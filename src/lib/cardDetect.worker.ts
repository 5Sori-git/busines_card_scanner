/// <reference lib="webworker" />
// 카드 테두리 검출을 메인 스레드 밖에서. OpenCV 없이 직접 구현:
//   그레이스케일 → 각 변(상/하/좌/우)에서 바깥→안으로 스캔하며 가장 강한 밝기 전이를
//   찾아 점집합을 만들고 → RANSAC 직선피팅 → 네 직선의 교점 = 네 모서리.
// 조명 변화·질감에 강함(국소 그래디언트 기반). 배경이 카드 경계까지 복잡하면 실패 → null.

interface Pt {
  x: number;
  y: number;
}
interface Line {
  /** 수평변: y = m*t + c (t=x) / 수직변: x = m*t + c (t=y) */
  m: number;
  c: number;
}

const ctx = self as unknown as Worker;

function toGray(img: ImageData): { g: Float32Array; w: number; h: number } {
  const { data, width: w, height: h } = img;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    g[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  // 3x3 박스 블러 (노이즈 억제)
  const b = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) s += g[(y + dy) * w + (x + dx)];
      b[y * w + x] = s / 9;
    }
  }
  return { g: b, w, h };
}

/**
 * 한 열/행을 바깥에서 안으로 훑어 "카드 경계" 전이를 찾는다.
 * 1) 가장 강한 전이(bestPos)를 찾고
 * 2) 그보다 바깥쪽(제한 범위 내)에 충분히 강한 전이가 또 있으면 그쪽을 택한다.
 *    → 카드 안쪽 장식 띠(흰↔파랑)가 실제 테두리(바탕↔파랑)보다 강할 때의 오검출 방지.
 */
function scanEdge(
  read: (t: number) => number,
  from: number,
  to: number, // from → to 방향 (바깥→안)
  minStep: number,
): number | null {
  const dir = to > from ? 1 : -1;
  const win = 4;
  const span = Math.abs(to - from);
  const magAt = (t: number) => {
    let before = 0;
    let after = 0;
    for (let k = 1; k <= win; k++) {
      before += read(t - dir * k);
      after += read(t + dir * k);
    }
    return Math.abs(after / win - before / win);
  };

  let bestPos = -1;
  let bestMag = 0;
  for (let t = from + dir * win; dir > 0 ? t < to - win : t > to + win; t += dir) {
    const m = magAt(t);
    if (m > bestMag) {
      bestMag = m;
      bestPos = t;
    }
  }
  if (bestMag < minStep) return null;

  // bestPos 에서 바깥으로 제한 범위만 더 살펴, 더 바깥의 유효 전이가 있으면 채택
  const limit = Math.round(span * 0.22);
  const gate = Math.max(minStep * 0.9, bestMag * 0.42);
  let outer = bestPos;
  for (let d = 1; d <= limit; d++) {
    const t = bestPos - dir * d; // 바깥 방향
    if (dir > 0 ? t <= from + win : t >= from - win) break;
    if (magAt(t) >= gate) outer = t;
  }
  return outer;
}

function ransacLine(pts: Pt[], horizontal: boolean): Line | null {
  if (pts.length < 8) return null;
  const val = (p: Pt) => (horizontal ? p.y : p.x);
  const par = (p: Pt) => (horizontal ? p.x : p.y);
  let best: number[] = [];
  const iters = 120;
  const thresh = 3.5;
  for (let it = 0; it < iters; it++) {
    const a = pts[(Math.random() * pts.length) | 0];
    const b = pts[(Math.random() * pts.length) | 0];
    const dt = par(b) - par(a);
    if (Math.abs(dt) < 1e-3) continue;
    const m = (val(b) - val(a)) / dt;
    const c = val(a) - m * par(a);
    const inl: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(val(pts[i]) - (m * par(pts[i]) + c)) <= thresh) inl.push(i);
    }
    if (inl.length > best.length) best = inl;
  }
  if (best.length < pts.length * 0.45 || best.length < 8) return null;
  // 인라이어 최소제곱 재피팅
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const n = best.length;
  for (const i of best) {
    const t = par(pts[i]);
    const v = val(pts[i]);
    sx += t;
    sy += v;
    sxx += t * t;
    sxy += t * v;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-6) return null;
  const m = (n * sxy - sx * sy) / denom;
  const c = (sy - m * sx) / n;
  return { m, c };
}

