//go:build windows

package internal

import (
	"os"
	"os/exec"
	"syscall"
	"unsafe"
)

const serviceName = "VisionOneAgent"

const (
	serviceWin32OwnProcess = 0x00000010
	serviceRunning         = 4
	serviceStopped         = 1
	serviceStartPending    = 2
	serviceStopPending     = 3
	controlStop            = 1
	controlShutdown        = 5
	controlInterrogate     = 4
	acceptStop             = 1
	acceptShutdown         = 4
)

var (
	advapi32                = syscall.NewLazyDLL("advapi32.dll")
	procStartSvcCtrlDisp    = advapi32.NewProc("StartServiceCtrlDispatcherW")
	procRegSvcCtrlHandlerEx = advapi32.NewProc("RegisterServiceCtrlHandlerExW")
	procSetServiceStatus    = advapi32.NewProc("SetServiceStatus")
)

type serviceStatus struct {
	ServiceType             uint32
	CurrentState            uint32
	ControlsAccepted        uint32
	Win32ExitCode           uint32
	ServiceSpecificExitCode uint32
	CheckPoint              uint32
	WaitHint                uint32
}

type serviceTableEntry struct {
	ServiceName *uint16
	ServiceProc uintptr
}

var (
	ssHandle uintptr
	svcStop  chan struct{}
	svcAgent *Agent
)

func setStatus(state, accepts uint32) {
	st := serviceStatus{ServiceType: serviceWin32OwnProcess, CurrentState: state, ControlsAccepted: accepts, WaitHint: 3000}
	procSetServiceStatus.Call(ssHandle, uintptr(unsafe.Pointer(&st)))
}

func handler(control, eventType, eventData, context uintptr) uintptr {
	switch uint32(control) {
	case controlStop, controlShutdown:
		setStatus(serviceStopPending, 0)
		if svcStop != nil {
			close(svcStop)
			svcStop = nil
		}
	case controlInterrogate:
		setStatus(serviceRunning, acceptStop|acceptShutdown)
	}
	return 0
}

func serviceMain(argc uint32, argv **uint16) uintptr {
	namePtr, _ := syscall.UTF16PtrFromString(serviceName)
	h, _, _ := procRegSvcCtrlHandlerEx.Call(uintptr(unsafe.Pointer(namePtr)), syscall.NewCallback(handler), 0)
	ssHandle = h
	setStatus(serviceStartPending, 0)

	svcStop = make(chan struct{})
	setStatus(serviceRunning, acceptStop|acceptShutdown)

	done := make(chan struct{})
	go func() { svcAgent.Run(svcStop); close(done) }()
	<-done

	setStatus(serviceStopped, 0)
	return 0
}

// RunService zažene agenta pod Windows Service Control Managerjem.
// Vrne napako (ni v storitvi), če ga poženemo iz konzole – tedaj teče v ospredju.
func RunService(a *Agent) bool {
	svcAgent = a
	namePtr, _ := syscall.UTF16PtrFromString(serviceName)
	table := []serviceTableEntry{
		{ServiceName: namePtr, ServiceProc: syscall.NewCallback(serviceMain)},
		{},
	}
	r, _, _ := procStartSvcCtrlDisp.Call(uintptr(unsafe.Pointer(&table[0])))
	return r != 0 // uspeh = tekli smo kot storitev
}

// InstallService registrira storitev prek sc.exe (teče samodejno ob zagonu kot SYSTEM).
func InstallService() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	bin := `"` + exe + `" run`
	if out, err := exec.Command("sc", "create", serviceName, "binPath=", bin, "start=", "auto", "DisplayName=", "VisionOne Agent").CombinedOutput(); err != nil {
		return osErr("sc create", out, err)
	}
	exec.Command("sc", "description", serviceName, "Nadzorni agent VisionOne.").Run()
	exec.Command("sc", "failure", serviceName, "reset=", "86400", "actions=", "restart/5000/restart/5000/restart/5000").Run()
	if out, err := exec.Command("sc", "start", serviceName).CombinedOutput(); err != nil {
		return osErr("sc start", out, err)
	}
	return nil
}

func UninstallService() error {
	exec.Command("sc", "stop", serviceName).Run()
	if out, err := exec.Command("sc", "delete", serviceName).CombinedOutput(); err != nil {
		return osErr("sc delete", out, err)
	}
	return nil
}

func osErr(ctx string, out []byte, err error) error {
	return &svcError{ctx: ctx, out: string(out), err: err}
}

type svcError struct {
	ctx, out string
	err      error
}

func (e *svcError) Error() string { return e.ctx + ": " + e.err.Error() + " " + e.out }
