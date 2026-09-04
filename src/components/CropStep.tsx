import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCw, Scan, Maximize, Wand2 } from 'lucide-react';
import { rotateBlob, detectCardQuad, type QuadNorm, type Pt } from '../lib/imagePrep';

interface Props {
  file: Blob;
  onConfirm: (result: { blob: Blob; quadNorm?: QuadNorm }) => void;
  onCancel: () => void;
}

type CornerIdx = 0 | 1 | 2 | 3; // TL, TR, BR, BL

const DEFAULT: QuadNorm = [
  { x: 0.06, y: 0.1 },
  { x: 0.94, y: 0.1 },
  { x: 0.94, y: 0.9 },
  { x: 0.06, y: 0.9 },
];
const cloneQuad = (q: QuadNorm) => q.map((p) => ({ ...p })) as QuadNorm;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default function CropStep({ file, onConfirm, onCancel }: Props) {
  const [blob, setBlob] = useState<Blob>(file);
  const [url, setUrl] = useState('');
  const [pts, setPts] = useState<QuadNorm>(cloneQuad(DEFAULT));
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(true);
  const [note, setNote] = useState<'detected' | 'manual' | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: CornerIdx; sx: number; sy: number; start: Pt } | null>(null);
  const touched = useRef(false);

  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  // blob 이 바뀔 때(첫 로드/회전) 테두리 자동 검출
  useEffect(() => {
    let alive = true;
    touched.current = false;
    setDetecting(true);
    setNote(null);
    detectCardQuad(blob)
      .then((q) => {
        if (!alive || touched.current) return;
        if (q) {
          setPts(q);
          setNote('detected');
        } else {
          setPts(cloneQuad(DEFAULT));
          setNote('manual');
        }
      })
      .finally(() => alive && setDetecting(false));
    return () => {
      alive = false;
    };
  }, [blob]);

  const onPointerDown = useCallback(
    (i: CornerIdx) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      touched.current = true;
      setNote(null);
      drag.current = { i, sx: e.clientX, sy: e.clientY, start: { ...pts[i] } };
    },
    [pts],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    const box = boxRef.current;
    if (!d || !box) return;
    const nx = clamp01(d.start.x + (e.clientX - d.sx) / (box.clientWidth || 1));
    const ny = clamp01(d.start.y + (e.clientY - d.sy) / (box.clientHeight || 1));
    setPts((prev) => {
      const next = cloneQuad(prev);
      next[d.i] = { x: nx, y: ny };
      return next;
    });
  }, []);

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  async function handleRotate() {
    if (busy) return;
    setBusy(true);
    try {
      setBlob(await rotateBlob(blob, 90)); // → blob effect 가 재검출
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoDetect() {
    setDetecting(true);
    setNote(null);
    const q = await detectCardQuad(blob);
    touched.current = false;
    if (q) {
      setPts(q);
      setNote('detected');
    } else {
      setNote('manual');
    }
    setDetecting(false);
  }

  const S = 1000;
  const poly = pts.map((p) => `${p.x * S},${p.y * S}`).join(' ');

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 items-center justify-center bg-slate-900 px-2 py-3">
        <div
          ref={boxRef}
          className="relative max-h-full max-w-full touch-none select-none"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {url && (
            <img
              src={url}
              alt="크롭할 명함"
              className="block max-h-[60vh] w-auto object-contain"
              draggable={false}
            />
          )}

          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${S} ${S}`}
            preserveAspectRatio="none"
          >
            <path
              d={`M0,0 H${S} V${S} H0 Z M ${poly} Z`}
              fill="rgba(0,0,0,0.55)"
              fillRule="evenodd"
            />
            <polygon
              points={poly}
              fill="none"
              stroke="#fff"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {pts.map((p, i) => (
            <div
              key={i}
              onPointerDown={onPointerDown(i as CornerIdx)}
              className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            >
              <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand shadow" />
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        <p className="mb-2 text-center text-xs text-slate-500">
          {detecting
            ? '명함 테두리 찾는 중…'
            : note === 'detected'
              ? '테두리를 자동으로 잡았어요. 어긋난 점은 끌어서 맞추세요.'
              : '명함의 네 모서리에 점을 맞추세요. 비스듬해도 반듯하게 펴집니다.'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRotate}
            disabled={busy || detecting}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-3 font-medium text-slate-700 active:bg-slate-100 disabled:opacity-50"
          >
            <RotateCw size={18} /> 회전
          </button>
          <button
            type="button"
            onClick={() => void handleAutoDetect()}
            disabled={busy || detecting}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-3 font-medium text-slate-700 active:bg-slate-100 disabled:opacity-50"
          >
            <Wand2 size={18} /> 자동
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ blob, quadNorm: pts })}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand py-3 font-semibold text-white active:bg-brand-700"
          >
            <Scan size={18} /> 이 영역 인식
          </button>
        </div>
        <div className="mt-2 flex justify-between">
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-2 text-sm text-slate-500 active:text-slate-700"
          >
            다시 선택
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ blob })}
            className="flex items-center gap-1 px-2 py-2 text-sm text-slate-500 active:text-slate-700"
          >
            <Maximize size={14} /> 전체 인식
          </button>
        </div>
      </div>
    </div>
  );
}
