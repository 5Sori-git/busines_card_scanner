import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Images, Keyboard, RotateCcw } from 'lucide-react';
import AppHeader from '../components/AppHeader';
import CropStep from '../components/CropStep';
import { prepareForOcr, ImagePrepError, type CropNorm } from '../lib/imagePrep';
import { runOcr, OcrError, type OcrProgress } from '../lib/ocr';
import { parseCard } from '../lib/parseCard';
import { saveImage } from '../db';
import { newId } from '../lib/id';

type Phase = 'idle' | 'crop' | 'prep' | 'ocr' | 'error';

export default function ScanPage() {
  const navigate = useNavigate();
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  function handlePick(file: File | undefined) {
    if (!file) return;
    setErrorMsg('');
    setProgress(null);
    setPickedFile(file);
    setPhase('crop');
  }

  async function runPipeline(blob: Blob, cropNorm?: CropNorm) {
    setPhase('prep');
    try {
      const prepared = await prepareForOcr(blob, { cropNorm, mode: 'auto' });

      setPhase('ocr');
      const result = await runOcr(prepared.ocrBlob, setProgress);

      const imageId = newId();
      await saveImage({
        id: imageId,
        blob: prepared.displayBlob,
        w: prepared.width,
        h: prepared.height,
        createdAt: Date.now(),
      });

      const { fields } = parseCard(result.text, { lines: result.lines });
      navigate('/new', {
        replace: true,
        state: {
          draft: fields,
          ocrRawText: result.text,
          ocrConfidence: result.confidence,
          imageId,
        },
      });
    } catch (e) {
      const msg =
        e instanceof ImagePrepError || e instanceof OcrError
          ? e.message
          : '처리 중 오류가 발생했습니다. 다시 시도해 주세요.';
      setErrorMsg(msg);
      setPhase('error');
      console.error('[scan]', e);
    }
  }

  if (phase === 'crop' && pickedFile) {
    return (
      <>
        <AppHeader title="영역 조절" back="/" />
        <CropStep
          file={pickedFile}
          onCancel={() => {
            setPickedFile(null);
            setPhase('idle');
          }}
          onConfirm={({ blob, cropNorm }) => void runPipeline(blob, cropNorm)}
        />
      </>
    );
  }

  const busy = phase === 'prep' || phase === 'ocr';
  const pct =
    phase === 'ocr' && progress?.phase === 'recognizing' ? Math.round(progress.progress * 100) : null;

  return (
    <>
      <AppHeader title="명함 스캔" back="/" />

      <main className="flex flex-1 flex-col px-4 py-5">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            handlePick(f);
          }}
        />
        <input
          ref={albumRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            handlePick(f);
          }}
        />

        {phase === 'idle' && (
          <p className="mb-4 text-sm text-slate-500">
            명함이 화면을 크게 차지하도록, 밝고 그림자 없는 곳에서 정면으로 찍으세요. 다음 화면에서
            명함 영역만 잘라낼 수 있습니다. 모든 처리는 이 기기 안에서만 이뤄집니다.
          </p>
        )}

        {busy && (
          <div className="my-6">
            <p className="mb-2 text-center text-sm font-medium text-slate-700">
              {phase === 'prep' ? '이미지 준비 중' : (progress?.label ?? '처리 중')}
              {pct !== null ? ` · ${pct}%` : ''}
            </p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{
                  width:
                    pct !== null
                      ? `${pct}%`
                      : progress?.phase === 'language'
                        ? '66%'
                        : phase === 'prep'
                          ? '15%'
                          : '40%',
                }}
              />
            </div>
            {progress?.phase === 'language' && (
              <p className="mt-2 text-center text-xs text-slate-400">
                한국어 인식 데이터를 처음 한 번만 내려받습니다 (약 10MB).
              </p>
            )}
          </div>
        )}

        {phase === 'error' && (
          <div className="my-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        <div className="mt-auto space-y-3 pt-4">
          {phase === 'error' ? (
            <button
              type="button"
              onClick={() => {
                setPhase('idle');
                setErrorMsg('');
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3.5 font-semibold text-white active:bg-brand-700"
            >
              <RotateCcw size={18} /> 다시 시도
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => cameraRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3.5 font-semibold text-white active:bg-brand-700 disabled:opacity-50"
              >
                <Camera size={18} /> 카메라로 촬영
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => albumRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-3.5 font-semibold text-slate-700 active:bg-slate-100 disabled:opacity-50"
              >
                <Images size={18} /> 앨범에서 선택
              </button>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => navigate('/new')}
            className="flex w-full items-center justify-center gap-2 py-2 text-sm text-slate-500 active:text-slate-700 disabled:opacity-50"
          >
            <Keyboard size={16} /> 사진 없이 직접 입력
          </button>
        </div>
      </main>
    </>
  );
}
