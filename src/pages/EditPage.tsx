import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, CornerDownRight, RefreshCw } from 'lucide-react';
import { db, saveContact, getImageUrl } from '../db';
import { emptyContact, type Contact, type PhoneType } from '../types';
import { newId } from '../lib/id';
import { formatPhone, normalizePhone } from '../lib/phone';
import { parseCard } from '../lib/parseCard';
import { recognizeImage } from '../lib/recognize';
import { getOcrModel, type OcrProgress } from '../lib/ocr';
import { getEngine } from '../lib/cloudOcr';
import type { PrepMode } from '../lib/imagePrep';
import AppHeader from '../components/AppHeader';
import ContactForm from '../components/ContactForm';
import ImageZoom from '../components/ImageZoom';

interface Props {
  mode: 'new' | 'edit';
}

/** 스캔 화면에서 navigate('/new', { state: {...} }) 로 전달 */
interface DraftState {
  draft?: Partial<Contact>;
  ocrRawText?: string;
  ocrConfidence?: number;
  imageId?: string;
}

/** 전화번호를 보기 좋은 형태로 (편집 폼 표시용) */
function toFormView(c: Contact): Contact {
  return { ...c, phones: c.phones.map((p) => ({ ...p, value: formatPhone(p.value) })) };
}

/** OCR 원문의 한 줄을 배정할 수 있는 대상 */
type AssignTarget =
  | 'name'
  | 'nameEn'
  | 'company'
  | 'department'
  | 'title'
  | 'phone-mobile'
  | 'phone-office'
  | 'phone-fax'
  | 'email'
  | 'url'
  | 'address'
  | 'memo';

const ASSIGN_OPTIONS: { value: AssignTarget; label: string }[] = [
  { value: 'name', label: '이름' },
  { value: 'nameEn', label: '영문 이름' },
  { value: 'company', label: '회사' },
  { value: 'department', label: '부서' },
  { value: 'title', label: '직함' },
  { value: 'phone-mobile', label: '휴대폰' },
  { value: 'phone-office', label: '유선 전화' },
  { value: 'phone-fax', label: '팩스' },
  { value: 'email', label: '이메일' },
  { value: 'url', label: '웹사이트' },
  { value: 'address', label: '주소' },
  { value: 'memo', label: '메모에 추가' },
];

