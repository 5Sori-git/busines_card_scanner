import { db } from '../db';
import type { Contact, StoredImage } from '../types';

const BACKUP_MAGIC = 'myeongham-scanner-backup';
const BACKUP_VERSION = 1;

interface BackupFile {
  magic: string;
  version: number;
  exportedAt: string;
  contacts: Contact[];
  images: Array<{
    id: string;
    w: number;
    h: number;
    type: string;
    data: string;
    createdAt?: number;
  }>;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function base64ToBlob(data: string, type: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function exportBackup(): Promise<Blob> {
  const contacts = await db.contacts.toArray();
  const images = await db.images.toArray();
  const payload: BackupFile = {
    magic: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    contacts,
    images: await Promise.all(
      images.map(async (img) => ({
        id: img.id,
        w: img.w,
        h: img.h,
        type: img.blob.type || 'image/jpeg',
        createdAt: img.createdAt,
        data: await blobToBase64(img.blob),
      })),
    ),
  };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export interface ImportResult {
  contacts: number;
  images: number;
}

/** mode: 'merge' → 같은 id 는 덮어쓰기, 'replace' → 전체 삭제 후 복원 */
export async function importBackup(file: File, mode: 'merge' | 'replace'): Promise<ImportResult> {
  const text = await file.text();
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('백업 파일을 읽을 수 없습니다 (JSON 형식 오류).');
  }
  if (parsed.magic !== BACKUP_MAGIC || !Array.isArray(parsed.contacts)) {
    throw new Error('이 앱의 백업 파일이 아닙니다.');
  }

  const images: StoredImage[] = (parsed.images ?? []).map((i) => ({
    id: i.id,
    w: i.w,
    h: i.h,
    createdAt: i.createdAt ?? Date.now(),
    blob: base64ToBlob(i.data, i.type),
  }));

  await db.transaction('rw', db.contacts, db.images, async () => {
    if (mode === 'replace') {
      await db.contacts.clear();
      await db.images.clear();
    }
    await db.contacts.bulkPut(parsed.contacts);
    if (images.length) await db.images.bulkPut(images);
  });

  return { contacts: parsed.contacts.length, images: images.length };
}
