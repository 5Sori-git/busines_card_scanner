# 명함 스캐너 (Myeongham Scanner)

명함 사진에서 텍스트를 추출해 연락처로 정리하는 **완전 클라이언트 사이드 PWA**.
모든 처리(OCR·저장)는 기기 안에서 이뤄지며, 이미지는 서버로 전송되지 않습니다.

- 대상: iPhone Safari (홈 화면 추가 → 앱처럼 사용, 오프라인 동작)
- OCR: Tesseract.js (WASM, `kor`+`eng`, LSTM) — 자산을 `public/tesseract/` 에 자체 호스팅
- 저장: IndexedDB (Dexie) + JSON 백업 내보내기/가져오기
- 내보내기: vCard(.vcf) / CSV / JSON

## 개발

```bash
npm install          # postinstall 에서 Tesseract 자산 복사 + 언어데이터(kor/eng) 다운로드
npm run dev          # http://localhost:5173
npm run build        # 타입체크 + 정적 빌드 → dist/
npm run preview      # 빌드 결과 로컬 확인 (PWA/Service Worker 테스트는 이 명령으로)
npm run setup:ocr    # 언어데이터 다운로드가 실패했을 때 온라인에서 재시도
```

> PWA(Service Worker)는 `dev`에서 비활성(`devOptions.enabled: false`)입니다.
> 설치·오프라인 동작은 `npm run build && npm run preview` 로 확인하세요.
> iPhone 실기기 테스트는 HTTPS 필요 → 배포본 또는 터널(cloudflared 등).

## OCR 자산 (`public/tesseract/`, git 제외)

`scripts/setup-ocr.mjs` 가 준비합니다. 이미 있으면 건너뜁니다.

| 경로 | 내용 | 출처 |
|------|------|------|
| `worker.min.js` | Tesseract 워커 | `node_modules/tesseract.js` 복사 |
| `core/tesseract-core*.wasm(.js)` | WASM 엔진 (simd/lstm 변형 포함) | `node_modules/tesseract.js-core` 복사 |
| `lang/{kor,eng}.traineddata.gz` | fast 모델 (기본, ~3MB) | `tessdata.projectnaptha.com/4.0.0_fast` |
| `lang-best/{kor,eng}.traineddata.gz` | best 모델 (토글 시, ~18MB) | `tessdata.projectnaptha.com/4.0.0` |

- 앱 셸만 프리캐시되고, `/tesseract/*` 는 **처음 필요할 때 런타임 캐시**(CacheFirst) → 설치는 가볍고, fast는 첫 스캔, best는 토글 켠 뒤 첫 스캔에서 1회 다운로드 후 오프라인.
- 모델 전환은 스캔 화면의 "고정밀 한글 인식" 토글 (`localStorage: cardscan.ocrModel`). 실제 촬영본에선 best가 나을 수 있으나 깨끗한 스캔본에선 fast가 더 나을 때도 있어 opt-in.

## 배포 — GitHub Pages (설정 완료)

`.github/workflows/deploy.yml` 가 `main` 브랜치 push 마다 빌드 → Pages 배포합니다.
라우팅은 HashRouter, `base` 는 워크플로가 `PAGES_BASE=/<레포이름>/` 로 자동 주입 →
`https://<사용자명>.github.io/<레포이름>/` 어느 경로에 올려도 동작합니다.

### 최초 1회

```bash
# 1) 로컬 저장소를 GitHub 새 레포에 연결 (레포는 github.com 에서 먼저 생성)
git branch -M main
git remote add origin https://github.com/<사용자명>/<레포이름>.git
git push -u origin main
```

2) GitHub 레포 → **Settings → Pages → Build and deployment → Source = "GitHub Actions"** 로 변경
3) **Actions** 탭에서 "Deploy to GitHub Pages" 실행 완료 확인 → 초록불이면 배포 주소가 표시됨

이후에는 `git push` 만 하면 자동 재배포됩니다.

### 아이폰에 설치

1. Safari로 `https://<사용자명>.github.io/<레포이름>/` 접속
2. 공유 → **홈 화면에 추가**
3. 첫 스캔 시 언어 데이터(~10MB)를 한 번 내려받으면, 이후 비행기 모드에서도 동작

> 빌드 시 `postinstall` 이 tessdata CDN 에서 `kor`/`eng` 언어데이터를 받습니다.
> CDN 장애로 실패해도 빌드는 통과하지만 그 배포본은 OCR이 안 되므로, Actions 로그에
> `[setup-ocr] ⚠` 경고가 있으면 재실행하세요.