export default function EditPage({ mode }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const draftState = (location.state ?? {}) as DraftState;

  const initial = useMemo<Contact>(() => {
    const base = emptyContact(newId());
    if (mode === 'new' && (draftState.draft || draftState.ocrRawText)) {
      return toFormView({
        ...base,
        ...draftState.draft,
        id: base.id,
        ocrRawText: draftState.ocrRawText,
        ocrConfidence: draftState.ocrConfidence,
        imageId: draftState.imageId,
      });
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /** 자동 인식으로 채워진 필드 (배지용) */
  const autoFilled = useMemo(() => {
    const s = new Set<string>();
    const d = mode === 'new' ? draftState.draft : undefined;
    if (!d) return s;
    for (const k of ['name', 'nameEn', 'company', 'department', 'title'] as const) {
      if (d[k]) s.add(k);
    }
    if (d.phones?.length) s.add('phones');
    if (d.emails?.length) s.add('emails');
    if (d.urls?.length) s.add('urls');
    if (d.addresses?.length) s.add('addresses');
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const [contact, setContact] = useState<Contact>(initial);
  const [loading, setLoading] = useState(mode === 'edit');
  const [notFound, setNotFound] = useState(false);
  const [showRaw, setShowRaw] = useState(
    typeof initial.ocrConfidence === 'number' && initial.ocrConfidence < 0.75,
  );
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  // 재인식
  const [reOpen, setReOpen] = useState(false);
  const [reMode, setReMode] = useState<PrepMode>('auto');
  const [reBusy, setReBusy] = useState(false);
  const [reProg, setReProg] = useState<OcrProgress | null>(null);
  const engine = getEngine();
  const engineLabel =
    engine === 'vision'
      ? 'Google Cloud Vision'
      : getOcrModel() === 'best'
        ? '기기 · 고정밀'
        : '기기 · 빠름';

  async function reRecognize() {
    if (!contact.imageId || reBusy) return;
    setReBusy(true);
    setReProg({ phase: 'engine', progress: 0.1, label: '이미지 준비 중' });
    try {
      const img = await db.images.get(contact.imageId);
      if (!img) throw new Error('저장된 이미지를 찾을 수 없습니다.');
      const { result } = await recognizeImage(img.blob, { mode: reMode, onProgress: setReProg });
      const { fields } = parseCard(result.text, { lines: result.lines });
      const ok = window.confirm(
        '새 인식 결과로 각 칸을 다시 채울까요?\n겹치는 칸은 새 값으로 바뀌고, 비어 있으면 지금 값이 유지됩니다.',
      );
      setContact((c) => {
        const next: Contact = {
          ...c,
          ocrRawText: result.text,
          ocrConfidence: result.confidence,
        };
        if (ok) {
          if (fields.name) next.name = fields.name;
          if (fields.nameEn) next.nameEn = fields.nameEn;
          if (fields.company) next.company = fields.company;
          if (fields.department) next.department = fields.department;
          if (fields.title) next.title = fields.title;
          if (fields.phones?.length) next.phones = fields.phones;
          if (fields.emails?.length) next.emails = fields.emails;
          if (fields.urls?.length) next.urls = fields.urls;
          if (fields.addresses?.length) next.addresses = fields.addresses;
        }
        return toFormView(next);
      });
      setShowRaw(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : '재인식에 실패했습니다.');
    } finally {
      setReBusy(false);
      setReProg(null);
    }
  }

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    let alive = true;
    db.contacts.get(id).then((c) => {
      if (!alive) return;
      if (c) setContact(toFormView(c));
      else setNotFound(true);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [mode, id]);

  useEffect(() => {
    let url: string | null = null;
    getImageUrl(contact.imageId).then((u) => {
      url = u;
      setImgUrl(u);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [contact.imageId]);

  function assignLine(target: AssignTarget, text: string) {
    setContact((c) => {
      const t = text.trim();
      if (!t) return c;
      switch (target) {
        case 'name':
          return { ...c, name: t };
        case 'nameEn':
          return { ...c, nameEn: t };
        case 'company':
          return { ...c, company: t };
        case 'department':
          return { ...c, department: t };
        case 'title':
          return { ...c, title: t };
        case 'phone-mobile':
        case 'phone-office':
        case 'phone-fax': {
          const type = target.split('-')[1] as PhoneType;
          return { ...c, phones: [...c.phones, { type, value: t }] };
        }
        case 'email':
          return { ...c, emails: [...c.emails.filter(Boolean), t] };
        case 'url':
          return { ...c, urls: [...c.urls.filter(Boolean), t] };
        case 'address': {
          const zipInLine = t.match(/\b\d{5}\b/)?.[0];
          const zip = c.addresses[0]?.zip || zipInLine;
          const raw = zipInLine && !c.addresses[0]?.zip ? t.replace(zipInLine, '').replace(/^[\s,]+/, '').trim() : t;
          return { ...c, addresses: [{ raw, zip }] };
        }
        case 'memo':
          return { ...c, memo: c.memo ? `${c.memo}\n${t}` : t };
        default:
          return c;
      }
    });
  }

  async function handleSave() {
    const hasSomething =
      contact.name.trim() ||
      contact.company?.trim() ||
      contact.phones.some((p) => p.value.trim()) ||
      contact.emails.some((e) => e.trim());
    if (!hasSomething) {
      alert('이름, 회사, 전화, 이메일 중 하나 이상을 입력하세요.');
      return;
    }
    const clean: Contact = {
      ...contact,
      name: contact.name.trim(),
      nameEn: contact.nameEn?.trim() || undefined,
      company: contact.company?.trim() || undefined,
      department: contact.department?.trim() || undefined,
      title: contact.title?.trim() || undefined,
      phones: contact.phones
        .filter((p) => p.value.trim())
        .map((p) => ({ ...p, value: normalizePhone(p.value.trim()) })),
      emails: contact.emails.map((e) => e.trim()).filter(Boolean),
      urls: contact.urls.map((u) => u.trim()).filter(Boolean),
      addresses: contact.addresses.filter((a) => a.raw.trim() || a.zip?.trim()),
    };
    await saveContact(clean);
    navigate(`/contact/${clean.id}`, { replace: true });
  }

  if (loading) {
    return (
      <>
        <AppHeader title="불러오는 중" back />
        <p className="p-8 text-center text-slate-400">…</p>
      </>
    );
  }
  if (notFound) {
    return (
      <>
        <AppHeader title="편집" back="/" />
        <p className="p-8 text-center text-slate-500">연락처를 찾을 수 없습니다.</p>
      </>
    );
  }

  const rawLines = (contact.ocrRawText ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <>
      <AppHeader
        title={mode === 'new' ? '새 명함' : '명함 편집'}
        back
        right={
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white active:bg-brand-700"
          >
            <Check size={16} /> 저장
          </button>
        }
      />

      <main className="flex-1 px-4 py-4 pb-24">
        {imgUrl && (
          <ImageZoom
            src={imgUrl}
            alt="스캔한 명함"
            className="mb-3 max-h-56 w-full rounded-xl border border-slate-200 object-contain"
          />
        )}

        {contact.imageId && (
          <div className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setReOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-slate-600"
            >
              <RefreshCw size={15} /> 이 사진으로 다시 인식
              <span className="ml-auto">{reOpen ? '▲' : '▼'}</span>
            </button>
            {reOpen && (
              <div className="space-y-3 border-t border-slate-100 px-4 py-3">
                <p className="text-xs text-slate-500">
                  현재 엔진: <span className="font-medium text-slate-700">{engineLabel}</span>{' '}
                  <Link to="/settings" className="text-brand">
                    변경
                  </Link>
                </p>
                {engine !== 'vision' && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-slate-500">전처리</p>
                    <div className="flex gap-1.5">
                      {(
                        [
                          ['auto', '자동'],
                          ['binarize', '고대비'],
                          ['plain', '원본'],
                        ] as [PrepMode, string][]
                      ).map(([v, label]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setReMode(v)}
                          className={`rounded-lg border px-3 py-1.5 text-sm ${
                            reMode === v
                              ? 'border-brand bg-brand-50 text-brand-700'
                              : 'border-slate-300 text-slate-600'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void reRecognize()}
                  disabled={reBusy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-50"
                >
                  <RefreshCw size={15} className={reBusy ? 'animate-spin' : ''} />
                  {reBusy ? (reProg?.label ?? '인식 중…') : '다시 인식'}
                </button>
              </div>
            )}
          </div>
        )}

        {typeof contact.ocrConfidence === 'number' && (
          <p className="mb-3 text-xs text-slate-500">
            <span className="font-medium text-amber-700">자동 인식 결과</span>입니다. 명함과 대조해
            값을 고쳐 주세요. 틀린 줄은 아래 “OCR 원문”에서 올바른 칸으로 보낼 수 있습니다. (평균
            신뢰도 {Math.round(contact.ocrConfidence * 100)}%)
          </p>
        )}

        {rawLines.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-600"
            >
              OCR 원문 · 줄을 칸으로 배정 {showRaw ? '▲' : '▼'}
            </button>
            {showRaw && (
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {rawLines.map((line, i) => (
                  <li key={i} className="flex items-center gap-2 px-3 py-2">
                    <CornerDownRight size={14} className="shrink-0 text-slate-300" />
                    <span className="flex-1 truncate text-xs text-slate-600" title={line}>
                      {line}
                    </span>
                    <select
                      aria-label={`"${line}" 배정`}
                      className="shrink-0 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-600"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) assignLine(e.target.value as AssignTarget, line);
                        e.target.value = '';
                      }}
                    >
                      <option value="">칸 선택…</option>
                      {ASSIGN_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <ContactForm value={contact} onChange={setContact} autoFilled={autoFilled} />
      </main>
    </>
  );
}
