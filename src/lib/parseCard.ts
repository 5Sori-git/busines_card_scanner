import type { Contact, PhoneType } from '../types';
import { extractPhones, normalizePhone } from './phone';
import type { OcrLine } from './ocr';

// OCR 원문 → 구조화된 연락처 필드 추정.
// 확정 추출(이메일/전화/URL) + 휴리스틱(회사/부서/직함/주소/이름).
// hints.lines 가 있으면 글자 크기·위치로 이름 추정 정확도를 높인다.

const TITLE_WORDS = [
  '대표이사', '대표', '부사장', '사장', '회장', '전무', '상무', '이사대우', '이사',
  '본부장', '실장', '센터장', '소장', '지사장', '점장', '원장', '국장',
  '부장', '차장', '과장', '팀장', '파트장', '리더', '대리', '주임', '사원',
  '선임', '책임', '수석', '전임', '연구위원', '전문위원',
  '엔지니어', '개발자', '디자이너', '매니저', '컨설턴트', '기획자', '프로',
  '변호사', '회계사', '세무사', '노무사', '변리사', '감정평가사', '교수', '박사',
  'CEO', 'CTO', 'COO', 'CFO', 'CMO', 'VP', 'President', 'Vice',
  'Director', 'Manager', 'Engineer', 'Developer', 'Designer', 'Lead', 'Head',
  'Founder', 'Co-Founder', 'Partner', 'Principal', 'Senior', 'Consultant', 'Chief',
];

const DEPT_WORDS = [
  '본부', '사업부', '사업본부', '연구소', '연구원', '개발원', '센터', '실', '팀',
  '파트', '그룹', '부문', '부서', '사무국', '지사', '지점', '영업소', 'division',
  'team', 'dept', 'department', 'group', 'lab', 'labs', 'office', 'unit',
];

const COMPANY_RE =
  /(주식회사|㈜|\(주\)|\(유\)|유한회사|유한책임회사|합자회사|재단법인|사단법인|\bInc\b\.?|\bLtd\b\.?|\bL\.?L\.?C\b\.?|\bCorp\b\.?|\bCo\.,?\s?Ltd\b|\bGmbH\b|\bA[/.]?S\b|컴퍼니|코퍼레이션|그룹|법인|Company|Holdings|Technologies|Solutions|Systems|Partners|Ventures|Labs|Studio)/i;

const URL_RE = /\b((https?:\/\/)?(www\.)?[a-z0-9-]+\.[a-z]{2,}(\.[a-z]{2,})?(\/[^\s]*)?)/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const EMAIL_TEST = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const ZIP_RE = /\b\d{5}\b/;
const ADDR_HINT_RE =
  /(특별시|광역시|특별자치[시도]|[가-힣]{2,}시\b|[가-힣]{2,}도\b|[가-힣]+구\b|[가-힣]+군\b|[가-힣]+동\b|[가-힣]+읍\b|[가-힣]+면\b|[가-힣]+리\b|[가-힣]+로\b|[가-힣]+길\b|\d+번지|\d+층|\d+호|빌딩|타워|B\/?D|Bldg|Floor|\bFl\b|Suite|Rm\b|Room)/i;

export interface ParseResult {
  fields: Partial<Contact>;
  /** raw 를 \n 으로 나눈 줄 인덱스 중 어떤 필드로 소비되었는지 */
  usedLines: Set<number>;
}

export interface ParseHints {
  lines?: OcrLine[];
}

function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** "영업본부 팀장 / Manager" → { department: "영업본부", title: "팀장 / Manager" } */
function splitDeptTitle(line: string): { department?: string; title?: string } {
  const hasTitle = TITLE_WORDS.some((w) => line.toLowerCase().includes(w.toLowerCase()));
  const deptWord = DEPT_WORDS.find((w) => line.toLowerCase().includes(w.toLowerCase()));

  if (deptWord && hasTitle) {
    // 부서 토큰이 끝나는 위치에서 자른다.
    const lower = line.toLowerCase();
    const idx = lower.indexOf(deptWord.toLowerCase());
    let cut = idx + deptWord.length;
    // 한글 부서명이 조사/공백 없이 이어질 수 있으니 다음 공백까지 부서로 본다.
    const nextSpace = line.indexOf(' ', cut);
    if (nextSpace !== -1 && nextSpace - cut <= 4) cut = nextSpace;
    const department = line.slice(0, cut).replace(/[·,/|-]\s*$/, '').trim();
    const title = line.slice(cut).replace(/^[\s·,/|-]+/, '').trim();
    return { department: department || undefined, title: title || undefined };
  }
  if (hasTitle) return { title: line };
  if (deptWord) return { department: line };
  return {};
}

function looksLikeName(s: string): boolean {
  const t = s.replace(/\s/g, '');
  if (/[0-9@]/.test(t)) return false;
  if (COMPANY_RE.test(s)) return false;
  if (TITLE_WORDS.some((w) => s.includes(w))) return false;
  // 한글 2~5자, 또는 영문 2~3단어(각 첫 글자 대문자), 또는 "홍길동 (Gildong Hong)"
  if (/^[가-힣]{2,5}$/.test(t)) return true;
  if (/^[가-힣]{2,4}\(?[A-Za-z][A-Za-z .]{2,}\)?$/.test(t)) return true;
  if (/^[A-Z][a-z]+(\s[A-Z][a-z]+){1,2}$/.test(s.trim())) return true;
  return false;
}

