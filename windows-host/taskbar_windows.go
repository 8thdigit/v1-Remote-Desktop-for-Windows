package main

import (
	"syscall"
	"unsafe"
)

// Windows creates the taskbar button asynchronously and broadcasts this
// message again if Explorer recreates it.
var registerWindowMessage = user.NewProc("RegisterWindowMessageW")

type taskbarOverlay struct {
	object       *taskbarObject
	uninitialize *syscall.LazyProc
}

func newTaskbarOverlay() taskbarOverlay {
	ole := syscall.NewLazyDLL("ole32.dll")
	uninit := ole.NewProc("CoUninitialize")
	hr, _, _ := ole.NewProc("CoInitializeEx").Call(0, 2) // STA, on the client window thread.
	if int32(hr) < 0 {
		return taskbarOverlay{}
	}
	t := taskbarOverlay{uninitialize: uninit}
	class := syscall.GUID{Data1: 0x56fdf344, Data2: 0xfd6d, Data3: 0x11d0, Data4: [8]byte{0x95, 0x8a, 0x00, 0x60, 0x97, 0xc9, 0xa0, 0x90}}
	iface := syscall.GUID{Data1: 0xea1afb91, Data2: 0x9e28, Data3: 0x4b86, Data4: [8]byte{0x90, 0xe9, 0x9e, 0x9f, 0x8a, 0x5e, 0xef, 0xaf}}
	hr, _, _ = ole.NewProc("CoCreateInstance").Call(uintptr(unsafe.Pointer(&class)), 0, 1,
		uintptr(unsafe.Pointer(&iface)), uintptr(unsafe.Pointer(&t.object)))
	if int32(hr) < 0 {
		t.object = nil
	} else if t.object != nil {
		hr, _, _ = syscall.SyscallN(t.object.vtable[3], uintptr(unsafe.Pointer(t.object)))
		if int32(hr) >= 0 {
			return t
		}
		t.close()
		return taskbarOverlay{}
	}
	return t
}

type taskbarObject struct{ vtable *[19]uintptr }

func (t taskbarOverlay) set(window, icon uintptr, description *uint16) bool {
	if t.object == nil {
		return false
	}
	hr, _, _ := syscall.SyscallN(t.object.vtable[18], uintptr(unsafe.Pointer(t.object)), window, icon, uintptr(unsafe.Pointer(description)))
	return int32(hr) >= 0
}

func (t taskbarOverlay) close() {
	if t.object != nil {
		syscall.SyscallN(t.object.vtable[2], uintptr(unsafe.Pointer(t.object)))
	}
	if t.uninitialize != nil {
		t.uninitialize.Call()
	}
}
