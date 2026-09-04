export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, text: string, mime: string): void {
  // BOM 추가: iOS/Excel 에서 한글 CSV 깨짐 방지
  const needsBom = mime.startsWith('text/csv');
  const parts = needsBom ? ['﻿', text] : [text];
  downloadBlob(filename, new Blob(parts, { type: `${mime};charset=utf-8` }));
}

export function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
