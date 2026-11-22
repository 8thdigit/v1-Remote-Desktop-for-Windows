package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// An RA ID names the portal user (IT staff) who should get this PC's
// Initiate requests. It is six digits, shown as RA-123456.

// normalizeRA accepts "RA-123456", "123456" or "123 456". An empty value
// clears the setting and is valid.
func normalizeRA(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", true
	}
	var digits strings.Builder
	for _, r := range value {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	d := digits.String()
	upper := strings.ToUpper(value)
	rest := strings.TrimLeft(strings.TrimPrefix(strings.TrimSpace(upper), "RA"), "-: ")
	for _, r := range rest {
		if !(r >= '0' && r <= '9') && r != ' ' && r != '-' {
			return "", false
		}
	}
	if len(d) != 6 {
		return "", false
	}
	return d, true
}

func formatRA(ra string) string {
	if ra == "" {
		return "not set"
	}
	return "RA-" + ra
}

const raHelp = "Enter the RA ID of the IT person who should get this PC's requests, such as RA-123456. They see it in the winss132r portal."

func loadRAAddress(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	ra, ok := normalizeRA(string(data))
	if !ok {
		return ""
	}
	return ra
}

func saveRAAddress(path, ra string) error {
	if ra == "" {
		err := os.Remove(path)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(ra+"\n"), 0600)
}

func saveUnattended(path string, c unattendedConfig) error {
	data, err := json.Marshal(c)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// setUnattendedRA changes only the RA ID of the saved unattended access, so
// the access code stays the same.
func setUnattendedRA(path, value string) (unattendedConfig, error) {
	ra, ok := normalizeRA(value)
	if !ok {
		return unattendedConfig{}, errors.New("an RA ID is six digits, such as RA-123456")
	}
	c, found, err := loadUnattended(path)
	if err != nil {
		return unattendedConfig{}, err
	}
	if !found {
		return unattendedConfig{}, errors.New("unattended access is not set up")
	}
	c.RA = ra
	return c, saveUnattended(path, c)
}
