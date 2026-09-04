// 명함 이미지 전처리.
//  - 회전(0/90/180/270) + 크롭/원근보정(명함 영역만 반듯하게) → OCR 정확도의 핵심
//  - 업스케일(작은 글씨 보정)
//  - 그레이스케일 + 조명 보정
//      mode 'plain'    : 그레이스케일만 (Tesseract 내부 Otsu 사용)
//      mode 'binarize' : 로컬 적응형 이진화 — 조명 불균일 / 질감 있는 명함에 강함
//      mode 'auto'     : binarize 시도 후 결과가 이상하면(거의 단색) plain+대비스트레치로 폴백

export type PrepMode = 'auto' | 'binarize' | 'plain';

export interface Pt {
  x: number;
  y: number;
}

/** (회전 적용 후) 이미지 기준 0~1 정규화 크롭 사각형 */
export interface CropNorm {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** (회전 적용 후) 이미지 기준 0~1 정규화 네 꼭짓점 — TL, TR, BR, BL 순서 */
export type QuadNorm = [Pt, Pt, Pt, Pt];

export interface PrepOptions {
  cropNorm?: CropNorm;
  quadNorm?: QuadNorm;
  rotate?: 0 | 90 | 180 | 270;
  mode?: PrepMode;
}

export interface PreparedImage {
  /** OCR 입력용 (그레이스케일/이진화, PNG) */
  ocrBlob: Blob;
  /** 저장/표시용 (컬러, 크롭·회전·원근보정 반영, JPEG) */
  displayBlob: Blob;
  width: number;
  height: number;
}

const OCR_TARGET_LONG_EDGE = 2200;
const MAX_UPSCALE = 3;
const DISPLAY_LONG_EDGE = 1280;
const SOURCE_MAX_LONG_EDGE = 2800;

export class ImagePrepError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ImagePrepError';
    this.cause = cause;
  }
}

async function toBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    /* imageOrientation 미지원 → 폴백 */
  }
  try {
    return await createImageBitmap(file);
  } catch (e) {
    throw new ImagePrepError(
      '이미지를 열 수 없습니다. HEIC 등 일부 형식은 지원되지 않습니다. 다른 사진(JPEG/PNG)을 선택해 주세요.',
      e,
    );
  }
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new ImagePrepError('Canvas 2D 컨텍스트를 만들 수 없습니다.');
  return { canvas, ctx };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new ImagePrepError('이미지 인코딩에 실패했습니다.'))),
      type,
      quality,
    );
  });
}

type Src = ImageBitmap | HTMLCanvasElement;

function drawRotated(src: Src, rotate: 0 | 90 | 180 | 270): HTMLCanvasElement {
  const sw = src.width;
  const sh = src.height;
  if (rotate === 0) {
    const { canvas, ctx } = makeCanvas(sw, sh);
    ctx.drawImage(src, 0, 0);
    return canvas;
  }
  const swap = rotate === 90 || rotate === 270;
  const { canvas, ctx } = makeCanvas(swap ? sh : sw, swap ? sw : sh);
  ctx.save();
  if (rotate === 90) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotate === 180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  } else {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  return canvas;
}

function downscale(src: HTMLCanvasElement, maxLong: number): HTMLCanvasElement {
  const long = Math.max(src.width, src.height);
  if (long <= maxLong) return src;
  const s = maxLong / long;
  const { canvas, ctx } = makeCanvas(src.width * s, src.height * s);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);

/** 단위정사각형 (0,0)(1,0)(1,1)(0,1) → quad(p0..p3) 사영변환 계수 */
function squareToQuad(p: [Pt, Pt, Pt, Pt]) {
  const [p0, p1, p2, p3] = p;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    return {
      a: p1.x - p0.x, b: p2.x - p1.x, c: p0.x,
      d: p1.y - p0.y, e: p2.y - p1.y, f: p0.y,
      g: 0, h: 0,
    };
  }
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return {
    a: p1.x - p0.x + g * p1.x,
    b: p3.x - p0.x + h * p3.x,
    c: p0.x,
    d: p1.y - p0.y + g * p1.y,
    e: p3.y - p0.y + h * p3.y,
    f: p0.y,
    g,
    h,
  };
}

