package main

import (
	"path/filepath"
	"testing"
	"time"
)

func TestNormalizeRA(t *testing.T) {
	for in, want := range map[string]string{"RA-123456": "123456", "123456": "123456", " ra 123 456 ": "123456", "": ""} {
		if got, ok := normalizeRA(in); !ok || got != want {
			t.Errorf("normalizeRA(%q) = %q, %v", in, got, ok)
		}
	}
	for _, bad := range []string{"12345", "1234567", "RA-12x456", "hello"} {
		if _, ok := normalizeRA(bad); ok {
			t.Errorf("normalizeRA(%q) accepted", bad)
		}
	}
	if formatRA("123456") != "RA-123456" || formatRA("") != "not set" {
		t.Fatal("formatRA")
	}
}

func TestUnattendedRAKeepsTheAccessCode(t *testing.T) {
	path := filepath.Join(t.TempDir(), "winss132r", unattendedFile)
	if _, err := setUnattendedRA(path, "RA-123456"); err == nil {
		t.Fatal("set an RA ID without unattended access")
	}
	first, err := enableUnattended(path, "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := setUnattendedRA(path, "12"); err == nil {
		t.Fatal("accepted a short RA ID")
	}
	changed, err := setUnattendedRA(path, "RA-654321")
	if err != nil || changed.RA != "654321" || changed.Key != first.Key {
		t.Fatalf("setUnattendedRA: %+v %v", changed, err)
	}
	again, err := enableUnattended(path, "https://other.example.com")
	if err != nil || again.RA != "654321" || again.Key != first.Key {
		t.Fatalf("re-enable lost the RA ID: %+v %v", again, err)
	}
	loaded, ok, err := loadUnattended(path)
	if !ok || err != nil || loaded.RA != "654321" {
		t.Fatalf("load: %+v %v %v", loaded, ok, err)
	}
	ra := filepath.Join(t.TempDir(), "ra.txt")
	if err := saveRAAddress(ra, "111222"); err != nil || loadRAAddress(ra) != "111222" {
		t.Fatal("attended RA ID was not saved")
	}
	if err := saveRAAddress(ra, ""); err != nil || loadRAAddress(ra) != "" {
		t.Fatal("attended RA ID was not cleared")
	}
}

func TestAdaptiveQuality(t *testing.T) {
	q := newAdaptiveQuality()
	start := q.level
	if !q.observe(400*time.Millisecond) || q.level != start-1 {
		t.Fatalf("slow upload did not step down: %d", q.level)
	}
	if !q.observe(time.Second) || q.level != 0 {
		t.Fatalf("very slow upload did not step down twice: %d", q.level)
	}
	for i := 0; i < 11; i++ {
		if q.observe(30 * time.Millisecond) {
			t.Fatal("stepped up too early")
		}
	}
	if !q.observe(30*time.Millisecond) || q.level != 1 {
		t.Fatalf("fast uploads did not step up: %d", q.level)
	}
	if w, h := qualityLevels[1].fitted(2560, 1440); w != 1280 || h != 720 {
		t.Fatalf("fitted = %dx%d", w, h)
	}
	if w, h := qualityLevels[3].fitted(1366, 768); w != 1366 || h != 768 {
		t.Fatalf("small screens must not be scaled up: %dx%d", w, h)
	}
}
