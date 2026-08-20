// png.mjs — read and write the PNGs this toolkit produces, using nothing but node:zlib.
//
// WHY NOT pixelmatch + pngjs
//
// Because this skill is published as `platforms: any` and deployed by copying a directory to
// a host that has no package.json, no registry credentials and sometimes no outbound network
// at all. The repo already learned this once and wrote it down: "ship the engine as one file
// that needs no install". A visual-diff tier that only works where `npm install` works is a
// visual-diff tier that is skipped on the day it matters.
//
// Node's zlib IS the hard half of PNG — inflate for reading, deflate for writing. What is
// left is a header, five filter functions and a CRC table, all of which are in the spec and
// none of which change.
//
// SCOPE, STATED HONESTLY
//
// This reads exactly what a headless Chromium screenshot is: 8 bits per channel, RGB or
// RGBA, non-interlaced. Anything else throws by name instead of decoding to plausible
// garbage — a diff tier that quietly compares the wrong pixels is worse than one that stops.
import zlib from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode a PNG buffer to { width, height, data } where data is RGBA, 4 bytes per pixel.
 *
 * RGB sources are widened to RGBA with alpha 255 so callers never branch on channel count —
 * the diff loop is hot enough that a per-pixel conditional is worth avoiding, and a caller
 * that forgets the branch produces a silently wrong percentage.
 */
export function decodePNG(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG file");

  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (this reader handles 8)`);
  if (colorType !== 2 && colorType !== 6)
    throw new Error(`unsupported PNG colour type ${colorType} (this reader handles 2=RGB and 6=RGBA)`);
  if (interlace !== 0) throw new Error("interlaced PNG is not supported");
  if (!width || !height) throw new Error("PNG has no IHDR");

  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error("PNG data is shorter than its header claims");

  // Undo the per-row filter. Each row is prefixed by one filter byte; every filter predicts
  // a byte from its left neighbour (a), the byte above (b) and the byte above-left (c), all
  // of which are already-reconstructed values — so this must run in order, in place.
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    row.copy(cur);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      switch (filter) {
        case 0: break;
        case 1: cur[i] = (cur[i] + a) & 0xff; break;
        case 2: cur[i] = (cur[i] + b) & 0xff; break;
        case 3: cur[i] = (cur[i] + ((a + b) >> 1)) & 0xff; break;
        case 4: cur[i] = (cur[i] + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`unknown PNG row filter ${filter} on row ${y}`);
      }
    }
    prev = cur;
  }

  if (channels === 4) return { width, height, data: out };
  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0, q = 0; p < out.length; p += 3, q += 4) {
    rgba[q] = out[p]; rgba[q + 1] = out[p + 1]; rgba[q + 2] = out[p + 2]; rgba[q + 3] = 255;
  }
  return { width, height, data: rgba };
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode RGBA pixels back to a PNG buffer. Filter 0 throughout — deflate does the work. */
export function encodePNG({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Perceptual distance, not raw RGB distance. Two greys one step apart and two blues one step
// apart are the same number in RGB and nothing like the same to an eye — and antialiased text
// differs by exactly that kind of step between two renders of an unchanged page. YIQ weights
// luminance the way vision does, which is what keeps the noise floor low enough for the 0.5%
// area threshold to mean something.
function yiqDelta(d, i, j) {
  const r1 = d.a[i], g1 = d.a[i + 1], b1 = d.a[i + 2], a1 = d.a[i + 3];
  const r2 = d.b[j], g2 = d.b[j + 1], b2 = d.b[j + 2], a2 = d.b[j + 3];
  // Blend against white so a change in transparency registers as a change in appearance.
  const f1 = a1 / 255, f2 = a2 / 255;
  const R1 = r1 * f1 + 255 * (1 - f1), G1 = g1 * f1 + 255 * (1 - f1), B1 = b1 * f1 + 255 * (1 - f1);
  const R2 = r2 * f2 + 255 * (1 - f2), G2 = g2 * f2 + 255 * (1 - f2), B2 = b2 * f2 + 255 * (1 - f2);
  const y = 0.29889531 * (R1 - R2) + 0.58662247 * (G1 - G2) + 0.11448223 * (B1 - B2);
  const iq = 0.59597799 * (R1 - R2) - 0.2741761 * (G1 - G2) - 0.32180189 * (B1 - B2);
  const q = 0.21147017 * (R1 - R2) - 0.52261711 * (G1 - G2) + 0.31114694 * (B1 - B2);
  return 0.5053 * y * y + 0.299 * iq * iq + 0.1957 * q * q;
}

// Squared YIQ distance at which two pixels count as "different".
//
// NOT pixelmatch's default of 0.1, and the reason matters. That default is calibrated for a
// tool where the per-pixel threshold is the ONLY gate, so it has to absorb antialiasing noise
// by itself. Here there are two gates in series: this one, and the 0.5% changed-AREA gate in
// judgePixelDiff. The area gate is what absorbs noise — antialiased text differs on the thin
// edges of glyphs, a tiny fraction of a page — so leaving this one loose as well is loose
// twice over, and it produced a real miss.
//
// Measured, on a page whose header background was changed outright from #102040 to #7a1030:
//
//   header navy -> maroon           score  1923   MISSED at 0.1 (3522), caught at 0.05 (1761)
//   accent orange -> green          score  8786   caught either way
//   antialiasing, #000 -> #080808   score    32   ignored, 55x below the threshold
//   white -> #f8f8f8                score    25   ignored, 70x below the threshold
//
// A wholesale repaint of the site's chrome reading as "0% of pixels changed" is precisely the
// regression this tier exists to catch, and two dark colours can sit well inside 0.1 of each
// other. 0.05 catches it with two orders of magnitude of headroom over the noise cases.
const PIXEL_DELTA = 0.05 * 35215;

/**
 * Compare two RGBA images of identical size.
 *
 * Returns the changed-pixel count and a diff image: the unchanged page dimmed to a grey
 * ghost, changed pixels in red. The ghost matters — a diff image that is black except for
 * red dots tells you something moved but not what, and the whole point of this tier is that
 * a person can look at it and recognise the section.
 */
export function diffImages(before, after) {
  const { width, height } = before;
  const total = width * height;
  const out = Buffer.alloc(total * 4);
  const d = { a: before.data, b: after.data };
  let changed = 0;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (yiqDelta(d, i, i) > PIXEL_DELTA) {
      out[i] = 255; out[i + 1] = 25; out[i + 2] = 25; out[i + 3] = 255;
      changed++;
    } else {
      const grey = (before.data[i] * 0.299 + before.data[i + 1] * 0.587 + before.data[i + 2] * 0.114);
      const dim = Math.round(255 - (255 - grey) * 0.15);
      out[i] = dim; out[i + 1] = dim; out[i + 2] = dim; out[i + 3] = 255;
    }
  }
  return { changed, total, image: { width, height, data: out } };
}
