package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRememberAndForgetRelayAddress(t *testing.T) {
	path := filepath.Join(t.TempDir(), "winss132r", "relay.txt")
	if got, err := loadRelayAddress(path); got != "" || err != nil {
		t.Fatalf("missing setting: %q, %v", got, err)
	}
	if err := saveRelayAddress(path, " https://example.com:8443/ "); err != nil {
		t.Fatal(err)
	}
	if err := saveRelayAddress(path, "https://example.com/?token=example"); err == nil {
		t.Fatal("accepted a relay URL containing a query string")
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != "https://example.com:8443\n" {
		t.Fatalf("stored content: %q, %v", content, err)
	}
	if got, err := loadRelayAddress(path); got != "https://example.com:8443" || err != nil {
		t.Fatalf("saved setting: %q, %v", got, err)
	}
	for i := 0; i < 2; i++ {
		if err := forgetRelayAddress(path); err != nil {
			t.Fatal(err)
		}
	}
	if got, err := loadRelayAddress(path); got != "" || err != nil {
		t.Fatalf("forgotten setting: %q, %v", got, err)
	}
}
