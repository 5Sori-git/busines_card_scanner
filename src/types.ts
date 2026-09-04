export type PhoneType = 'mobile' | 'office' | 'fax';

export const PHONE_TYPE_LABEL: Record<PhoneType, string> = {
  mobile: '휴대폰',
  office: '유선',
  fax: '팩스',
};

export interface Phone {
  type: PhoneType;
  value: string;
}

export interface Address {
  raw: string;
  zip?: string;
}

export interface Contact {
  id: string;
  name: string;
  nameEn?: string;
  company?: string;
  department?: string;
  title?: string;
  phones: Phone[];
  emails: string[];
  addresses: Address[];
  urls: string[];
  memo?: string;
  tags: string[];
  /** 원본 명함 이미지 (images 테이블) 참조 */
  imageId?: string;
  /** OCR 원문 — 재파싱 및 사용자 대조용 */
  ocrRawText?: string;
  /** 0~1, Tesseract 평균 신뢰도 */
  ocrConfidence?: number;
  createdAt: number;
  updatedAt: number;
}

export interface StoredImage {
  id: string;
  blob: Blob;
  w: number;
  h: number;
  createdAt: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

/** 새 연락처의 빈 골격 */
export function emptyContact(id: string): Contact {
  const now = Date.now();
  return {
    id,
    name: '',
    phones: [],
    emails: [],
    addresses: [],
    urls: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}
