// Copyright 2011 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Package jpeg444 is the standard library's baseline JPEG encoder, changed to
// keep full colour resolution (4:4:4) instead of halving it (4:2:0). Screen
// text is thin and often coloured or anti-aliased with colour (ClearType);
// halving the colour planes smears it, which made the remote screen hard to
// read. Encode with Options.Subsample set keeps the standard 4:2:0 output.
package jpeg444

const (
	sof0Marker = 0xc0 // Start Of Frame (Baseline Sequential).
	dhtMarker  = 0xc4 // Define Huffman Table.
	dqtMarker  = 0xdb // Define Quantization Table.
)

// unzig maps from the zig-zag ordering to the natural ordering.
var unzig = [blockSize]int{
	0, 1, 8, 16, 9, 2, 3, 10,
	17, 24, 32, 25, 18, 11, 4, 5,
	12, 19, 26, 33, 40, 48, 41, 34,
	27, 20, 13, 6, 7, 14, 21, 28,
	35, 42, 49, 56, 57, 50, 43, 36,
	29, 22, 15, 23, 30, 37, 44, 51,
	58, 59, 52, 45, 38, 31, 39, 46,
	53, 60, 61, 54, 47, 55, 62, 63,
}
