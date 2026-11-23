import { useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Images,
  FileText,
  MapPin,
  Plus,
  Edit3,
  Trash2,
  X,
} from 'lucide-react';
import { api, dateLabel, fullName, type Item } from './api';
import { useArchive } from './context';
import { Empty, Field, MediaImage, Modal } from './components';
import { PersonSearch } from './PersonSearch';
import { MediaPicker } from './MediaPicker';
import { MapCanvas, PlaceSearch, eventPoint, type MapPoint } from './FamilyMap';
import { familyEvents, eventsForRange, familyEventById } from './eventData';
import {
  selectMaterials,
  mediaSpan,
  mediaDateLabel,
  dateSelection,
  placeSelection,
  isPhoto,
} from './materials';
import { dateSpan, eventSpan, historicalDate, monthDays, type DateSpan } from './eventDates';

export const eventPeriod = (e: Item) =>
  e.start_date
    ? `${dateLabel(e.start_date)}${e.end_date ? ' — ' + dateLabel(e.end_date) : ''}`
    : e.date_text || 'Дата не указана';
const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};
export function Events({ calendar = false }: { calendar?: boolean }) {
  const { archive, event: openEvent, photo, browse } = useArchive();
  const [query, setQuery] = useState(''),
    [pid, setPid] = useState('');
  const [month, setMonth] = useState(currentMonth);
  const all = calendar ? eventsForRange(archive.data, dateSpan(month)) : familyEvents(archive.data);
  const matches = (e: Item) =>
    (!pid || e.person_ids?.includes(pid)) &&
    `${e.title} ${e.description} ${e.place}`.toLowerCase().includes(query.toLowerCase());
  const events = all
    .filter(matches)
    .sort((a, b) => (eventSpan(b)?.start || '').localeCompare(eventSpan(a)?.start || ''));
  const photos = archive.data.media.filter(
    (m) =>
      isPhoto(m) &&
      (!pid || archive.data.tags.some((t) => t.media_id === m.id && t.person_id === pid)) &&
      `${m.title} ${m.description} ${m.place}`.toLowerCase().includes(query.toLowerCase()),
  );
  const [day, setDay] = useState('');
  const days = monthDays(month);
  const selectedMaterials = selectMaterials(archive.data, {
    kind: 'date',
    value: day || month,
    personId: pid,
    query,
  });
  const showEvents = selectedMaterials.events,
    showPhotos = selectedMaterials.photos,
    showDocuments = selectedMaterials.documents;
  const shift = (step: number) => {
    const [y, m] = month.split('-').map(Number);
    const next = new Date(0);
    next.setUTCFullYear(y, m - 1 + step, 1);
    if (next.getUTCFullYear() < 1 || next.getUTCFullYear() > 9999) return;
    setMonth(next.toISOString().slice(0, 7));
    setDay('');
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ХРОНИКА СЕМЬИ</div>
          <h1>{calendar ? 'Календарь' : 'События'}</h1>
          <p>
            {calendar ? 'Фотографии и события по датам' : 'История семьи: периоды, места, люди и фотографии'}
          </p>
        </div>
        <button className="primary" onClick={() => openEvent?.('new')}>
          <Plus size={18} />
          Добавить событие
        </button>
      </div>
      <div className="toolbar wrap">
        <input
          aria-label="Поиск событий"
          placeholder="Событие, место или описание…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <PersonSearch value={pid} onChange={setPid} empty="События человека" />
        <span className="muted">{events.length} событий</span>
      </div>
      {calendar && (
        <>
          <div className="calendar-toolbar">
            <button title="Предыдущий месяц" onClick={() => shift(-1)}>
              <ChevronLeft size={18} />
            </button>
            <input
              aria-label="Месяц календаря"
              type="month"
              value={month}
              onChange={(e) => {
                if (dateSpan(e.target.value)) {
                  setMonth(e.target.value);
                  setDay('');
                }
              }}
            />
            <button title="Следующий месяц" onClick={() => shift(1)}>
              <ChevronRight size={18} />
            </button>
            <button
              onClick={() => {
                setMonth(currentMonth());
                setDay('');
              }}
            >
              Сегодня
            </button>
            {day && <button onClick={() => setDay('')}>Весь месяц</button>}
          </div>
          <div className="calendar-grid" role="grid" aria-label="Календарь событий и фотографий">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((x) => (
              <div role="columnheader" className="calendar-weekday" key={x}>
                {x}
              </div>
            ))}
            {days.map((d) => {
              const {
                events: es,
                photos: ps,
                documents: docs,
              } = selectMaterials(archive.data, {
                kind: 'date',
                value: d,
                personId: pid,
                query,
              });
              const cover =
                ps[0]?.id ||
                es.find((e) => e.cover_media_id || e.media_ids?.length)?.cover_media_id ||
                es.find((e) => e.media_ids?.length)?.media_ids[0];
              return (
                <button
                  key={d}
                  role="gridcell"
                  aria-selected={day === d}
                  aria-label={`${dateLabel(d)}: событий ${es.length}, фотографий ${ps.length}${docs.length ? `, документов ${docs.length}` : ''}`}
                  className={`calendar-day ${d.startsWith(month) ? '' : 'outside'} ${day === d ? 'selected' : ''}`}
                  onClick={() => {
                    if (!d.startsWith(month)) setMonth(d.slice(0, 7));
                    setDay(d);
                    browse?.({ kind: 'date', value: d, personId: pid, query });
                  }}
                >
                  <span>{Number(d.slice(-2))}</span>
                  {cover && <MediaImage id={cover} alt="Фото этого дня" />}
                  {!!es.length && (
                    <small>
                      <CalendarDays size={11} />
                      {es.length}
                    </small>
                  )}
                  {!!ps.length && (
                    <small>
                      <Images size={11} />
                      {ps.length}
                    </small>
                  )}
                  {!!docs.length && (
                    <small>
                      <FileText size={11} />
                      {docs.length}
                    </small>
                  )}
                </button>
              );
            })}
          </div>
          <p className="muted">
            В календаре учтены рождения, смерти, дни рождения, юбилеи и годовщины. Если известны только месяц
            или год, точный день не придумывается.
          </p>
          <div className="section-title">
            <h2>{day ? dateLabel(day) : 'В выбранном месяце'}</h2>
            <span>
              {showEvents.length} событий · {showPhotos.length} фотографий · {showDocuments.length} документов
            </span>
          </div>
        </>
      )}
      <div className="event-grid">
        {(calendar ? showEvents : events).map((e) => (
          <button key={e.id} className="event-card" onClick={() => openEvent?.(e.id)}>
            {e.cover_media_id || e.media_ids?.[0] ? (
              <MediaImage id={e.cover_media_id || e.media_ids[0]} alt={e.title} />
            ) : (
              <div className="event-cover-empty">
                <CalendarDays size={30} />
              </div>
            )}
            <div>
              <small>{eventPeriod(e)}</small>
              <h3>{e.title}</h3>
              {e.anniversary && (
                <small className="anniversary-badge">{e.jubilee ? 'Юбилейная дата' : 'Ежегодная дата'}</small>
              )}
              {e.place && (
                <p>
                  <MapPin size={13} />
                  {e.place}
                </p>
              )}
              <p>{e.description?.slice(0, 160)}</p>
              <small>
                {e.person_ids
                  ?.map((id: string) => fullName(archive.data.people.find((p) => p.id === id)))
                  .join(' · ')}
              </small>
            </div>
          </button>
        ))}
      </div>
      {calendar && (
        <div className="calendar-photos">
          {[...showPhotos, ...showDocuments].map((m) => (
            <button key={m.id} onClick={() => photo(m.id)}>
              {m.mime?.startsWith('image/') ? (
                <MediaImage id={m.id} alt={m.title} />
              ) : (
                <div className="related-file-cover">
                  <FileText size={30} />
                  <small>{m.filename}</small>
                </div>
              )}
              <span>{m.title}</span>
              <small>{mediaDateLabel(m)}</small>
              {(m.comment || m.description) && (
                <p className="material-description">{m.comment || m.description}</p>
              )}
            </button>
          ))}
        </div>
      )}
      {!(calendar ? showEvents.length + showPhotos.length + showDocuments.length : events.length) && (
        <Empty>
          {calendar
            ? 'В этом периоде пока нет материалов. Выберите другой месяц или добавьте событие.'
            : 'События не найдены.'}
        </Empty>
      )}
      {calendar && (
        <details className="undated-events">
          <summary>
            Без даты: {events.filter((e) => !eventSpan(e)).length} событий,{' '}
            {photos.filter((m) => !historicalDate(m.date || '')).length} фотографий
          </summary>
          {events
            .filter((e) => !eventSpan(e))
            .map((e) => (
              <button key={e.id} onClick={() => openEvent?.(e.id)}>
                {e.title}
              </button>
            ))}
          {photos
            .filter((m) => !historicalDate(m.date || ''))
            .map((m) => (
              <button key={m.id} onClick={() => photo(m.id)}>
                {m.title}
              </button>
            ))}
        </details>
      )}
    </>
  );
}

