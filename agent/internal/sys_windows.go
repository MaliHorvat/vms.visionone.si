//go:build windows

package internal

import (
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32            = syscall.NewLazyDLL("kernel32.dll")
	procGlobalMemStatus = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetDiskFreeEx   = kernel32.NewProc("GetDiskFreeSpaceExW")
	procGetSystemTimes  = kernel32.NewProc("GetSystemTimes")
)

type memStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

func hostMetrics(diskPath string) (cpu, mem, disk float64) {
	mem = memPercentWin()
	if diskPath == "" {
		diskPath = "C:\\"
	}
	disk = diskPercentWin(diskPath)
	cpu = cpuPercentWin()
	return
}

func memPercentWin() float64 {
	var m memStatusEx
	m.Length = uint32(unsafe.Sizeof(m))
	r, _, _ := procGlobalMemStatus.Call(uintptr(unsafe.Pointer(&m)))
	if r == 0 {
		return 0
	}
	return float64(m.MemoryLoad)
}

func diskPercentWin(path string) float64 {
	var freeAvail, total, totalFree uint64
	p, _ := syscall.UTF16PtrFromString(path)
	r, _, _ := procGetDiskFreeEx.Call(uintptr(unsafe.Pointer(p)),
		uintptr(unsafe.Pointer(&freeAvail)), uintptr(unsafe.Pointer(&total)), uintptr(unsafe.Pointer(&totalFree)))
	if r == 0 || total == 0 {
		return 0
	}
	return (1 - float64(totalFree)/float64(total)) * 100
}

func fileTimeToUint64(ft [2]uint32) uint64 { return uint64(ft[1])<<32 | uint64(ft[0]) }

func sysTimes() (idle, kernel, user uint64) {
	var i, k, u [2]uint32
	procGetSystemTimes.Call(uintptr(unsafe.Pointer(&i)), uintptr(unsafe.Pointer(&k)), uintptr(unsafe.Pointer(&u)))
	return fileTimeToUint64(i), fileTimeToUint64(k), fileTimeToUint64(u)
}

func cpuPercentWin() float64 {
	i1, k1, u1 := sysTimes()
	time.Sleep(200 * time.Millisecond)
	i2, k2, u2 := sysTimes()
	idle := float64(i2 - i1)
	total := float64((k2 - k1) + (u2 - u1))
	if total <= 0 {
		return 0
	}
	return (1 - idle/total) * 100
}
