import type { Contact, PhoneType } from '../types';
import { extractPhones, normalizePhone } from './phone';
import type { OcrLine } from './ocr';

// OCR 원문 → 구조화된 연락처 필드 추정.
// 확정 추출(이메일/전화/URL) + 휴리스틱(회사/부서/직함/주소/이름).
// hints.lines 가 있으면 글자 크기·위치로 이름 추정 정확도를 높인다.

const TITLE_WORDS = [
  '대표이사', '대표', '부사장', '사장', '회장', '전무', '상무', '이사대우', '이사',
  '본부장', '실장', '센터장', '소장', '지사장', '점장', '원장', '국장',
  '부장', '차장', '과장', '팀장', '파트장', '리더', '대리', '주임', '사원', '인턴',
  '선임', '책임', '수석', '전임', '연구위원', '전문위원', '전임연구원',
  '엔지니어', '개발자', '디자이너', '매니저', '컨설턴트', '기획자', '프로',
  '변호사', '회계사', '세무사', '노무사', '변리사', '감정평가사', '교수', '박사',
  'CEO', 'CTO', 'COO', 'CFO', 'CMO', 'VP', 'President', 'Vice',
  'Director', 'Manager', 'Engineer', 'Developer', 'Designer', 'Lead', 'Head',
  'Founder', 'Co-Founder', 'Partner', 'Principal', 'Senior', 'Consultant', 'Chief',
];

const DEPT_WORDS = [
  '본부', '사업부', '사업본부', '이행사업부', '연구소', '연구원', '개발원', '센터',
  '실', '팀', '파트', '그룹', '부문', '부서', '사무국', '지사', '지점', '영업소',
  'division', 'team', 'dept', 'department', 'group', 'lab', 'labs', 'office', 'unit',
];

const COMPANY_RE =
  /(주식회사|㈜|\(주\)|\(유\)|유한회사|유한책임회사|합자회사|재단법인|사단법인|\bInc\b\.?|\bLtd\b\.?|\bL\.?L\.?C\b\.?|\bCorp\b\.?|\bCo\.,?\s?Ltd\b|\bGmbH\b|\bA[/.]?S\b|컴퍼니|코퍼레이션|그룹|법인|Company|Holdings|Technologies|Solutions|Systems|Partners|Ventures|Labs|Studio)/i;

const URL_RE = /\b((https?:\/\/)?(www\.)?[a-z0-9-]+\.[a-z]{2,}(\.[a-z]{2,})?(\/[^\s]*)?)/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const EMAIL_TEST = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const ZIP_RE = /\b\d{5}\b/;
const ADDR_HINT_RE =
  /(특별시|광역시|특별자치[시도]|[가-힣]{2,}시\b|[가-힣]{2,}도\b|[가-힣]+구\b|[가-힣]+군\b|[가-힣]+동\b|[가-힣]+읍\b|[가-힣]+면\b|[가-힣]+리\b|[가-힣]+로\b|[가-힣]+길\b|\d+번지|\d+층|\d+호|빌딩|타워|B\/?D|Bldg|Floor|\bFl\b|Suite|Rm\b|Room)/i;

const PERSONAL_MAIL_RE = /gmail|naver|daum|hanmail|kakao|outlook|hotmail|yahoo|icloud|nate/i;

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

function hasTitleWord(s: string): boolean {
  const low = s.toLowerCase();
  return TITLE_WORDS.some((w) => low.includes(w.toLowerCase()));
}