/** 수평변(y=m*x+c) 과 수직변(x=m*y+c) 의 교점 */
function intersect(hor: Line, ver: Line): Pt | null {
  // y = hor.m * x + hor.c ,  x = ver.m * y + ver.c
  const den = 1 - hor.m * ver.m;
  if (Math.abs(den) < 1e-6) return null;
  const y = (hor.m * ver.c + hor.c) / den;
  const x = ver.m * y + ver.c;
  return { x, y };
}

function detect(img: ImageData): { pts: Pt[]; w: number; h: number } | null {
  const { g, w, h } = toGray(img);
  const at = (x: number, y: number) => g[((y | 0) < 0 ? 0 : (y | 0) >= h ? h - 1 : y | 0) * w + ((x | 0) < 0 ? 0 : (x | 0) >= w ? w - 1 : x | 0)];

  // 적응 임계값: 표본 그래디언트의 대략적 분포
  let gsum = 0;
  let gn = 0;
  for (let y = 2; y < h - 2; y += 7) {
    for (let x = 2; x < w - 2; x += 7) {
      gsum += Math.abs(at(x + 2, y) - at(x - 2, y)) + Math.abs(at(x, y + 2) - at(x, y - 2));
      gn += 2;
    }
  }
  const minStep = Math.min(60, Math.max(12, (gsum / Math.max(1, gn)) * 2.2));

  const stepX = Math.max(2, Math.round(w / 200));
  const stepY = Math.max(2, Math.round(h / 200));
  const topPts: Pt[] = [];
  const botPts: Pt[] = [];
  const leftPts: Pt[] = [];
  const rightPts: Pt[] = [];

  for (let x = Math.round(w * 0.04); x < w * 0.96; x += stepX) {
    const yt = scanEdge((t) => at(x, t), 0, Math.round(h * 0.48), minStep);
    if (yt != null) topPts.push({ x, y: yt });
    const yb = scanEdge((t) => at(x, t), h - 1, Math.round(h * 0.52), minStep);
    if (yb != null) botPts.push({ x, y: yb });
  }
  for (let y = Math.round(h * 0.04); y < h * 0.96; y += stepY) {
    const xl = scanEdge((t) => at(t, y), 0, Math.round(w * 0.48), minStep);
    if (xl != null) leftPts.push({ x: xl, y });
    const xr = scanEdge((t) => at(t, y), w - 1, Math.round(w * 0.52), minStep);
    if (xr != null) rightPts.push({ x: xr, y });
  }

  const top = ransacLine(topPts, true);
  const bot = ransacLine(botPts, true);
  const left = ransacLine(leftPts, false);
  const right = ransacLine(rightPts, false);
  if (!top || !bot || !left || !right) return null;

  const tl = intersect(top, left);
  const tr = intersect(top, right);
  const br = intersect(bot, right);
  const bl = intersect(bot, left);
  if (!tl || !tr || !br || !bl) return null;

  return { pts: [tl, tr, br, bl], w, h };
}

ctx.onmessage = async (e: MessageEvent) => {
  const { id, blob } = e.data ?? {};
  if (!blob) {
    ctx.postMessage({ id, quad: null });
    return;
  }
  try {
    const bmp = await createImageBitmap(blob);
    const LONG = 760;
    const scale = Math.min(1, LONG / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const oc = new OffscreenCanvas(w, h);
    const octx = oc.getContext('2d');
    if (!octx) {
      bmp.close();
      ctx.postMessage({ id, quad: null });
      return;
    }
    octx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const res = detect(octx.getImageData(0, 0, w, h));
    ctx.postMessage({ id, quad: res });
  } catch {
    ctx.postMessage({ id, quad: null });
  }
};
