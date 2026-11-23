import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import {
  Check,
  Download,
  Eye,
  LoaderCircle,
  ScanFace,
  Trash2,
  WandSparkles,
  X,
  UserRound,
  ArrowUpRight,
  MousePointer2,
  CalendarDays,
  MapPin,
} from 'lucide-react';
import { PersonSearch } from './PersonSearch';
import { TrashDialog } from './ArchiveCleanup';
import { api, downloadMedia, fullName, type Item } from './api';
import { useArchive } from './context';
import { Empty, Field, MediaImage, Modal, PersonPicker } from './components';
import { PhotoHotspots } from './PhotoHotspots';
import { detectFaces } from './faceDetection';
import { newRegions, rectangle, rectStyle, validRect, type Point, type Rect } from './photoGeometry';
import { LocationEditor } from './LocationEditor';
import { MapCanvas } from './FamilyMap';
import { eventPoint } from './placeData';
import { dateSpan } from './eventDates';
import { mediaSpan, spanValue, mediaDateLabel, dateSelection, placeSelection } from './materials';

export function PhotoViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const { archive, run, person, busy, notify, browse, selectPerson } = useArchive();
  const m = archive.data.media.find((m) => m.id === id);
  const tags = archive.data.tags.filter((t) => t.media_id === id);
  const [mark, setMark] = useState(false);
  const [workflow, setWorkflow] = useState<'known' | 'frame' | 'detect' | null>(null);
  const [highlighted, setHighlighted] = useState('');
  const [highlightPulse, setHighlightPulse] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [selected, setSelected] = useState('');
  const [pid, setPid] = useState('');
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);
  const [edit, setEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ready, setReady] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<Rect[]>([]);
  const [suggestion, setSuggestion] = useState<Rect | null>(null);
  const [detectionNote, setDetectionNote] = useState('');
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const start = useRef<Point | null>(null);
  const previousRect = useRef<Rect | null>(null);
  const saving = useRef(false);
  const draftId = useRef('');
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const locked = busy || detecting || isSaving;
  const reset = () => {
    setRect(null);
    setSelected('');
    setPid('');
    setLabel('');
    setPending(false);
    setSuggestion(null);
    start.current = null;
    setDrawing(false);
    draftId.current = '';
  };
  const canLeave = () =>
    !saving.current && !busy && (!pending || window.confirm('Отменить несохранённую отметку?'));
  const close = () => {
    if (canLeave()) onClose();
  };
  const openPerson = (personId: string) => {
    if (personId && canLeave()) person(personId);
  };
  const mode = (value: boolean) => {
    if (canLeave()) {
      reset();
      setMark(value);
      setWorkflow(null);
      setHighlighted('');
    }
  };
  const selectTag = (tag: Item) => {
    if (tag.person_id) selectPerson?.(tag.person_id);
    if (locked || !canLeave()) return;
    reset();
    setMark(true);
    setWorkflow(tag.person_id ? 'known' : 'frame');
    setHighlighted('');
    setSelected(tag.id);
    setPid(tag.person_id || '');
    setLabel(tag.label || '');
    setRect(validRect(tag) ? { x: tag.x, y: tag.y, w: tag.w, h: tag.h } : null);
  };
  const position = (e: PointerEvent): Point => {
    const r = stage.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const save = async (box: Rect, personId = pid) => {
    if (saving.current || !validRect(box)) return;
    saving.current = true;
    setSaving(true);
    setPending(true);
    const existing =
      tags.find((t) => t.id === selected) ||
      (personId ? tags.find((t) => t.person_id === personId && !validRect(t)) : undefined);
    draftId.current ||= existing?.id || crypto.randomUUID();
    const result = await run(async () => {
      await api('save', {
        kind: 'tags',
        record: {
          ...existing,
          id: draftId.current,
          media_id: id,
          person_id: personId,
          label: personId
            ? fullName(archive.data.people.find((p) => p.id === personId))
            : label.trim() || 'Неизвестный человек',
          comment: existing?.comment || '',
          recognition_mode: 'manual',
          recognition_confirmed: true,
          face_id: '',
          ...box,
        },
        title: 'Отмечен человек на фотографии',
      });
      return true;
    }, 'Отметка сохранена');
    saving.current = false;
    if (!live.current) return;
    setSaving(false);
    if (result) {
      setSuggestions((current) => newRegions(current, [box]));
      reset();
    }
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!mark) {
      setHighlighted('');
      return;
    }
    if (
      !workflow ||
      workflow === 'detect' ||
      (workflow === 'known' && !pid) ||
      !ready ||
      locked ||
      e.button !== 0 ||
      (pending && !selected)
    )
      return;
    e.preventDefault();
    previousRect.current = rect;
    start.current = position(e);
    setDrawing(true);
    setRect({ ...start.current, w: 0, h: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (start.current) setRect(rectangle(start.current, position(e)));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const box = rectangle(start.current, position(e));
    start.current = null;
    setDrawing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!validRect(box)) {
      setRect(previousRect.current);
      return;
    }
    setRect(box);
    setPending(true);
    if (pid) void save(box, pid);
  };
  const cancelPointer = () => {
    if (start.current) {
      start.current = null;
      setDrawing(false);
      setRect(previousRect.current);
    }
  };
  const findFaces = async () => {
    if (!image.current || locked || pending) return;
    reset();
    setMark(true);
    setWorkflow('detect');
    setHighlighted('');
    setDetecting(true);
    setDetectionNote('Ищем лица на этом компьютере…');
    try {
      const found = await detectFaces(image.current);
      if (!live.current) return;
      const fresh = newRegions(found, tags.filter((t) => validRect(t)) as (Item & Rect)[]);
      setSuggestions(fresh);
      setDetectionNote(
        fresh.length
          ? `Найдено новых областей: ${fresh.length}. Нажмите на рамку и выберите человека.`
          : found.length
            ? 'Найденные лица уже отмечены.'
            : 'Лица не найдены. Выделите их вручную.',
      );
    } catch (error) {
      if (live.current) setDetectionNote('Не удалось выполнить поиск лиц. Можно выделить человека вручную.');
      console.warn('Local face detection failed:', error);
    } finally {
      if (live.current) setDetecting(false);
    }
  };
  if (!m) return null;
  const startFlow = (flow: 'known' | 'frame') => {
    if (locked || !canLeave()) return;
    reset();
    setWorkflow(flow);
    setHighlighted('');
    setDetectionNote('');
  };
  const isImage = m.mime?.startsWith('image/');
  return (
    <Modal title={m.title} onClose={close} wide>
      <div className="photo-viewer">
        <div className="photo-workspace">
          <div className="viewer-toolbar">
            <div className="photo-modes" role="group" aria-label="Режим фотографии">
              <button
                aria-pressed={!mark}
                className={!mark ? 'primary' : ''}
                disabled={locked}
                onClick={() => mode(false)}
              >
                <Eye size={17} />
                Просмотр
              </button>
              <button
                aria-pressed={mark}
                className={mark ? 'primary' : ''}
                disabled={!isImage || locked}
                onClick={() => mode(true)}
              >
                <ScanFace size={17} />
                Разметка
              </button>
            </div>
            {mark && (
              <button disabled={!ready || locked || pending} onClick={findFaces}>
                {detecting ? <LoaderCircle size={17} className="spin" /> : <WandSparkles size={17} />}Найти
                лица
              </button>
            )}
            <button
              title="Сохранить оригинал"
              aria-label="Сохранить оригинал"
              disabled={locked}
              onClick={() => run(() => downloadMedia(m))}
            >
              <Download size={17} />
            </button>
            <button disabled={locked} onClick={() => setEdit(true)}>
              Дата и комментарий
            </button>
            <button
              className="icon-button danger-on-hover"
              title="Переместить в корзину"
              aria-label="Переместить материал в корзину"
              disabled={locked}
              onClick={() => {
                if (canLeave()) setDeleting(true);
              }}
            >
              <Trash2 size={18} />
            </button>
          </div>
          {mark && isImage && (
            <div className="annotation-scenarios" role="group" aria-label="Способ добавления отметки">
              <button
                type="button"
                aria-pressed={workflow === 'known'}
                disabled={locked}
                onClick={() => startFlow('known')}
              >
                <UserRound size={20} />
                <span>
                  <strong>Сначала человек</strong>
                  <small>Найти имя → выделить → готово</small>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={workflow === 'frame'}
                disabled={locked}
                onClick={() => startFlow('frame')}
              >
                <MousePointer2 size={20} />
                <span>
                  <strong>Сначала рамка</strong>
                  <small>Выделить → выбрать имя → сохранить</small>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={workflow === 'detect'}
                disabled={locked || !ready || pending}
                onClick={findFaces}
              >
                <WandSparkles size={20} />
                <span>
                  <strong>Автоматический поиск</strong>
                  <small>Найти лица → подписать каждое</small>
                </span>
              </button>
            </div>
          )}
          {isImage ? (
            <div className={'image-workspace ' + (mark ? 'marking' : 'viewing')}>
              <div
                className={`image-stage ${!mark && highlighted && tags.some((t) => t.id === highlighted && validRect(t)) ? 'spotlight-active' : ''}`}
                ref={stage}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={cancelPointer}
              >
                <MediaImage
                  id={id}
                  thumb={false}
                  alt={m.title}
                  onLoad={(e) => {
                    image.current = e.currentTarget;
                    setReady(true);
                  }}
                />
                {ready && (
                  <PhotoHotspots
                    tags={tags}
                    people={archive.data.people}
                    editing={mark}
                    selected={selected}
                    highlighted={!mark ? highlighted : ''}
                    pulse={highlightPulse}
                    onSelect={(t) =>
                      mark
                        ? selectTag(t)
                        : t.person_id
                          ? openPerson(t.person_id)
                          : notify(t.label || 'Человек пока неизвестен')
                    }
                  />
                )}
                {mark &&
                  suggestions.map((r, index) => (
                    <button
                      key={index}
                      className="face-tag suggested"
                      style={rectStyle(r)}
                      aria-label={`Найденное лицо ${index + 1}`}
                      disabled={locked}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        if (!canLeave()) return;
                        reset();
                        setSuggestion(r);
                        setRect(r);
                        setPending(true);
                      }}
                    >
                      <span>Выбрать человека</span>
                    </button>
                  ))}
                {mark && rect && <div className="face-tag draft" style={rectStyle(rect)} />}
                {mark && rect && !drawing && (
                  <TagPopover rect={rect} stage={stage.current}>
                    <div className="tag-popover-title">
                      {selected ? 'Уточнить отметку' : 'Кто на фотографии?'}
                    </div>
                    <PersonSearch
                      value={pid}
                      disabled={locked}
                      onChange={(value) => {
                        setPid(value);
                        setPending(true);
                      }}
                      empty="Человек пока неизвестен"
                    />
                    {!pid && (
                      <input
                        aria-label="Подпись неизвестного человека"
                        placeholder="Подпись (необязательно)"
                        value={label}
                        disabled={locked}
                        onChange={(e) => {
                          setLabel(e.target.value);
                          setPending(true);
                        }}
                      />
                    )}
                    <div className="tag-popover-actions">
                      <small>{pid ? 'Сохранить выбранного человека' : 'Можно сохранить без имени'}</small>
                      <button
                        className="icon-button primary"
                        title="Сохранить отметку"
                        aria-label="Сохранить отметку"
                        disabled={locked}
                        onClick={() => save(rect)}
                      >
                        <Check size={18} />
                      </button>
                      <button
                        className="icon-button"
                        title="Отменить отметку"
                        aria-label="Отменить отметку"
                        disabled={locked}
                        onClick={() => {
                          if (suggestion)
                            setSuggestions((current) => current.filter((r) => r !== suggestion));
                          reset();
                        }}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </TagPopover>
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
          <p className="photo-hint">
            {mark
              ? pid && !rect
                ? 'Выделите человека — отметка сохранится автоматически.'
                : !workflow
                  ? 'Выберите удобный способ добавления отметки.'
                  : workflow === 'known'
                    ? 'Найдите человека справа по первым буквам имени или фамилии.'
                    : 'Выделите человека рамкой или выберите найденное лицо.'
              : 'Наведите на лицо, чтобы увидеть имя. Имя в списке подсветит человека; клик по лицу откроет карточку.'}
          </p>
          {!mark && highlighted && (
            <div className="photo-highlight-caption" role="status">
              <span>
                {tags.some((t) => t.id === highlighted && validRect(t))
                  ? 'Человек выделен на фотографии.'
                  : 'У этой отметки пока нет рамки. Укажите её в режиме «Разметка».'}
              </span>
              <button
                type="button"
                className="icon-button"
                title="Убрать выделение"
                aria-label="Убрать выделение"
                onClick={() => setHighlighted('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {mark && detectionNote && (
            <p className="detection-note" role="status">
              {detectionNote}
            </p>
          )}
          {mark && (
            <p className="detection-caption">
              Поиск находит лица, а имя выбираете вы. Нечёткие и маленькие лица можно отметить вручную.
            </p>
          )}
          <p className="photo-description">{m.description}</p>
          {m.comment && (
            <div className="media-comment">
              <strong>Комментарий</strong>
              <p>{m.comment}</p>
            </div>
          )}
        </div>
        <aside className="photo-sidebar">
          <div className="section-title">
            <h3>Кто на фотографии</h3>
            <span className="count">{tags.length}</span>
          </div>
          {tags.map((t) => (
            <div key={t.id} className={`photo-tag-row ${highlighted === t.id && !mark ? 'active' : ''}`}>
              <button
                className="tag-person"
                aria-pressed={!mark && highlighted === t.id}
                onClick={() => {
                  if (mark) selectTag(t);
                  else {
                    setHighlighted(t.id);
                    if (t.person_id) selectPerson?.(t.person_id);
                    setHighlightPulse((n) => n + 1);
                    stage.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                  }
                }}
              >
                {t.person_id
                  ? fullName(archive.data.people.find((p) => p.id === t.person_id))
                  : t.label || 'Неизвестный человек'}
                <small>{!validRect(t) ? 'Без рамки' : t.comment || 'Отмечен на фото'}</small>
              </button>
              {!mark && t.person_id && (
                <button
                  className="icon-button"
                  title="Открыть карточку"
                  aria-label={`Открыть карточку: ${fullName(archive.data.people.find((p) => p.id === t.person_id))}`}
                  onClick={() => openPerson(t.person_id)}
                >
                  <ArrowUpRight size={15} />
                </button>
              )}
              {mark && (
                <>
                  <button
                    title="Задать рамку"
                    aria-label={`Задать рамку: ${t.label || 'человек'}`}
                    className="icon-button"
                    disabled={locked}
                    onClick={() => selectTag(t)}
                  >
                    <ScanFace size={16} />
                  </button>
                  <button
                    title="Удалить отметку"
                    aria-label={`Удалить отметку: ${t.label || 'человек'}`}
                    className="icon-button danger-on-hover"
                    disabled={locked}
                    onClick={() => {
                      if (canLeave()) {
                        reset();
                        void run(() => api('remove', { kind: 'tags', id: t.id }), 'Отметка удалена');
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
          {!tags.length && <p className="muted">Пока никто не отмечен.</p>}
          {mark && !rect && workflow === 'known' && (
            <div className="tag-form">
              <h3>{selected ? 'Выделить этого человека' : 'Новая отметка'}</h3>
              <Field label="Кого выделяем">
                <PersonSearch
                  value={pid}
                  disabled={locked}
                  onChange={(value) => {
                    setSelected('');
                    setPid(value);
                  }}
                  empty="Выбрать до выделения"
                />
              </Field>
              <small>
                {pid
                  ? 'После выделения сохранится автоматически.'
                  : 'Начните вводить любую часть имени или фамилии.'}
              </small>
            </div>
          )}
          <div className="photo-meta">
            {m.date && (
              <button
                className="metadata-link"
                disabled={!dateSelection(m)}
                onClick={() => {
                  const selection = dateSelection(m);
                  if (selection) browse?.(selection);
                }}
              >
                <CalendarDays size={16} />
                {mediaDateLabel(m)}
              </button>
            )}
            {(m.place || eventPoint(m)) && (
              <button
                className="metadata-link"
                onClick={() => {
                  const selection = placeSelection(m);
                  if (selection) browse?.(selection);
                }}
              >
                <MapPin size={16} />
                {m.place || 'Место на карте'}
              </button>
            )}
            {m.date_source_text && m.date_source_text !== m.date && (
              <small>Дата в источнике: {m.date_source_text}</small>
            )}
            {eventPoint(m) && (
              <div className="photo-location-preview">
                <MapCanvas
                  points={[eventPoint(m)!]}
                  onSelect={() => {
                    const selection = placeSelection(m);
                    if (selection) browse?.(selection);
                  }}
                />
              </div>
            )}
            <small>
              {archive.data.sources.find((s) => s.id === m.source_id)?.title || 'Добавлено в этот архив'}
            </small>
          </div>
        </aside>
      </div>
      {edit && <MediaForm media={m} onClose={() => setEdit(false)} />}
      {deleting && (
        <TrashDialog kind="media" ids={[id]} onClose={() => setDeleting(false)} onDone={onClose} />
      )}
    </Modal>
  );
}

function TagPopover({
  rect,
  stage,
  children,
}: {
  rect: Rect;
  stage: HTMLDivElement | null;
  children: React.ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!stage || !popup.current) return;
    const place = () => {
      const width = stage.clientWidth,
        height = stage.clientHeight;
      const pw = popup.current!.offsetWidth,
        ph = popup.current!.offsetHeight;
      const right = (rect.x + rect.w) * width + 10;
      const left = rect.x * width - pw - 10;
      let x: number, y: number;
      if (right + pw <= width) {
        x = right;
        y = rect.y * height;
      } else if (left >= 0) {
        x = left;
        y = rect.y * height;
      } else {
        x = Math.max(0, Math.min(rect.x * width, width - pw));
        y = (rect.y + rect.h) * height + 10;
        if (y + ph > height && rect.y * height > ph + 10) y = rect.y * height - ph - 10;
      }
      setPosition({ left: x, top: Math.max(0, Math.min(y, Math.max(height - ph, 0))) });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(stage);
    observer.observe(popup.current);
    return () => observer.disconnect();
  }, [stage, rect]);
  return (
    <div
      className="tag-popover"
      ref={popup}
      style={position}
      role="group"
      aria-label="Выбор человека для отметки"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function MediaForm({ media, onClose }: { media: Item; onClose: () => void }) {
  const { run, busy } = useArchive();
  const [m, setM] = useState<Item>(() => {
    const span = mediaSpan(media),
      date = span ? spanValue(span) : '';
    return {
      ...media,
      date,
      date_precision: span?.precision || 'day',
      date_source_text: media.date_source_text || (media.date && media.date !== date ? media.date : ''),
    };
  });
  const [error, setError] = useState('');
  const save = async () => {
    const date = m.date_precision === 'year' && /^\d{1,4}$/.test(m.date) ? m.date.padStart(4, '0') : m.date;
    const span = dateSpan(date);
    if (date && (!span || span.precision !== m.date_precision))
      return setError('Проверьте дату и выбранную точность.');
    const hasLat = m.latitude !== null && m.latitude !== undefined,
      hasLon = m.longitude !== null && m.longitude !== undefined;
    if (
      hasLat !== hasLon ||
      (hasLat &&
        (!Number.isFinite(m.latitude) ||
          !Number.isFinite(m.longitude) ||
          Math.abs(m.latitude) > 90 ||
          Math.abs(m.longitude) > 180))
    )
      return setError('Укажите широту и долготу в допустимых пределах.');
    setError('');
    const saved = await run(async () => {
      await api('save', {
        kind: 'media',
        record: { ...m, date },
        title: 'Изменены дата, место и подпись материала',
      });
      return true;
    }, 'Сведения сохранены');
    if (saved) onClose();
  };
  return (
    <Modal title="Дата, место и комментарий" onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          <Field label="Название" wide>
            <input value={m.title || ''} onChange={(e) => setM({ ...m, title: e.target.value })} />
          </Field>
          <Field label="Раздел" wide>
            <select
              value={m.kind || (m.mime?.startsWith('image/') ? 'photo' : 'document')}
              onChange={(e) => setM({ ...m, kind: e.target.value })}
            >
              <option value="photo" disabled={!m.mime?.startsWith('image/')}>
                Фотоальбом
              </option>
              <option value="document">Документы</option>
            </select>
          </Field>
          <Field label="Точность даты">
            <select
              value={m.date_precision}
              onChange={(e) => {
                const precision = e.target.value;
                const length = precision === 'day' ? 10 : precision === 'month' ? 7 : 4;
                setM({
                  ...m,
                  date_precision: precision,
                  date: m.date.length >= length ? m.date.slice(0, length) : '',
                });
              }}
            >
              <option value="day">Точный день</option>
              <option value="month">Известны месяц и год</option>
              <option value="year">Известен только год</option>
            </select>
          </Field>
          <Field
            label={m.date_precision === 'day' ? 'Дата' : m.date_precision === 'month' ? 'Месяц и год' : 'Год'}
          >
            <input
              type={m.date_precision === 'day' ? 'date' : m.date_precision === 'month' ? 'month' : 'number'}
              min={m.date_precision === 'day' ? '0001-01-01' : m.date_precision === 'month' ? '0001-01' : '1'}
              max={
                m.date_precision === 'day' ? '9999-12-31' : m.date_precision === 'month' ? '9999-12' : '9999'
              }
              value={m.date}
              onChange={(e) => setM({ ...m, date: e.target.value })}
            />
          </Field>
          {m.date_source_text && (
            <p className="full muted">Исходная подпись даты сохранена: {m.date_source_text}</p>
          )}
          <LocationEditor value={m} onChange={(value) => setM(value as typeof m)} />
          <Field label="Описание" wide>
            <textarea
              rows={6}
              value={m.description || ''}
              onChange={(e) => setM({ ...m, description: e.target.value })}
            />
          </Field>
          <Field label="Комментарий" wide>
            <textarea
              rows={3}
              placeholder="Ваши заметки о фотографии или документе"
              value={m.comment || ''}
              onChange={(e) => setM({ ...m, comment: e.target.value })}
            />
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" type="submit" disabled={busy}>
            Сохранить
          </button>
        </footer>
      </form>
    </Modal>
  );
}
