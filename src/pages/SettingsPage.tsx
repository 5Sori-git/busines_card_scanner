import { useState, type ReactNode } from 'react';
import { Check, Eye, EyeOff, Cpu, Cloud, ExternalLink } from 'lucide-react';
import AppHeader from '../components/AppHeader';
import { getOcrModel, setOcrModel, type OcrModel } from '../lib/ocr';
import {
  getEngine,
  setEngine,
  getGcvKey,
  setGcvKey,
  testGcvKey,
  type Engine,
} from '../lib/cloudOcr';

export default function SettingsPage() {
  const [engine, setEng] = useState<Engine>(getEngine());
  const [model, setModel] = useState<OcrModel>(getOcrModel());
  const [key, setKey] = useState(getGcvKey());
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);

  function chooseEngine(e: Engine) {
    if (e === 'vision' && getGcvKey().length < 20) {
      setEng('vision'); // UI 는 바꾸되, 키 없으면 실제로는 device 로 동작
      setEngine('vision');
      return;
    }
    setEng(e);
    setEngine(e);
  }

  async function chooseModel(m: OcrModel) {
    setModel(m);
    await setOcrModel(m);
  }

  function saveKey() {
    setGcvKey(key);
    setKey(getGcvKey());
    setSaved(true);
    setTestMsg(null);
    setTimeout(() => setSaved(false), 1500);
    // 키를 지웠는데 엔진이 vision 이면 device 로
    if (getGcvKey().length < 20 && engine === 'vision') {
      setEng('device');
      setEngine('device');
    }
  }

  async function runTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      setTestMsg(await testGcvKey(key));
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <AppHeader title="설정" back="/" />
      <main className="flex-1 space-y-6 px-4 py-5">
        {/* 인식 엔진 */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-500">인식 엔진</h2>
          <div className="space-y-2">
            <EngineOption
              active={engine === 'device'}
              icon={<Cpu size={18} />}
              title="기기에서 인식"
              desc="오프라인·비공개. 이미지가 기기 밖으로 나가지 않습니다."
              onClick={() => chooseEngine('device')}
            />
            <EngineOption
              active={engine === 'vision'}
              icon={<Cloud size={18} />}
              title="Google Cloud Vision"
              desc="한글 정확도가 높습니다. 스캔 이미지가 Google 서버로 전송됩니다. 무료 월 1,000건."
              onClick={() => chooseEngine('vision')}
            />
          </div>
        </section>

        {/* device 세부: 모델 */}
        {engine === 'device' && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-500">기기 인식 모델</h2>
            <div className="space-y-2">
              <EngineOption
                active={model === 'fast'}
                title="빠른 모델 (기본)"
                desc="가볍고 빠릅니다. 깨끗한 스캔본에 유리."
                onClick={() => void chooseModel('fast')}
              />
              <EngineOption
                active={model === 'best'}
                title="고정밀 한글 모델"
                desc="처음 켠 뒤 첫 스캔에서 약 18MB 다운로드. 노이즈 있는 실제 촬영본에 유리할 수 있음."
                onClick={() => void chooseModel('best')}
              />
            </div>
          </section>
        )}

        {/* vision 세부: API 키 */}
        {engine === 'vision' && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-500">Google Cloud Vision API 키</h2>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="AIza..."
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-10 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400"
                    aria-label={showKey ? '숨기기' : '보기'}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={saveKey}
                  className="flex items-center gap-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white active:bg-brand-700"
                >
                  {saved ? <Check size={16} /> : null} 저장
                </button>
              </div>

              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void runTest()}
                  disabled={testing || key.trim().length < 20}
                  className="text-sm font-medium text-brand disabled:opacity-40"
                >
                  {testing ? '확인 중…' : '키 테스트'}
                </button>
                {key && (
                  <button
                    type="button"
                    onClick={() => {
                      setKey('');
                      setGcvKey('');
                      setTestMsg(null);
                      setEng('device');
                      setEngine('device');
                    }}
                    className="text-sm text-red-600"
                  >
                    키 지우기
                  </button>
                )}
              </div>
              {testMsg && (
                <p className={`mt-2 text-sm ${testMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {testMsg.ok ? '✓ ' : '✗ '}
                  {testMsg.message}
                </p>
              )}

              <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <p className="font-medium text-slate-600">키 발급 방법</p>
                <p>
                  1. Google Cloud Console에서 프로젝트 생성 →{' '}
                  <a
                    href="https://console.cloud.google.com/apis/library/vision.googleapis.com"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-brand"
                  >
                    Cloud Vision API 사용 설정 <ExternalLink size={11} />
                  </a>
                </p>
                <p>2. API 및 서비스 → 사용자 인증 정보 → API 키 만들기</p>
                <p>
                  3. (권장) 그 키에 <b>애플리케이션 제한</b>=HTTP 리퍼러(이 앱 주소), <b>API 제한</b>
                  =Cloud Vision API 로 제한
                </p>
                <p className="pt-1 text-slate-400">
                  키는 이 기기(localStorage)에만 저장되고 Google로만 전송됩니다. 브라우저 개발자도구엔
                  노출되므로 반드시 위 제한을 걸어 두세요.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function EngineOption({
  active,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  icon?: ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
        active ? 'border-brand bg-brand-50' : 'border-slate-200 bg-white active:bg-slate-50'
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          active ? 'border-brand' : 'border-slate-300'
        }`}
      >
        {active && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium text-slate-800">
          {icon && <span className="text-slate-500">{icon}</span>}
          {title}
        </span>
        <span className="block text-sm text-slate-500">{desc}</span>
      </span>
    </button>
  );
}
