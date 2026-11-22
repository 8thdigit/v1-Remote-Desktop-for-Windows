package main

import "time"

// qualityLevel is one step of the adaptive stream: the largest frame size
// sent and the JPEG quality.
type qualityLevel struct {
	maxW, maxH, jpeg int
}

// From "keep it moving on a slow link" to "sharp text on a fast one".
var qualityLevels = []qualityLevel{
	{1024, 640, 42},
	{1280, 800, 52},
	{1600, 1000, 60},
	{1920, 1200, 68},
	{1920, 1200, 78},
	{2560, 1600, 80},
}

// adaptiveQuality picks the level from how long frame uploads take, so the
// picture is as sharp as the connection allows without building lag.
type adaptiveQuality struct {
	level, good int
}

const (
	slowUpload = 220 * time.Millisecond
	fastUpload = 90 * time.Millisecond
)

func newAdaptiveQuality() *adaptiveQuality { return &adaptiveQuality{level: 2} }

func (q *adaptiveQuality) current() qualityLevel { return qualityLevels[q.level] }

// observe records one frame upload. It steps down at once after a slow
// upload, and steps up after a run of fast ones.
func (q *adaptiveQuality) observe(upload time.Duration) (changed bool) {
	switch {
	case upload > slowUpload:
		q.good = 0
		if q.level > 0 {
			q.level--
			if upload > 3*slowUpload && q.level > 0 {
				q.level--
			}
			return true
		}
	case upload < fastUpload:
		q.good++
		if q.good >= 12 && q.level < len(qualityLevels)-1 {
			q.level++
			q.good = 0
			return true
		}
	default:
		q.good = 0
	}
	return false
}

// fitted scales a screen size down (never up) to fit within the level.
func (l qualityLevel) fitted(w, h int) (int, int) {
	if w > l.maxW {
		h = max(1, h*l.maxW/w)
		w = l.maxW
	}
	if h > l.maxH {
		w = max(1, w*l.maxH/h)
		h = l.maxH
	}
	return w, h
}
