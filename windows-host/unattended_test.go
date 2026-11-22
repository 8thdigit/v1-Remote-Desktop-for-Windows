package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"testing"
)

func TestStandingCodeMatchesRelay(t *testing.T) {
	// Same vector as the relay test: standingCode("A"*43) on the server.
	key := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	if got := standingCode(key); !codeFormat.MatchString(got) {
		t.Fatalf("code format: %q", got)
	}
	if standingCode(key) != standingCode(key) || standingCode(key) == standingCode("B"+key[1:]) {
		t.Fatal("code is not a stable function of the key")
	}
	if got, want := standingCode(key), "FAB848AE7CEB"; got != want {
		t.Fatalf("standingCode = %s, want %s", got, want)
	}
}

func TestUnattendedConfigPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "winss132r", unattendedFile)
	if _, ok, err := loadUnattended(path); ok || err != nil {
		t.Fatalf("missing config: %v %v", ok, err)
	}
	if _, err := enableUnattended(path, "https://example.com/?x=1"); err == nil {
		t.Fatal("accepted an invalid relay")
	}
	first, err := enableUnattended(path, " https://example.com/ ")
	if err != nil {
		t.Fatal(err)
	}
	if !tokenFormat.MatchString(first.Key) || first.Relay != "https://example.com" {
		t.Fatalf("config: %+v", first)
	}
	again, err := enableUnattended(path, "https://other.example.com")
	if err != nil || again.Key != first.Key || again.Relay != "https://other.example.com" {
		t.Fatalf("re-enable changed the key or kept the old relay: %+v %v", again, err)
	}
	loaded, ok, err := loadUnattended(path)
	if !ok || err != nil || loaded != again {
		t.Fatalf("loaded %+v %v %v", loaded, ok, err)
	}
	for i := 0; i < 2; i++ {
		if err := disableUnattended(path); err != nil {
			t.Fatal(err)
		}
	}
	if _, ok, _ := loadUnattended(path); ok {
		t.Fatal("config survived disable")
	}
}

func TestConnectStatus(t *testing.T) {
	for n, want := range map[int]string{0: "Connect: +00", 1: "Connect: +01", 9: "Connect: +09", 12: "Connect: +12", 120: "Connect: +120"} {
		if got := connectStatus(n); got != want {
			t.Errorf("connectStatus(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestInitiateRejected(t *testing.T) {
	if _, ok := initiateRejected(&statusError{status: 404, text: "x"}); !ok {
		t.Fatal("404 should be reported as an unsupported relay")
	}
	if _, ok := initiateRejected(fmt.Errorf("wrapped: %w", &statusError{status: 409})); !ok {
		t.Fatal("wrapped 409 should be reported")
	}
	if _, ok := initiateRejected(&statusError{status: 410}); ok {
		t.Fatal("410 means the registration ended and should restart the round")
	}
	if _, ok := initiateRejected(errors.New("dial tcp: timeout")); ok {
		t.Fatal("network errors should restart the round")
	}
}
