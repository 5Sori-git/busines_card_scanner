import Dexie, { type Table } from 'dexie';
import type { Contact, StoredImage, MetaRow } from './types';

export class CardScanDB extends Dexie {
  contacts!: Table<Contact, string>;
  images!: Table<StoredImage, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('cardscan');
    // 배열 필드(phones/emails)는 개수가 적어 메모리 검색으로 처리 → 인덱스는 최소만.
    this.version(1).stores({
      contacts: 'id, name, company, updatedAt',
      images: 'id',
      meta: 'key',
    });
  }
}

export const db = new CardScanDB();

export async function saveContact(c: Contact): Promise<void> {
  c.updatedAt = Date.now();
  await db.contacts.put(c);
}

export async function removeContact(id: string): Promise<void> {
  await db.transaction('rw', db.contacts, db.images, async () => {
    const c = await db.contacts.get(id);
    if (c?.imageId) await db.images.delete(c.imageId);
    await db.contacts.delete(id);
  });
}

export async function getImageUrl(imageId: string | undefined): Promise<string | null> {
  if (!imageId) return null;
  const img = await db.images.get(imageId);
  return img ? URL.createObjectURL(img.blob) : null;
}

export async function saveImage(img: StoredImage): Promise<void> {
  await db.images.put(img);
}

/**
 * 어떤 연락처에도 연결되지 않은 이미지를 정리한다.
 * 스캔 도중 저장을 취소한 경우 등에서 생기는 고아 이미지 제거용.
 * 방금 만든 이미지(스캔→편집 화면 이동 중)를 지우지 않도록 유예시간을 둔다.
 */
export async function pruneOrphanImages(olderThanMs = 10 * 60 * 1000): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  const [images, contacts] = await Promise.all([db.images.toArray(), db.contacts.toArray()]);
  const used = new Set(contacts.map((c) => c.imageId).filter(Boolean));
  const orphanIds = images
    .filter((i) => !used.has(i.id) && (i.createdAt ?? 0) < cutoff)
    .map((i) => i.id);
  if (orphanIds.length) await db.images.bulkDelete(orphanIds);
  return orphanIds.length;
}
