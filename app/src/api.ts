import { invoke, isTauri } from '@tauri-apps/api/core';
export type Item = Record<string, any> & { id: string };
export type ArchiveData = {
  people: Item[];
  relationships: Item[];
  media: Item[];
  tags: Item[];
  texts: Item[];
  text_links: Item[];
  sources: Item[];
  facts: Item[];
  events?: Item[];
};
export type Archive = {
  data: ArchiveData;
  tree_id: string;
  title: string;
  root: string;
  history: Item[];
  trash?: { media: Item[]; texts: Item[] };
};
export async function api<T = any>(op: string, payload: Record<string, any> = {}): Promise<T> {
  if (isTauri()) return invoke<T>('archive', { op, payload });
  const r = await fetch('/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, payload }),
  });
  const result = await r.json();
  if (!result.ok) throw new Error(result.error);
  return result.result;
}
export const fullName = (p?: Partial<Item>) =>
  p ? [p.surname, p.given_name, p.patronymic].filter(Boolean).join(' ') : 'Неизвестный человек';
export const initials = (p?: Partial<Item>) =>
  p ? [p.given_name?.[0], p.surname?.[0]].filter(Boolean).join('') : '?';
export const dateLabel = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('.') : v || 'Не указано';
export const years = (p: Partial<Item>) =>
  `${p.birth_date?.slice(0, 4) || '?'}${p.death_date ? ' — ' + p.death_date.slice(0, 4) : p.alive === false ? ' — ?' : ''}`;
export function plainText(v: any): string {
  if (!v) return '';
  if (v.type === 'text') return v.text || '';
  return (v.content || []).map(plainText).join(v.type === 'doc' ? '\n' : '');
}
export function mentionedPeople(v: any): string[] {
  const ids = new Set<string>();
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'personLink' && n.attrs?.personId) ids.add(n.attrs.personId);
    Object.values(n).forEach((x) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (typeof x === 'object') walk(x);
    });
  };
  walk(v);
  return [...ids];
}
const mediaCache = new Map<string, Promise<string>>();
export function clearMedia() {
  mediaCache.clear();
}
export function releaseMedia(id: string, thumb = false) {
  mediaCache.delete(id + ':' + thumb);
}
export function mediaUrl(id: string, thumbnail = true): Promise<string> {
  const key = id + ':' + thumbnail;
  if (!mediaCache.has(key))
    mediaCache.set(
      key,
      api<string>('media_data', { id, thumbnail }).catch((e) => {
        mediaCache.delete(key);
        throw e;
      }),
    );
  return mediaCache.get(key)!;
}
export async function pickFile(
  save = false,
  defaultPath = 'Ветка семьи.familyzip',
  extensions = ['familyzip'],
): Promise<string | null> {
  if (isTauri()) {
    const dialog = await import('@tauri-apps/plugin-dialog');
    if (save) return dialog.save({ defaultPath, filters: [{ name: 'Файл архива', extensions }] });
    const result = await dialog.open({ multiple: false, filters: [{ name: 'Файл архива', extensions }] });
    return typeof result === 'string' ? result : null;
  }
  return window.prompt(save ? 'Путь для сохранения файла' : 'Путь к файлу', save ? defaultPath : '');
}
export async function chooseLibrary(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ directory: true, multiple: false, title: 'Папка семейного архива' });
    return typeof r === 'string' ? r : null;
  }
  return window.prompt('Путь к папке архива');
}
export async function openUrl(url: string) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Поддерживаются ссылки http и https');
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else window.open(url, '_blank', 'noopener,noreferrer');
}
export async function downloadMedia(m: Item) {
  const target = await pickFile(true, m.filename || m.title, m.filename?.split('.').slice(-1) || ['bin']);
  if (target) await api('export_media', { id: m.id, path: target });
  return !!target;
}
export function fileBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
export async function thumbnail(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) return '';
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = bitmap.width * scale;
    c.height = bitmap.height * scale;
    c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
    bitmap.close();
    return c.toDataURL('image/jpeg', 0.84).split(',')[1];
  } catch {
    return '';
  }
}
