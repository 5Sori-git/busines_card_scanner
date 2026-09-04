import type { Contact, PhoneType } from '../types';
import { formatPhone } from './phone';

function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

const TEL_TYPE: Record<PhoneType, string> = {
  mobile: 'CELL',
  office: 'WORK,VOICE',
  fax: 'WORK,FAX',
};

/** 단일 연락처 → vCard 3.0 문자열 */
export function toVCard(c: Contact): string {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

  const name = c.name || c.nameEn || '(이름 없음)';
  lines.push(`N:${esc(name)};;;;`);
  lines.push(`FN:${esc(name)}`);
  if (c.nameEn) lines.push(`NICKNAME:${esc(c.nameEn)}`);

  if (c.company || c.department) {
    lines.push(`ORG:${esc(c.company ?? '')}${c.department ? ';' + esc(c.department) : ''}`);
  }
  if (c.title) lines.push(`TITLE:${esc(c.title)}`);

  for (const p of c.phones) {
    if (!p.value) continue;
    lines.push(`TEL;TYPE=${TEL_TYPE[p.type]}:${esc(formatPhone(p.value))}`);
  }
  for (const e of c.emails) {
    if (e) lines.push(`EMAIL;TYPE=WORK,INTERNET:${esc(e)}`);
  }
  for (const a of c.addresses) {
    if (a.raw) lines.push(`ADR;TYPE=WORK:;;${esc(a.raw)};;;${esc(a.zip ?? '')};`);
  }
  for (const u of c.urls) {
    if (u) lines.push(`URL:${esc(u)}`);
  }

  const noteParts: string[] = [];
  if (c.tags.length) noteParts.push(`태그: ${c.tags.join(', ')}`);
  if (c.memo) noteParts.push(c.memo);
  if (noteParts.length) lines.push(`NOTE:${esc(noteParts.join('\n'))}`);

  lines.push(`REV:${new Date(c.updatedAt).toISOString()}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function toVCardBook(contacts: Contact[]): string {
  return contacts.map(toVCard).join('\r\n') + '\r\n';
}
