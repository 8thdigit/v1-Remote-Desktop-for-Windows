package main

import (
	"strings"
	"testing"
	"time"
)

func TestVersionText(t *testing.T) {
	old := version
	defer func() { version = old }()
	for in, want := range map[string]string{
		"v0.3.2":           "Connect.AI v0.3.2 · Windows x64",
		"v0.3.2-4-gabc123": "Connect.AI v0.3.2-4-gabc123 · Windows x64",
		"":                 "Connect.AI dev · Windows x64",
		"bad version\n":    "Connect.AI dev · Windows x64",
	} {
		version = in
		if got := versionText(); got != want {
			t.Errorf("version %q: got %q, want %q", in, got, want)
		}
	}
}

func TestFormatDuration(t *testing.T) {
	for d, want := range map[time.Duration]string{
		-time.Second:                   "0s",
		45 * time.Second:               "45s",
		5*time.Minute + 12*time.Second: "5m 12s",
		2*time.Hour + 3*time.Minute:    "2h 03m",
	} {
		if got := formatDuration(d); got != want {
			t.Errorf("%v: got %q, want %q", d, got, want)
		}
	}
}

func TestSessionLog(t *testing.T) {
	var l sessionLog
	now := time.Date(2026, 11, 22, 14, 0, 0, 0, time.Local)
	if got := l.activeText(now); got != "No one is connected." {
		t.Fatalf("idle: %q", got)
	}
	l.begin(now)
	if got := l.activeText(now.Add(90 * time.Second)); !strings.Contains(got, "since 14:00:00 (1m 30s)") {
		t.Fatalf("live: %q", got)
	}
	l.finish(now.Add(2*time.Minute), "Remote session ended.")
	l.finish(now.Add(3*time.Minute), "ignored: nothing live")
	if _, ok := l.live(); ok {
		t.Fatal("session still live after finish")
	}
	lines := l.lines(now.Add(5 * time.Minute))
	if len(lines) != 1 || lines[0] != "14:00:00 – 14:02:00  (2m 00s)  Remote session ended." {
		t.Fatalf("history: %q", lines)
	}
	for i := 0; i < maxSessionRecords+3; i++ {
		l.begin(now)
		l.finish(now, "")
	}
	if len(l.records) != maxSessionRecords {
		t.Fatalf("kept %d records", len(l.records))
	}
}
