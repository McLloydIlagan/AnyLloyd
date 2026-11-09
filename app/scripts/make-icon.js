/**
 * Generates assets/icon.ico — a minimal valid Windows ICO file containing
 * 16×16, 32×32, and 48×48 images in the AnyLloyd color scheme (#1a1a2e bg, #00d4aa accent).
 *
 * Requires only Node.js built-ins (no npm packages).
 * Run: node scripts/make-icon.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── BMP helpers ──────────────────────────────────────────────────────────────

/** Write a 32-bit LE integer into a buffer at offset */
function writeUInt32LE(buf, val, offset) {
  buf[offset]     =  val        & 0xff;
  buf[offset + 1] = (val >>  8) & 0xff;
  buf[offset + 2] = (val >> 16) & 0xff;
  buf[offset + 3] = (val >> 24) & 0xff;
}

/** Write a 16-bit LE integer into a buffer at offset */
function writeUInt16LE(buf, val, offset) {
  buf[offset]     =  val       & 0xff;
  buf[offset + 1] = (val >> 8) & 0xff;
}

/**
 * Build a raw BMP DIB (no file header) for use inside an ICO entry.
 * Format: BITMAPINFOHEADER (40 bytes) + pixel data (BGRA, bottom-up) + AND mask.
 *
 * @param {number} size - Image dimension in pixels (square)
 * @param {Function} colorFn - (x, y) => [r, g, b, a]
 */
function buildDIB(size, colorFn) {
  const pixelCount = size * size;
  const rowBytes   = size * 4;                        // 32 bpp, no padding needed for powers of 2
  const maskRowBytes = Math.ceil(size / 8);           // AND mask: 1 bpp, padded to 4-byte boundary
  const maskRowPadded = Math.ceil(maskRowBytes / 4) * 4;

  const headerSize = 40;
  const pixelSize  = pixelCount * 4;
  const maskSize   = maskRowPadded * size;
  const totalSize  = headerSize + pixelSize + maskSize;

  const buf = Buffer.alloc(totalSize, 0);

  // BITMAPINFOHEADER
  writeUInt32LE(buf, 40,          0);   // biSize
  writeUInt32LE(buf, size,        4);   // biWidth
  writeUInt32LE(buf, size * 2,    8);   // biHeight (×2 = XOR + AND masks)
  writeUInt16LE(buf, 1,          12);   // biPlanes
  writeUInt16LE(buf, 32,         14);   // biBitCount
  writeUInt32LE(buf, 0,          16);   // biCompression (BI_RGB)
  writeUInt32LE(buf, pixelSize,  20);   // biSizeImage
  writeUInt32LE(buf, 0,          24);   // biXPelsPerMeter
  writeUInt32LE(buf, 0,          28);   // biYPelsPerMeter
  writeUInt32LE(buf, 0,          32);   // biClrUsed
  writeUInt32LE(buf, 0,          36);   // biClrImportant

  // XOR pixel data — BMP is bottom-up
  let pixelOff = headerSize;
  for (let row = size - 1; row >= 0; row--) {
    for (let col = 0; col < size; col++) {
      const [r, g, b, a] = colorFn(col, row);
      buf[pixelOff++] = b;
      buf[pixelOff++] = g;
      buf[pixelOff++] = r;
      buf[pixelOff++] = a;
    }
  }

  // AND mask — all zeros = fully opaque (we use alpha channel instead)
  // Leave as zeroed buffer (already done by Buffer.alloc)

  return buf;
}

/**
 * Draw the AnyLloyd icon at a given size.
 * Design: dark navy background, teal-green monitor outline with a small screen highlight.
 *
 * @param {number} size
 * @returns {Function} colorFn(x, y) => [r, g, b, a]
 */