export function EventPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { archive, run, person, photo, busy, browse } = useArchive();
  const original = familyEventById(archive.data, id);
  const [editing, setEditing] = useState(id === 'new');
  if (editing) return <EventForm original={original} onClose={onClose} />;
  if (!original) return null;
  const e = original;
  const point = eventPoint(e);
  return (
    <Modal title={e.title} onClose={onClose} wide>
      <div className="event-detail">
        <section>
          <button
            className="event-period metadata-link"
            disabled={!dateSelection(e, true)}
            onClick={() => {
              const selection = dateSelection(e, true);
              if (selection) browse?.(selection);
            }}
          >
            <CalendarDays size={18} />
            {eventPeriod(e)}
          </button>
          <button
            className="event-place metadata-link"
            disabled={!placeSelection(e)}
            onClick={() => {
              const selection = placeSelection(e);
              if (selection) browse?.(selection);
            }}
          >
            <MapPin size={17} />
            {e.place || 'Место не указано'}
          </button>
          <p className="event-description">{e.description}</p>
          <div className="event-people">
            {(e.person_ids || []).map((p: string) => (
              <button
                key={p}
                onClick={() => {
                  onClose();
                  person(p);
                }}
              >
                {fullName(archive.data.people.find((x) => x.id === p))}
              </button>
            ))}
          </div>
          <div className="calendar-photos">
            {(e.media_ids || []).map((m: string) => (
              <button
                key={m}
                onClick={() => {
                  onClose();
                  photo(m);
                }}
              >
                <MediaImage
                  id={m}
                  alt={archive.data.media.find((x) => x.id === m)?.title || 'Фото события'}
                />
              </button>
            ))}
          </div>
          {e.source_id && (
            <small className="muted">
              Источник: {archive.data.sources.find((s) => s.id === e.source_id)?.title || 'Исходный архив'}
            </small>
          )}
        </section>
        {point && (
          <MapCanvas
            points={[point]}
            onSelect={() => {
              const selection = placeSelection(e);
              if (selection) browse?.(selection);
            }}
          />
        )}
      </div>
      <footer className="modal-footer">
        {e.generated ? (
          <button
            className="primary"
            onClick={() => {
              onClose();
              person(e.source_person_id);
            }}
          >
            Открыть карточку человека
          </button>
        ) : (
          <>
            <button
              className="danger-on-hover"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Удалить событие? Действие можно отменить в истории.'))
                  void run(async () => {
                    if (e.legacy_fact_id)
                      await api('save', {
                        kind: 'events',
                        record: { ...e, hidden: true },
                        title: 'Скрыто событие из исходного архива',
                      });
                    else await api('remove', { kind: 'events', id: e.id });
                    onClose();
                  }, 'Событие удалено');
              }}
            >
              <Trash2 size={16} />
              Удалить
            </button>
            <button className="primary" onClick={() => setEditing(true)}>
              <Edit3 size={16} />
              Изменить событие
            </button>
          </>
        )}
      </footer>
    </Modal>
  );
}

