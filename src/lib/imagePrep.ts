// 명함 이미지 전처리. Tesseract 정확도를 위해 (1) 업스케일 (2) 그레이스케일 + 대비 보정.
// 하드 이진화는 조명 불균일 시 역효과라 M1에서는 생략(Tesseract 내부 Otsu 사용).
// EXIF 회전은 최신 브라우저가 createImageBitmap/<img> 에서 기본 적용 → M1에서 별도 처리 안 함.

export interface PreparedImage {
  /** OCR 입력용 (그레이스케일·대비보정·업스케일, PNG) */
  ocrBlob: Blob;
  /** 저장/표시용 원본 축소본 (컬러, JPEG) */
  displayBlob: Blob;
  width: number;
  height: number;
}

const OCR_TARGET_LONG_EDGE = 2000; // 이보다 작으면 최대 2배까지 업스케일
const MAX_UPSCALE = 2;
const DISPLAY_LONG_EDGE = 1280;

async function toBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch (e) {
    throw new ImagePrepError(
      '이미지를 열 수 없습니다. HEIC 등 일부 형식은 지원되지 않습니다. 다른 사진(JPEG/PNG)을 선택해 주세요.',
      e,
    );
  }
}

export class ImagePrepError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ImagePrepError';
    this.cause = cause;
  }
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
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

function scaleFor(longEdge: number, srcLong: number, allowUpscale: boolean): number {
  const s = longEdge / srcLong;
  if (s >= 1) return allowUpscale ? Math.min(s, MAX_UPSCALE) : 1;
  return s;
}

/** 컬러 축소본 (저장/표시용) */
export async function makeThumbnail(file: Blob, longEdge = DISPLAY_LONG_EDGE): Promise<Blob> {
  const bmp = await toBitmap(file);
  try {
    const srcLong = Math.max(bmp.width, bmp.height);
    const s = scaleFor(longEdge, srcLong, false);
    const w = Math.round(bmp.width * s);
    const h = Math.round(bmp.height * s);
    const { canvas, ctx } = makeCanvas(w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    return await canvasToBlob(canvas, 'image/jpeg', 0.8);
  } finally {
    bmp.close();
  }
}

export async function prepareForOcr(file: Blob): Promise<PreparedImage> {
  const bmp = await toBitmap(file);
  try {
    const srcLong = Math.max(bmp.width, bmp.height);
    const s = scaleFor(OCR_TARGET_LONG_EDGE, srcLong, true);
    const w = Math.max(1, Math.round(bmp.width * s));
    const h = Math.max(1, Math.round(bmp.height * s));

    const { canvas, ctx } = makeCanvas(w, h);
    ctx.drawImage(bmp, 0, 0, w, h);

    // 표시용(컬러) 먼저 추출
    const dispScale = scaleFor(DISPLAY_LONG_EDGE, Math.max(w, h), false);
    let displayBlob: Blob;
    if (dispScale < 1) {
      const dw = Math.round(w * dispScale);
      const dh = Math.round(h * dispScale);
      const { canvas: dc, ctx: dctx } = makeCanvas(dw, dh);
      dctx.drawImage(canvas, 0, 0, dw, dh);
      displayBlob = await canvasToBlob(dc, 'image/jpeg', 0.8);
    } else {
      displayBlob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
    }

    // 그레이스케일 + 대비 스트레치 (5~95 퍼센타일 정규화)
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const hist = new Uint32Array(256);
    const gray = new Uint8ClampedArray(d.length / 4);
    for (let i = 0, g = 0; i < d.length; i += 4, g++) {
      const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      gray[g] = v;
      hist[v]++;
    }
    const total = gray.length;
    const lowCut = total * 0.05;
    const highCut = total * 0.95;
    let acc = 0;
    let lo = 0;
    let hi = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc <= lowCut) lo = v;
      if (acc <= highCut) hi = v;
    }
    if (hi - lo < 16) {
      lo = 0;
      hi = 255;
    }
    const range = hi - lo || 1;
    for (let i = 0, g = 0; i < d.length; i += 4, g++) {
      let v = ((gray[g] - lo) * 255) / range;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const ocrBlob = await canvasToBlob(canvas, 'image/png');

    return { ocrBlob, displayBlob, width: w, height: h };
  } finally {
    bmp.close();
  }
}
