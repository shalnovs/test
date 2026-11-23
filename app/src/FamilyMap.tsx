import { useEffect, useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import { useArchive } from './context';
import { familyEvents } from './eventData';
import { Empty } from './components';
import { api, type Item } from './api';
import { materialPlaces, isPhoto } from './materials';

export { eventPoint, findPlaces, type MapPoint } from './placeData';
import { eventPoint, findPlaces, placeKey, type MapPoint } from './placeData';
export { MapCanvas } from './MapCanvas';
import { MapCanvas } from './MapCanvas';
export type Settlement = {
  name: string;
  lat: number;
  lon: number;
  country: string;
  region?: string;
  district?: string;
  kind?: string;
  id?: number;
};
export function PlaceSearch({ onChoose }: { onChoose: (p: Settlement) => void }) {
  const { archive } = useArchive();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Settlement[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const known: Settlement[] = [...archive.data.media, ...(archive.data.events || [])]
    .filter((m) => m.place && typeof m.latitude === 'number' && typeof m.longitude === 'number')
    .map((m) => ({ name: m.place, lat: m.latitude, lon: m.longitude, country: 'Место из семейного архива' }));
  const local: Settlement[] = [
    ...known.filter(
      (p) =>
        query.trim().length > 1 &&
        query
          .toLowerCase()
          .split(/\s+/)
          .every((q) => p.name.toLowerCase().includes(q)),
    ),
    ...findPlaces(query),
  ];
  const matches = [...results, ...local]
    .filter((p, i, all) => all.findIndex((x) => x.lat === p.lat && x.lon === p.lon) === i)
    .slice(0, 40);
  useEffect(() => {
    let live = true;
    setResults([]);
    setError('');
    if (query.trim().length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(
      () =>
        api<Settlement[]>('search_places', { query })
          .then((rows) => {
            if (live) setResults(Array.isArray(rows) ? rows : []);
          })
          .catch(() => {
            if (live)
              setError('Полный справочник недоступен. Проверьте наличие places.sqlite рядом с программой.');
          })
          .finally(() => {
            if (live) setLoading(false);
          }),
      200,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  return (
    <div className="place-search">
      <label className="search">
        <Search size={16} />
        <input
          aria-label="Найти город, село или деревню"
          placeholder="Город, село, деревня — можно добавить район…"
          maxLength={160}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (matches[0]) {
                onChoose(matches[0]);
                setQuery('');
              }
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
      </label>
      {query && (
        <div className="place-results">
          {matches.map((p) => (
            <button
              type="button"
              key={`${p.lat}:${p.lon}`}
              onClick={() => {
                onChoose(p);
                setQuery('');
              }}
            >
              <MapPin size={15} />
              <span>
                {p.name}
                <small>{[p.kind, p.district, p.region, p.country].filter(Boolean).join(' · ')}</small>
              </span>
            </button>
          ))}
          {loading && <p role="status">Поиск в справочнике…</p>}
          {error && <p role="status">{error}</p>}
          {!loading && !matches.length && (
            <p>
              {query.trim().length < 2
                ? 'Введите хотя бы две буквы.'
                : 'Населённый пункт не найден. Уточните район или выберите точку на карте вручную.'}
            </p>
          )}
        </div>
      )}
      <small className="place-attribution">
        Локальный справочник{' '}
        <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">
          GeoNames
        </a>{' '}
        ·{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
          CC BY 4.0
        </a>
      </small>
    </div>
  );
}
export function FamilyMap() {
  const { archive, event: openEvent, browse } = useArchive();
  const [selected, setSelected] = useState(''),
    [query, setQuery] = useState(''),
    [center, setCenter] = useState<[number, number]>();
  const groups = materialPlaces(archive.data, query);
  const points = groups.flatMap((g) =>
    g.point
      ? [
          {
            ...g.point,
            title: `${g.title} · ${g.events.length} событий, ${g.photos.length} фото, ${g.documents.length} документов`,
          },
        ]
      : [],
  );
  const choose = (key: string) => {
    const group = groups.find((g) => g.key === key);
    if (!group) return;
    setSelected(key);
    browse?.({ kind: 'place', key, title: group.title, query });
  };
  const missingEvents = familyEvents(archive.data).filter((e) => !placeKey(e));
  const missingPhotos = archive.data.media.filter(isPhoto).filter((m) => !placeKey(m));
  const missingDocuments = archive.data.media.filter((m) => !isPhoto(m) && !placeKey(m));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ГЕОГРАФИЯ СЕМЬИ</div>
          <h1>Карта</h1>
          <p>Места жизни, семейные события и фотографии</p>
        </div>
        <button className="primary" onClick={() => openEvent?.('new')}>
          <MapPin size={17} />
          Добавить событие
        </button>
      </div>
      <div className="map-page-layout">
        <section>
          <PlaceSearch
            onChoose={(p) => {
              setCenter([p.lat, p.lon]);
              const key = placeKey({ id: 'city', latitude: p.lat, longitude: p.lon });
              if (groups.some((g) => g.key === key)) choose(key);
            }}
          />
          <MapCanvas points={points} selected={selected} center={center} onSelect={choose} />
          <p className="muted">
            Нажмите на место: откроются события, фотографии и документы. Для названия города без координат
            используется его однозначно найденный центр.
          </p>
        </section>
        <aside className="map-event-list">
          <input
            aria-label="Найти материалы на карте"
            placeholder="Место, событие, фото или человек…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <small>
            {points.length} мест на карте · {groups.length - points.length} мест требуют уточнения точки
          </small>
          {groups.map((g) => (
            <button
              key={g.key}
              className={`map-event-row ${selected === g.key ? 'selected' : ''}`}
              onClick={() => choose(g.key)}
            >
              <MapPin size={19} />
              <span>
                <strong>{g.title}</strong>
                <small>
                  {g.events.length} событий · {g.photos.length} фотографий · {g.documents.length} документов
                  {!g.point ? ' · без точки на карте' : ''}
                </small>
              </span>
            </button>
          ))}
          {!groups.length && <Empty>Укажите место в фотографии или событии — оно появится здесь.</Empty>}
          <details className="unlocated-materials">
            <summary>
              Без места: {missingEvents.length} событий, {missingPhotos.length} фотографий,{' '}
              {missingDocuments.length} документов
            </summary>
            {missingEvents.map((e) => (
              <button key={'event:' + e.id} onClick={() => openEvent?.(e.id)}>
                {e.title}
              </button>
            ))}
            {[...missingPhotos, ...missingDocuments].map((m) => (
              <UnlocatedPhoto key={m.id} media={m} />
            ))}
          </details>
        </aside>
      </div>
    </>
  );
}
function UnlocatedPhoto({ media }: { media: Item }) {
  const { photo } = useArchive();
  return <button onClick={() => photo(media.id)}>{media.title}</button>;
}
