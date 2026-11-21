package main

import "math"

// Geometry of the status icon, in units of the icon's width (0..1, y down):
// two clockwise sync arrows around a ring, plus a status dot at the lower
// right. The whole glyph is drawn in the state colour, which reads on both
// light and dark taskbars.
const (
	syncCenterX, syncCenterY = 0.43, 0.45
	syncRadius               = 0.30
	syncStroke               = 0.12
	syncHeadHalf             = 0.135 // half the width of an arrowhead's base
	syncHeadLength           = 0.15
	syncDotX, syncDotY       = 0.76, 0.76
	syncDotRadius            = 0.20
	syncDotGap               = 0.07
)

type syncArc struct{ from, to float64 } // degrees, anticlockwise from 3 o'clock

// The top arc runs over the top and points down on the right; the bottom arc
// runs under the bottom and points up on the left. Both arrowheads sit at the
// arc's "from" end, pointing clockwise.
var syncArcs = [2]syncArc{{from: 18, to: 172}, {from: 198, to: 300}}

func ringPoint(degrees float64) (x, y float64) {
	a := degrees * math.Pi / 180
	return syncCenterX + syncRadius*math.Cos(a), syncCenterY - syncRadius*math.Sin(a)
}

// arcDistance is the signed distance from (x, y) to a stroked arc with
// rounded ends.
func arcDistance(x, y float64, arc syncArc) float64 {
	dx, dy := x-syncCenterX, syncCenterY-y
	a := math.Atan2(dy, dx) * 180 / math.Pi
	if a < 0 {
		a += 360
	}
	if a >= arc.from && a <= arc.to {
		return math.Abs(math.Hypot(dx, dy)-syncRadius) - syncStroke/2
	}
	fx, fy := ringPoint(arc.from)
	tx, ty := ringPoint(arc.to)
	return math.Min(math.Hypot(x-fx, y-fy), math.Hypot(x-tx, y-ty)) - syncStroke/2
}

// arrowhead returns the triangle at an arc's "from" end, pointing clockwise.
func arrowhead(arc syncArc) [3][2]float64 {
	px, py := ringPoint(arc.from)
	a := arc.from * math.Pi / 180
	tx, ty := math.Sin(a), math.Cos(a)  // clockwise tangent, screen coords
	nx, ny := math.Cos(a), -math.Sin(a) // outward normal, screen coords
	return [3][2]float64{
		{px + tx*syncHeadLength, py + ty*syncHeadLength},
		{px + nx*syncHeadHalf, py + ny*syncHeadHalf},
		{px - nx*syncHeadHalf, py - ny*syncHeadHalf},
	}
}

func segmentDistance(x, y, ax, ay, bx, by float64) float64 {
	vx, vy := bx-ax, by-ay
	t := ((x-ax)*vx + (y-ay)*vy) / (vx*vx + vy*vy)
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(x-ax-t*vx, y-ay-t*vy)
}

func triangleDistance(x, y float64, t [3][2]float64) float64 {
	d := math.Inf(1)
	inside := true
	var sign float64
	for i := 0; i < 3; i++ {
		a, b := t[i], t[(i+1)%3]
		d = math.Min(d, segmentDistance(x, y, a[0], a[1], b[0], b[1]))
		cross := (b[0]-a[0])*(y-a[1]) - (b[1]-a[1])*(x-a[0])
		if i == 0 {
			sign = cross
		} else if cross*sign < 0 {
			inside = false
		}
	}
	if inside {
		return -d
	}
	return d
}

// syncIconDistance is the signed distance from (x, y) to the whole glyph.
func syncIconDistance(x, y float64) float64 {
	dot := math.Hypot(x-syncDotX, y-syncDotY) - syncDotRadius
	arrows := math.Inf(1)
	for _, arc := range syncArcs {
		arrows = math.Min(arrows, arcDistance(x, y, arc))
		arrows = math.Min(arrows, triangleDistance(x, y, arrowhead(arc)))
	}
	arrows = math.Max(arrows, -(dot - syncDotGap)) // keep a gap around the dot
	return math.Min(arrows, dot)
}

// syncIconPixels renders the status icon as size*size straight-alpha ARGB
// pixels, top row first, in the colour rgb with anti-aliased edges.
func syncIconPixels(size int, rgb uint32) []uint32 {
	if size <= 0 {
		size = 16
	}
	const samples = 4
	scale := float64(size)
	pixels := make([]uint32, size*size)
	for py := 0; py < size; py++ {
		for px := 0; px < size; px++ {
			covered := 0
			for sy := 0; sy < samples; sy++ {
				for sx := 0; sx < samples; sx++ {
					x := (float64(px) + (float64(sx)+0.5)/samples) / scale
					y := (float64(py) + (float64(sy)+0.5)/samples) / scale
					if syncIconDistance(x, y) <= 0 {
						covered++
					}
				}
			}
			if covered > 0 {
				alpha := uint32(math.Round(float64(covered) * 255 / (samples * samples)))
				pixels[py*size+px] = alpha<<24 | rgb&0xffffff
			}
		}
	}
	return pixels
}
