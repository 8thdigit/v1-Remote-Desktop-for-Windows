package main

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// version is set at build time with -ldflags "-X main.version=v0.3.2"
// (see build.sh). Local builds without a tag report "dev".
var version = "dev"

var versionFormat = regexp.MustCompile(`^v?[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$`)

// versionText is the version line shown in the Msfwr window.
func versionText() string {
	v := strings.TrimSpace(version)
	if !versionFormat.MatchString(v) {
		v = "dev"
	}
	return "Connect.AI " + v + " · Windows x64"
}

// stateLabel is the headline for an unattended state in the Msfwr window.
func stateLabel(state string, connections int) string {
	switch state {
	case "connected":
		return "● Connected: IT is viewing and controlling this PC (" + connectStatus(connections) + ")"
	case "calling":
		return "● Request sent: waiting for IT to accept"
	case "offline":
		return "● Offline: cannot reach the relay"
	case "locked":
		return "● Paused: Windows is locked"
	}
	return "● Ready: unattended access is on"
}

// formatDuration renders an elapsed time such as "45s", "5m 12s" or "2h 03m".
func formatDuration(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	d = d.Round(time.Second)
	switch {
	case d < time.Minute:
		return strconv.Itoa(int(d.Seconds())) + "s"
	case d < time.Hour:
		return strconv.Itoa(int(d.Minutes())) + "m " + twoDigits(int(d.Seconds())%60) + "s"
	}
	return strconv.Itoa(int(d.Hours())) + "h " + twoDigits(int(d.Minutes())%60) + "m"
}

// sessionRecord is one remote session seen since the app started.
type sessionRecord struct {
	start, end time.Time // end is zero while the session is live
	note       string    // how it ended
}

// sessionLog keeps the most recent remote sessions for the Msfwr window.
// It lives in memory only; nothing about sessions is written to disk.
type sessionLog struct {
	records []sessionRecord
}

const maxSessionRecords = 10

func (l *sessionLog) begin(now time.Time) {
	l.records = append(l.records, sessionRecord{start: now})
	if len(l.records) > maxSessionRecords {
		l.records = l.records[len(l.records)-maxSessionRecords:]
	}
}

func (l *sessionLog) finish(now time.Time, note string) {
	if n := len(l.records); n > 0 && l.records[n-1].end.IsZero() {
		l.records[n-1].end = now
		l.records[n-1].note = note
	}
}

// live returns the start of the current session, if one is live.
func (l *sessionLog) live() (time.Time, bool) {
	if n := len(l.records); n > 0 && l.records[n-1].end.IsZero() {
		return l.records[n-1].start, true
	}
	return time.Time{}, false
}

// activeText describes who is connected right now.
func (l *sessionLog) activeText(now time.Time) string {
	if start, ok := l.live(); ok {
		return "IT is connected now: since " + start.Format("15:04:05") + " (" + formatDuration(now.Sub(start)) + ")"
	}
	return "No one is connected."
}

// lines lists sessions newest first for the window's history list.
func (l *sessionLog) lines(now time.Time) []string {
	out := make([]string, 0, len(l.records))
	for i := len(l.records) - 1; i >= 0; i-- {
		r := l.records[i]
		if r.end.IsZero() {
			out = append(out, r.start.Format("15:04:05")+"  live now  ("+formatDuration(now.Sub(r.start))+")")
			continue
		}
		line := r.start.Format("15:04:05") + " – " + r.end.Format("15:04:05") + "  (" + formatDuration(r.end.Sub(r.start)) + ")"
		if r.note != "" {
			line += "  " + r.note
		}
		out = append(out, line)
	}
	return out
}

// sameLines reports whether two list contents are identical, so the window
// only rebuilds a list box (and loses its selection) when something changed.
func sameLines(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
