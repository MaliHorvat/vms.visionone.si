//go:build linux

package internal

import (
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// hostMetrics vrne CPU %, RAM %, disk % (korenski ali podan path).
func hostMetrics(diskPath string) (cpu, mem, disk float64) {
	cpu = cpuPercentLinux()
	mem = memPercentLinux()
	if diskPath == "" {
		diskPath = "/"
	}
	disk = diskPercent(diskPath)
	return
}

func readCPU() (idle, total uint64) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "cpu ") {
			f := strings.Fields(line)[1:]
			for i, v := range f {
				n, _ := strconv.ParseUint(v, 10, 64)
				total += n
				if i == 3 { // idle
					idle = n
				}
			}
			return
		}
	}
	return
}

func cpuPercentLinux() float64 {
	i1, t1 := readCPU()
	time.Sleep(200 * time.Millisecond)
	i2, t2 := readCPU()
	dt := float64(t2 - t1)
	if dt <= 0 {
		return 0
	}
	return (1 - float64(i2-i1)/dt) * 100
}

func memPercentLinux() float64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	var total, avail float64
	for _, line := range strings.Split(string(data), "\n") {
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		v, _ := strconv.ParseFloat(f[1], 64)
		switch f[0] {
		case "MemTotal:":
			total = v
		case "MemAvailable:":
			avail = v
		}
	}
	if total == 0 {
		return 0
	}
	return (1 - avail/total) * 100
}

func diskPercent(path string) float64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0
	}
	total := float64(st.Blocks) * float64(st.Bsize)
	free := float64(st.Bavail) * float64(st.Bsize)
	if total == 0 {
		return 0
	}
	return (1 - free/total) * 100
}
