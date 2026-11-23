package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"time"
)

// Screen updates are sent as changed regions (patches) on top of a full
// frame (a keyframe), so typing or a moving window costs a few kilobytes
// instead of a whole JPEG. The relay keeps the keyframe and the patches since
// it; each viewer composes them on a canvas.

const (
	// bandRows is the height of the strips the screen is compared in. It is a
	// multiple of 16 so patches line up with JPEG blocks.
	bandRows = 32
	// alignPixels rounds patch edges out to JPEG block boundaries.
	alignPixels = 16
	// maxRects caps the patches in one update; past it they are merged.
	maxRects = 12
	// keyArea is the share of the screen above which a keyframe is cheaper
	// than patches.
	keyArea = 0.45
)

// dirtyRects compares two 32-bit frames of the same w×h size and returns the
// regions that changed, aligned to JPEG blocks. It returns nil when nothing
// changed.
func dirtyRects(prev, cur []byte, w, h int) []image.Rectangle {
	stride := w * 4
	if w <= 0 || h <= 0 || len(prev) < stride*h || len(cur) < stride*h {
		return nil
	}
	var rects []image.Rectangle
	for y0 := 0; y0 < h; y0 += bandRows {
		y1 := y0 + bandRows
		if y1 > h {
			y1 = h
		}
		left, right := w, -1
		for y := y0; y < y1; y++ {
			a, b := prev[y*stride:(y+1)*stride], cur[y*stride:(y+1)*stride]
			if bytes.Equal(a, b) {
				continue
			}
			first, last := diffSpan(a, b)
			if first/4 < left {
				left = first / 4
			}
			if last/4 > right {
				right = last / 4
			}
		}
		if right < 0 {
			continue
		}
		r := image.Rect(left/alignPixels*alignPixels, y0, (right/alignPixels+1)*alignPixels, y1)
		if r.Max.X > w {
			r.Max.X = w
		}
		rects = append(rects, r)
	}
	return mergeRects(rects)
}

// diffSpan returns the first and last byte offsets where a and b differ.
// a and b have equal length and are known to differ.
func diffSpan(a, b []byte) (first, last int) {
	n := len(a)
	for first < n && a[first] == b[first] {
		first++
	}
	last = n - 1
	for last > first && a[last] == b[last] {
		last--
	}
	return first, last
}

// mergeRects joins vertically touching bands whose union is not much bigger
// than the two of them, then merges everything into one box when there are
// still too many.
func mergeRects(rects []image.Rectangle) []image.Rectangle {
	if len(rects) == 0 {
		return nil
	}
	out := []image.Rectangle{rects[0]}
	for _, r := range rects[1:] {
		last := &out[len(out)-1]
		u := last.Union(r)
		if last.Max.Y == r.Min.Y && area(u)*4 <= (area(*last)+area(r))*5 {
			*last = u
			continue
		}
		out = append(out, r)
	}
	if len(out) > maxRects {
		box := out[0]
		for _, r := range out[1:] {
			box = box.Union(r)
		}
		return []image.Rectangle{box}
	}
	return out
}

func area(r image.Rectangle) int { return r.Dx() * r.Dy() }

// totalArea is the screen share the regions cover, from 0 to 1.
func totalArea(rects []image.Rectangle, w, h int) float64 {
	sum := 0
	for _, r := range rects {
		sum += area(r)
	}
	return float64(sum) / float64(w*h)
}

// update is one keyframe or patch to send to the relay.
type update struct {
	key  bool
	x, y int
	jpeg []byte
}

// packUpdates encodes updates for the relay's application/x-msfwr-frames
// body: for each, the kind (0 keyframe, 1 patch), x and y (uint16), the JPEG
// length (uint32) and the JPEG. Big-endian.
func packUpdates(list []update) []byte {
	size := 0
	for _, u := range list {
		size += 9 + len(u.jpeg)
	}
	out := make([]byte, 0, size)
	for _, u := range list {
		var head [9]byte
		if !u.key {
			head[0] = 1
		}
		binary.BigEndian.PutUint16(head[1:], uint16(u.x))
		binary.BigEndian.PutUint16(head[3:], uint16(u.y))
		binary.BigEndian.PutUint32(head[5:], uint32(len(u.jpeg)))
		out = append(out, head[:]...)
		out = append(out, u.jpeg...)
	}
	return out
}

