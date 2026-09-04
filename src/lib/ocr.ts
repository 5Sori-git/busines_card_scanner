import { createWorker, OEM, type Worker } from 'tesseract.js';

// Tesseract.js 워커 래퍼. 자산은 /public/tesseract/ 에 자체 호스팅(→ 오프라인 PWA).
// 워커는 지연 생성 싱글턴. 언어는 kor+eng, 엔진은 LSTM 전용(가장 가벼운 core).

export type OcrPhase = 'engine' | 'language' | 'recognizing';

export interface OcrProgress {
  phase: OcrPhase;
  /** 0~1 (단계별) */
  progress: number;
  label: string;
}

/** OCR이 인식한 한 줄. 이름 추정 등에 글자 크기(height)와 위치(top)를 활용한다. */
export interface OcrLine {
  text: string;
  /** 줄 bbox 높이(px) ≈ 글자 크기 */
  height: number;
  /** 줄 상단 y좌표(px) */
  top: number;
}

export interface OcrResult {
  text: string;
  /** 0~1 평균 신뢰도 */
  confidence: number;
  /** 레이아웃 순서의 줄 목록 (bbox 포함) */
  lines: OcrLine[];
}

export class OcrError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'OcrError';
    this.cause = cause;
  }
}

function assetUrl(path: string): string {
  const b = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return b + path;
}

// ---- 인식 모델 (fast / best) ----
export type OcrModel = 'fast' | 'best';
const MODEL_KEY = 'cardscan.ocrModel';

export function getOcrModel(): OcrModel {
  try {
    return localStorage.getItem(MODEL_KEY) === 'best' ? 'best' : 'fast';
  } catch {
    return 'fast';
  }
}

/** 모델 변경 시 현재 워커를 종료 → 다음 인식에서 새 언어데이터로 재생성 */
export async function setOcrModel(model: OcrModel): Promise<void> {
  if (getOcrModel() === model) return;
  try {
    localStorage.setItem(MODEL_KEY, model);
  } catch {
    /* 저장 실패해도 세션 내에서는 아래 종료로 반영 */
  }
  await terminateOcr();
}

let workerPromise: Promise<Worker> | null = null;
let progressListener: ((p: OcrProgress) => void) | null = null;

function handleLog(m: { status?: string; progress?: number }): void {
  if (!progressListener || !m.status) return;
  const s = m.status;
  const progress = typeof m.progress === 'number' ? m.progress : 0;
  if (s === 'recognizing text') {
    progressListener({ phase: 'recognizing', progress, label: '텍스트 인식 중' });
  } else if (s.includes('traineddata') || s.includes('language')) {
    progressListener({
      phase: 'language',
      progress,
      label:
        getOcrModel() === 'best'
          ? '고정밀 한글 데이터 준비 중 (최초 1회)'
          : '언어 데이터 준비 중 (최초 1회)',
    });
  } else if (s.includes('core') || s.includes('tesseract') || s.includes('api') || s.includes('initializ')) {
    progressListener({ phase: 'engine', progress, label: 'OCR 엔진 준비 중' });
  }
}

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const langDir = getOcrModel() === 'best' ? 'lang-best' : 'lang';
    workerPromise = createWorker('kor+eng', OEM.LSTM_ONLY, {
      workerPath: assetUrl('/tesseract/worker.min.js'),
      corePath: assetUrl('/tesseract/core'),
      langPath: assetUrl(`/tesseract/${langDir}`),
      cacheMethod: 'none', // Service Worker(CacheFirst)가 캐시 담당 → 이중 저장 방지
      gzip: true,
      logger: handleLog,
      errorHandler: (e: unknown) => console.error('[ocr] worker error', e),
    }).catch((e) => {
      workerPromise = null; // 실패하면 다음 호출에서 재시도
      throw new OcrError(
        'OCR 엔진을 불러오지 못했습니다. 온라인 상태에서 한 번 실행해 언어 데이터를 받아 주세요.',
        e,
      );
    });
  }
  return workerPromise;
}

/** 엔진/언어 데이터를 미리 로드 (스캔 화면 진입 시 호출하면 첫 인식이 빨라짐) */
export async function warmUpOcr(onProgress?: (p: OcrProgress) => void): Promise<void> {
  progressListener = onProgress ?? null;
  try {
    await getWorker();
  } finally {
    progressListener = null;
  }
}

export async function runOcr(
  image: Blob | string,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  progressListener = onProgress ?? null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    return {
      text: data.text ?? '',
      confidence: (data.confidence ?? 0) / 100,
      lines: extractLines(data),
    };
  } catch (e) {
    if (e instanceof OcrError) throw e;
    throw new OcrError('텍스트 인식에 실패했습니다. 다른 사진으로 다시 시도해 주세요.', e);
  } finally {
    progressListener = null;
  }
}

interface RawBBox {
  y0: number;
  y1: number;
}
interface RawLine {
  text?: string;
  bbox?: RawBBox;
}

function extractLines(data: { lines?: RawLine[] | null }): OcrLine[] {
  const out: OcrLine[] = [];
  for (const line of data.lines ?? []) {
    const text = (line.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const b = line.bbox;
    out.push({
      text,
      height: b ? Math.max(0, b.y1 - b.y0) : 0,
      top: b ? b.y0 : 0,
    });
  }
  return out;
}

export async function terminateOcr(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (!p) return;
  const w = await p.catch(() => null);
  if (w) await w.terminate();
}