/** src 캔버스에서 quad(픽셀좌표, TL/TR/BR/BL) 영역을 outW×outH 반듯한 사각형으로 원근 보정 */
function perspectiveWarp(
  src: HTMLCanvasElement,
  quad: [Pt, Pt, Pt, Pt],
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const sctx = src.getContext('2d', { willReadFrequently: true });
  if (!sctx) throw new ImagePrepError('Canvas 컨텍스트를 만들 수 없습니다.');
  const sd = sctx.getImageData(0, 0, src.width, src.height).data;
  const sw = src.width;
  const sh = src.height;

  const { a, b, c, d, e, f, g, h } = squareToQuad(quad);
  const { canvas: out, ctx: octx } = makeCanvas(outW, outH);
  const oImg = octx.createImageData(outW, outH);
  const od = oImg.data;

  for (let y = 0; y < outH; y++) {
    const v = (y + 0.5) / outH;
    for (let x = 0; x < outW; x++) {
      const u = (x + 0.5) / outW;
      const denom = g * u + h * v + 1 || 1e-9;
      let sx = (a * u + b * v + c) / denom;
      let sy = (d * u + e * v + f) / denom;
      if (sx < 0) sx = 0;
      else if (sx > sw - 1) sx = sw - 1;
      if (sy < 0) sy = 0;
      else if (sy > sh - 1) sy = sh - 1;
      const x0 = sx | 0;
      const y0 = sy | 0;
      const x1 = x0 + 1 < sw ? x0 + 1 : x0;
      const y1 = y0 + 1 < sh ? y0 + 1 : y0;
      const fx = sx - x0;
      const fy = sy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * outW + x) * 4;
      od[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
      od[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
      od[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
      od[o + 3] = 255;
    }
  }
  octx.putImageData(oImg, 0, 0);
  return out;
}

/** 로컬 적응형 이진화 (적분영상). data 는 RGBA, R=G=B=그레이 가정 */
function adaptiveThreshold(data: Uint8ClampedArray, w: number, h: number): number {
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  for (let i = 0, g = 0; i < data.length; i += 4, g++) gray[g] = data[i];

  const sw = w + 1;
  const sat = new Float64Array(sw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const rowOff = y * w;
    const satRow = (y + 1) * sw;
    const satPrev = y * sw;
    for (let x = 0; x < w; x++) {
      rowSum += gray[rowOff + x];
      sat[satRow + x + 1] = sat[satPrev + x + 1] + rowSum;
    }
  }

  const rad = Math.min(60, Math.max(10, Math.round(Math.min(w, h) / 12)));
  const C = 10;
  let whiteCount = 0;
  for (let y = 0; y < h; y++) {
    const y0 = y - rad < 0 ? 0 : y - rad;
    const y1 = y + rad >= h ? h - 1 : y + rad;
    for (let x = 0; x < w; x++) {
      const x0 = x - rad < 0 ? 0 : x - rad;
      const x1 = x + rad >= w ? w - 1 : x + rad;
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        sat[(y1 + 1) * sw + (x1 + 1)] -
        sat[y0 * sw + (x1 + 1)] -
        sat[(y1 + 1) * sw + x0] +
        sat[y0 * sw + x0];
      const mean = sum / area;
      const g = y * w + x;
      const on = gray[g] > mean - C ? 255 : 0;
      if (on) whiteCount++;
      const i = g * 4;
      data[i] = data[i + 1] = data[i + 2] = on;
      data[i + 3] = 255;
    }
  }
  return whiteCount / n;
}

/** 그레이스케일 + (옵션) 5~95 퍼센타일 대비 스트레치 (in-place) */
function grayStretch(data: Uint8ClampedArray, stretch: boolean): void {
  const n = data.length / 4;
  const hist = new Uint32Array(256);
  const gray = new Uint8ClampedArray(n);
  for (let i = 0, g = 0; i < data.length; i += 4, g++) {
    const v = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    gray[g] = v;
    hist[v]++;
  }
  let lo = 0;
  let hi = 255;
  if (stretch) {
    const lowCut = n * 0.05;
    const highCut = n * 0.95;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc <= lowCut) lo = v;
      if (acc <= highCut) hi = v;
    }
    if (hi - lo < 16) {
      lo = 0;
      hi = 255;
    }
  }
  const range = hi - lo || 1;
  for (let i = 0, g = 0; i < data.length; i += 4, g++) {
    let v = stretch ? ((gray[g] - lo) * 255) / range : gray[g];
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
}

/** blob 을 90/180/270° 회전한 새 JPEG 로 (EXIF 방향도 함께 흡수) */
export async function rotateBlob(file: Blob, rotate: 90 | 180 | 270): Promise<Blob> {
  const bmp = await toBitmap(file);
  try {
    return await canvasToBlob(drawRotated(bmp, rotate), 'image/jpeg', 0.92);
  } finally {
    bmp.close();
  }
}

// ---- 카드 테두리 자동 검출 ----
// 라이브러리 없이: 축소 → 그레이스케일 → Otsu 이진화 → 최대 연결영역 → 극점 4개를 모서리로.
// 밝은 명함/어두운 배경(또는 반대) 모두 시도해서 더 그럴듯한 쪽 선택. 실패하면 null.

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      thr = t;
    }
  }
  return thr;
}

