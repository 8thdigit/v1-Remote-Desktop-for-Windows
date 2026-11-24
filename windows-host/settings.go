package main

import (
	"errors"
	"os"
	"path/filepath"
)

// defaultRelayAddress prefills the relay box when nothing is saved. The
// Vercel site serves the viewer and proxies /api to the relay on Render, so
// one origin works for the host, the viewer and shared links. Users can
// replace it with any other relay and Save it.
const defaultRelayAddress = "https://connect-ai-nine.vercel.app"

// Only the relay origin is saved. Pairing codes and session tokens are not
// preferences and must never be written here.
func loadRelayAddress(path string) (string, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	r, err := newRelay(string(data))
	if err != nil {
		return "", err
	}
	return r.origin, nil
}

func saveRelayAddress(path, value string) error {
	r, err := newRelay(value)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(r.origin+"\n"), 0600)
}

func forgetRelayAddress(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