function iconColorFn(size) {
  const bg      = [26,  26,  46,  255];  // #1a1a2e
  const accent  = [0,   212, 170, 255];  // #00d4aa
  const screen  = [15,  52,  96,  255];  // #0f3460 — inner screen
  const hilite  = [0,   240, 192, 255];  // lighter teal for highlight dot

  const cx = size / 2;
  const cy = size / 2;

  // Outer monitor border: rounded rect occupying ~80% of the icon
  const outerW = Math.round(size * 0.82);
  const outerH = Math.round(size * 0.66);
  const outerX = Math.round((size - outerW) / 2);
  const outerY = Math.round((size - outerH) / 2) - Math.round(size * 0.04);
  const r2 = Math.round(size * 0.08);   // corner radius

  // Inner screen area (inset by border width ~10%)
  const bw     = Math.max(1, Math.round(size * 0.09));
  const innerX = outerX + bw;
  const innerY = outerY + bw;
  const innerW = outerW - bw * 2;
  const innerH = outerH - bw * 2;

  // Stand: thin rectangle below monitor
  const standW = Math.round(size * 0.22);
  const standH = Math.max(1, Math.round(size * 0.09));
  const standX = Math.round(cx - standW / 2);
  const standY = outerY + outerH;

  // Base: wider rectangle at the bottom
  const baseW = Math.round(size * 0.52);
  const baseH = Math.max(1, Math.round(size * 0.07));
  const baseX = Math.round(cx - baseW / 2);
  const baseY = standY + standH;

  // Small highlight dot in upper-right of screen
  const dotR  = Math.max(1, Math.round(size * 0.07));
  const dotCX = innerX + innerW - dotR * 2;
  const dotCY = innerY + dotR * 2;

  return function colorFn(x, y) {
    // ── helpers ────────────────────────────────────────────────────────────
    function inRoundRect(px, py, rx, ry, rw, rh, cr) {
      if (px < rx || px >= rx + rw || py < ry || py >= ry + rh) return false;
      // corner check
      const corners = [
        [rx + cr,       ry + cr],
        [rx + rw - cr,  ry + cr],
        [rx + cr,       ry + rh - cr],
        [rx + rw - cr,  ry + rh - cr],
      ];
      if (px < rx + cr && py < ry + cr) {
        const dx = px - corners[0][0], dy = py - corners[0][1];
        return dx * dx + dy * dy <= cr * cr;
      }
      if (px >= rx + rw - cr && py < ry + cr) {
        const dx = px - corners[1][0], dy = py - corners[1][1];
        return dx * dx + dy * dy <= cr * cr;
      }
      if (px < rx + cr && py >= ry + rh - cr) {
        const dx = px - corners[2][0], dy = py - corners[2][1];
        return dx * dx + dy * dy <= cr * cr;
      }
      if (px >= rx + rw - cr && py >= ry + rh - cr) {
        const dx = px - corners[3][0], dy = py - corners[3][1];
        return dx * dx + dy * dy <= cr * cr;
      }
      return true;
    }

    function inRect(px, py, rx, ry, rw, rh) {
      return px >= rx && px < rx + rw && py >= ry && py < ry + rh;
    }

    function inCircle(px, py, ccx, ccy, cr) {
      const dx = px - ccx, dy = py - ccy;
      return dx * dx + dy * dy <= cr * cr;
    }

    // ── drawing order (painter's algorithm) ────────────────────────────────
    if (inRoundRect(x, y, outerX, outerY, outerW, outerH, r2)) {
      // Inner screen area
      if (inRect(x, y, innerX, innerY, innerW, innerH)) {
        // Highlight dot
        if (inCircle(x, y, dotCX, dotCY, dotR)) return hilite;
        return screen;
      }
      return accent;
    }
    if (inRect(x, y, standX, standY, standW, standH)) return accent;
    if (inRect(x, y, baseX,  baseY,  baseW,  baseH))  return accent;
    return bg;
  };
}

// ── ICO builder ──────────────────────────────────────────────────────────────

const SIZES = [16, 32, 48, 256];

const dibs = SIZES.map((sz) => buildDIB(sz, iconColorFn(sz)));

// ICO file format:
//   6 bytes header
//   N × 16 bytes directory entries
//   N × image data blobs

const ICO_HEADER_SIZE = 6;
const ICO_DIR_ENTRY_SIZE = 16;
const dirOffset = ICO_HEADER_SIZE + SIZES.length * ICO_DIR_ENTRY_SIZE;

let imageOffset = dirOffset;
const entries = dibs.map((dib, i) => {
  const sz = SIZES[i];
  const entry = { size: sz, dataSize: dib.length, offset: imageOffset };
  imageOffset += dib.length;
  return entry;
});

const totalSize = imageOffset;
const ico = Buffer.alloc(totalSize, 0);

// Header
writeUInt16LE(ico, 0,              0);   // reserved
writeUInt16LE(ico, 1,              2);   // type = ICO
writeUInt16LE(ico, SIZES.length,   4);   // image count

// Directory entries + image blobs
entries.forEach((e, i) => {
  const de = ICO_HEADER_SIZE + i * ICO_DIR_ENTRY_SIZE;
  const sz = e.size;
  ico[de]     = sz >= 256 ? 0 : sz;   // width  (0 = 256)
  ico[de + 1] = sz >= 256 ? 0 : sz;   // height (0 = 256)
  ico[de + 2] = 0;                    // color count (0 = true color)
  ico[de + 3] = 0;                    // reserved
  writeUInt16LE(ico, 1,         de + 4);   // planes
  writeUInt16LE(ico, 32,        de + 6);   // bit count
  writeUInt32LE(ico, e.dataSize, de + 8);  // data size
  writeUInt32LE(ico, e.offset,  de + 12);  // data offset
  // Copy DIB data
  dibs[i].copy(ico, e.offset);
});

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.ico');
fs.writeFileSync(outPath, ico);
console.log(`Icon written to ${outPath} (${ico.length} bytes, ${SIZES.join('/')}px)`);
