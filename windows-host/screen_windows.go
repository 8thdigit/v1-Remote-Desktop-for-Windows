package main

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"syscall"
	"unsafe"
)

var (
	user          = syscall.NewLazyDLL("user32.dll")
	gdi           = syscall.NewLazyDLL("gdi32.dll")
	getDC         = user.NewProc("GetDC")
	releaseDC     = user.NewProc("ReleaseDC")
	getMetrics    = user.NewProc("GetSystemMetrics")
	getAsyncKey   = user.NewProc("GetAsyncKeyState")
	openDesktop   = user.NewProc("OpenInputDesktop")
	closeDesktop  = user.NewProc("CloseDesktop")
	getObjectInfo = user.NewProc("GetUserObjectInformationW")
	createDC      = gdi.NewProc("CreateCompatibleDC")
	deleteDC      = gdi.NewProc("DeleteDC")
	createDIB     = gdi.NewProc("CreateDIBSection")
	selectObject  = gdi.NewProc("SelectObject")
	deleteObject  = gdi.NewProc("DeleteObject")
	stretch       = gdi.NewProc("StretchBlt")
	stretchMode   = gdi.NewProc("SetStretchBltMode")
)

func setDPI() {
	dpi := user.NewProc("SetProcessDpiAwarenessContext")
	if dpi.Find() != nil {
		user.NewProc("SetProcessDPIAware").Call()
		return
	}
	if ok, _, _ := dpi.Call(^uintptr(3)); ok == 0 {
		user.NewProc("SetProcessDPIAware").Call()
	}
}

func stopPressed() bool {
	keyDown := func(key uintptr) bool {
		v, _, _ := getAsyncKey.Call(key)
		return v&0x8000 != 0
	}
	return (keyDown(0x11) && keyDown(0x32)) || keyDown(0x7b)
}

func onDefaultDesktop() bool {
	d, _, _ := openDesktop.Call(0, 0, 1)
	if d == 0 {
		return false
	}
	defer closeDesktop.Call(d)
	var buf [128]uint16
	var size uint32
	ok, _, _ := getObjectInfo.Call(d, 2, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)*2), uintptr(unsafe.Pointer(&size)))
	return ok != 0 && syscall.UTF16ToString(buf[:]) == "Default"
}

func metric(which uintptr) int {
	n, _, _ := getMetrics.Call(which)
	return int(int32(n))
}

func sameScreen(w, h int) bool { return metric(0) == w && metric(1) == h }

type dibInfo struct {
	Size                                            uint32
	Width, Height                                   int32
	Planes, Bits                                    uint16
	Compression, ImageSize, X, Y, Colors, Important uint32
}

func fitted(w, h int) (int, int) {
	if w > 1280 {
		h = max(1, h*1280/w)
		w = 1280
	}
	if h > 800 {
		w = max(1, w*800/h)
		h = 800
	}
	return w, h
}

func snapshot() (*image.RGBA, int, int, error) {
	fail := errors.New("could not capture the primary screen")
	w, h := metric(0), metric(1)
	if w <= 0 || h <= 0 || w > 32768 || h > 32768 {
		return nil, 0, 0, fail
	}
	dw, dh := fitted(w, h)
	src, _, _ := getDC.Call(0)
	if src == 0 {
		return nil, 0, 0, fail
	}
	defer releaseDC.Call(0, src)
	dst, _, _ := createDC.Call(src)
	if dst == 0 {
		return nil, 0, 0, fail
	}
	defer deleteDC.Call(dst)
	info := dibInfo{Size: 40, Width: int32(dw), Height: -int32(dh), Planes: 1, Bits: 32}
	var pixel *byte
	bitmap, _, _ := createDIB.Call(dst, uintptr(unsafe.Pointer(&info)), 0, uintptr(unsafe.Pointer(&pixel)), 0, 0)
	if bitmap == 0 || pixel == nil {
		return nil, 0, 0, fail
	}
	defer deleteObject.Call(bitmap)
	old, _, _ := selectObject.Call(dst, bitmap)
	if old == 0 || old == ^uintptr(0) {
		return nil, 0, 0, fail
	}
	defer selectObject.Call(dst, old)
	stretchMode.Call(dst, 3)
	ret, _, _ := stretch.Call(dst, 0, 0, uintptr(dw), uintptr(dh), src, 0, 0, uintptr(w), uintptr(h), 0x40cc0020)
	if ret == 0 {
		return nil, 0, 0, fail
	}
	gdi.NewProc("GdiFlush").Call()
	bgra := unsafe.Slice(pixel, dw*dh*4)
	img := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for i := 0; i < len(bgra); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = bgra[i+2], bgra[i+1], bgra[i], 255
	}
	return img, w, h, nil
}

func encodeJPEG(img image.Image) ([]byte, error) {
	for _, quality := range []int{58, 40, 25} {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
			return nil, err
		}
		if buf.Len() <= 768*1024 {
			return buf.Bytes(), nil
		}
	}
	return nil, errors.New("screen frame is too large for the relay")
}
