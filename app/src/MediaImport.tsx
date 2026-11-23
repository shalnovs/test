import { useEffect, useRef, useState } from 'react';
import { Copy, FileText, RotateCcw, Check, X } from 'lucide-react';
import { api, fileBase64, thumbnail, type Item } from './api';
import { useArchive } from './context';
import { Modal, MediaImage } from './components';
type Decision = { action: 'use' | 'restore' | 'copy'; id: string } | null;
type Review = { file: File; base64: string; duplicates: Item[] };
export function DuplicateImportDialog({
  review,
  onChoose,
}: {
  review: Review;
  onChoose: (decision: Decision) => void;
}) {
  const [id, setId] = useState(review.duplicates[0]?.id || '');
  const existing = review.duplicates.find((m) => m.id === id) || review.duplicates[0];
  return (
    <Modal title="Найден дубликат — выберите действие" onClose={() => onChoose(null)} wide>
      <p>Содержимое файла уже есть в архиве. До вашего решения новая запись не создаётся.</p>
      <div className="import-comparison">
        <section>
          <h3>Добавляемый файл</h3>
          {review.file.type.startsWith('image/') ? (
            <img src={`data:${review.file.type};base64,${review.base64}`} alt="Добавляемая фотография" />
          ) : (
            <div className="related-file-cover">
              <FileText size={40} />
            </div>
          )}
          <strong>{review.file.name}</strong>
        </section>
        <section>
          <h3>Уже в архиве</h3>
          {review.duplicates.length > 1 && (
            <select aria-label="Найденные дубликаты" value={id} onChange={(e) => setId(e.target.value)}>
              {review.duplicates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                  {m.trashed_at ? ' · в корзине' : ''}
                </option>
              ))}
            </select>
          )}
          {existing.mime?.startsWith('image/') ? (
            <MediaImage id={existing.id} alt="Существующая фотография" />
          ) : (
            <div className="related-file-cover">
              <FileText size={40} />
            </div>
          )}
          <strong>{existing.title}</strong>
          <small>{existing.filename}</small>
          <p>{[existing.date, existing.place].filter(Boolean).join(' · ')}</p>
          {existing.comment && <p>{existing.comment}</p>}
          {existing.marked_count > 0 && (
            <p className="notice">
              В материале есть отметки людей: {existing.marked_count}. Они сохранятся у имеющегося материала.
            </p>
          )}
          {existing.trashed_at && <p className="notice">Этот материал находится в корзине.</p>}
        </section>
      </div>
      <footer className="modal-footer wrap">
        <button onClick={() => onChoose(null)}>
          <X size={16} />
          Пропустить файл
        </button>
        <button onClick={() => onChoose({ action: 'copy', id: existing.id })}>
          <Copy size={16} />
          Добавить отдельную копию
        </button>
        <button
          className="primary"
          onClick={() => onChoose({ action: existing.trashed_at ? 'restore' : 'use', id: existing.id })}
        >
          {existing.trashed_at ? <RotateCcw size={16} /> : <Check size={16} />}{' '}
          {existing.trashed_at ? 'Восстановить из корзины' : 'Использовать имеющееся'}
        </button>
      </footer>
    </Modal>
  );
}
export function useMediaImport() {
  const { archive } = useArchive();
  const [review, setReview] = useState<Review | null>(null);
  const resolve = useRef<((d: Decision) => void) | null>(null),
    live = useRef(true),
    tree = useRef(archive.tree_id);
  tree.current = archive.tree_id;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      resolve.current?.(null);
      resolve.current = null;
    };
  }, [archive.tree_id]);
  const decide = (decision: Decision) => {
    const done = resolve.current;
    resolve.current = null;
    setReview(null);
    done?.(decision);
  };
  const importFile = async (file: File, kind: 'photo' | 'document' = 'photo'): Promise<Item | null> => {
    const treeId = archive.tree_id;
    if (!live.current) return null;
    const base64 = await fileBase64(file);
    let duplicates = ((await api('check_media', { base64, tree_id: treeId })).duplicates as Item[]) || [];
    let preview = '';
    while (live.current && tree.current === treeId) {
      let decision: Decision = null;
      if (duplicates.length) {
        decision = await new Promise<Decision>((done) => {
          resolve.current = done;
          setReview({ file, base64, duplicates });
        });
        if (!decision) return null;
      }
      if (!live.current || tree.current !== treeId) return null;
      if (!preview) preview = await thumbnail(file);
      if (!live.current || tree.current !== treeId) return null;
      const result = await api<Item>('add_media', {
        tree_id: treeId,
        filename: file.name,
        title: file.name.replace(/\.[^.]+$/, ''),
        mime: file.type || 'application/octet-stream',
        kind,
        base64,
        thumbnail: preview,
        ...(decision ? { duplicate_action: decision.action, duplicate_id: decision.id } : {}),
      });
      if (result.needs_confirmation) {
        duplicates = result.duplicates;
        continue;
      }
      return result;
    }
    return null;
  };
  return {
    importFile,
    duplicateDialog: review ? (
      <DuplicateImportDialog
        key={`${review.file.name}:${review.duplicates.map((m) => m.id).join(',')}`}
        review={review}
        onChoose={decide}
      />
    ) : null,
  };
}
