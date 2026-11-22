package main

import (
	"encoding/binary"
	"math"
	"strings"
	"time"
	"unicode/utf16"
	"unsafe"
)

var sendInput = user.NewProc("SendInput")
var setCursor = user.NewProc("SetCursorPos")
var vkScan = user.NewProc("VkKeyScanW")

// The Windows x64 INPUT structure consists of a 4-byte type, 4 bytes of
// alignment padding, and a 32-byte union.
type nativeInput struct {
	kind, pad uint32
	data      [32]byte
}

func emit(inputs ...nativeInput) {
	if len(inputs) > 0 {
		sendInput.Call(uintptr(len(inputs)), uintptr(unsafe.Pointer(&inputs[0])), unsafe.Sizeof(inputs[0]))
	}
}
func mouse(flags uint32, value int32) nativeInput {
	var n nativeInput
	binary.LittleEndian.PutUint32(n.data[8:], uint32(value))
	binary.LittleEndian.PutUint32(n.data[12:], flags)
	return n
}
func keyboard(vk, scan uint16, flags uint32) nativeInput {
	n := nativeInput{kind: 1}
	binary.LittleEndian.PutUint16(n.data[0:], vk)
	binary.LittleEndian.PutUint16(n.data[2:], scan)
	binary.LittleEndian.PutUint32(n.data[4:], flags)
	return n
}

type controls struct {
	pressed     [3]bool
	lastPointer time.Time
}

var mouseDown = [3]uint32{2, 32, 8}
var mouseUp = [3]uint32{4, 64, 16}

func newControls() *controls { return &controls{} }
func (c *controls) release() {
	for i, down := range c.pressed {
		if down {
			emit(mouse(mouseUp[i], 0))
			c.pressed[i] = false
		}
	}
}

func (c *controls) apply(e event, w, h int) {
	switch e.Kind {
	case "release":
		c.release()
	case "key":
		tap(e)
	case "down", "up", "move", "wheel":
		if math.IsNaN(e.X) || math.IsNaN(e.Y) || e.X < 0 || e.X > 1 || e.Y < 0 || e.Y > 1 {
			return
		}
		if ok, _, _ := setCursor.Call(uintptr(math.Round(e.X*float64(w-1))), uintptr(math.Round(e.Y*float64(h-1)))); ok == 0 {
			c.release()
			return
		}
		c.lastPointer = time.Now()
		if e.Kind == "wheel" {
			if e.Delta == 1 || e.Delta == -1 {
				emit(mouse(0x800, int32(120*e.Delta)))
			}
		} else if e.Button >= 0 && e.Button < len(c.pressed) {
			switch e.Kind {
			case "down":
				if !c.pressed[e.Button] {
					emit(mouse(mouseDown[e.Button], 0))
					c.pressed[e.Button] = true
				}
			case "up":
				if c.pressed[e.Button] {
					emit(mouse(mouseUp[e.Button], 0))
					c.pressed[e.Button] = false
				}
			}
		}
	}
}

var keys = map[string]uint16{
	"Backspace": 8, "Tab": 9, "Enter": 13, "Escape": 27,
	"PageUp": 33, "PageDown": 34, "End": 35, "Home": 36,
	"ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39, "ArrowDown": 40,
	"Insert": 45, "Delete": 46,
	"F1": 112, "F2": 113, "F3": 114, "F4": 115, "F5": 116, "F6": 117,
	"F7": 118, "F8": 119, "F9": 120, "F10": 121, "F11": 122,
}

func tap(e event) {
	runes := []rune(e.Key)
	if len(runes) == 1 && !e.Ctrl && !e.Alt {
		if runes[0] < 32 || (runes[0] >= 127 && runes[0] < 160) {
			return
		}
		var inputs []nativeInput
		for _, u := range utf16.Encode(runes) {
			inputs = append(inputs, keyboard(0, u, 4), keyboard(0, u, 6))
		}
		emit(inputs...)
		return
	}
	vk, permitted := keys[e.Key]
	if !permitted {
		if len(runes) != 1 || runes[0] > 127 || runes[0] < 32 {
			return
		}
		n, _, _ := vkScan.Call(uintptr(runes[0]))
		if uint16(n) == 0xffff {
			return
		}
		vk = uint16(n) & 0xff
	}
	// Never send the Windows security sequence or Msfwr's local stop key.
	if (e.Ctrl && (vk == 0x32 || (e.Alt && vk == 46))) || strings.EqualFold(e.Key, "F12") {
		return
	}
	var mods []uint16
	if e.Ctrl {
		mods = append(mods, 17)
	}
	if e.Shift {
		mods = append(mods, 16)
	}
	if e.Alt {
		mods = append(mods, 18)
	}
	var inputs []nativeInput
	for _, m := range mods {
		inputs = append(inputs, keyboard(m, 0, 0))
	}
	var flags uint32
	if vk >= 33 && vk <= 46 {
		flags = 1
	}
	inputs = append(inputs, keyboard(vk, 0, flags), keyboard(vk, 0, flags|2))
	for i := len(mods) - 1; i >= 0; i-- {
		inputs = append(inputs, keyboard(mods[i], 0, 2))
	}
	emit(inputs...)
}
