import { useEffect, useRef, useState } from 'react';
import {
  ScanFace,
  Search,
  Check,
  Square,
  CheckSquare,
  WandSparkles,
  ArrowUpRight,
  LoaderCircle,
} from 'lucide-react';
import { api, fullName, type Item } from './api';
import { useArchive } from './context';
import { Empty, MediaImage, Modal } from './components';
import { PersonSearch } from './PersonSearch';
import { FACE_VERSION, scanFaces } from './faceRecognition';
type Results = {
  faces: Item[];
  automatic: Item[];
  groups: Item[][];
  people: { id: string; examples: number }[];
  indexed_faces: number;
  indexed_photos: number;
};
const blank: Results = {
  faces: [],
  automatic: [],
  groups: [],
  people: [],
  indexed_faces: 0,
  indexed_photos: 0,
};
export function Faces() {
  const { archive, run, busy, photo } = useArchive();
  const [person, setPerson] = useState(''),
    [mode, setMode] = useState<'person' | 'groups' | 'automatic'>('groups'),
    [threshold, setThreshold] = useState(0.56);
  const [results, setResults] = useState<Results>(blank),
    [selected, setSelected] = useState<string[]>([]),
    [group, setGroup] = useState(-1),
    [working, setWorking] = useState(false),
    [loading, setLoading] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState(''),
    [outcome, setOutcome] = useState(''),
    [failures, setFailures] = useState<{ id: string; title: string }[]>([]);
  const cancel = useRef(false),
    alive = useRef(true),
    request = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      cancel.current = true;
      alive.current = false;
    };
  }, []);
  const refresh = async () => {
    const sequence = ++request.current;
    setLoading(true);
    try {
      const value = await api<Results>('face_matches', {
        version: FACE_VERSION,
        person_id: person,
        threshold,
        groups: mode === 'groups',
      });
      if (alive.current && sequence === request.current) {
        setResults(value);
        setError('');
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current && sequence === request.current) setLoading(false);
    }
  };
  useEffect(() => {
    setSelected([]);
    setGroup(-1);
  }, [archive, threshold, mode]);
  useEffect(() => {
    if (mode === 'person') setSelected([]);
    void refresh();
  }, [archive, person, threshold, mode]);
  const scan = async () => {
    cancel.current = false;
    setWorking(true);
    setError('');
    setOutcome('');
    setProgress('Подготавливаем локальное распознавание…');
    try {
      const r = await scanFaces(
        archive,
        cancel,
        (n, total, title) => alive.current && setProgress(`${n} из ${total} · ${title}`),
      );
      if (alive.current) {
        setFailures(r.failures);
        setProgress(
          r.cancelled
            ? 'Обработка остановлена. Сохранённые результаты будут использованы при следующем запуске.'
            : `Обработано фотографий: ${r.done}`,
        );
        await refresh();
      }
    } catch (e) {
      if (alive.current) setError('Не удалось запустить распознавание: ' + String(e));
    } finally {
      if (alive.current) setWorking(false);
    }
  };
  const apply = async (automatic = false) => {
    setOutcome('');
    const value = await run(
      () =>
        api('face_tag_batch', {
          version: FACE_VERSION,
          tree_id: archive.tree_id,
          mode: automatic ? 'auto' : 'review',
          person_id: person,
          face_ids: selected,
        }),
      'Разметка сохранена',
    );
    if (value && alive.current) {
      setOutcome(
        `Новых отметок: ${value.assigned}. Подтверждено: ${value.confirmed}.${value.conflicts ? ` Пропущено конфликтующих отметок: ${value.conflicts}.` : ''} Изменение можно отменить в истории.`,
      );
      setSelected([]);
      await refresh();
    }
  };
  const list =
    mode === 'groups'
      ? results.groups[group] || []
      : mode === 'automatic'
        ? results.automatic
        : results.faces;
  const review = (
    <>
      {mode === 'automatic' ? (
        <div className="batch-face-toolbar">
          <p>
            Будут подписаны только уверенные совпадения с достаточным числом примеров. Проверьте результат;
            автоматические отметки можно подтвердить в поиске человека или отменить через историю.
          </p>
          <button className="primary" disabled={busy || working || !list.length} onClick={() => apply(true)}>
            <WandSparkles size={17} />
            Автоотметить уверенные ({list.length})
          </button>
        </div>
      ) : (
        !!list.length && (
          <div className="batch-face-toolbar">
            <button disabled={working || busy} onClick={() => setSelected(list.map((f) => f.id))}>
              <CheckSquare size={16} />
              Выбрать все {list.length}
            </button>
            <button disabled={!selected.length || working || busy} onClick={() => setSelected([])}>
              <Square size={16} />
              Снять выбор
            </button>
            <button
              className="primary"
              disabled={!person || !selected.length || busy || working}
              onClick={() => apply()}
            >
              <Check size={17} />
              Указать человека на выбранных ({selected.length})
            </button>
            <small>
              {person
                ? `Будет указан: ${fullName(archive.data.people.find((p) => p.id === person))}`
                : 'Выберите человека в поле «Кто это?»'}
            </small>
          </div>
        )
      )}
      {loading && <p className="muted">Сопоставляем лица…</p>}
      <div className="face-results">
        {list.map((face) => {
          const media = archive.data.media.find((m) => m.id === face.media_id);
          const name = face.suggested_person_id
            ? fullName(archive.data.people.find((p) => p.id === face.suggested_person_id))
            : '';
          return (
            <article
              key={face.id}
              className={`${selected.includes(face.id) ? 'selected' : ''} ${face.known ? 'known' : ''}`}
            >
              <button
                className="face-crop"
                aria-label={`Выбрать лицо на фото: ${media?.title}`}
                disabled={mode === 'automatic' || working || busy}
                aria-pressed={selected.includes(face.id)}
                onClick={() =>
                  setSelected(
                    selected.includes(face.id)
                      ? selected.filter((id) => id !== face.id)
                      : [...selected, face.id],
                  )
                }
              >
                <MediaImage id={face.media_id} alt="Найденное лицо" crop={face as any} />
                {selected.includes(face.id) && <Check className="face-selected" size={23} />}
              </button>
              <span className={`face-match-label ${face.strong ? 'strong' : ''}`}>
                {face.known
                  ? face.confirmed
                    ? 'Уже подтверждён'
                    : 'Автоотметка · проверьте'
                  : face.strong
                    ? 'Высокое сходство'
                    : 'Проверьте совпадение'}
              </span>
              {name && <strong>{name}</strong>}
              <p>{media?.title}</p>
              <small>{media?.date}</small>
              <button className="text-button" onClick={() => photo(face.media_id)}>
                Открыть фотографию
                <ArrowUpRight size={14} />
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
  const references = results.people.find((p) => p.id === person)?.examples || 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ЛЮДИ НА СНИМКАХ</div>
          <h1>Поиск лиц</h1>
          <p>Найдите одного человека во всём альбоме и отметьте выбранные снимки вместе</p>
        </div>
        <button className="primary" disabled={working || busy} onClick={scan}>
          <ScanFace size={18} />
          Обработать фотоальбом
        </button>
      </div>
      <div className="face-index-summary">
        <div>
          <strong>{results.indexed_faces}</strong>
          <span>лиц в локальной базе</span>
        </div>
        <div>
          <strong>{results.people.length}</strong>
          <span>людей с подтверждёнными примерами</span>
        </div>
        <p>
          Программа сравнивает лица с вашими отметками. Для автоматической подписи нужны как минимум два
          подтверждённых фото человека. Автоматические отметки становятся примерами только после вашего
          подтверждения.
        </p>
      </div>
      {(working || progress) && (
        <div className="scan-progress" role="status">
          {working && <LoaderCircle className="spin" size={18} />}
          <span>{progress}</span>
          {working && (
            <button
              onClick={() => {
                cancel.current = true;
              }}
            >
              Остановить
            </button>
          )}
        </div>
      )}
      {failures.length > 0 && (
        <details className="scan-failures">
          <summary>Не удалось обработать {failures.length} файлов</summary>
          {failures.map((f) => (
            <button key={f.id} onClick={() => photo(f.id)}>
              {f.title}
            </button>
          ))}
        </details>
      )}
      <div className="segmented face-tabs">
        {(
          [
            ['person', 'Поиск человека'],
            ['groups', 'Группы похожих лиц'],
            ['automatic', 'Автоматические предложения'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} disabled={working} aria-pressed={mode === key} onClick={() => setMode(key)}>
            {label}
            {key === 'automatic' ? ` · ${results.automatic.length}` : ''}
          </button>
        ))}
      </div>
      {mode === 'person' && (
        <div className="toolbar wrap">
          <PersonSearch
            value={person}
            onChange={setPerson}
            empty="Кого ищем во всех фотографиях"
            disabled={working}
          />
          {mode === 'person' && (
            <select
              aria-label="Широта поиска похожих лиц"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            >
              <option value={0.48}>Более точные совпадения</option>
              <option value={0.56}>Обычный поиск</option>
              <option value={0.63}>Больше похожих лиц</option>
            </select>
          )}
          {person && mode === 'person' && (
            <span className="muted">Подтверждённых фото для сравнения: {references}</span>
          )}
        </div>
      )}
      {person && mode === 'person' && !references && (
        <div className="notice">
          Сначала выделите этого человека рамкой на знакомой фотографии. Старые подписи без рамки не задают
          образец лица. После разметки нажмите «Обработать фотоальбом».
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {outcome && (
        <p className="notice" role="status">
          {outcome}
        </p>
      )}
      {mode === 'groups' && (
        <div className="face-group-list">
          {results.groups.map((items, i) => (
            <button
              key={items[0].id}
              aria-label={`Просмотреть группу ${i + 1}: ${items.length} лиц`}
              aria-pressed={group === i}
              onClick={() => {
                setGroup(i);
                setSelected(items.map((f) => f.id));
                setPerson('');
              }}
            >
              <div className="face-group-samples">
                {items.slice(0, 4).map((f) => (
                  <MediaImage key={f.id} id={f.media_id} alt="Лицо в группе" crop={f as any} />
                ))}
              </div>
              <span>
                Группа {i + 1}
                <small>
                  {items.length} лиц · {new Set(items.map((f) => f.media_id)).size} фото
                </small>
                <b className="face-group-open">Просмотреть группу →</b>
              </span>
            </button>
          ))}
        </div>
      )}
      {mode === 'groups'
        ? group >= 0 && (
            <Modal title={`Группа ${group + 1} · ${list.length} лиц`} onClose={() => setGroup(-1)} wide>
              <div className="face-group-review">
                <p>
                  Просмотрите все лица. Снимите выбор с ошибочных совпадений, выберите человека и сохраните
                  отметки одним действием.
                </p>
                <label className="face-owner-label">Кто это?</label>
                <PersonSearch
                  value={person}
                  onChange={setPerson}
                  empty="Кто в выбранной группе"
                  disabled={working || busy}
                />
                {review}
              </div>
            </Modal>
          )
        : review}
      {!loading && !list.length && (
        <Empty>
          {!results.indexed_faces
            ? 'Обработайте фотоальбом, чтобы создать базу лиц.'
            : mode === 'person' && !person
              ? 'Выберите человека для поиска.'
              : mode === 'groups' && group < 0
                ? results.groups.length
                  ? 'Нажмите «Просмотреть группу» на любой карточке выше.'
                  : 'Неопознанных лиц пока нет. Обработайте новые фотографии или откройте поиск человека.'
                : mode === 'automatic'
                  ? 'Уверенных предложений пока нет. Добавьте подтверждённые примеры или используйте групповой поиск.'
                  : 'Совпадений не найдено. Попробуйте расширить поиск или добавить другие фотографии человека.'}
        </Empty>
      )}
    </>
  );
}
