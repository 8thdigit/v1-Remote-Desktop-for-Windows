package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// unattendedConfig is the saved, pre-approved access for this PC. The key is
// a long random secret that never leaves the PC except to the relay; the
// access code that IT types into the viewer is derived from it (see
// standingCode), so the code stays the same across restarts.
type unattendedConfig struct {
	Relay string `json:"relay"`
	Key   string `json:"key"`
}

const unattendedFile = "unattended.json"

// standingCode must match standingCode in artifacts/api-server/src/lib/deskline.ts.
func standingCode(key string) string {
	sum := sha256.Sum256([]byte("winss132r-standing:" + key))
	return strings.ToUpper(hex.EncodeToString(sum[:6]))
}

func formatCode(code string) string {
	if len(code) != 12 {
		return code
	}
	return code[:4] + "-" + code[4:8] + "-" + code[8:]
}

func newUnattendedKey() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

// loadUnattended returns ok=false when unattended access is not set up.
func loadUnattended(path string) (unattendedConfig, bool, error) {
	var c unattendedConfig
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return c, false, nil
	}
	if err != nil {
		return c, false, err
	}
	if err := json.Unmarshal(data, &c); err != nil {
		return c, false, errors.New("the saved unattended access settings are damaged")
	}
	r, err := newRelay(c.Relay)
	if err != nil {
		return c, false, err
	}
	if !tokenFormat.MatchString(c.Key) {
		return c, false, errors.New("the saved unattended access key is invalid")
	}
	c.Relay = r.origin
	return c, true, nil
}

// enableUnattended keeps an existing key for the same file so the access
// code IT recorded keeps working, and creates one otherwise.
func enableUnattended(path, relayAddress string) (unattendedConfig, error) {
	r, err := newRelay(relayAddress)
	if err != nil {
		return unattendedConfig{}, err
	}
	c, ok, _ := loadUnattended(path)
	if !ok {
		if c.Key, err = newUnattendedKey(); err != nil {
			return unattendedConfig{}, err
		}
	}
	c.Relay = r.origin
	data, err := json.Marshal(c)
	if err != nil {
		return unattendedConfig{}, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return unattendedConfig{}, err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0600); err != nil {
		return unattendedConfig{}, err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return unattendedConfig{}, err
	}
	return c, nil
}

func disableUnattended(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
