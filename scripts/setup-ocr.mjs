// Tesseract.js 자산을 public/tesseract/ 로 복사·다운로드해서 완전 오프라인(PWA)로 쓸 수 있게 한다.
//  - worker / core(wasm): node_modules 에서 복사 (네트워크 불필요)
//  - 언어 데이터(kor/eng): 최초 1회 다운로드 (fast 모델)
// 이미 있으면 즉시 종료하므로 predev/prebuild 에 넣어도 부담 없음.
import { cp, mkdir, access, writeFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'public', 'tesseract');
const coreDir = join(outDir, 'core');
const langDir = join(outDir, 'lang');

const CORE_FILES = [
  'tesseract-core.wasm',
  'tesseract-core.wasm.js',
  'tesseract-core-simd.wasm',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
];

// fast 모델: kor ≈ 6.3MB, eng ≈ 2MB (best 모델은 각 3배)
const LANG_BASE = 'https://tessdata.projectnaptha.com/4.0.0_fast';
const LANGS = ['eng', 'kor'];

const exists = (p) =>
  access(p, constants.F_OK).then(
    () => true,
    () => false,
  );

async function nonEmpty(p) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(coreDir, { recursive: true });
  await mkdir(langDir, { recursive: true });

  // 이미 완비되었으면 바로 종료
  const targets = [
    join(outDir, 'worker.min.js'),
    ...CORE_FILES.map((f) => join(coreDir, f)),
    ...LANGS.map((l) => join(langDir, `${l}.traineddata.gz`)),
  ];
  if ((await Promise.all(targets.map(nonEmpty))).every(Boolean)) {
    console.log('[setup-ocr] 자산이 이미 준비되어 있습니다. 건너뜁니다.');
    return;
  }

  // 1) worker
  const workerSrc = require.resolve('tesseract.js/dist/worker.min.js');
  await cp(workerSrc, join(outDir, 'worker.min.js'));
  console.log('[setup-ocr] worker.min.js 복사 완료');

  // 2) core (wasm)
  const coreRoot = dirname(require.resolve('tesseract.js-core/package.json'));
  for (const f of CORE_FILES) {
    const src = join(coreRoot, f);
    if (await exists(src)) {
      await cp(src, join(coreDir, f));
    } else {
      console.warn(`[setup-ocr] (건너뜀) core 파일 없음: ${f}`);
    }
  }
  console.log('[setup-ocr] core wasm 복사 완료');

  // 3) 언어 데이터 (네트워크). 실패해도 빌드는 계속 — 온라인에서 재시도 시 CDN 폴백.
  for (const lang of LANGS) {
    const dest = join(langDir, `${lang}.traineddata.gz`);
    if (await nonEmpty(dest)) continue;
    const url = `${LANG_BASE}/${lang}.traineddata.gz`;
    try {
      console.log(`[setup-ocr] 다운로드: ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      console.log(`[setup-ocr]   → ${lang}.traineddata.gz 저장`);
    } catch (e) {
      console.warn(
        `[setup-ocr] ⚠ ${lang} 언어 데이터 다운로드 실패 (${e.message}). ` +
          `온라인 상태에서 "npm run setup:ocr" 로 다시 시도하세요.`,
      );
    }
  }
  console.log('[setup-ocr] 완료');
}

main().catch((e) => {
  console.error('[setup-ocr] 오류:', e);
  process.exitCode = 0; // 빌드를 막지 않는다
});
