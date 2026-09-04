import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCw, Scan, Maximize } from 'lucide-react';
import { rotateBlob, type CropNorm } from '../lib/imagePrep';

interface Props {
  file: Blob;
  onConfirm: (result: { blob: Blob; cropNorm?: CropNorm }) => void;
  onCancel: () => void;
}

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'move';

const MIN = 0.12; // 최소 크롭 비율

function clamp(v: number, lo = 0, hi = 1) {
  return v < lo ? lo : v > hi ? hi : v;
}

export default function CropStep({ file, onConfirm, onCancel }: Props) {
  const [blob, setBlob] = useState<Blob>(file);
  const [url, setUrl] = useState('');
  const [rect, setRect] = useState<CropNorm>({ x: 0.04, y: 0.06, w: 0.92, h: 0.88 });
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ h: Handle; sx: number; sy: number; start: CropNorm } | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  const onPointerDown = useCallback(
    (h: Handle) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { h, sx: e.clientX, sy: e.clientY, start: rect };
    },
    [rect],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    const box = boxRef.current;
    if (!d || !box) return;
    const bw = box.clientWidth || 1;
    const bh = box.clientHeight || 1;
    const dx = (e.clientX - d.sx) / bw;
    const dy = (e.clientY - d.sy) / bh;
    const s = d.start;
    let { x, y, w, h } = s;

    if (d.h === 'move') {
      x = clamp(s.x + dx, 0, 1 - s.w);
      y = clamp(s.y + dy, 0, 1 - s.h);
    } else {
      const west = d.h === 'nw' || d.h === 'sw';
      const north = d.h === 'nw' || d.h === 'ne';
      if (west) {
        const nx = clamp(s.x + dx, 0, s.x + s.w - MIN);
        w = s.x + s.w - nx;
        x = nx;
      } else {
        w = clamp(s.w + dx, MIN, 1 - s.x);
      }
      if (north) {
        const ny = clamp(s.y + dy, 0, s.y + s.h - MIN);
        h = s.y + s.h - ny;
        y = ny;
      } else {
        h = clamp(s.h + dy, MIN, 1 - s.y);
      }
    }
    setRect({ x, y, w, h });
  }, []);

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  async function handleRotate() {
    if (busy) return;
    setBusy(true);
    try {
      const rotated = await rotateBlob(blob, 90);
      setBlob(rotated);
      setRect({ x: 0.04, y: 0.06, w: 0.92, h: 0.88 });
    } finally {
      setBusy(false);
    }
  }

  const pct = (n: number) => `${n * 100}%`;

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
          {url && <img src={url} alt="크롭할 명함" className="block max-h-[62vh] w-auto object-contain" draggable={false} />}

          {/* 바깥 어둡게 */}
          <div
            className="pointer-events-none absolute border border-white/90"
            style={{
              left: pct(rect.x),
              top: pct(rect.y),
              width: pct(rect.w),
              height: pct(rect.h),
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
            }}
          />
          {/* 이동 영역 */}
          <div
            className="absolute cursor-move"
            style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
            onPointerDown={onPointerDown('move')}
          />
          {/* 모서리 핸들 */}
          {(['nw', 'ne', 'sw', 'se'] as Handle[]).map((h) => {
            const left = h === 'nw' || h === 'sw' ? rect.x : rect.x + rect.w;
            const top = h === 'nw' || h === 'ne' ? rect.y : rect.y + rect.h;
            return (
              <div
                key={h}
                onPointerDown={onPointerDown(h)}
                className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: pct(left), top: pct(top) }}
              >
                <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand shadow" />
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        <p className="mb-2 text-center text-xs text-slate-500">
          명함 테두리에 맞춰 영역을 조절하세요. 기울었으면 회전.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRotate}
            disabled={busy}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-3 font-medium text-slate-700 active:bg-slate-100 disabled:opacity-50"
          >
            <RotateCw size={18} /> 회전
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ blob, cropNorm: rect })}
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