### 다른 호스팅 (Vercel / Cloudflare Pages / Netlify)

빌드 `npm run build`, 출력 `dist`, `PAGES_BASE` 불필요(루트 배포). HashRouter라 rewrite 설정도 불필요.

## 구조

```
scripts/
  gen-icons.mjs        의존성 없는 PWA 아이콘 PNG 생성기
  setup-ocr.mjs        Tesseract 자산 복사/다운로드
src/
  db.ts                Dexie 스키마 + 저장/삭제/고아이미지 정리
  types.ts             Contact / StoredImage 모델
  lib/
    imagePrep.ts       이미지 전처리 (업스케일 + 그레이스케일 + 대비보정)
    ocr.ts             Tesseract 워커 래퍼 (지연 싱글턴, 진행률)
    parseCard.ts       OCR 원문 → 필드 추정 (이메일·전화·URL 확정 + 휴리스틱)
    phone.ts           한국 전화번호 정규화/표시
    vcard.ts  csv.ts   내보내기 포맷터
    backup.ts          JSON 백업(이미지 base64 포함) 내보내기/가져오기
    download.ts  id.ts 파일 다운로드 / UUID
  components/
    ContactForm.tsx    필드 폼 (자동추출 "자동" 배지)
    CropStep.tsx       스캔 전 명함 영역 크롭 + 90° 회전
    ImageZoom.tsx      탭하면 전체화면 확대(핀치줌)
  pages/
    ListPage.tsx       목록·검색·내보내기 메뉴
    ScanPage.tsx       카메라/앨범 → 크롭 → 전처리 → OCR(+줄 bbox) → parseCard → 편집화면
    EditPage.tsx       신규/편집 폼. 전화번호 표시형식 편집, OCR 원문 줄→칸 배정, 자동추출 배지
    DetailPage.tsx     상세·전화/메일 링크·vCard·삭제
```

전처리(`imagePrep`) 모드: `plain`(그레이스케일만) / `binarize`(로컬 적응형 이진화) / `auto`(binarize 후 실패 시 대비스트레치 폴백, 기본값).

## 마일스톤

| 단계 | 범위 | 상태 |
|------|------|------|
| **M0** | 셋업, PWA, Dexie, 연락처 CRUD, vCard/CSV/JSON 내보내기·가져오기 | ✅ 완료 |
| **M1** | 카메라/앨범 업로드 + 이미지 전처리 + Tesseract 워커(자체호스팅) + OCR 원문 표시 | ✅ 완료 |
| **M2** | `parseCard` 정교화(부서/직함 분리, 줄 크기 힌트 이름추출, 회사 유추) + 검토·편집 화면(자동추출 배지, 전화 표시형식, OCR 원문 줄→칸 배정, 이미지 확대) | ✅ 완료 |
| **M3** | 수동 크롭·회전(`CropStep`), 로컬 적응형 이진화(`imagePrep`), EXIF 방향 보정, 파서 개선(이름+직함 분리·근접 유선번호→팩스·로고 회사명) | ✅ 완료 |
| **M3.5** | 4점 원근 크롭(비스듬한 명함을 반듯하게 펴기), 고정밀(best) 한글 모델 토글 | ✅ 완료 |
| M4 | HEIC 자동 변환, 재인식(전처리 프리셋), 중복 병합, PNG 아이콘 정식화, (선택) CLOVA 폴백 | ⬜ |
| M4 | OpenCV.js 이진화, 중복 감지·병합, 태그 필터 | ⬜ |

## 알아둘 점

- 데이터는 이 브라우저에만 저장됩니다. **정기적으로 "전체 백업 저장(.json)"** 하세요.
  Safari에서 "웹사이트 데이터 삭제" 시 사라집니다.
- **한글 인식 정확도**: fast 모델 + Tesseract 특성상 특히 큰 제목(이름)·디자인 명함에서 오인식이 잦습니다.
  스캔 후 **편집 화면에서 명함과 대조해 수정**하는 것을 전제로 설계했습니다 (OCR 원문도 항상 표시).
- **HEIC**: 아이폰 일부 상황에서 HEIC가 그대로 업로드되면 "형식 미지원" 안내가 뜹니다 → 다른 사진 선택 (M3에서 자동 변환 예정).
- 현재 아이콘은 `scripts/gen-icons.mjs`가 그리는 플레이스홀더입니다(M3에서 교체).