interface QuadCandidate {
  quad: [Pt, Pt, Pt, Pt];
  areaFrac: number;
  solidity: number; // 영역크기 / bbox넓이
}

function largestBlobQuad(
  gray: Uint8Array,
  w: number,
  h: number,
  thr: number,
  bright: boolean,
): QuadCandidate | null {
  const n = w * h;
  const inMask = (p: number) => (bright ? gray[p] > thr : gray[p] < thr);
  const label = new Int32Array(n);
  let bestId = 0;
  let bestSize = 0;
  let cur = 0;
  const stack: number[] = [];
  for (let p = 0; p < n; p++) {
    if (label[p] || !inMask(p)) continue;
    cur++;
    let size = 0;
    stack.length = 0;
    stack.push(p);
    label[p] = cur;
    while (stack.length) {
      const q = stack.pop() as number;
      size++;
      const qx = q % w;
      if (qx > 0 && !label[q - 1] && inMask(q - 1)) {
        label[q - 1] = cur;
        stack.push(q - 1);
      }
      if (qx < w - 1 && !label[q + 1] && inMask(q + 1)) {
        label[q + 1] = cur;
        stack.push(q + 1);
      }
      if (q >= w && !label[q - w] && inMask(q - w)) {
        label[q - w] = cur;
        stack.push(q - w);
      }
      if (q < n - w && !label[q + w] && inMask(q + w)) {
        label[q + w] = cur;
        stack.push(q + w);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestId = cur;
    }
  }
  if (!bestId) return null;
  const areaFrac = bestSize / n;
  if (areaFrac < 0.15 || areaFrac > 0.985) return null;

  let top: Pt = { x: 0, y: 1e9 };
  let bot: Pt = { x: 0, y: -1 };
  let left: Pt = { x: 1e9, y: 0 };
  let right: Pt = { x: -1, y: 0 };
  let minX = 1e9;
  let minY = 1e9;
  let maxX = -1;
  let maxY = -1;
  for (let p = 0; p < n; p++) {
    if (label[p] !== bestId) continue;
    const x = p % w;
    const y = (p / w) | 0;
    if (y < top.y || (y === top.y && x < top.x)) top = { x, y };
    if (y > bot.y || (y === bot.y && x > bot.x)) bot = { x, y };
    if (x < left.x || (x === left.x && y > left.y)) left = { x, y };
    if (x > right.x || (x === right.x && y < right.y)) right = { x, y };
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bboxArea = (maxX - minX + 1) * (maxY - minY + 1) || 1;
  const solidity = bestSize / bboxArea;

  const pts = [top, right, bot, left];
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x));
  const tl = bySum[0];
  const br = bySum[3];
  const tr = byDiff[0];
  const bl = byDiff[3];
  const quad: [Pt, Pt, Pt, Pt] = [tl, tr, br, bl];
  if (new Set(quad.map((p) => `${p.x},${p.y}`)).size < 4) return null;

  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area2 += quad[i].x * quad[j].y - quad[j].x * quad[i].y;
  }
  if (Math.abs(area2) / 2 / n < 0.12) return null;

  return { quad, areaFrac, solidity };
}

/** 카드 네 모서리 자동 추정. 못 찾으면 null. */
export async function detectCardQuad(file: Blob): Promise<QuadNorm | null> {
  const bmp = await toBitmap(file);
  try {
    const s = 480 / Math.max(bmp.width, bmp.height);
    const w = Math.max(1, Math.round(bmp.width * Math.min(1, s)));
    const h = Math.max(1, Math.round(bmp.height * Math.min(1, s)));
    const { ctx } = makeCanvas(w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;

    const gray = new Uint8Array(w * h);
    const hist = new Uint32Array(256);
    for (let i = 0, g = 0; i < d.length; i += 4, g++) {
      const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      gray[g] = v;
      hist[v]++;
    }
    const thr = otsu(hist, w * h);

    const cands = [
      largestBlobQuad(gray, w, h, thr, true),
      largestBlobQuad(gray, w, h, thr, false),
    ].filter((c): c is QuadCandidate => !!c);
    if (!cands.length) return null;

    // 면적이 20~90%에 가깝고 solidity(사각형다움)가 높은 후보 선택
    const score = (c: QuadCandidate) => {
      const areaPenalty = Math.abs(c.areaFrac - 0.5);
      return c.solidity - areaPenalty * 0.6;
    };
    cands.sort((a, b) => score(b) - score(a));
    const best = cands[0];
    if (best.solidity < 0.62) return null;

    const cx = (best.quad[0].x + best.quad[1].x + best.quad[2].x + best.quad[3].x) / 4;
    const cy = (best.quad[0].y + best.quad[1].y + best.quad[2].y + best.quad[3].y) / 4;
    const out = best.quad.map((p) => ({
      x: clamp01((p.x + (p.x - cx) * 0.03) / w),
      y: clamp01((p.y + (p.y - cy) * 0.03) / h),
    })) as QuadNorm;
    return out;
  } catch {
    return null;
  } finally {
    bmp.close();
  }
}

export async function makeThumbnail(file: Blob, longEdge = DISPLAY_LONG_EDGE): Promise<Blob> {
  const bmp = await toBitmap(file);
  try {
    const s = Math.min(1, longEdge / Math.max(bmp.width, bmp.height));
    const { canvas, ctx } = makeCanvas(bmp.width * s, bmp.height * s);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas, 'image/jpeg', 0.8);
  } finally {
    bmp.close();
  }
}

