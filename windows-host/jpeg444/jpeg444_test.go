package jpeg444

import (
	"bytes"
	"image"
	"image/color"
	stdjpeg "image/jpeg"
	"testing"
)

// screenLike draws thin coloured strokes on white, like text on a screen.
func screenLike(w, h int) *image.RGBA {
	m := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := range m.Pix {
		m.Pix[i] = 255
	}
	colors := []color.RGBA{{200, 0, 0, 255}, {0, 0, 200, 255}, {0, 120, 0, 255}, {20, 20, 20, 255}}
	for y := 3; y < h; y += 7 {
		for x := 0; x < w; x++ {
			if (x/3+y)%4 != 0 {
				m.SetRGBA(x, y, colors[(x/9+y)%len(colors)])
			}
		}
	}
	return m
}

func diff(t *testing.T, want *image.RGBA, data []byte) float64 {
	t.Helper()
	got, err := stdjpeg.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Bounds().Size() != want.Bounds().Size() {
		t.Fatalf("size %v, want %v", got.Bounds().Size(), want.Bounds().Size())
	}
	var sum float64
	b := want.Bounds()
	gb := got.Bounds()
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			r1, g1, b1, _ := want.At(b.Min.X+x, b.Min.Y+y).RGBA()
			r2, g2, b2, _ := got.At(gb.Min.X+x, gb.Min.Y+y).RGBA()
			for _, d := range []int{int(r1>>8) - int(r2>>8), int(g1>>8) - int(g2>>8), int(b1>>8) - int(b2>>8)} {
				if d < 0 {
					d = -d
				}
				sum += float64(d)
			}
		}
	}
	return sum / float64(b.Dx()*b.Dy()*3)
}

func TestFullChromaIsSharperThanSubsampled(t *testing.T) {
	m := screenLike(203, 117) // odd sizes exercise partial blocks
	var full, sub bytes.Buffer
	if err := Encode(&full, m, &Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	if err := stdjpeg.Encode(&sub, m, &stdjpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	a, b := diff(t, m, full.Bytes()), diff(t, m, sub.Bytes())
	if a >= b {
		t.Fatalf("4:4:4 error %.2f is not below 4:2:0 error %.2f", a, b)
	}
}

func TestSubsampleMatchesStandardLibrary(t *testing.T) {
	m := screenLike(64, 48)
	var ours, std bytes.Buffer
	if err := Encode(&ours, m, &Options{Quality: 70, Subsample: true}); err != nil {
		t.Fatal(err)
	}
	if err := stdjpeg.Encode(&std, m, &stdjpeg.Options{Quality: 70}); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(ours.Bytes(), std.Bytes()) {
		t.Fatal("4:2:0 output differs from image/jpeg")
	}
}

func TestSubImage(t *testing.T) {
	m := screenLike(160, 96)
	sub := m.SubImage(image.Rect(48, 32, 112, 80)).(*image.RGBA)
	var buf bytes.Buffer
	if err := Encode(&buf, sub, &Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	if e := diff(t, sub, buf.Bytes()); e > 12 {
		t.Fatalf("patch error %.2f too high", e)
	}
}

func BenchmarkScreen1080(b *testing.B) {
	m := screenLike(1920, 1080)
	for i := 0; i < b.N; i++ {
		var buf bytes.Buffer
		Encode(&buf, m, &Options{Quality: 80})
		b.SetBytes(int64(buf.Len()))
	}
}