// profile is a picture quality a viewer can pick: the largest screen size
// sent (larger screens are scaled down), the JPEG qualities the pacer steps
// through, and whether colour is subsampled (4:2:0, smaller but smears
// coloured text) or kept at full resolution (4:4:4).
type profile struct {
	name       string
	maxW, maxH int
	qualities  []int
	subsample  bool
}

var profiles = map[string]profile{
	// Native resolution (up to 4K) for reading small text.
	"sharp": {"sharp", 3840, 2400, []int{90, 86, 82, 76, 68, 60}, false},
	// Native on common 1080p screens; larger ones scaled to 1920 wide.
	"balanced": {"balanced", 1920, 1200, []int{85, 80, 74, 66, 58, 50}, false},
	// The old 1280×800 picture for slow links.
	"fast": {"fast", 1280, 800, []int{70, 60, 50, 42, 34, 28}, true},
}

const defaultProfile = "balanced"

// profileFor returns the named profile, or the default for an unknown name.
func profileFor(name string) profile {
	if p, ok := profiles[name]; ok {
		return p
	}
	return profiles[defaultProfile]
}

// fitted scales a w×h screen down to fit maxW×maxH, keeping its shape.
func fitted(w, h, maxW, maxH int) (int, int) {
	if w > maxW {
		h = max(1, h*maxW/w)
		w = maxW
	}
	if h > maxH {
		w = max(1, w*maxH/h)
		h = maxH
	}
	return w, h
}

// max returns the larger of two ints (kept local for Go toolchain parity).
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// pacer adapts JPEG quality and the gap between uploads to how fast uploads
// reach the relay: slow uploads lower quality and leave room for input;
// fast ones raise it again.
type pacer struct {
	prof  profile
	level int
	fast  int
	gap   time.Duration
}

const (
	minGap  = 20 * time.Millisecond // at most about 50 uploads a second
	maxGap  = 400 * time.Millisecond
	slowRTT = 450 * time.Millisecond
	fastRTT = 200 * time.Millisecond
)

func newPacer() *pacer { return &pacer{prof: profileFor(defaultProfile), level: 1, gap: minGap} }

// setProfile switches to the named picture quality. It reports whether
// anything changed.
func (p *pacer) setProfile(name string) bool {
	next := profileFor(name)
	if next.name == p.prof.name {
		return false
	}
	p.prof, p.level, p.fast = next, 1, 0
	return true
}

// quality is the JPEG quality for the next update.
func (p *pacer) quality() int { return p.prof.qualities[p.level] }

// refineQuality is the quality of the keyframe sent once the screen settles.
func (p *pacer) refineQuality() int {
	q := p.prof.qualities[0] + 4
	if q > 94 {
		q = 94
	}
	return q
}

// observe records how long an upload of n bytes took. Big uploads are
// judged by throughput rather than time, so one large keyframe on a good
// link does not lower the quality.
func (p *pacer) observe(n int, took time.Duration) {
	if n == 0 {
		return
	}
	slow, fast := slowRTT, fastRTT
	if extra := time.Duration(n/(256*1024)) * 150 * time.Millisecond; extra > 0 {
		slow += extra
		fast += extra
	}
	switch {
	case took > slow:
		p.fast = 0
		if p.level < len(p.prof.qualities)-1 {
			p.level++
		}
		p.gap *= 2
	case took < fast:
		p.fast++
		if p.fast >= 6 && p.level > 0 {
			p.level--
			p.fast = 0
		}
		p.gap = p.gap * 3 / 4
	default:
		p.fast = 0
	}
	if p.gap < minGap {
		p.gap = minGap
	}
	if p.gap > maxGap {
		p.gap = maxGap
	}
}
