import type { ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import type { Contact, Phone, PhoneType } from '../types';
import { PHONE_TYPE_LABEL } from '../types';

interface Props {
  value: Contact;
  onChange: (next: Contact) => void;
  /** 자동 인식으로 채워진 필드 키 집합 (배지 표시용) */
  autoFilled?: Set<string>;
}

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

function AutoBadge() {
  return (
    <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 align-middle">
      자동
    </span>
  );
}

function Field({
  label,
  auto,
  children,
}: {
  label: string;
  auto?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">
        {label}
        {auto && <AutoBadge />}
      </span>
      {children}
    </label>
  );
}

export default function ContactForm({ value, onChange, autoFilled }: Props) {
  const isAuto = (k: string) => !!autoFilled?.has(k);
  const set = <K extends keyof Contact>(key: K, v: Contact[K]) => onChange({ ...value, [key]: v });

  const setPhone = (i: number, patch: Partial<Phone>) => {
    const phones = value.phones.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    set('phones', phones);
  };
  const addPhone = () => set('phones', [...value.phones, { type: 'mobile' as PhoneType, value: '' }]);
  const removePhone = (i: number) => set('phones', value.phones.filter((_, idx) => idx !== i));

  const setList = (key: 'emails' | 'urls', i: number, v: string) =>
    set(key, value[key].map((x, idx) => (idx === i ? v : x)));
  const addList = (key: 'emails' | 'urls') => set(key, [...value[key], '']);
  const removeList = (key: 'emails' | 'urls', i: number) =>
    set(key, value[key].filter((_, idx) => idx !== i));

  const addr = value.addresses[0] ?? { raw: '', zip: '' };
  const setAddr = (patch: Partial<{ raw: string; zip: string }>) => {
    const next = { ...addr, ...patch };
    set('addresses', next.raw || next.zip ? [next] : []);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="이름" auto={isAuto('name')}>
          <input
            className={inputCls}
            value={value.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="홍길동"
          />
        </Field>
        <Field label="영문 이름" auto={isAuto('nameEn')}>
          <input
            className={inputCls}
            value={value.nameEn ?? ''}
            onChange={(e) => set('nameEn', e.target.value)}
            placeholder="Gildong Hong"
          />
        </Field>
      </div>

      <Field label="회사" auto={isAuto('company')}>
        <input
          className={inputCls}
          value={value.company ?? ''}
          onChange={(e) => set('company', e.target.value)}
          placeholder="(주)회사이름"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="부서" auto={isAuto('department')}>
          <input
            className={inputCls}
            value={value.department ?? ''}
            onChange={(e) => set('department', e.target.value)}
            placeholder="영업팀"
          />
        </Field>
        <Field label="직함" auto={isAuto('title')}>
          <input
            className={inputCls}
            value={value.title ?? ''}
            onChange={(e) => set('title', e.target.value)}
            placeholder="팀장"
          />
        </Field>
      </div>

      {/* 전화 */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-600">
            전화{isAuto('phones') && <AutoBadge />}
          </span>
          <button type="button" onClick={addPhone} className="flex items-center gap-1 text-sm text-brand">
            <Plus size={16} /> 추가
          </button>
        </div>
        <div className="space-y-2">
          {value.phones.length === 0 && (
            <p className="text-sm text-slate-400">전화번호가 없습니다.</p>
          )}
          {value.phones.map((p, i) => (
            <div key={i} className="flex gap-2">
              <select
                className="rounded-lg border border-slate-300 bg-white px-2 py-2.5 text-slate-700"
                value={p.type}
                onChange={(e) => setPhone(i, { type: e.target.value as PhoneType })}
              >
                {(Object.keys(PHONE_TYPE_LABEL) as PhoneType[]).map((t) => (
                  <option key={t} value={t}>
                    {PHONE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <input
                className={inputCls}
                inputMode="tel"
                value={p.value}
                onChange={(e) => setPhone(i, { value: e.target.value })}
                placeholder="010-1234-5678"
              />
              <button
                type="button"
                onClick={() => removePhone(i)}
                className="flex w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 active:bg-slate-100"
                aria-label="삭제"
              >
                <X size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 이메일 */}
      <ListEditor
        label="이메일"
        auto={isAuto('emails')}
        items={value.emails}
        placeholder="hong@company.com"
        inputMode="email"
        onAdd={() => addList('emails')}
        onChangeItem={(i, v) => setList('emails', i, v)}
        onRemove={(i) => removeList('emails', i)}
      />

      {/* 주소 */}
      <Field label="주소" auto={isAuto('addresses')}>
        <textarea
          className={inputCls}
          rows={2}
          value={addr.raw}
          onChange={(e) => setAddr({ raw: e.target.value })}
          placeholder="서울시 강남구 …"
        />
      </Field>
      <Field label="우편번호">
        <input
          className={inputCls}
          inputMode="numeric"
          value={addr.zip ?? ''}
          onChange={(e) => setAddr({ zip: e.target.value })}
          placeholder="06000"
        />
      </Field>

      {/* 웹 */}
      <ListEditor
        label="웹사이트"
        auto={isAuto('urls')}
        items={value.urls}
        placeholder="https://company.com"
        inputMode="url"
        onAdd={() => addList('urls')}
        onChangeItem={(i, v) => setList('urls', i, v)}
        onRemove={(i) => removeList('urls', i)}
      />

      <Field label="태그 (쉼표로 구분)">
        <input
          className={inputCls}
          value={value.tags.join(', ')}
          onChange={(e) =>
            set(
              'tags',
              e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            )
          }
          placeholder="전시회, 협력사"
        />
      </Field>

      <Field label="메모">
        <textarea
          className={inputCls}
          rows={3}
          value={value.memo ?? ''}
          onChange={(e) => set('memo', e.target.value)}
          placeholder="만난 자리, 후속 조치 등"
        />
      </Field>
    </div>
  );
}

function ListEditor({
  label,
  auto,
  items,
  placeholder,
  inputMode,
  onAdd,
  onChangeItem,
  onRemove,
}: {
  label: string;
  auto?: boolean;
  items: string[];
  placeholder: string;
  inputMode: 'email' | 'url' | 'text';
  onAdd: () => void;
  onChangeItem: (i: number, v: string) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">
          {label}
          {auto && <AutoBadge />}
        </span>
        <button type="button" onClick={onAdd} className="flex items-center gap-1 text-sm text-brand">
          <Plus size={16} /> 추가
        </button>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-slate-400">항목이 없습니다.</p>}
        {items.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={inputCls}
              inputMode={inputMode === 'text' ? undefined : inputMode}
              value={v}
              onChange={(e) => onChangeItem(i, e.target.value)}
              placeholder={placeholder}
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="flex w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 active:bg-slate-100"
              aria-label="삭제"
            >
              <X size={18} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
