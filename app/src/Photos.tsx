import { useRef, useState, type PointerEvent } from 'react';
import { Plus, ScanFace, Download, Trash2, Check, UserRound, Image as ImageIcon } from 'lucide-react';
import { api, downloadMedia, fileBase64, fullName, thumbnail, type Item } from './api';
import { useArchive } from './context';
import { Chip, Empty, Field, MediaImage, Modal, PersonPicker, SearchBox } from './components';
export function Photos() {
  const { archive, photo, run, busy } = useArchive();
  const [q, setQ] = useState('');
  const [pid, setPid] = useState('');
  const [kind, setKind] = useState('all');
  const [limit, setLimit] = useState(48);
  const file = useRef<HTMLInputElement>(null);
  const list = archive.data.media.filter(
    (m) =>
      (kind === 'all' || (kind === 'photo' ? m.kind === 'photo' : m.kind !== 'photo')) &&
      (!pid ||
        archive.data.tags.some((t) => t.media_id === m.id && t.person_id === pid) ||
        archive.data.people.some((p) => p.id === pid && p.avatar_id === m.id)) &&
      [m.title, m.description, m.place].join(' ').toLowerCase().includes(q.toLowerCase()),
  );
  const upload = async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files);
    await run(async () => {
      for (const f of selected)
        await api('add_media', {
          filename: f.name,
          title: f.name.replace(/\.[^.]+$/, ''),
          mime: f.type || 'application/octet-stream',
          base64: await fileBase64(f),
          thumbnail: await thumbnail(f),
        });
    }, `Добавлено файлов: ${selected.length}`);
    if (file.current) file.current.value = '';
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">МГНОВЕНИЯ И ДОКУМЕНТЫ</div>
          <h1>Фотоальбом</h1>
          <p>Сохраняйте фотографии и отмечайте близких</p>
        </div>
        <button className="primary" disabled={busy} onClick={() => file.current?.click()}>
          <Plus size={18} />
          Добавить файлы
        </button>
        <input ref={file} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
      <div className="toolbar wrap">
        <SearchBox
          value={q}
          onChange={(v) => {
            setQ(v);
            setLimit(48);
          }}
          placeholder="Подпись, место или описание"
        />
        <PersonPicker
          value={pid}
          onChange={(v) => {
            setPid(v);
            setLimit(48);
          }}
          empty="Все люди"
        />
        <select aria-label="Тип материалов" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">Все материалы</option>
          <option value="photo">Фотографии</option>
          <option value="document">Документы и сканы</option>
        </select>
        <span className="muted">{list.length} материалов</span>
      </div>
      <div className="photo-grid">
        {list.slice(0, limit).map((m) => (
          <button key={m.id} className="photo-card" onClick={() => photo(m.id)}>
            <div className="photo-cover">
              {m.thumb ? (
                <MediaImage id={m.id} alt={m.title} />
              ) : (
                <div className="file-cover">
                  <ImageIcon size={32} />
                  <span>{m.filename?.split('.').pop()?.toUpperCase() || 'ФАЙЛ'}</span>
                </div>
              )}
              <span className="photo-count">
                <UserRound size={12} />
                {archive.data.tags.filter((t) => t.media_id === m.id).length}
              </span>
            </div>
            <div className="photo-caption">
              <strong>{m.title}</strong>
              <small>{m.date || m.place || (m.kind === 'photo' ? 'Семейная фотография' : 'Документ')}</small>
            </div>
          </button>
        ))}
      </div>
      {!list.length && <Empty>Материалы не найдены.</Empty>}
      {list.length > limit && (
        <div className="load-more">
          <button onClick={() => setLimit(limit + 48)}>Показать ещё</button>
        </div>
      )}
    </>
  );
}
type Rect = { x: number; y: number; w: number; h: number };
export function PhotoViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const { archive, run, person, busy } = useArchive();
  const m = archive.data.media.find((m) => m.id === id);
  const tags = archive.data.tags.filter((t) => t.media_id === id);
  const [mark, setMark] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState('');
  const [pid, setPid] = useState('');
  const [label, setLabel] = useState('');
  const [edit, setEdit] = useState(false);
  const [ready, setReady] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  if (!m) return null;
  const isImage = m.mime?.startsWith('image/');
  const position = (e: PointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const down = (e: PointerEvent) => {
    if (!mark || !ready || e.button !== 0) return;
    e.preventDefault();
    const p = position(e);
    setStart(p);
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!start) return;
    const p = position(e);
    setRect({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    });
  };
  const saveTag = () =>
    run(async () => {
      if (!rect || rect.w < 0.005 || rect.h < 0.005)
        throw new Error('Сначала выделите рамкой человека на фотографии');
      const existing = tags.find((t) => t.id === selected);
      await api('save', {
        kind: 'tags',
        record: {
          ...existing,
          id: existing?.id || '',
          media_id: id,
          person_id: pid,
          label: pid
            ? fullName(archive.data.people.find((p) => p.id === pid))
            : label || 'Неизвестный человек',
          comment: existing?.comment || '',
          ...rect,
        },
        title: 'Отмечен человек на фотографии',
      });
      setRect(null);
      setStart(null);
      setSelected('');
      setPid('');
      setLabel('');
      setMark(false);
    }, 'Отметка сохранена');
  return (
    <Modal title={m.title} onClose={onClose} wide>
      <div className="photo-viewer">
        <div className="photo-workspace">
          <div className="viewer-toolbar">
            <button
              className={mark ? 'primary' : ''}
              disabled={!isImage}
              onClick={() => {
                setMark(!mark);
                setRect(null);
                setStart(null);
              }}
            >
              <ScanFace size={17} />
              {mark ? 'Режим отметок' : 'Отметить человека'}
            </button>
            <button
              onClick={() =>
                run(async () => {
                  if (await downloadMedia(m)) return true;
                })
              }
            >
              <Download size={16} />
              Сохранить оригинал
            </button>
            <button onClick={() => setEdit(true)}>Подпись</button>
          </div>
          {isImage ? (
            <div className={'image-workspace ' + (mark ? 'marking' : '')}>
              <div
                className="image-stage"
                ref={stage}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={() => setStart(null)}
                onPointerCancel={() => setStart(null)}
              >
                <MediaImage id={id} thumb={false} alt={m.title} onLoad={() => setReady(true)} />
                {tags
                  .filter((t) => t.x !== null && t.x !== undefined)
                  .map((t) => (
                    <button
                      title={t.label}
                      className={'face-tag ' + (t.id === selected ? 'selected' : '')}
                      key={t.id}
                      style={{
                        left: `${t.x * 100}%`,
                        top: `${t.y * 100}%`,
                        width: `${t.w * 100}%`,
                        height: `${t.h * 100}%`,
                        pointerEvents: mark ? 'none' : 'auto',
                      }}
                      onClick={() => t.person_id && person(t.person_id)}
                    >
                      <span>
                        {t.label || fullName(archive.data.people.find((p) => p.id === t.person_id))}
                      </span>
                    </button>
                  ))}
                {rect && (
                  <div
                    className="face-tag draft"
                    style={{
                      left: `${rect.x * 100}%`,
                      top: `${rect.y * 100}%`,
                      width: `${rect.w * 100}%`,
                      height: `${rect.h * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          ) : (
            <Empty
              action={
                <button onClick={() => run(() => downloadMedia(m))}>
                  <Download size={16} />
                  Сохранить файл
                </button>
              }
            >
              Документ {m.filename}. Сохраните оригинал, чтобы открыть его в подходящей программе.
            </Empty>
          )}
          {mark && (
            <p className="photo-hint">Проведите мышью по фотографии, чтобы выделить человека рамкой.</p>
          )}
          <p className="photo-description">{m.description}</p>
        </div>
        <aside className="photo-sidebar">
          <div className="section-title">
            <h3>Кто на фотографии</h3>
            <span className="count">{tags.length}</span>
          </div>
          {tags.map((t) => (
            <div key={t.id} className="photo-tag-row">
              <button className="tag-person" onClick={() => t.person_id && person(t.person_id)}>
                {t.label || fullName(archive.data.people.find((p) => p.id === t.person_id))}
                <small>
                  {t.x === null || t.x === undefined ? 'Без рамки' : t.comment || 'Отмечен на фото'}
                </small>
              </button>
              <button
                title="Задать рамку"
                className="icon-button"
                onClick={() => {
                  setSelected(t.id);
                  setPid(t.person_id || '');
                  setLabel(t.label || '');
                  setMark(true);
                  setRect(t.x != null ? { x: t.x, y: t.y, w: t.w, h: t.h } : null);
                }}
              >
                <ScanFace size={16} />
              </button>
              <button
                title="Удалить отметку"
                className="icon-button danger-on-hover"
                onClick={() => run(() => api('remove', { kind: 'tags', id: t.id }), 'Отметка удалена')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!tags.length && <p className="muted">Пока никто не отмечен.</p>}
          {mark && (
            <div className="tag-form">
              <h3>{selected ? 'Уточнить отметку' : 'Новая отметка'}</h3>
              <Field label="Человек">
                <PersonPicker value={pid} onChange={setPid} empty="Человек пока неизвестен" />
              </Field>
              {!pid && (
                <Field label="Подпись">
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Например: сосед семьи"
                  />
                </Field>
              )}
              <button className="primary" disabled={!rect || busy} onClick={saveTag}>
                <Check size={16} />
                Сохранить отметку
              </button>
              <button
                className="subtle"
                onClick={() => {
                  setMark(false);
                  setRect(null);
                  setSelected('');
                }}
              >
                Отмена
              </button>
            </div>
          )}
          <div className="photo-meta">
            {m.date && <p>Дата: {m.date}</p>}
            {m.place && <p>Место: {m.place}</p>}
            <small>
              {archive.data.sources.find((s) => s.id === m.source_id)?.title || 'Добавлено в этот архив'}
            </small>
          </div>
        </aside>
      </div>
      {edit && <MediaForm media={m} onClose={() => setEdit(false)} />}
    </Modal>
  );
}
function MediaForm({ media, onClose }: { media: Item; onClose: () => void }) {
  const { run } = useArchive();
  const [m, setM] = useState(media);
  return (
    <Modal title="Подпись к материалу" onClose={onClose}>
      <div className="form-grid">
        {[
          ['title', 'Название'],
          ['date', 'Дата или период'],
          ['place', 'Место'],
        ].map(([k, label]) => (
          <Field key={k} label={label} wide>
            <input value={m[k] || ''} onChange={(e) => setM({ ...m, [k]: e.target.value })} />
          </Field>
        ))}
        <Field label="Описание" wide>
          <textarea
            rows={6}
            value={m.description || ''}
            onChange={(e) => setM({ ...m, description: e.target.value })}
          />
        </Field>
      </div>
      <footer className="modal-footer">
        <button onClick={onClose}>Отмена</button>
        <button
          className="primary"
          onClick={() =>
            run(async () => {
              await api('save', { kind: 'media', record: m, title: 'Изменена подпись к материалу' });
              onClose();
            }, 'Подпись сохранена')
          }
        >
          Сохранить
        </button>
      </footer>
    </Modal>
  );
}
