import type { Contact } from '../types';
import { formatPhone } from './phone';

const HEADERS = [
  '이름',
  '영문이름',
  '회사',
  '부서',
  '직함',
  '휴대폰',
  '유선',
  '팩스',
  '이메일',
  '주소',
  '우편번호',
  '웹',
  '태그',
  '메모',
  '등록일',
] as const;

function cell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function pick(c: Contact, type: 'mobile' | 'office' | 'fax'): string {
  return c.phones
    .filter((p) => p.type === type && p.value)
    .map((p) => formatPhone(p.value))
    .join(' / ');
}

export function toCSV(contacts: Contact[]): string {
  const rows = [HEADERS.join(',')];
  for (const c of contacts) {
    const a = c.addresses[0];
    rows.push(
      [
        c.name,
        c.nameEn ?? '',
        c.company ?? '',
        c.department ?? '',
        c.title ?? '',
        pick(c, 'mobile'),
        pick(c, 'office'),
        pick(c, 'fax'),
        c.emails.join(' / '),
        a?.raw ?? '',
        a?.zip ?? '',
        c.urls.join(' / '),
        c.tags.join(' '),
        c.memo ?? '',
        new Date(c.createdAt).toISOString().slice(0, 10),
      ]
        .map((v) => cell(String(v)))
        .join(','),
    );
  }
  return rows.join('\r\n');
}