function upscaleFactor(long: number): number {
  const s = OCR_TARGET_LONG_EDGE / long;
  if (s <= 1) return s;
  return Math.min(s, MAX_UPSCALE);
}

export async function prepareForOcr(file: Blob, opts: PrepOptions = {}): Promise<PreparedImage> {
  const { cropNorm, quadNorm, rotate = 0, mode = 'auto' } = opts;
  const bmp = await toBitmap(file);
  try {
    const rotated = downscale(drawRotated(bmp, rotate), SOURCE_MAX_LONG_EDGE);

    let canvas: HTMLCanvasElement;
    if (quadNorm) {
      // 원근 보정
      const quadPx = quadNorm.map((p) => ({
        x: p.x * rotated.width,
        y: p.y * rotated.height,
      })) as [Pt, Pt, Pt, Pt];
      const targetW = (dist(quadPx[0], quadPx[1]) + dist(quadPx[3], quadPx[2])) / 2 || 1;
      const targetH = (dist(quadPx[0], quadPx[3]) + dist(quadPx[1], quadPx[2])) / 2 || 1;
      const s = upscaleFactor(Math.max(targetW, targetH));
      canvas = perspectiveWarp(
        rotated,
        quadPx,
        Math.max(1, Math.round(targetW * s)),
        Math.max(1, Math.round(targetH * s)),
      );
    } else {
      // 사각형 크롭 (기본 전체)
      const c = cropNorm ?? { x: 0, y: 0, w: 1, h: 1 };
      const cx = Math.max(0, Math.min(rotated.width - 1, Math.round(c.x * rotated.width)));
      const cy = Math.max(0, Math.min(rotated.height - 1, Math.round(c.y * rotated.height)));
      const cw = Math.max(1, Math.min(rotated.width - cx, Math.round(c.w * rotated.width)));
      const ch = Math.max(1, Math.min(rotated.height - cy, Math.round(c.h * rotated.height)));
      const s = upscaleFactor(Math.max(cw, ch));
      const { canvas: cnv, ctx } = makeCanvas(cw * s, ch * s);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(rotated, cx, cy, cw, ch, 0, 0, cnv.width, cnv.height);
      canvas = cnv;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new ImagePrepError('Canvas 컨텍스트를 만들 수 없습니다.');
    const w = canvas.width;
    const h = canvas.height;

    // 표시용 컬러본
    const dispScale = Math.min(1, DISPLAY_LONG_EDGE / Math.max(w, h));
    let displayBlob: Blob;
    if (dispScale < 1) {
      const { canvas: dc, ctx: dctx } = makeCanvas(w * dispScale, h * dispScale);
      dctx.imageSmoothingQuality = 'high';
      dctx.drawImage(canvas, 0, 0, dc.width, dc.height);
      displayBlob = await canvasToBlob(dc, 'image/jpeg', 0.82);
    } else {
      displayBlob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
    }

    // OCR 전처리
    const img = ctx.getImageData(0, 0, w, h);
    if (mode === 'plain') {
      grayStretch(img.data, false);
    } else {
      grayStretch(img.data, false);
      const whiteRatio = adaptiveThreshold(img.data, w, h);
      if (mode === 'auto' && (whiteRatio > 0.97 || whiteRatio < 0.03)) {
        const fresh = ctx.getImageData(0, 0, w, h);
        grayStretch(fresh.data, true);
        img.data.set(fresh.data);
      }
    }
    ctx.putImageData(img, 0, 0);
    const ocrBlob = await canvasToBlob(canvas, 'image/png');

    return { ocrBlob, displayBlob, width: w, height: h };
  } finally {
    bmp.close();
  }
}
