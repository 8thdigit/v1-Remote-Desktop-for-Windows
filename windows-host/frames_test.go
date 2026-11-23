package main

import (
	"encoding/binary"
	"image"
	"testing"
	"time"
)

func frameOf(w, h int) []byte { return make([]byte, w*h*4) }

func setPixel(buf []byte, w, x, y int, v byte) { buf[(y*w+x)*4] = v }

func TestDirtyRectsFindsAlignedChangedRegions(t *testing.T) {
	w, h := 320, 200
	prev, cur := frameOf(w, h), frameOf(w, h)
	if got := dirtyRects(prev, cur, w, h); got != nil {
		t.Fatalf("unchanged frame: got %v", got)
	}
	setPixel(cur, w, 37, 5, 9)    // band 0
	setPixel(cur, w, 300, 150, 9) // band 4
	got := dirtyRects(prev, cur, w, h)
	want := []image.Rectangle{image.Rect(32, 0, 48, 32), image.Rect(288, 128, 304, 160)}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %v, want %v", got, want)
	}
	// Touching bands of similar width merge into one region.
	setPixel(cur, w, 40, 40, 9)
	got = dirtyRects(prev, cur, w, h)
	if got[0] != image.Rect(32, 0, 48, 64) {
		t.Fatalf("bands did not merge: %v", got)
	}
	// A change at the right edge stays inside the frame.
	prev, cur = frameOf(w, h), frameOf(w, h)
	setPixel(cur, w, w-1, h-1, 1)
	if got := dirtyRects(prev, cur, w, h); got[0].Max.X != w || got[0].Max.Y != h {
		t.Fatalf("edge change: %v", got)
	}
}

func TestDirtyRectsMergesWhenThereAreTooMany(t *testing.T) {
	w, h := 64, bandRows*(maxRects+4)*2
	prev, cur := frameOf(w, h), frameOf(w, h)
	for b := 0; b < maxRects+4; b++ {
		setPixel(cur, w, 0, b*2*bandRows, 1) // every other band
	}
	got := dirtyRects(prev, cur, w, h)
	if len(got) != 1 || got[0].Min.Y != 0 || got[0].Max.Y != (maxRects+3)*2*bandRows+bandRows {
		t.Fatalf("got %v", got)
	}
	if a := totalArea(got, w, h); a <= 0 || a > 1 {
		t.Fatalf("area %v", a)
	}
}

func TestPackUpdatesMatchesTheRelayFormat(t *testing.T) {
	body := packUpdates([]update{{key: true, jpeg: []byte{1, 2}}, {x: 16, y: 300, jpeg: []byte{3}}})
	if len(body) != 9+2+9+1 || body[0] != 0 || body[11] != 1 {
		t.Fatalf("body %v", body)
	}
	if binary.BigEndian.Uint16(body[12:]) != 16 || binary.BigEndian.Uint16(body[14:]) != 300 || binary.BigEndian.Uint32(body[16:]) != 1 {
		t.Fatalf("patch header %v", body[11:20])
	}
}

func TestPacerAdaptsToUploadSpeed(t *testing.T) {
	p := newPacer()
	start := p.quality()
	p.observe(50000, 600*time.Millisecond)
	if p.quality() >= start || p.gap <= minGap {
		t.Fatalf("slow upload kept quality %d gap %v", p.quality(), p.gap)
	}
	for i := 0; i < 40; i++ {
		p.observe(50000, 20*time.Millisecond)
	}
	if p.quality() <= start || p.gap != minGap {
		t.Fatalf("fast uploads: quality %d gap %v", p.quality(), p.gap)
	}
	if p.refineQuality() > 94 || p.refineQuality() < p.quality() {
		t.Fatalf("refine quality %d", p.refineQuality())
	}
	p.observe(0, time.Second) // heartbeats do not count
	if p.gap != minGap {
		t.Fatal("an empty tick changed the pace")
	}
}

func TestProfilesSetResolutionAndQuality(t *testing.T) {
	p := newPacer()
	if p.prof.name != defaultProfile {
		t.Fatalf("default profile %q", p.prof.name)
	}
	if w, h := fitted(1920, 1080, p.prof.maxW, p.prof.maxH); w != 1920 || h != 1080 {
		t.Fatalf("a 1080p screen is not sent at native size: %dx%d", w, h)
	}
	if !p.setProfile("sharp") || p.setProfile("sharp") {
		t.Fatal("setProfile should report a change once")
	}
	if w, h := fitted(2560, 1440, p.prof.maxW, p.prof.maxH); w != 2560 || h != 1440 {
		t.Fatalf("sharp scaled a 1440p screen to %dx%d", w, h)
	}
	p.setProfile("fast")
	if w, h := fitted(1920, 1080, p.prof.maxW, p.prof.maxH); w != 1280 || h != 720 {
		t.Fatalf("fast sent %dx%d", w, h)
	}
	if !p.prof.subsample || profileFor("balanced").subsample {
		t.Fatal("only fast subsamples colour")
	}
	if profileFor("nonsense").name != defaultProfile {
		t.Fatal("unknown names fall back to the default")
	}
	// A big keyframe on a good link does not count as slow.
	q := newPacer()
	before := q.quality()
	q.observe(1<<20, 900*time.Millisecond)
	if q.quality() != before {
		t.Fatal("a 1 MB keyframe in 0.9 s lowered quality")
	}
}
