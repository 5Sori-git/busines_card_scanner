import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Share2, Trash2 } from 'lucide-react';
import { db, removeContact, getImageUrl } from '../db';
import { PHONE_TYPE_LABEL } from '../types';
import { formatPhone } from '../lib/phone';
import { toVCard } from '../lib/vcard';
import { downloadText } from '../lib/download';
import AppHeader from '../components/AppHeader';
import ImageZoom from '../components/ImageZoom';

export default function DetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // { c } 래퍼로 "로딩(undefined)" 과 "없음(c=undefined)" 을 구분
  const wrap = useLiveQuery(
    async () => ({ c: id ? await db.contacts.get(id) : undefined }),
    [id],
  );
  const contact = wrap?.c;
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    getImageUrl(contact?.imageId).then((u) => {
      revoked = u;
      setImgUrl(u);
    });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [contact?.imageId]);

  if (wrap === undefined) {
    return (
      <>
        <AppHeader title="연락처" back="/" />
        <p className="p-8 text-center text-slate-400">…</p>
      </>
    );
  }
  if (!contact) {
    return (
      <>
        <AppHeader title="연락처" back="/" />
        <div className="p-8 text-center text-slate-500">
          삭제되었거나 존재하지 않는 연락처입니다.
          <div className="mt-3">
            <Link to="/" className="text-brand">
              목록으로
            </Link>
          </div>
        </div>
      </>
    );
  }

  async function handleDelete() {
    if (!contact) return;
    if (!confirm(`"${contact.name || '이 연락처'}"를 삭제할까요?`)) return;
    await removeContact(contact.id);
    navigate('/', { replace: true });
  }

  function handleShareVCard() {
    if (!contact) return;
    const name = contact.name || contact.nameEn || 'contact';
    downloadText(`${name}.vcf`, toVCard(contact), 'text/vcard');
  }

  const subtitle = [contact.company, contact.department, contact.title].filter(Boolean).join(' · ');
  const hasDetails =
    contact.phones.length > 0 ||
    contact.emails.length > 0 ||
    contact.addresses.length > 0 ||
    contact.urls.length > 0 ||
    contact.tags.length > 0 ||
    !!contact.memo;

  return (
    <>
      <AppHeader
        title="연락처"
        back="/"
        right={
          <Link
            to={`/contact/${contact.id}/edit`}
            className="flex items-center gap-1 rounded-full px-3 py-2 text-sm font-medium text-brand active:bg-brand-50"
          >
            <Pencil size={16} /> 편집
          </Link>
        }
      />

      <main className="flex-1 px-4 py-4 pb-28">
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-slate-900">
            {contact.name || contact.nameEn || '(이름 없음)'}
          </h2>
          {contact.nameEn && contact.name && (
            <p className="text-slate-500">{contact.nameEn}</p>
          )}
          {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
        </div>

        {imgUrl && (
          <ImageZoom
            src={imgUrl}
            alt="명함 원본"
            className="mb-4 w-full rounded-xl border border-slate-200 object-contain"
          />
        )}

        {!hasDetails && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-400">
            추가 정보가 없습니다. 오른쪽 위 <span className="text-brand">편집</span>에서 채워보세요.
          </p>
        )}

        <div hidden={!hasDetails} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          {contact.phones.length > 0 && (
            <Section title="전화">
              {contact.phones.map((p, i) => (
                <a
                  key={i}
                  href={`tel:${p.value}`}
                  className="flex items-center justify-between py-1 text-brand"
                >
                  <span className="text-slate-500">{PHONE_TYPE_LABEL[p.type]}</span>
                  <span>{formatPhone(p.value)}</span>
                </a>
              ))}
            </Section>
          )}

          {contact.emails.length > 0 && (
            <Section title="이메일">
              {contact.emails.map((e, i) => (
                <a key={i} href={`mailto:${e}`} className="block break-all py-1 text-brand">
                  {e}
                </a>
              ))}
            </Section>
          )}

          {contact.addresses.length > 0 && (
            <Section title="주소">
              {contact.addresses.map((a, i) => (
                <p key={i} className="py-1 text-slate-700">
                  {a.raw}
                  {a.zip ? ` (${a.zip})` : ''}
                </p>
              ))}
            </Section>
          )}

          {contact.urls.length > 0 && (
            <Section title="웹">
              {contact.urls.map((u, i) => (
                <a
                  key={i}
                  href={/^https?:\/\//.test(u) ? u : `https://${u}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all py-1 text-brand"
                >
                  {u}
                </a>
              ))}
            </Section>
          )}

          {contact.tags.length > 0 && (
            <Section title="태그">
              <div className="flex flex-wrap gap-1.5 pt-1">
                {contact.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-brand-50 px-2.5 py-1 text-sm text-brand-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {contact.memo && (
            <Section title="메모">
              <p className="whitespace-pre-wrap py-1 text-slate-700">{contact.memo}</p>
            </Section>
          )}
        </div>

        {contact.ocrRawText && (
          <details className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <summary className="cursor-pointer font-medium text-slate-600">OCR 원문</summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-500">{contact.ocrRawText}</pre>
          </details>
        )}
      </main>

      {/* 하단 액션바 */}
      <div className="safe-bottom fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 border-t border-slate-200 bg-white px-4 py-3">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleShareVCard}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3 font-semibold text-white active:bg-brand-700"
          >
            <Share2 size={18} /> vCard 내보내기
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="flex items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-3 font-medium text-red-600 active:bg-red-50"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </div>
  );
}
