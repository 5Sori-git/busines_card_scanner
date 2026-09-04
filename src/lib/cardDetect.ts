import { detectQuadByBlob, type QuadNorm, type Pt } from './imagePrep';

// 카드 테두리 검출.
//  1순위: 엣지 스캔라인 방식 — 워커에서(메인 스레드 안 막음). 국소 그래디언트 기반이라 조명에 강함.
//  폴백: 밝기 blob 방식 (imagePrep, 480px).
//  둘 다 "카드다운" 검증(isPlausibleCardQuad) 통과 못하면 null → 호출측은 기본 사각형 유지.

let worker: Worker | null = null;
let reqId = 0;
const pending = new Map<number, (v: { pts: Pt[]; w: number; h: number } | null) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./cardDetect.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const { id, quad } = e.data ?? {};
      const cb = pending.get(id);
      if (cb) {
        pending.delete(id);
        cb(quad ?? null);
      }
    };
    worker.onerror = () => {
      for (const cb of pending.values()) cb(null);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** 스캔 화면 진입 시 워커를 미리 띄워둔다 (지연 감소, 실패 무시) */
export function preloadCardDetect(): void {
  getWorker();
}

function detectViaWorker(
  blob: Blob,
  timeoutMs = 6000,
): Promise<{ pts: Pt[]; w: number; h: number } | null> {
  const wk = getWorker();
  if (!wk) return Promise.resolve(null);
  const id = ++reqId;
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      if (pending.delete(id)) resolve(null);
    }, timeoutMs);
    pending.set(id, (v) => {
      clearTimeout(t);
      resolve(v);
    });
    wk.postMessage({ id, blob });
  });
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function normalize(pts: Pt[], w: number, h: number): QuadNorm {
  // pts 순서: TL, TR, BR, BL (워커에서 그 순서로 보냄)
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  return pts.map((p) => ({
    x: clamp01((p.x + (p.x - cx) * 0.012) / w),
    y: clamp01((p.y + (p.y - cy) * 0.012) / h),
  })) as QuadNorm;
}

/** 검출 결과가 "명함 프레임"으로 그럴듯한지 (애매하면 자동 적용 안 함) */
export function isPlausibleCardQuad(q: QuadNorm | null | undefined): q is QuadNorm {
  if (!q || q.length !== 4) return false;
  if (q.some((p) => p.x < -0.04 || p.x > 1.04 || p.y < -0.04 || p.y > 1.04)) return false;
  if (new Set(q.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size < 4) return false;

  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const s = Math.sign(cross);
    if (s !== 0) {
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }

  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area2 += q[i].x * q[j].y - q[j].x * q[i].y;
  }
  const area = Math.abs(area2) / 2;
  if (area < 0.1 || area > 0.99) return false;

  const wAvg = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const hAvg = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const lo = Math.min(wAvg, hAvg);
  const hi = Math.max(wAvg, hAvg);
  if (lo < 1e-6) return false;
  const ar = hi / lo;
  if (ar < 1.1 || ar > 3.0) return false;

  const wTop = dist(q[0], q[1]);
  const wBot = dist(q[3], q[2]);
  const hL = dist(q[0], q[3]);
  const hR = dist(q[1], q[2]);
  if (Math.abs(wTop - wBot) / Math.max(wTop, wBot) > 0.6) return false;
  if (Math.abs(hL - hR) / Math.max(hL, hR) > 0.6) return false;

  return true;
}

/** 카드 네 모서리 자동 추정. 엣지(워커) → blob 폴백 → 둘 다 부적합하면 null. */
export async function detectCardQuad(file: Blob): Promise<QuadNorm | null> {
  try {
    const r = await detectViaWorker(file);
    if (r) {
      const q = normalize(r.pts, r.w, r.h);
      if (isPlausibleCardQuad(q)) return q;
    }
  } catch {
    /* fall through */
  }
  try {
    const q = await detectQuadByBlob(file);
    if (isPlausibleCardQuad(q)) return q;
  } catch {
    /* noop */
  }
  return null;
}
