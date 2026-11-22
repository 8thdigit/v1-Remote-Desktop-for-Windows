//go:build windows

package main

import (
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"unsafe"
)

// pickValidity asks how long a new remote access link stays valid. The
// default is 24 hours; the user can choose other values such as 4 or 5 by
// typing the number. It returns false if the user cancels.
func pickValidity(window uintptr) (int, bool) {
	text, ok := inputDialog(window, "Remote access URL validity",
		"How long should this link stay valid?\n\n"+
			"Pick hours: 1, 2, 4, 5, 8, 12, 24, 48, 72 or 120.\n"+
			"(Default: 24 hours)")
	if !ok {
		return 0, false
	}
	trimmed := strings.TrimSpace(strings.ToLower(text))
	if trimmed == "" {
		return defaultLinkHours, true
	}
	hours, err := strconv.Atoi(trimmed)
	if err != nil || !validLinkHours(hours) {
		warn, _ := syscall.UTF16PtrFromString("Choose one of: 1, 2, 4, 5, 8, 12, 24, 48, 72, 120 hours.")
		title, _ := syscall.UTF16PtrFromString("Msfwr")
		messageBox.Call(window, uintptr(unsafe.Pointer(warn)),
			uintptr(unsafe.Pointer(title)), 0x30) // MB_ICONWARNING
		return 0, false
	}
	return hours, true
}

// inputDialog asks for one line of text with a prefilled default. It uses a
// Windows Forms InputBox through PowerShell so no custom dialog code is
// needed; when PowerShell is unavailable the default is accepted silently.
func inputDialog(window uintptr, title, prompt string) (string, bool) {
	_ = window
	script := "Add-Type -AssemblyName Microsoft.VisualBasic | Out-Null; " +
		"$v = [Microsoft.VisualBasic.Interaction]::InputBox(" +
		quotePS(prompt) + ", " + quotePS(title) + ", '" + strconv.Itoa(defaultLinkHours) + "'); " +
		"[Console]::Out.Write($v)"
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil && len(out) == 0 {
		return "", true // fall back to the default when there is no dialog host
	}
	return strings.TrimSpace(string(out)), true
}

func quotePS(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}
