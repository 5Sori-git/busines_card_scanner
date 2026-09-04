// 한국 전화번호 정규화/표시 유틸. (외부 라이브러리 없이 최소 구현)

/** 입력 문자열에서 전화번호로 보이는 후보를 모두 추출 */
export function extractPhones(text: string): string[] {
  const out = new Set<string>();
  const re = /(\+?82[-\s.]?)?0?1[0-9][-\s.]?\d{3,4}[-\s.]?\d{4}|(\+?82[-\s.]?)?0?\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g;
  for (const m of text.matchAll(re)) {
    const digits = m[0].replace(/[^\d+]/g, '');
    if (digits.replace(/\D/g, '').length >= 8) out.add(normalizePhone(m[0]));
  }
  return [...out];
}

/** E.164 유사 형태(+82...)로 정규화. 실패 시 숫자만 남겨 반환 */
export function normalizePhone(raw: string, region: 'KR' = 'KR'): string {
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (region === 'KR') {
    if (d.startsWith('0082')) d = d.slice(4);
    else if (d.startsWith('82')) d = d.slice(2);
    if (d.startsWith('0')) d = d.slice(1);
    return '+82' + d;
  }
  return d;
}

/** 화면 표시용: 국내 번호를 하이픈 형태로 */
export function formatPhone(value: string): string {
  let d = value;
  if (d.startsWith('+82')) d = '0' + d.slice(3);
  d = d.replace(/\D/g, '');
  if (/^01[0-9]\d{7,8}$/.test(d)) {
    return d.length === 11
      ? d.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3')
      : d.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  }
  if (/^02\d{7,8}$/.test(d)) {
    return d.replace(/(\d{2})(\d{3,4})(\d{4})/, '$1-$2-$3');
  }
  if (/^0\d{9,10}$/.test(d)) {
    return d.replace(/(\d{3})(\d{3,4})(\d{4})/, '$1-$2-$3');
  }
  return value;
}
