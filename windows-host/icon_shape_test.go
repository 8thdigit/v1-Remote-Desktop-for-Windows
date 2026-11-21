package main

import "testing"

func TestSyncIconPixels(t *testing.T) {
	for _, size := range []int{16, 20, 24, 32, 48} {
		pixels := syncIconPixels(size, 0x16a34a)
		if len(pixels) != size*size {
			t.Fatalf("size %d: got %d pixels", size, len(pixels))
		}
		opaque := 0
		for _, p := range pixels {
			if p>>24 != 0 && p&0xffffff != 0x16a34a {
				t.Fatalf("size %d: pixel %08x is not the state colour", size, p)
			}
			if p>>24 == 0xff {
				opaque++
			}
		}
		// The glyph covers a fair part of the icon, but not all of it.
		if opaque < size*size/6 || opaque > size*size/2 {
			t.Errorf("size %d: %d of %d pixels opaque", size, opaque, size*size)
		}
		for _, corner := range []int{0, size - 1, size * (size - 1)} {
			if pixels[corner] != 0 {
				t.Errorf("size %d: corner %d is not transparent", size, corner)
			}
		}
	}
}
