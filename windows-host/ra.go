package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// An RA (remote access) ID names the company this PC's remote access points
// to. That company sees the PC when it signs in to the relay, and gets its
// Initiate requests. It is six digits, shown as RA-123456.

// normalizeRA accepts "RA-123456", "ra 123456", "123456" or "123 456". An
// empty value clears the setting and is valid.
func normalizeRA(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", true
	}
	rest := strings.TrimSpace(strings.ToUpper(value))
	rest = strings.TrimLeft(strings.TrimPrefix(rest, "RA"), "-: ")
	var digits strings.Builder
	for _, r := range rest {
		switch {
		case r >= '0' && r <= '9':
			digits.WriteRune(r)
		case r == ' ' || r == '-':
		default:
			return "", false
		}
	}
	if digits.Len() != 6 {
		return "", false
	}
	return digits.String(), true
}

// formatRA shows an RA ID the way the relay's console does.
func formatRA(ra string) string {
	if ra == "" {
		return ""
	}
	return "RA-" + ra
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

// raStatusText describes where this PC's remote access points, from what the
// relay said about the RA ID at the last registration.
func raStatusText(ra, status, company string) string {
	switch {
	case ra == "":
		return "No RA ID set: requests reach anyone who saved this PC's access code."
	case status == "ok" && company != "":
		return "Remote access points to " + formatRA(ra) + " (" + company + ")."
	case status == "ok":
		return "Remote access points to " + formatRA(ra) + "."
	case status == "unknown":
		return formatRA(ra) + " does not belong to any company on this relay. Check the RA ID."
	}
	return "Remote access points to " + formatRA(ra) + "."
}