export function EventForm({ original, onClose }: { original?: Item; onClose: () => void }) {
  const { archive, run, busy } = useArchive();
  const [e, setE] = useState<any>(() =>
    original
      ? {
          ...original,
          person_ids: [...(original.person_ids || [])],
          media_ids: [...(original.media_ids || [])],
        }
      : {
          title: '',
          description: '',
          start_date: '',
          end_date: '',
          place: '',
          person_ids: [],
          media_ids: [],
          latitude: null,
          longitude: null,
          cover_media_id: '',
        },
  );
  const [mediaOpen, setMediaOpen] = useState(false),
    [error, setError] = useState(''),
    [mapOpen, setMapOpen] = useState(false),
    [center, setCenter] = useState<[number, number]>();
  const set = (key: string, value: any) => setE((prev: any) => ({ ...prev, [key]: value }));
  const point: MapPoint[] =
    typeof e.latitude === 'number' && typeof e.longitude === 'number'
      ? [{ id: 'chosen', title: e.place || 'Место события', lat: e.latitude, lon: e.longitude }]
      : [];
  const save = async () => {
    if (!e.title.trim()) return setError('Укажите заголовок события.');
    if ((e.start_date && !dateSpan(e.start_date)) || (e.end_date && !dateSpan(e.end_date)))
      return setError('Проверьте даты: ГГГГ, ГГГГ-ММ или ГГГГ-ММ-ДД.');
    if (e.end_date && (!e.start_date || dateSpan(e.end_date)!.end < dateSpan(e.start_date)!.start))
      return setError('Окончание не может быть раньше начала.');
    setError('');
    const ok = await run(async () => {
      await api('save', {
        kind: 'events',
        record: {
          ...e,
          cover_media_id: e.media_ids.includes(e.cover_media_id) ? e.cover_media_id : e.media_ids[0] || '',
        },
        title: original ? 'Изменено событие' : 'Добавлено событие',
      });
      return true;
    }, 'Событие сохранено');
    if (ok) onClose();
  };
  return (
    <Modal title={original ? 'Изменить событие' : 'Новое событие'} onClose={onClose} wide>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void save();
        }}
      >
        <div className="form-grid">
          <Field label="Заголовок" wide>
            <input autoFocus value={e.title} onChange={(ev) => set('title', ev.target.value)} />
          </Field>
          <Field label="Начало">
            <input
              placeholder="ГГГГ-ММ-ДД, месяц или год"
              value={e.start_date || ''}
              onChange={(ev) => set('start_date', ev.target.value)}
            />
          </Field>
          <Field label="Окончание">
            <input
              placeholder="Для события в один день оставьте пустым"
              value={e.end_date || ''}
              onChange={(ev) => set('end_date', ev.target.value)}
            />
          </Field>
          {e.date_text && <p className="full muted">Дата в источнике: {e.date_text}</p>}
          <Field label="Место события" wide>
            <input
              placeholder="Город, адрес, название места…"
              value={e.place}
              onChange={(ev) => {
                set('place', ev.target.value);
                set('latitude', null);
                set('longitude', null);
              }}
            />
          </Field>
          <div className="full">
            <button type="button" onClick={() => setMapOpen(!mapOpen)}>
              <MapPin size={17} />
              {mapOpen ? 'Свернуть карту' : 'Указать место на карте'}
            </button>
            {mapOpen && (
              <div className="event-location-editor">
                <PlaceSearch
                  onChoose={(p) => {
                    setE((prev: any) => ({
                      ...prev,
                      place: [p.name, p.district, p.region, p.id ? p.country : ''].filter(Boolean).join(', '),
                      latitude: p.lat,
                      longitude: p.lon,
                      location_precision: 'settlement',
                    }));
                    setCenter([p.lat, p.lon]);
                  }}
                />
                <MapCanvas
                  points={point}
                  center={center}
                  onPick={(lat, lon) => {
                    setE((prev: any) => ({
                      ...prev,
                      latitude: +lat.toFixed(6),
                      longitude: +lon.toFixed(6),
                      location_precision: 'point',
                    }));
                  }}
                />
                <div className="coordinate-fields">
                  <Field label="Широта">
                    <input
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      value={e.latitude ?? ''}
                      onChange={(ev) => {
                        set('latitude', ev.target.value === '' ? null : Number(ev.target.value));
                        set('location_precision', 'point');
                      }}
                    />
                  </Field>
                  <Field label="Долгота">
                    <input
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      value={e.longitude ?? ''}
                      onChange={(ev) => {
                        set('longitude', ev.target.value === '' ? null : Number(ev.target.value));
                        set('location_precision', 'point');
                      }}
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() => {
                      set('latitude', null);
                      set('longitude', null);
                    }}
                  >
                    Убрать точку
                  </button>
                </div>
                <small>Город выбирается по его центру. Для точного места нажмите на карту.</small>
              </div>
            )}
          </div>
          <Field label="Описание" wide>
            <textarea rows={5} value={e.description} onChange={(ev) => set('description', ev.target.value)} />
          </Field>
          <div className="full field">
            <span>Участники</span>
            <PersonSearch
              value=""
              onChange={(id) => id && set('person_ids', [...e.person_ids, id])}
              exclude={e.person_ids}
              empty="Добавить участника"
            />
            <div className="event-people">
              {e.person_ids.map((id: string) => (
                <span key={id}>
                  {fullName(archive.data.people.find((p) => p.id === id))}
                  <button
                    type="button"
                    aria-label="Убрать участника"
                    onClick={() =>
                      set(
                        'person_ids',
                        e.person_ids.filter((p: string) => p !== id),
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="full">
            <div className="section-title">
              <h3>Фотографии</h3>
              <button type="button" onClick={() => setMediaOpen(true)}>
                <Images size={17} />
                Выбрать фотографии
              </button>
            </div>
            <div className="event-photo-edit">
              {e.media_ids.map((id: string) => (
                <article key={id}>
                  <button
                    type="button"
                    title="Сделать главным фото события"
                    aria-pressed={e.cover_media_id === id || (!e.cover_media_id && e.media_ids[0] === id)}
                    onClick={() => set('cover_media_id', id)}
                  >
                    <MediaImage
                      id={id}
                      alt={archive.data.media.find((m) => m.id === id)?.title || 'Фотография'}
                    />
                    <span>
                      {e.cover_media_id === id || (!e.cover_media_id && e.media_ids[0] === id)
                        ? 'Главное фото'
                        : 'Сделать главным'}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="Убрать фото из события"
                    className="icon-button"
                    onClick={() =>
                      set(
                        'media_ids',
                        e.media_ids.filter((m: string) => m !== id),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </article>
              ))}
            </div>
          </div>
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
          <button type="submit" className="primary" disabled={busy}>
            Сохранить событие
          </button>
        </footer>
      </form>
      {mediaOpen && (
        <MediaPicker
          selected={e.media_ids}
          onClose={() => setMediaOpen(false)}
          onChoose={(ids) => {
            set('media_ids', ids);
            setMediaOpen(false);
          }}
        />
      )}
    </Modal>
  );
}
