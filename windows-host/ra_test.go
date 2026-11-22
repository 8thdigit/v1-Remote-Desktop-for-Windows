package main

import (
	"path/filepath"
	"testing"
)

func TestNormalizeRA(t *testing.T) {
	for in, want := range map[string]string{"RA-123456": "123456", "ra 123456": "123456", "123 456": "123456", " 654321 ": "654321", "": ""} {
		got, ok := normalizeRA(in)
		if !ok || got != want {
			t.Errorf("normalizeRA(%q) = %q, %v; want %q", in, got, ok, want)
		}
	}
	for _, in := range []string{"12345", "1234567", "RB-123456", "12a456", "RA-12345x"} {
		if _, ok := normalizeRA(in); ok {
			t.Errorf("normalizeRA(%q) accepted a bad RA ID", in)
		}
	}
}

func TestSetUnattendedRAKeepsTheAccessCode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "unattended.json")
	if _, err := setUnattendedRA(path, "RA-123456"); err == nil {
		t.Fatal("set an RA ID before unattended access was on")
	}
	first, err := enableUnattended(path, "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := setUnattendedRA(path, "nope"); err == nil {
		t.Fatal("accepted an invalid RA ID")
	}
	changed, err := setUnattendedRA(path, "RA-123456")
	if err != nil || changed.RA != "123456" || changed.Key != first.Key {
		t.Fatalf("setUnattendedRA = %+v, %v", changed, err)
	}
	loaded, ok, err := loadUnattended(path)
	if !ok || err != nil || loaded.RA != "123456" {
		t.Fatalf("RA ID was not saved: %+v %v %v", loaded, ok, err)
	}
	again, err := enableUnattended(path, "https://example.org")
	if err != nil || again.RA != "123456" || again.Key != first.Key {
		t.Fatalf("re-enabling lost the RA ID or key: %+v %v", again, err)
	}
	cleared, err := setUnattendedRA(path, "")
	if err != nil || cleared.RA != "" {
		t.Fatalf("clearing = %+v, %v", cleared, err)
	}
}

func TestRAStatusText(t *testing.T) {
	if got := raStatusText("123456", "ok", "Acme Ltd"); got != "Remote access points to RA-123456 (Acme Ltd)." {
		t.Fatal(got)
	}
	if got := raStatusText("123456", "unknown", ""); got != "RA-123456 does not belong to any company on this relay. Check the RA ID." {
		t.Fatal(got)
	}
}