/** "영업본부 팀장 / Manager" → { department: "영업본부", title: "팀장 / Manager" } */
function splitDeptTitle(line: string): { department?: string; title?: string } {
  const hasTitle = hasTitleWord(line);
  const deptWord = DEPT_WORDS.find((w) => line.toLowerCase().includes(w.toLowerCase()));

  if (deptWord && hasTitle) {
    const lower = line.toLowerCase();
    const idx = lower.indexOf(deptWord.toLowerCase());
    let cut = idx + deptWord.length;
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

const HANGUL_TITLES = TITLE_WORDS.filter((w) => /^[가-힣]/.test(w)).sort((a, b) => b.length - a.length);
// "김 영 주대리 …", "홍길동 과장" 처럼 이름 뒤에 직함이 (공백이 있든 없든) 붙은 형태
const NAME_TITLE_RE = new RegExp(
  `^((?:[가-힣]\\s?){1,3}[가-힣])\\s{0,2}(${HANGUL_TITLES.join('|')})(?![가-힣])`,
);

/**
 * "김 영 주 대리", "김 영 주대리 2111", "홍길동 과장", "김영주" → 이름(+직함) 분리.
 * OCR이 한글 이름 사이에 공백을 넣거나 직함과 붙여 쓰는 경우가 많아 despace/트림 한다.
 */
function splitNameLine(line: string): { name: string; title?: string } | null {
  const s = line.replace(/\s+/g, ' ').trim();

  // 이름 + 한글 직함 (뒤에 잡음이 있어도 OK)
  const mt = s.match(NAME_TITLE_RE);
  if (mt) {
    const name = mt[1].replace(/\s/g, '');
    if (/^[가-힣]{2,4}$/.test(name)) return { name, title: mt[2] };
  }

  // 이름 + 공백 + 나머지(직함/영문 직함 후보)
  const m = s.match(/^((?:[가-힣]\s?){1,3}[가-힣])\s+([A-Za-z가-힣][A-Za-z가-힣 /·.]{1,16})$/);
  if (m) {
    const name = m[1].replace(/\s/g, '');
    const rest = m[2].trim().replace(/^[·/|,\-\s]+/, '');
    if (/^[가-힣]{2,4}$/.test(name) && hasTitleWord(rest)) return { name, title: rest };
  }

  // 순수 이름 줄 (공백 포함 가능: "김 영 주")
  if (/^(?:[가-힣]\s?){2,4}$/.test(s)) {
    const name = s.replace(/\s/g, '');
    if (/^[가-힣]{2,4}$/.test(name)) return { name };
  }
  return null;
}

function looksLikeCompanyLogo(s: string): boolean {
  const t = s.trim();
  if (t.length < 3 || t.length > 24) return false;
  if (/[0-9@]/.test(t)) return false;
  if (EMAIL_TEST.test(t) || extractPhones(t).length) return false;
  if (hasTitleWord(t)) return false;
  // 라틴 대문자 위주 (로고 텍스트): "SOFTITECH", "ACME", "SOFT TECH"
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 3) {
    const upper = letters.replace(/[^A-Z]/g, '').length;
    if (upper / letters.length >= 0.6 && /^[A-Za-z][A-Za-z .|]+$/.test(t)) return true;
  }
  return false;
}

function normEmail(s: string): string {
  return s.toLowerCase().replace(/[._-]/g, '');
}

/** 자릿수가 같고 한 자리만 다른 두 유선번호 → 뒤쪽을 팩스로 (한국 명함의 흔한 패턴: 485/486) */
function reclassifyFax(phones: { value: string; type: PhoneType }[]): void {
  const office = phones.filter((p) => p.type === 'office');
  if (office.length !== 2 || phones.some((p) => p.type === 'fax')) return;
  const [a, b] = office.map((p) => p.value.replace(/\D/g, ''));
  if (a.length !== b.length) return;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  if (diff === 1) office[1].type = 'fax';
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
    // 라벨: 원문자(Ⓜ Ⓔ Ⓣ Ⓕ)가 깨져도 줄 앞 단독 알파벳 토큰으로 감지
    const faxHint = /fax|팩스|(^|[\s(])F[\s.:)]|(^|[\s(])F\s*0\d/i.test(line);
    const telHint = /tel|전화|대표|직통|유선|(^|[\s(])T[\s.:)]|(^|[\s(])T\s*0\d/i.test(line);
    const mobileHint =
      /mobile|휴대|핸드|무선|셀|cell|(^|[\s(])[CM][\s.:)]|(^|[\s(])[CM]\s*01|H\.?P/i.test(line);
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
  reclassifyFax(fields.phones);

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

  // ---- 이름 (+ 인라인 직함) : 회사/부서/주소 판정 전에 먼저 잡는다 ----
  let name: string | undefined;
  const hintLines = hints.lines ?? [];
  if (hintLines.length) {
    const maxBottom = Math.max(...hintLines.map((l) => l.top + l.height), 1);
    const top = hintLines
      .filter((l) => l.top < maxBottom * 0.6)
      .sort((a, b) => b.height - a.height);
    for (const l of top) {
      const nm = splitNameLine(l.text);
      if (nm) {
        name = nm.name;
        if (nm.title && !fields.title) fields.title = nm.title;
        break;
      }
    }
  }
  if (!name) {
    const emailLocal = emails[0] ? normEmail(emails[0].split('@')[0]) : '';
    lines.forEach((line, i) => {
      if (name || used.has(i)) return;
      if (extractPhones(line).length || EMAIL_TEST.test(line)) return;
      const nm = splitNameLine(line);
      const compact = normEmail(line.replace(/\s/g, ''));
      if (nm) {
        name = nm.name;
        if (nm.title && !fields.title) fields.title = nm.title;
        used.add(i);
      } else if (emailLocal && compact.length >= 2 && emailLocal.includes(compact)) {
        name = line.replace(/\s/g, '');
        used.add(i);
      }
    });
  }
  if (name) fields.name = name.replace(/\s/g, '');

  // ---- 회사 / 부서 / 직함 / 주소 ----
  lines.forEach((line, i) => {
    if (used.has(i)) return;
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

  // ---- 회사 폴백 ----
  if (!fields.company) {
    // 1) 로고성 라틴 대문자 줄
    const logoIdx = lines.findIndex((l, i) => !used.has(i) && looksLikeCompanyLogo(l));
    if (logoIdx >= 0) {
      fields.company = lines[logoIdx].trim();
      used.add(logoIdx);
      // 바로 인접한 순수 한글 줄(2~10자)이 있으면 한글 회사명으로 교체 ("소프트아이텍")
      for (const j of [logoIdx + 1, logoIdx - 1]) {
        const cand = lines[j];
        if (
          cand &&
          !used.has(j) &&
          /^[가-힣]{2,12}$/.test(cand.replace(/\s/g, '')) &&
          !hasTitleWord(cand) &&
          !splitNameLine(cand)
        ) {
          fields.company = cand.replace(/\s/g, '');
          used.add(j);
          break;
        }
      }
    }
  }
  if (!fields.company) {
    // 2) 상단부의 짧은 순수 한글 줄 (회사명이 로고 옆 한글로만 있는 경우: "소프트아이텍")
    const topCount = Math.max(3, Math.ceil(lines.length * 0.45));
    const idx = lines.findIndex((l, i) => {
      if (used.has(i) || i >= topCount) return false;
      const t = l.replace(/\s/g, '');
      return (
        /^[가-힣]{2,12}$/.test(t) &&
        !hasTitleWord(l) &&
        !DEPT_WORDS.some((w) => t.includes(w)) &&
        !ADDR_HINT_RE.test(l) &&
        !splitNameLine(l)
      );
    });
    if (idx >= 0) {
      fields.company = lines[idx].replace(/\s/g, '');
      used.add(idx);
    }
  }
  if (!fields.company && emails[0] && !PERSONAL_MAIL_RE.test(emails[0])) {
    const dom = emails[0].split('@')[1]?.split('.')[0];
    if (dom && dom.length > 1) fields.company = dom.charAt(0).toUpperCase() + dom.slice(1);
  }

  // 이름이 라틴 문자로 시작하면 영문 이름 칸으로
  if (fields.name && /^[A-Za-z]/.test(fields.name)) {
    const m = fields.name.match(/^([가-힣]{2,5})\s*[(（]?\s*([A-Za-z][A-Za-z .]+?)\s*[)）]?$/);
    if (m) {
      fields.name = m[1];
      fields.nameEn = m[2].trim();
    } else {
      fields.nameEn = fields.name;
      delete fields.name;
    }
  }

  return { fields, usedLines: used };
}
