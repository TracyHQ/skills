// The PNG reader is the one piece of this toolkit that could be wrong in a way nobody
// notices: it decodes to plausible numbers either way, and a diff over the wrong pixels
// still prints a confident percentage. So it is checked against an INDEPENDENT encoder
// written below rather than against its own round-trip — a round-trip only proves the two
// halves agree with each other, which they would even if both were wrong.
//
// The control writer uses filter type 4 (Paeth) on every row, deliberately: it is the
// hardest branch of the reader and the one `encodePNG` never exercises, because encodePNG
// writes filter 0 throughout.
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
// @ts-expect-error — plain ESM, no type declarations by design (see qa-judge.mjs's header)
import { decodePNG, encodePNG, diffImages } from "../scripts/png.mjs";

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const paethPredict = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** An RGB (colour type 2) PNG, Paeth-filtered on every row. `at` supplies each pixel. */
function writeControlPNG(w: number, h: number, at: (x: number, y: number) => [number, number, number]): Buffer {
  const raw: number[] = [];
  let prev = new Array(w * 3).fill(0);
  for (let y = 0; y < h; y++) {
    const cur: number[] = [];
    for (let x = 0; x < w; x++) cur.push(...at(x, y));
    raw.push(4);
    for (let i = 0; i < w * 3; i++) {
      const a = i >= 3 ? cur[i - 3]! : 0;
      const b = prev[i]!;
      const c = i >= 3 ? prev[i - 3]! : 0;
      raw.push((cur[i]! - paethPredict(a, b, c)) & 0xff);
    }
    prev = cur;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.from(raw))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const gradient = (x: number, y: number): [number, number, number] => [(x * 4) % 256, (y * 4) % 256, ((x + y) * 2) % 256];
const W = 64, H = 64;

describe("decodePNG", () => {
  it("reads a Paeth-filtered RGB PNG written by an independent encoder", () => {
    const img = decodePNG(writeControlPNG(W, H, gradient));
    expect([img.width, img.height]).toEqual([W, H]);
    // Every pixel, not a sample: an unfilter bug typically corrupts one row onwards, and a
    // spot check on row 20 would miss a break that starts at row 40.
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const q = (y * W + x) * 4;
        const [r, g, b] = gradient(x, y);
        expect([img.data[q], img.data[q + 1], img.data[q + 2], img.data[q + 3]]).toEqual([r, g, b, 255]);
      }
  });

  it("widens RGB to RGBA so callers never branch on channel count", () => {
    const img = decodePNG(writeControlPNG(4, 4, () => [10, 20, 30]));
    expect(img.data.length).toBe(4 * 4 * 4);
    expect(img.data[3]).toBe(255);
  });

  it("refuses formats it cannot read instead of decoding to garbage", () => {
    expect(() => decodePNG(Buffer.from("not a png at all"))).toThrow(/not a PNG/);
    const bad = writeControlPNG(4, 4, gradient);
    bad[8 + 8 + 8] = 16; // IHDR bit depth -> 16
    expect(() => decodePNG(bad)).toThrow(/bit depth 16/);
  });
});

describe("encodePNG", () => {
  it("round-trips pixels byte for byte", () => {
    const img = decodePNG(writeControlPNG(W, H, gradient));
    const back = decodePNG(encodePNG(img));
    expect(back.width).toBe(img.width);
    expect(Buffer.compare(back.data, img.data)).toBe(0);
  });
});

describe("diffImages", () => {
  const base = decodePNG(writeControlPNG(W, H, gradient));

  it("finds nothing between an image and itself", () => {
    expect(diffImages(base, base).changed).toBe(0);
  });

  it("counts exactly the pixels that changed", () => {
    const one = { ...base, data: Buffer.from(base.data) };
    const q = (20 * W + 10) * 4;
    one.data[q] = 255; one.data[q + 1] = 0; one.data[q + 2] = 0;
    expect(diffImages(base, one).changed).toBe(1);
  });

  it("counts every pixel when the image is replaced outright", () => {
    const white = { width: W, height: H, data: Buffer.alloc(W * H * 4, 255) };
    const black = { width: W, height: H, data: Buffer.alloc(W * H * 4) };
    for (let i = 3; i < black.data.length; i += 4) black.data[i] = 255;
    expect(diffImages(white, black).changed).toBe(W * H);
  });

  it("weighs colour perceptually, not by raw RGB distance", () => {
    // A red-channel-only shift of 120 is a large RGB number (perceptual score 2305) and
    // still below the threshold of 3521; lifting red AND green by the same amount scores
    // 7196 and registers. That gap is the property keeping antialiased text under the noise
    // floor — without it the 0.5% area threshold would have to be raised until it caught
    // nothing. Alpha is written explicitly: `Buffer.alloc(n, 128)` fills the alpha byte too,
    // and a half-transparent fixture is blended toward white before the comparison, which
    // silently halves every delta being asserted on.
    const solid = (r: number, g: number, b: number) => {
      const data = Buffer.alloc(8 * 8 * 4);
      for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
      return { width: 8, height: 8, data };
    };
    const flat = solid(128, 128, 128);
    expect(diffImages(flat, solid(248, 128, 128)).changed).toBe(0);
    expect(diffImages(flat, solid(255, 255, 128)).changed).toBe(64);
  });

  it("paints changed pixels red and leaves the rest as a legible grey ghost", () => {
    // A diff image that is black except for red dots says something moved but not where.
    const one = { ...base, data: Buffer.from(base.data) };
    const q = (20 * W + 10) * 4;
    one.data[q] = 255; one.data[q + 1] = 0; one.data[q + 2] = 0;
    const d = diffImages(base, one);
    expect([d.image.data[q], d.image.data[q + 1], d.image.data[q + 2]]).toEqual([255, 25, 25]);
    const other = (0 * W + 0) * 4;
    expect(d.image.data[other]).toBe(d.image.data[other + 1]); // grey: r == g == b
    expect(d.image.data[other]).toBeGreaterThan(200); // and pale, not black
  });
});
