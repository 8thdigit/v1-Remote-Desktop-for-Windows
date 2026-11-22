package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testLink(now time.Time) savedLink {
	return savedLink{ID: "abcdefgh", Code: "L0123456789A", Pin: "042137", Key: strings.Repeat("k", 43), Name: "PC",
		Relay: "https://msfwr.vercel.app", CreatedAt: now.UnixMilli(), ExpiresAt: now.Add(24 * time.Hour).UnixMilli(), Hours: 24}
}

func TestSavedLinkRoundTripAndClear(t *testing.T) {
	now := time.Now()
	path := filepath.Join(t.TempDir(), "links.json")
	if l, err := loadLink(path, now); l != nil || err != nil {
		t.Fatalf("no file should mean no link: %v %v", l, err)
	}
	want := testLink(now)
	if err := saveLink(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := loadLink(path, now)
	if err != nil || got == nil || *got != want {
		t.Fatalf("loadLink = %+v, %v", got, err)
	}
	if got.shareURL() != "https://msfwr.vercel.app/r/L0123456789A" {
		t.Fatalf("shareURL = %s", got.shareURL())
	}
	if got.shareText() != "https://msfwr.vercel.app/r/L0123456789A\r\nAccess code: 042137" {
		t.Fatalf("shareText = %q", got.shareText())
	}
	if l, _ := loadLink(path, now.Add(25*time.Hour)); l != nil {
		t.Fatal("an expired link was still shown")
	}
	if err := forgetLink(path); err != nil {
		t.Fatal(err)
	}
	if l, _ := loadLink(path, now); l != nil {
		t.Fatal("link survived Clear")
	}
	if err := forgetLink(path); err != nil {
		t.Fatal("clearing twice should be fine:", err)
	}
}

func TestLoadLinkReadsOlderListFilesAndSkipsBadEntries(t *testing.T) {
	now := time.Now()
	path := filepath.Join(t.TempDir(), "links.json")
	newest := testLink(now)
	noPin := newest
	noPin.ID, noPin.Pin = "older", ""
	data := `[{"id":"x","code":"bad","key":"k"},` + mustJSON(t, newest) + `,` + mustJSON(t, noPin) + `]`
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := loadLink(path, now)
	if err != nil || got == nil || got.ID != newest.ID {
		t.Fatalf("loadLink = %+v, %v", got, err)
	}
	if err := os.WriteFile(path, []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadLink(path, now); err == nil {
		t.Fatal("a damaged file was not reported")
	}
}

func TestLinkTexts(t *testing.T) {
	if formatValidity(24) != "24 hours" || formatValidity(48) != "2 days" || formatValidity(1) != "1 hour" || formatValidity(5) != "5 hours" {
		t.Fatal("formatValidity")
	}
	now := time.Date(2026, 11, 22, 10, 0, 0, 0, time.Local)
	if got := timeLeft(now.Add(5*time.Hour+20*time.Minute).UnixMilli(), now); got != "expires in 5h 20m" {
		t.Fatal(got)
	}
	if got := linkSummary(nil, now); !strings.Contains(got, "No remote access URL") {
		t.Fatal(got)
	}
	l := testLink(now)
	if got := linkSummary(&l, now); !strings.Contains(got, "expires in 1d 00h") {
		t.Fatal(got)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
