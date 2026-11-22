package main

import (
	"context"
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

// timeLeft renders how long until something expires, for status lines like
// "expires in 5h 20m" or "expired 3m ago".
func timeLeft(unixMilli int64, now time.Time) string {
	d := time.Until(time.UnixMilli(unixMilli))
	neg := d < 0
	if neg {
		d = -d
	}
	var text string
	switch {
	case d < time.Minute:
		text = "less than a minute"
	case d < time.Hour:
		text = twoDigits(int(d.Minutes())) + "m"
	case d < 24*time.Hour:
		h := int(d.Hours())
		text = strconv.Itoa(h) + "h " + twoDigits(int(d.Minutes())-h*60) + "m"
	default:
		text = strconv.Itoa(int(d.Hours())/24) + "d " + twoDigits(int(d.Hours())%24) + "h"
	}
	if neg {
		return "expired " + text + " ago"
	}
	return "expires in " + text
}

// linksPathFor returns where saved remote access links live next to the
// unattended settings file. It is empty when the config path is unknown.
func linksPathFor(configPath string) string {
	if configPath == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(configPath), linksFile)
}

// linkRequest is a remote access link the UI wants registered so its shared
// URL can open sessions. serveUnattended creates the link on the relay,
// stores it in links.json, and keeps re-registering the host under its code
// after every session until the link expires or is revoked.
type linkRequest struct {
	id    uint64 // unique per request, for retry bookkeeping between rounds
	name  string
	hours int
}

var linkSeq uint64

// newLinkRequest stamps a request with a fresh id.
func newLinkRequest(name string, hours int) linkRequest {
	linkSeq++
	return linkRequest{id: linkSeq, name: name, hours: hours}
}

// listLinks summarizes saved links for menus and status text. Expired links
// are dropped from the file as a side effect when linksPath is known.
func listLinks(linksPath string, now time.Time) []string {
	if linksPath == "" {
		return nil
	}
	all, err := loadLinks(linksPath, now)
	if err != nil {
		return []string{"Saved links could not be read: " + err.Error()}
	}
	fresh := make([]savedLink, 0, len(all))
	for _, l := range all {
		if !l.expired(now) {
			fresh = append(fresh, l)
		}
	}
	if len(fresh) != len(all) {
		_ = saveLinks(linksPath, fresh)
	}
	out := make([]string, 0, len(fresh)+1)
	for _, l := range fresh {
		status := timeLeft(l.ExpiresAt, now)
		if l.Name != "" {
			status = l.Name + " — " + status
		}
		out = append(out, l.shareURL()+"  ("+status+")")
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// revokeLink drops a saved link locally and asks the relay to stop honouring
// its shared URL. The key stored with the link proves ownership.
func revokeLink(linksPath, id string, now time.Time) error {
	r, err := newRelay(savedLinkRelay(linksPath, id, now))
	if err != nil {
		return err
	}
	links, err := loadLinks(linksPath, now)
	if err != nil {
		return err
	}
	var target *savedLink
	for i := range links {
		if links[i].ID == id {
			target = &links[i]
		}
	}
	if target == nil {
		return errors.New("that link is no longer saved on this PC")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := r.revokeLink(ctx, target.ID, target.Key); err != nil {
		return err
	}
	rest, _ := removeLink(links, id)
	return saveLinks(linksPath, rest)
}

// savedLinkRelay finds the relay origin a saved link belongs to.
func savedLinkRelay(linksPath, id string, now time.Time) string {
	links, err := loadLinks(linksPath, now)
	if err != nil {
		return ""
	}
	for _, l := range links {
		if l.ID == id {
			return l.Relay
		}
	}
	return ""
}
