package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// savedLink is a remote access link persisted on this PC. The secret key is
// stored next to it so the client can show status, re-register after each
// session, and revoke the link later. Codes are public; keys never leave
// this file except in requests to the relay that prove ownership.
type savedLink struct {
	ID        string `json:"id"`
	Code      string `json:"code"`
	Key       string `json:"key"`
	Name      string `json:"name,omitempty"`
	Relay     string `json:"relay"`
	CreatedAt int64  `json:"createdAt"` // Unix milliseconds
	ExpiresAt int64  `json:"expiresAt"` // Unix milliseconds
}

func (l savedLink) expired(now time.Time) bool {
	return now.UnixMilli() >= l.ExpiresAt
}

func (l savedLink) shareURL() string {
	link := remoteLink{Code: l.Code}
	return link.URL(l.Relay)
}

const linksFile = "links.json"

// loadLinks returns the saved links, dropping ones past their validity. A
// missing file means no links yet, which is not an error. Damaged files are
// reported so callers can warn instead of silently forgetting secrets.
func loadLinks(path string, now time.Time) ([]savedLink, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var all []savedLink
	if err := json.Unmarshal(data, &all); err != nil {
		return nil, errors.New("the saved remote access links are damaged")
	}
	kept := make([]savedLink, 0, len(all))
	for _, l := range all {
		if !linkCodeFormat.MatchString(l.Code) || !tokenFormat.MatchString(l.Key) || l.ID == "" {
			continue
		}
		if _, err := newRelay(l.Relay); err != nil {
			continue
		}
		if !l.expired(now) {
			kept = append(kept, l)
		}
	}
	return kept, nil
}

func saveLinks(path string, links []savedLink) error {
	data, err := json.Marshal(links)
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

// addLink stores a freshly created link, replacing any older one with the
// same id, and drops expired links. It keeps at most maxLinks entries.
func addLink(links []savedLink, l savedLink, now time.Time) []savedLink {
	out := make([]savedLink, 0, len(links)+1)
	replaced := false
	for _, old := range links {
		if old.ID == l.ID {
			if !replaced {
				out = append(out, l)
				replaced = true
			}
			continue
		}
		if !old.expired(now) {
			out = append(out, old)
		}
	}
	if !replaced {
		out = append(out, l)
	}
	const maxLinks = 8
	if len(out) > maxLinks {
		out = out[len(out)-maxLinks:]
	}
	return out
}

// removeLink drops the link with this id and reports whether it was there.
func removeLink(links []savedLink, id string) ([]savedLink, bool) {
	out := make([]savedLink, 0, len(links))
	found := false
	for _, l := range links {
		if l.ID == id {
			found = true
			continue
		}
		out = append(out, l)
	}
	return out, found
}

// linkHoursList are the validity choices offered when creating a link. The
// default is 24 hours; other values such as 4 or 5 hours are selectable.
var linkHoursList = []int{1, 2, 4, 5, 8, 12, 24, 48, 72, 120}

// validLinkHours reports whether hours is an allowed validity value.
func validLinkHours(hours int) bool {
	for _, h := range linkHoursList {
		if h == hours {
			return true
		}
	}
	return false
}

// formatValidity renders a duration for menus, e.g. "24 hours".
func formatValidity(hours int) string {
	switch hours {
	case 1:
		return "1 hour"
	case 24:
		return "24 hours (default)"
	}
	if hours%24 == 0 {
		if hours/24 == 1 {
			return "1 day"
		}
		return strconv.Itoa(hours/24) + " days"
	}
	return strconv.Itoa(hours) + " hours"
}
