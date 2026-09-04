import type { OcrResult, OcrLine, OcrProgress } from './ocr';

// 선택적 클라우드 OCR — Google Cloud Vision (BYOK: 사용자가 자기 API 키 직접 입력).
// 키는 이 기기 localStorage 에만 저장되고, 요청은 브라우저 → vision.googleapis.com 직접 전송.
// 이 경로를 쓰면 스캔 이미지가 Google 서버로 전송된다(기본은 기기 내 Tesseract).

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';
const KEY_STORE = 'cardscan.gcvKey';
const ENGINE_KEY = 'cardscan.engine';

export type Engine = 'device' | 'vision';

export class CloudOcrError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CloudOcrError';
    this.cause = cause;
  }
}

export function getGcvKey(): string {
  try {
    return (localStorage.getItem(KEY_STORE) ?? '').trim();
  } catch {
    return '';
  }
}

export function setGcvKey(key: string): void {
  try {
    const k = key.trim();
    if (k) localStorage.setItem(KEY_STORE, k);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* private mode 등 */
  }
}

export function hasGcvKey(): boolean {
  return getGcvKey().length >= 20;
}

/** vision 은 키가 있을 때만 유효 — 키를 지우면 자동으로 device 로 복귀 */
export function getEngine(): Engine {
  try {
    return localStorage.getItem(ENGINE_KEY) === 'vision' && hasGcvKey() ? 'vision' : 'device';
  } catch {
    return 'device';
  }
}

export function setEngine(e: Engine): void {
  try {
    localStorage.setItem(ENGINE_KEY, e);
  } catch {
    /* noop */
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

interface GError {
  code?: number;
  message?: string;
  status?: string;
}

function friendlyError(httpStatus: number, err?: GError): string {
  const m = err?.message ?? '';
  if (httpStatus === 400 || err?.status === 'INVALID_ARGUMENT') {
    if (/API key not valid/i.test(m)) return 'API 키가 올바르지 않습니다. 키 값을 다시 확인하세요.';
    return `요청이 거부되었습니다. (${m || 'INVALID_ARGUMENT'})`;
  }
  if (httpStatus === 403 || err?.status === 'PERMISSION_DENIED') {
    if (/has not been used|is disabled|SERVICE_DISABLED/i.test(m))
      return 'Google Cloud 프로젝트에서 "Cloud Vision API"를 활성화해야 합니다.';
    if (/referer|referrer|blocked|API_KEY_HTTP_REFERRER/i.test(m))
      return '이 주소가 API 키의 사이트(HTTP 리퍼러) 제한에 없습니다. 키 설정에 배포 주소를 추가하세요.';
    return `키에 권한이 없습니다. (${m || 'PERMISSION_DENIED'})`;
  }
  if (httpStatus === 429 || err?.status === 'RESOURCE_EXHAUSTED')
    return 'Google Vision 사용 한도를 초과했습니다 (무료 월 1,000건).';
  return `클라우드 인식 실패 (HTTP ${httpStatus}). ${m}`;
}

function boxOf(vertices: { x?: number; y?: number }[] | undefined) {
  const ys = (vertices ?? []).map((v) => v.y ?? 0);
  return {
    y0: ys.length ? Math.min(...ys) : 0,
    y1: ys.length ? Math.max(...ys) : 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLines(fta: any): OcrLine[] {
  const words: { text: string; y0: number; y1: number; x0: number }[] = [];
  for (const page of fta?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const w of para.words ?? []) {
          const text = (w.symbols ?? []).map((s: { text: string }) => s.text).join('');
          if (!text) continue;
          const b = boxOf(w.boundingBox?.vertices);
          const xs = (w.boundingBox?.vertices ?? []).map((v: { x?: number }) => v.x ?? 0);
          words.push({ text, y0: b.y0, y1: b.y1, x0: xs.length ? Math.min(...xs) : 0 });
        }
      }
    }
  }
  if (!words.length) return [];
  const hs = words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const medH = hs[hs.length >> 1] || 10;
  words.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  const lines: OcrLine[] = [];
  let cur: typeof words = [];
  let midY = 0;
  const flush = () => {
    if (!cur.length) return;
    cur.sort((a, b) => a.x0 - b.x0);
    lines.push({
      text: cur.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim(),
      top: Math.min(...cur.map((w) => w.y0)),
      height: Math.max(...cur.map((w) => w.y1)) - Math.min(...cur.map((w) => w.y0)),
    });
    cur = [];
  };
  for (const w of words) {
    const c = (w.y0 + w.y1) / 2;
    if (cur.length && Math.abs(c - midY) > medH * 0.7) flush();
    midY = cur.length ? (midY * cur.length + c) / (cur.length + 1) : c;
    cur.push(w);
  }
  flush();
  return lines;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function estimateConfidence(fta: any): number {
  const vals: number[] = [];
  for (const page of fta?.pages ?? []) {
    if (typeof page.confidence === 'number') vals.push(page.confidence);
    for (const block of page.blocks ?? []) {
      if (typeof block.confidence === 'number') vals.push(block.confidence);
    }
  }
  if (!vals.length) return 0.95;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export async function runCloudOcr(
  image: Blob,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  const key = getGcvKey();
  if (!key) {
    throw new CloudOcrError('Google Vision API 키가 없습니다. 설정에서 키를 입력하세요.');
  }
  onProgress?.({ phase: 'recognizing', progress: 0.15, label: '클라우드로 전송 중' });
  const content = await blobToBase64(image);
  onProgress?.({ phase: 'recognizing', progress: 0.45, label: '클라우드 인식 중' });

  let res: Response;
  try {
    res = await fetch(`${VISION_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            imageContext: { languageHints: ['ko', 'en'] },
          },
        ],
      }),
    });
  } catch (e) {
    throw new CloudOcrError('네트워크 오류로 Google Vision에 연결하지 못했습니다.', e);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new CloudOcrError(friendlyError(res.status, json?.error), json);

  const r = json?.responses?.[0];
  if (r?.error) throw new CloudOcrError(friendlyError(r.error.code ?? res.status, r.error), r.error);

  const fta = r?.fullTextAnnotation;
  const text: string = fta?.text ?? r?.textAnnotations?.[0]?.description ?? '';
  if (!text.trim()) {
    throw new CloudOcrError('이미지에서 글자를 찾지 못했습니다. 더 선명한 사진으로 시도하세요.');
  }

  onProgress?.({ phase: 'recognizing', progress: 1, label: '완료' });
  return { text, confidence: estimateConfidence(fta), lines: extractLines(fta) };
}

/** 1x1 이미지로 키 유효성만 확인 */
export async function testGcvKey(key: string): Promise<{ ok: boolean; message: string }> {
  const k = key.trim();
  if (k.length < 20) return { ok: false, message: '키가 너무 짧습니다.' };
  const onePx =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  try {
    const res = await fetch(`${VISION_URL}?key=${encodeURIComponent(k)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ image: { content: onePx }, features: [{ type: 'TEXT_DETECTION' }] }],
      }),
    });
    const json = await res.json().catch(() => ({}));
    const err = json?.error ?? json?.responses?.[0]?.error;
    if (res.ok && !err) return { ok: true, message: '키가 정상 동작합니다.' };
    return { ok: false, message: friendlyError(err?.code ?? res.status, err) };
  } catch {
    return { ok: false, message: '네트워크 오류로 확인하지 못했습니다.' };
  }
}
