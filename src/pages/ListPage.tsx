import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Download, MoreVertical, Search, Upload, X } from 'lucide-react';
import { db, pruneOrphanImages } from '../db';
import type { Contact } from '../types';
import { formatPhone } from '../lib/phone';
import { toVCardBook } from '../lib/vcard';
import { toCSV } from '../lib/csv';
import { exportBackup, importBackup } from '../lib/backup';
import { downloadBlob, downloadText, todayStamp } from '../lib/download';
import AppHeader from '../components/AppHeader';

function matches(c: Contact, q: string): boolean {
  if (!q) return true;
  const hay = [
    c.name,
    c.nameEn,
    c.company,
    c.department,
    c.title,
    c.memo,
    ...c.emails,
    ...c.tags,
    ...c.phones.flatMap((p) => [p.value, formatPhone(p.value)]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default function ListPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const contacts = useLiveQuery(
    () => db.contacts.orderBy('updatedAt').reverse().toArray(),
    [],
  );

  const filtered = useMemo(
    () => (contacts ?? []).filter((c) => matches(c, q.trim())),
    [contacts, q],
  );

  useEffect(() => {
    void pruneOrphanImages();
  }, []);

  async function handleExport(kind: 'vcf' | 'csv' | 'json') {
    setMenuOpen(false);
    const all = await db.contacts.orderBy('name').toArray();
    if (kind === 'json') {
      downloadBlob(`myeongham-backup-${todayStamp()}.json`, await exportBackup());
      return;
    }
    if (all.length === 0) {
      alert('내보낼 연락처가 없습니다.');
      return;
    }
    if (kind === 'vcf') downloadText(`contacts-${todayStamp()}.vcf`, toVCardBook(all), 'text/vcard');
    else downloadText(`contacts-${todayStamp()}.csv`, toCSV(all), 'text/csv');
  }

  async function handleImport(file: File) {
    const mode = confirm(
      '기존 연락처를 유지하고 병합할까요?\n\n확인 = 병합 (같은 항목은 덮어쓰기)\n취소 = 전체 교체 (기존 데이터 삭제)',
    )
      ? 'merge'
      : 'replace';
    try {
      const r = await importBackup(file, mode);
      alert(`가져오기 완료: 연락처 ${r.contacts}건, 이미지 ${r.images}건`);
    } catch (e) {
      alert(e instanceof Error ? e.message : '가져오기 실패');
    }
  }

  return (
    <>
      <AppHeader
        title="명함 스캐너"
        right={
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
            aria-label="메뉴"
          >
            <MoreVertical size={22} />
          </button>
        }
      />

      <div className="px-4 pt-3">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-9 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            placeholder="이름, 회사, 전화 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400"
              aria-label="지우기"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <main className="flex-1 px-4 py-3">
        {contacts === undefined ? (
          <p className="py-16 text-center text-slate-400">불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <EmptyState hasQuery={!!q} hasAny={(contacts?.length ?? 0) > 0} />
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link to={`/contact/${c.id}`} className="block px-4 py-3 active:bg-slate-50">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold text-slate-900">
                      {c.name || c.nameEn || '(이름 없음)'}
                    </span>
                    {c.phones[0] && (
                      <span className="shrink-0 text-sm text-slate-500">
                        {formatPhone(c.phones[0].value)}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-sm text-slate-500">
                    {[c.company, c.title].filter(Boolean).join(' · ') || c.emails[0] || ''}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* FAB */}
      <button
        type="button"
        onClick={() => navigate('/scan')}
        className="safe-bottom fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-brand px-6 py-3.5 font-semibold text-white shadow-lg shadow-brand/30 active:bg-brand-700"
        style={{ maxWidth: 'calc(28rem - 2rem)' }}
      >
        <Camera size={20} /> 명함 스캔
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleImport(f);
        }}
      />

      {menuOpen && (
        <Sheet onClose={() => setMenuOpen(false)}>
          <SheetItem icon={<Download size={18} />} label="전체 vCard (.vcf)" onClick={() => handleExport('vcf')} />
          <SheetItem icon={<Download size={18} />} label="전체 CSV (.csv)" onClick={() => handleExport('csv')} />
          <SheetItem icon={<Download size={18} />} label="전체 백업 저장 (.json)" onClick={() => handleExport('json')} />
          <SheetItem
            icon={<Upload size={18} />}
            label="백업 불러오기"
            onClick={() => {
              setMenuOpen(false);
              fileRef.current?.click();
            }}
          />
        </Sheet>
      )}
    </>
  );
}

function EmptyState({ hasQuery, hasAny }: { hasQuery: boolean; hasAny: boolean }) {
  if (hasQuery && hasAny) {
    return <p className="py-16 text-center text-slate-400">검색 결과가 없습니다.</p>;
  }
  return (
    <div className="py-16 text-center">
      <p className="text-slate-500">아직 저장된 명함이 없습니다.</p>
      <p className="mt-1 text-sm text-slate-400">
        아래 <span className="font-medium text-brand">명함 스캔</span> 버튼으로 시작하세요.
      </p>
    </div>
  );
}

function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end bg-black/30" onClick={onClose}>
      <div
        className="safe-bottom mx-auto w-full max-w-md rounded-t-2xl bg-white p-2"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
        <button
          type="button"
          onClick={onClose}
          className="mt-1 w-full rounded-xl py-3 text-center font-medium text-slate-500 active:bg-slate-100"
        >
          닫기
        </button>
      </div>
    </div>
  );
}

function SheetItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-slate-800 active:bg-slate-100"
    >
      <span className="text-slate-500">{icon}</span>
      {label}
    </button>
  );
}
