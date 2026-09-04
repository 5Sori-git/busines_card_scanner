// 의존성 없이 PWA 아이콘 PNG를 생성한다. (Node 내장 zlib 만 사용)
// npm run icons / predev / prebuild 에서 자동 실행.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');
mkdirSync(outDir, { recursive: true });

// ---- 최소 PNG 인코더 (RGBA, 8bit, filter 0) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 아이콘 그리기: 인디고 배경 위에 흰 명함 + 텍스트 줄 2개 ----
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  };
  const fillRect = (x0, y0, x1, y1, r, g, b) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++)
      for (let x = Math.round(x0); x < Math.round(x1); x++) put(x, y, r, g, b);
  };

  // 배경 (brand indigo #4f46e5)
  fillRect(0, 0, size, size, 0x4f, 0x46, 0xe5);
  // 명함 (safe zone 0.2~0.8 안쪽 → maskable 로도 사용 가능)
  fillRect(size * 0.22, size * 0.31, size * 0.78, size * 0.69, 0xff, 0xff, 0xff);
  // 텍스트 줄
  fillRect(size * 0.29, size * 0.42, size * 0.63, size * 0.455, 0x94, 0xa3, 0xb8);
  fillRect(size * 0.29, size * 0.52, size * 0.55, size * 0.555, 0xcb, 0xd5, 0xe1);
  // 강조 점 (brand)
  fillRect(size * 0.29, size * 0.6, size * 0.4, size * 0.635, 0x4f, 0x46, 0xe5);

  return encodePNG(size, size, rgba);
}

const targets = [
  ['pwa-192x192.png', 192],
  ['pwa-512x512.png', 512],
  ['maskable-512x512.png', 512],
  ['apple-touch-icon-180x180.png', 180],
];

for (const [name, size] of targets) {
  writeFileSync(join(outDir, name), drawIcon(size));
  console.log('generated', name);
}
