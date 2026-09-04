import {
  prepareForOcr,
  type PreparedImage,
  type PrepMode,
  type QuadNorm,
} from './imagePrep';
import { runOcr, type OcrResult, type OcrProgress } from './ocr';
import { runCloudOcr, getEngine, type Engine } from './cloudOcr';

// 스캔/재인식 공통 경로: 전처리 → (기기 Tesseract 또는 Google Vision) 인식.

export interface RecognizeOpts {
  engine?: Engine;
  mode?: PrepMode;
  quadNorm?: QuadNorm;
  onProgress?: (p: OcrProgress) => void;
}

export async function recognizeImage(
  blob: Blob,
  opts: RecognizeOpts = {},
): Promise<{ prepared: PreparedImage; result: OcrResult; engine: Engine }> {
  const engine = opts.engine ?? getEngine();
  const prepared = await prepareForOcr(blob, {
    quadNorm: opts.quadNorm,
    mode: opts.mode ?? 'auto',
  });
  const result =
    engine === 'vision'
      ? await runCloudOcr(prepared.displayBlob, opts.onProgress)
      : await runOcr(prepared.ocrBlob, opts.onProgress);
  return { prepared, result, engine };
}
