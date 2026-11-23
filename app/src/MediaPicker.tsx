import { useRef, useState } from 'react';
import { Check, ImagePlus, Upload, X } from 'lucide-react';
import { useMediaImport } from './MediaImport';
import { useArchive } from './context';
import { Empty, MediaImage, Modal } from './components';
import { validRect, type Rect } from './photoGeometry';

export function MediaPicker({
  selected = [],
  onChoose,
  onClose,
  personId = '',
  portrait = false,
  crop = null,
}: {
  selected?: string[];
  onChoose: (ids: string[], crop?: Rect | null) => void;
  onClose: () => void;
  personId?: string;
  portrait?: boolean;
  crop?: Rect | null;
}) {
  const { archive, run, busy, notify } = useArchive();
  const { importFile, duplicateDialog } = useMediaImport();
  const [ids, setIds] = useState(selected),
    [query, setQuery] = useState(''),
    [related, setRelated] = useState(!!personId);
  const [portraitCrop, setCrop] = useState<Rect | null>(crop);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const file = useRef<HTMLInputElement>(null);
  const chosen = archive.data.media.find((m) => m.id === ids[0]);
  const face = archive.data.tags.find(
    (t) => t.media_id === ids[0] && t.person_id === personId && validRect(t),
  );
  const list = archive.data.media.filter(
    (m) =>
      m.mime?.startsWith('image/') &&
      `${m.title} ${m.description}`.toLowerCase().includes(query.toLowerCase()) &&
      (!related ||
        archive.data.tags.some((t) => t.media_id === m.id && t.person_id === personId) ||
        selected.includes(m.id)),
  );
  const pick = (id: string) => {
    if (portrait && id === ids[0]) return;
    setCrop(null);
    setSize({ w: 0, h: 0 });
    setIds((prev) => (portrait ? [id] : prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return;
    const result = await run(() => importFile(f));
    if (result)
      notify(
        result.reused
          ? 'Выбрано имеющееся фото'
          : result.restored
            ? 'Фото восстановлено'
            : 'Фотография добавлена',
      );
    if (result?.id) {
      setIds((prev) => (portrait ? [result.id] : [...new Set([...prev, result.id])]));
      setCrop(null);
      setRelated(false);
    }
    if (file.current) file.current.value = '';
  };
  return (
    <>
      <Modal title={portrait ? 'Главное фото профиля' : 'Фотографии события'} onClose={onClose} wide>
        <div className={`media-picker ${portrait ? 'with-preview' : ''}`}>
          {portrait && (
            <aside className="portrait-choice">
              <div className="portrait-preview">
                {chosen ? (
                  <MediaImage
                    id={chosen.id}
                    alt="Предпросмотр портрета"
                    crop={portraitCrop || undefined}
                    onLoad={(e) =>
                      setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                    }
                  />
                ) : (
                  <ImagePlus size={56} />
                )}
              </div>
              <h3>{chosen?.title || 'Выберите фотографию'}</h3>
              <p>Фото будет видно в карточке и семейном дереве.</p>
              {face && (
                <button
                  type="button"
                  disabled={!size.w}
                  onClick={() => {
                    const side = Math.min(Math.max(face.w * size.w, face.h * size.h) * 1.5, size.w, size.h);
                    const x = Math.max(0, Math.min(size.w - side, (face.x + face.w / 2) * size.w - side / 2));
                    const y = Math.max(0, Math.min(size.h - side, (face.y + face.h / 2) * size.h - side / 2));
                    setCrop({ x: x / size.w, y: y / size.h, w: side / size.w, h: side / size.h });
                  }}
                >
                  Использовать отмеченное лицо
                </button>
              )}
              {portraitCrop && (
                <button type="button" onClick={() => setCrop(null)}>
                  Показать всё фото
                </button>
              )}
              <button
                type="button"
                className="subtle"
                onClick={() => {
                  setIds([]);
                  setCrop(null);
                }}
              >
                Без фотографии
              </button>
            </aside>
          )}
          <section>
            <div className="media-picker-toolbar">
              <input
                aria-label="Поиск фотографии"
                placeholder="Найти фото по подписи…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="button" disabled={busy} onClick={() => file.current?.click()}>
                <Upload size={17} />С компьютера
              </button>
              <input
                hidden
                ref={file}
                type="file"
                accept="image/*"
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </div>
            {personId && (
              <div className="segmented">
                <button type="button" aria-pressed={related} onClick={() => setRelated(true)}>
                  Фотографии человека
                </button>
                <button type="button" aria-pressed={!related} onClick={() => setRelated(false)}>
                  Весь альбом
                </button>
              </div>
            )}
            <div className="media-picker-grid">
              {list.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  aria-label={`Выбрать фото: ${m.title}`}
                  aria-pressed={ids.includes(m.id)}
                  className={ids.includes(m.id) ? 'selected' : ''}
                  onClick={() => pick(m.id)}
                >
                  <MediaImage id={m.id} alt={m.title} />
                  <span>{m.title}</span>
                  {ids.includes(m.id) && <Check className="media-check" size={20} />}
                </button>
              ))}
            </div>
            {!list.length && <Empty>Фотографий не найдено. Откройте весь альбом или загрузите новую.</Empty>}
          </section>
        </div>
        <footer className="modal-footer">
          <span className="muted">{portrait ? '' : `Выбрано фотографий: ${ids.length}`}</span>
          <button type="button" onClick={onClose}>
            <X size={16} />
            Отмена
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onChoose(ids, portraitCrop)}
          >
            <Check size={17} />
            {portrait ? 'Применить портрет' : 'Добавить фотографии'}
          </button>
        </footer>
      </Modal>
      {duplicateDialog}
    </>
  );
}