export function parseCard(raw: string, hints: ParseHints = {}): ParseResult {
  const lines = splitLines(raw);
  const joined = lines.join('\n');
  const used = new Set<number>();
  const fields: Partial<Contact> = { phones: [], emails: [], addresses: [], urls: [] };

  // ---- 이메일 ----
  const emails = [...new Set(joined.match(EMAIL_RE) ?? [])];
  fields.emails = emails;

  // ---- 전화 ----
  const phones = new Map<string, PhoneType>();
  for (const line of lines) {
    const nums = extractPhones(line);
    if (!nums.length) continue;
    const faxHint = /fax|팩스|F[\s.:)]/i.test(line);
    const telHint = /tel|전화|대표|직통|유선|T[\s.:)]/i.test(line);
    const mobileHint = /mobile|휴대|핸드|무선|셀|cell|C[\s.:)]|M[\s.:)]|H\.?P/i.test(line);
    nums.forEach((p, idx) => {
      const norm = normalizePhone(p);
      let type: PhoneType;
      if (/^\+8210/.test(norm)) type = 'mobile';
      else if (mobileHint && !faxHint) type = 'mobile';
      else if (faxHint && telHint) type = idx === 0 ? 'office' : 'fax';
      else if (faxHint) type = 'fax';
      else type = 'office';
      if (!phones.has(norm)) phones.set(norm, type);
    });
  }
  fields.phones = [...phones].map(([value, type]) => ({ value, type }));

  // ---- URL ----
  const urls = new Set<string>();
  for (const m of joined.replace(EMAIL_RE, ' ').matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:)\]]+$/, '');
    if (!/\.[a-z]{2,}($|\/)/i.test(u)) continue;
    if (/\.(png|jpe?g|gif|svg|webp)$/i.test(u)) continue;
    if (/^\d+\.\d+$/.test(u)) continue;
    urls.add(u);
  }
  fields.urls = [...urls];

  // ---- 회사 / 부서 / 직함 / 주소 ----
  lines.forEach((line, i) => {
    if (EMAIL_TEST.test(line) || extractPhones(line).length) return;

    if (!fields.company && COMPANY_RE.test(line) && line.length <= 40) {
      fields.company = line;
      used.add(i);
      return;
    }

    if (!fields.title || !fields.department) {
      const dt = splitDeptTitle(line);
      if ((dt.title || dt.department) && line.length <= 30) {
        if (dt.department && !fields.department) fields.department = dt.department;
        if (dt.title && !fields.title) fields.title = dt.title;
        used.add(i);
        return;
      }
    }

    if (fields.addresses!.length === 0 && (ZIP_RE.test(line) || ADDR_HINT_RE.test(line))) {
      const zip = line.match(ZIP_RE)?.[0];
      const rest = line.replace(ZIP_RE, '').replace(/^[\s,]+/, '').trim();
      fields.addresses = [{ raw: rest || line, zip }];
      used.add(i);
      return;
    }
  });

  // 주소가 여러 줄로 쪼개진 경우 다음 줄을 이어붙임
  if (fields.addresses?.length === 1) {
    const addrIdx = lines.findIndex(
      (l, i) => used.has(i) && l.includes(fields.addresses![0].raw.slice(0, 8)),
    );
    const next = lines[addrIdx + 1];
    if (
      addrIdx >= 0 &&
      next &&
      !used.has(addrIdx + 1) &&
      !EMAIL_TEST.test(next) &&
      !extractPhones(next).length &&
      ADDR_HINT_RE.test(next)
    ) {
      fields.addresses[0].raw = `${fields.addresses[0].raw} ${next}`.trim();
      used.add(addrIdx + 1);
    }
  }

  // ---- 이름 ----
  // 1) OCR 줄 크기 힌트: 상단 60% 안에서 가장 큰 글씨이면서 이름꼴인 줄
  let name: string | undefined;
  const hintLines = hints.lines ?? [];
  if (hintLines.length) {
    const maxTop = Math.max(...hintLines.map((l) => l.top + l.height), 1);
    const candidates = hintLines
      .filter((l) => l.top < maxTop * 0.6 && looksLikeName(l.text))
      .sort((a, b) => b.height - a.height);
    if (candidates[0]) name = candidates[0].text;
  }
  // 2) 폴백: 미사용 줄 중 이름꼴 첫 줄, 이메일 로컬파트와 겹치면 가산
  if (!name) {
    const emailLocal = emails[0]?.split('@')[0]?.toLowerCase().replace(/[._-]/g, '') ?? '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (used.has(i)) continue;
      if (extractPhones(line).length || EMAIL_TEST.test(line)) continue;
      const compact = line.replace(/\s/g, '').toLowerCase();
      if (looksLikeName(line) || (emailLocal && compact.length >= 2 && emailLocal.includes(compact))) {
        name = line;
        used.add(i);
        break;
      }
    }
  }
  if (name) {
    // "홍길동 (Gildong Hong)" → name/nameEn 분리
    const m = name.match(/^([가-힣]{2,5})\s*[(（]?\s*([A-Za-z][A-Za-z .]+?)\s*[)）]?$/);
    if (m) {
      fields.name = m[1];
      fields.nameEn = m[2].trim();
    } else if (/^[A-Za-z]/.test(name)) {
      fields.nameEn = name;
    } else {
      fields.name = name;
    }
  }

  // 회사를 못 찾았으면: 이메일 도메인에서 유추 (표시용 후보)
  if (!fields.company && emails[0]) {
    const dom = emails[0].split('@')[1]?.split('.')[0];
    if (dom && dom.length > 1 && !/gmail|naver|daum|hanmail|kakao|outlook|hotmail|yahoo|icloud|nate/i.test(emails[0])) {
      fields.company = dom.charAt(0).toUpperCase() + dom.slice(1);
    }
  }

  return { fields, usedLines: used };
}
