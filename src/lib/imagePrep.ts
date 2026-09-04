// 명함 이미지 전처리.
//  - 회전(사용자 지정 0/90/180/270) + 크롭(명함 영역만) → OCR 정확도의 핵심
//  - 업스케일(작은 글씨 보정)
//  - 그레이스케일 + 조명 보정
//      mode 'plain'    : 그레이스케일만 (Tesseract 내부 Otsu 사용) — 균일 조명 깨끗한 크롭에 적합
//      mode 'binarize' : 로컬 적응형 이진화 — 조명 불균일 / 질감 있는 명함에 강함
//      mode 'auto'     : binarize 시도 후 결과가 이상하면(거의 단색) plain+대비스트레치로 폴백

export type PrepMode = 'auto' | 'binarize' | 'plain';

/** (회전 적용 후) 이미지 기준 0~1 정규화 크롭 사각형 */
export interface CropNorm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PrepOptions {
  cropNorm?: CropNorm;
  rotate?: 0 | 90 | 180 | 270;
  mode?: PrepMode;
}

export interface PreparedImage {
  /** OCR 입력용 (그레이스케일/이진화, PNG) */
  ocrBlob: Blob;
  /** 저장/표시용 (컬러, 크롭·회전 반영, JPEG) */
  displayBlob: Blob;
  width: number;
  height: number;
}

const OCR_TARGET_LONG_EDGE = 2200;
const MAX_UPSCALE = 3;
const DISPLAY_LONG_EDGE = 1280;

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
    // imageOrientation 옵션 미지원 브라우저 폴백
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

/** 로컬 적응형 이진화 (적분영상). data 는 RGBA, 그레이스케일이 R=G=B 로 채워져 있다고 가정 */
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
  return whiteCount / n; // 흰색 비율
}

/** 그레이스케일 + 5~95 퍼센타일 대비 스트레치 (in-place) */
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
    const canvas = drawRotated(bmp, rotate);
    return await canvasToBlob(canvas, 'image/jpeg', 0.92);
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

export async function prepareForOcr(file: Blob, opts: PrepOptions = {}): Promise<PreparedImage> {
  const { cropNorm, rotate = 0, mode = 'auto' } = opts;
  const bmp = await toBitmap(file);
  try {
    // 1) 회전
    const rotated = drawRotated(bmp, rotate);

    // 2) 크롭 영역 (회전 좌표계 기준)
    const c = cropNorm ?? { x: 0, y: 0, w: 1, h: 1 };
    const cx = Math.max(0, Math.min(rotated.width - 1, Math.round(c.x * rotated.width)));
    const cy = Math.max(0, Math.min(rotated.height - 1, Math.round(c.y * rotated.height)));
    const cw = Math.max(1, Math.min(rotated.width - cx, Math.round(c.w * rotated.width)));
    const ch = Math.max(1, Math.min(rotated.height - cy, Math.round(c.h * rotated.height)));

    // 3) 업스케일 배율
    const cropLong = Math.max(cw, ch);
    let scale = OCR_TARGET_LONG_EDGE / cropLong;
    scale = scale > MAX_UPSCALE ? MAX_UPSCALE : scale < 1 ? scale : Math.min(scale, MAX_UPSCALE);
    if (scale >= 0.999 && scale <= 1.001) scale = 1;
    const w = Math.max(1, Math.round(cw * scale));
    const h = Math.max(1, Math.round(ch * scale));

    const { canvas, ctx } = makeCanvas(w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(rotated, cx, cy, cw, ch, 0, 0, w, h);

    // 4) 표시용 컬러본
    const dispScale = Math.min(1, DISPLAY_LONG_EDGE / Math.max(w, h));
    let displayBlob: Blob;
    if (dispScale < 1) {
      const { canvas: dc, ctx: dctx } = makeCanvas(w * dispScale, h * dispScale);
      dctx.drawImage(canvas, 0, 0, dc.width, dc.height);
      displayBlob = await canvasToBlob(dc, 'image/jpeg', 0.82);
    } else {
      displayBlob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
    }

    // 5) OCR 전처리
    const img = ctx.getImageData(0, 0, w, h);
    if (mode === 'plain') {
      grayStretch(img.data, false);
    } else {
      grayStretch(img.data, false); // 먼저 그레이스케일
      const whiteRatio = adaptiveThreshold(img.data, w, h);
      if (mode === 'auto' && (whiteRatio > 0.97 || whiteRatio < 0.03)) {
        // 이진화 실패 → 대비 스트레치로 폴백
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
