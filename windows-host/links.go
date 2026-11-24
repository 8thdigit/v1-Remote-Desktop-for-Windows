package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"
)

// savedLink is this PC's remote access URL ("Create remote access URL"). A
// PC has at most one at a time: the Msfwr window shows it with its access
// code, and Clear removes it. The PC's unattended key proves ownership of
// the link to the relay; it is stored with the link so the link can be
// restored on the relay after a relay restart and cleared later.
type savedLink struct {
	ID        string `json:"id"`
	Code      string `json:"code"`
	Pin       string `json:"pin"`
	Key       string `json:"key"`
	Name      string `json:"name,omitempty"`
	Relay     string `json:"relay"`
	CreatedAt int64  `json:"createdAt"` // Unix milliseconds
	ExpiresAt int64  `json:"expiresAt"` // Unix milliseconds
	Hours     int    `json:"hours,omitempty"`
}

func (l savedLink) expired(now time.Time) bool {
	return now.UnixMilli() >= l.ExpiresAt
}

// shareURL is the one-click address people open to connect, such as
// https://connect-ai-nine.vercel.app/r/L0123456789A#042137. The access code after the
// # is read by the page in the browser and never sent to a server log.
func (l savedLink) shareURL() string {
	return l.pageURL() + "#" + l.Pin
}

// pageURL is the link without its access code.
func (l savedLink) pageURL() string {
	link := remoteLink{Code: l.Code}
	r, err := newRelay(l.Relay)
	if err != nil {
		return l.Relay + "/r/" + l.Code
	}
	return link.URL(linkOrigin(r))
}

// shareText is what Copy puts on the clipboard: the one-click URL.
func (l savedLink) shareText() string {
	return l.shareURL()
}

const linksFile = "links.json"

var pinFormat = regexp.MustCompile(`^[0-9]{6}$`)

// loadLink returns this PC's current remote access URL, or nil when there is
// none or it expired. A damaged file is reported so the window can say so.
func loadLink(path string, now time.Time) (*savedLink, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// Older builds saved a list of links; the newest valid one wins.
	var all []savedLink
	if err := json.Unmarshal(data, &all); err != nil {
		var one savedLink
		if err := json.Unmarshal(data, &one); err != nil {
			return nil, errors.New("the saved remote access URL is damaged")
		}
		all = []savedLink{one}
	}
	for i := len(all) - 1; i >= 0; i-- {
		l := all[i]
		if !linkCodeFormat.MatchString(l.Code) || !tokenFormat.MatchString(l.Key) || l.ID == "" || !pinFormat.MatchString(l.Pin) {
			continue
		}
		if _, err := newRelay(l.Relay); err != nil {
			continue
		}
		if l.expired(now) {
			continue
		}
		return &l, nil
	}
	return nil, nil
}

func saveLink(path string, l savedLink) error {
	data, err := json.Marshal(l)
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

func forgetLink(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// createRemoteLink asks the relay for a new remote access URL for this PC
// and saves it, replacing (and clearing on the relay) any earlier one.
func createRemoteLink(ctx context.Context, path, origin, key, name string, hours int) (savedLink, error) {
	if path == "" {
		return savedLink{}, errors.New("this PC has no place to save the URL")
	}
	r, err := newRelay(origin)
	if err != nil {
		return savedLink{}, err
	}
	created, err := r.createLink(ctx, key, name, hours)
	if err != nil {
		return savedLink{}, err
	}
	if !pinFormat.MatchString(created.Pin) {
		return savedLink{}, errors.New("this relay is too old to create URLs with an access code; ask IT to update it")
	}
	old, _ := loadLink(path, time.Now())
	l := savedLink{ID: created.ID, Code: created.Code, Pin: created.Pin, Key: key, Name: name, Relay: origin,
		CreatedAt: created.CreatedAt, ExpiresAt: created.ExpiresAt, Hours: hours}
	if err := saveLink(path, l); err != nil {
		_ = r.revokeLink(ctx, l.ID, key)
		return savedLink{}, errors.New("the URL could not be saved on this PC: " + err.Error())
	}
	if old != nil && old.ID != l.ID {
		_ = r.revokeLink(ctx, old.ID, old.Key)
	}
	return l, nil
}

// clearRemoteLink removes this PC's remote access URL at once, then asks the
// relay to stop honouring it. The local copy goes first so the URL is gone
// from the window even while the relay cannot be reached; the relay is told
// again on the next registration if that fails (see restoreOrClear).
func clearRemoteLink(ctx context.Context, path string) error {
	l, err := loadLink(path, time.Now())
	if err := forgetLink(path); err != nil {
		return err
	}
	if err != nil || l == nil {
		return nil
	}
	r, err := newRelay(l.Relay)
	if err != nil {
		return nil
	}
	if err := r.revokeLink(ctx, l.ID, l.Key); err != nil {
		var status *statusError
		if errors.As(err, &status) && status.status == 404 {
			return nil // already gone on the relay
		}
		return errors.New("cleared on this PC, but the relay could not be told yet: " + err.Error())
	}
	return nil
}

// linkHoursList are the validity choices offered when creating a link. The
// default is 24 hours.
var linkHoursList = []int{1, 2, 4, 5, 8, 12, 24, 48, 72, 120}

// defaultLinkHours is the validity preselected when creating a remote access
// URL.
const defaultLinkHours = 24

// validLinkHours reports whether hours is an allowed validity value.
func validLinkHours(hours int) bool {
	for _, h := range linkHoursList {
		if h == hours {
			return true
		}
	}
	return false
}

// formatValidity renders a validity choice for the window, e.g. "24 hours".
func formatValidity(hours int) string {
	switch {
	case hours == 1:
		return "1 hour"
	case hours == 24:
		return "24 hours"
	case hours%24 == 0:
		return strconv.Itoa(hours/24) + " days"
	}
	return strconv.Itoa(hours) + " hours"
}

// timeLeft renders how long until something expires, for status lines like
// "expires in 5h 20m" or "expired 3m ago".
func timeLeft(unixMilli int64, now time.Time) string {
	d := time.UnixMilli(unixMilli).Sub(now)
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

// linkSummary is the status line under the URL in the Msfwr window.
func linkSummary(l *savedLink, now time.Time) string {
	if l == nil {
		return "No remote access URL. Choose how long it stays valid, then Create."
	}
	return "Valid until " + time.UnixMilli(l.ExpiresAt).Format("Mon 15:04") + " (" + timeLeft(l.ExpiresAt, now) + "). Opening it also needs a 4-digit Access PIN from the supporting company; several people can connect at once."
}

// linksPathFor returns where the remote access URL lives next to the
// unattended settings file. It is empty when the config path is unknown.
func linksPathFor(configPath string) string {
	if configPath == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(configPath), linksFile)
}
