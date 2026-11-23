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

// pacer adapts JPEG quality and the gap between uploads to how fast uploads
// reach the relay: slow uploads lower quality and leave room for input;
// fast ones raise it again.
type pacer struct {
	level int
	fast  int
	gap   time.Duration
}

var qualities = []int{80, 70, 60, 50, 40, 30}

const (
	minGap  = 33 * time.Millisecond // at most about 30 uploads a second
	maxGap  = 400 * time.Millisecond
	slowRTT = 300 * time.Millisecond
	fastRTT = 120 * time.Millisecond
)

func newPacer() *pacer { return &pacer{level: 2, gap: minGap} }

// quality is the JPEG quality for the next update.
func (p *pacer) quality() int { return qualities[p.level] }

// refineQuality is the quality of the keyframe sent once the screen settles.
func (p *pacer) refineQuality() int {
	q := qualities[p.level] + 15
	if q > 85 {
		q = 85
	}
	return q
}

// observe records how long an upload of n bytes took.
func (p *pacer) observe(n int, took time.Duration) {
	if n == 0 {
		return
	}
	switch {
	case took > slowRTT:
		p.fast = 0
		if p.level < len(qualities)-1 {
			p.level++
		}
		p.gap *= 2
	case took < fastRTT:
		p.fast++
		if p.fast >= 8 && p.level > 0 {
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
