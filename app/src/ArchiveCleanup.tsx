import { useEffect, useRef, useState } from 'react';
import { Copy, Trash2, RotateCcw, Search, Check, LoaderCircle, AlertTriangle } from 'lucide-react';
import { api, clearMedia, fullName, plainText, type Item } from './api';
import { useArchive } from './context';
import { Empty, MediaImage, Modal, SearchBox } from './components';
import { scanSimilarPhotos } from './photoDuplicates';

export function TrashDialog({
  kind,
  ids,
  onClose,
  onDone,
  keepId,
  permanent = false,
}: {
  kind: 'media' | 'texts';
  ids: string[];
  onClose: () => void;
  onDone?: () => void;
  keepId?: string;
  permanent?: boolean;
}) {
  const { archive, run, busy, notify } = useArchive();
  const [preview, setPreview] = useState<{
      count: number;
      people: Item[];
      tags: number;
      events: number;
    } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api(permanent ? 'purge_preview' : 'trash_preview', { kind, ids })
      .then((v) => live && setPreview(v))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [kind, JSON.stringify(ids), permanent]);
  return (
    <Modal
      title={permanent ? 'Удалить окончательно' : keepId ? 'Объединить дубли' : 'Переместить в корзину'}
      onClose={onClose}
    >
      {error ? (
        <p role="alert">{error}</p>
      ) : !preview ? (
        <p>
          <LoaderCircle className="spin" size={18} /> Проверяем связи…
        </p>
      ) : (
        <>
          <p>
            Выбрано материалов: <strong>{ids.length}</strong>.{' '}
            {permanent
              ? 'Оригиналы, подписи и отметки будут удалены без возможности восстановления из корзины или истории изменений.'
              : 'Их можно будет восстановить из корзины.'}
          </p>
          {(preview.people.length > 0 || preview.tags > 0) && (
            <div className="deletion-warning" role="alert">
              <AlertTriangle size={22} />
              <div>
                <strong>Внимание: с материалами связаны люди</strong>
                <p>
                  {preview.people.length
                    ? preview.people.map(fullName).join(', ')
                    : 'На фотографиях есть ещё не подписанные отметки.'}
                </p>
                {preview.tags > 0 && <small>Отметок на фотографиях: {preview.tags}.</small>}
              </div>
            </div>
          )}
          {preview.events > 0 && <p className="muted">Связанных событий: {preview.events}.</p>}
          <p>
            {permanent
              ? 'Люди останутся в дереве. Если это объединённый дубль, его связи сохранятся у основного материала. Общие файлы, которые используются другими материалами, не удаляются. Внешние резервные копии не изменяются.'
              : keepId
                ? 'Отметки и связи будут показаны у выбранного основного материала. Исходные подписи, комментарии и тексты останутся в копиях в корзине.'
                : 'Материалы и отметки исчезнут из обычных разделов, но сохранятся в корзине вместе со связями. Люди останутся в семейном дереве.'}
          </p>
          <ul className="trash-titles">
            {ids.map((id) => (
              <li key={id}>
                {(permanent ? archive.trash?.[kind] : archive.data[kind])?.find((m) => m.id === id)?.title ||
                  id}
              </li>
            ))}
          </ul>
        </>
      )}
      <footer className="modal-footer">
        <button disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button
          className={permanent ? 'danger-button' : 'primary'}
          disabled={busy || !preview}
          onClick={async () => {
            const ok = await run(
              async () => {
                const result = await api(
                  permanent ? 'purge_items' : keepId ? 'merge_duplicates' : 'trash_items',
                  {
                    kind,
                    ids,
                    keep_id: keepId,
                    confirm_marked: !!preview?.people.length || !!preview?.tags,
                    ...(permanent ? { confirm_permanent: true } : {}),
                  },
                );
                if (permanent) clearMedia();
                return result || {};
              },
              permanent
                ? 'Материалы удалены окончательно'
                : keepId
                  ? 'Дубли объединены и перемещены в корзину'
                  : 'Материалы перемещены в корзину',
            );
            if (ok) {
              if (ok.pending_files)
                notify(
                  `Записи удалены. Занятых файлов: ${ok.pending_files}; программа повторит их удаление при следующем запуске.`,
                );
              onClose();
              onDone?.();
            }
          }}
        >
          <Trash2 size={16} />
          {permanent ? 'Удалить навсегда' : keepId ? 'Объединить и убрать повторы' : 'В корзину'}
        </button>
      </footer>
    </Modal>
  );
}
export function ArchiveCleanup() {
  const { archive, photo, text, run, busy } = useArchive();
  const [tab, setTab] = useState<'media' | 'texts' | 'similar' | 'trash'>('media');
  const [groups, setGroups] = useState<Item[][]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [query, setQuery] = useState(''),
    [progress, setProgress] = useState('');
  const [working, setWorking] = useState(false);
  const cancel = useRef(false);
  const [deletion, setDeletion] = useState<{
    kind: 'media' | 'texts';
    ids: string[];
    keepId?: string;
  } | null>(null);
  const [trashKind, setTrashKind] = useState<'media' | 'texts'>('media');
  const [selected, setSelected] = useState<string[]>([]);
  const [permanent, setPermanent] = useState<{ kind: 'media' | 'texts'; ids: string[] } | null>(null);
  useEffect(
    () => () => {
      cancel.current = true;
    },
    [],
  );
  useEffect(() => {
    setSelected([]);
    setError('');
    if (tab === 'trash' || tab === 'similar') {
      setGroups([]);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    api<Item[][]>('find_duplicates', { kind: tab })
      .then((v) => live && setGroups(v))
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [tab, archive]);
  const scan = async () => {
    cancel.current = false;
    setWorking(true);
    setError('');
    try {
      const r = await scanSimilarPhotos(archive, cancel, (n, total) => setProgress(`${n} из ${total}`));
      if (!cancel.current) {
        setGroups(r.groups);
        setProgress(r.failed ? `Не удалось прочитать файлов: ${r.failed}` : 'Поиск завершён');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };
  const trash = (archive.trash?.[trashKind] || []).filter((m) =>
    `${m.title} ${m.comment || ''}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ПОРЯДОК В АРХИВЕ</div>
          <h1>Дубли и корзина</h1>
          <p>Сравните материалы, сохраните нужное и восстановите удалённое</p>
        </div>
      </div>
      <div className="segmented cleanup-tabs">
        {(
          [
            ['media', 'Точные копии файлов'],
            ['texts', 'Одинаковые тексты'],
            ['similar', 'Похожие фотографии'],
            ['trash', 'Корзина'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} disabled={working} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {key === 'trash' ? <Trash2 size={16} /> : <Copy size={16} />} {label}
          </button>
        ))}
      </div>
      {tab === 'similar' && (
        <div className="cleanup-intro">
          <p>
            Поиск учитывает уменьшенные и слегка изменённые изображения. Совпадение внешнего вида ещё не
            означает, что фото одинаковые — выберите ненужные копии после сравнения.
          </p>
          <button className="primary" disabled={working} onClick={scan}>
            <Search size={17} />
            Найти похожие фотографии
          </button>
          {working && (
            <button
              onClick={() => {
                cancel.current = true;
                setProgress('Поиск остановлен. Повторный запуск продолжит обработку.');
              }}
            >
              Остановить
            </button>
          )}
          <span role="status">{progress}</span>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p>
          <LoaderCircle className="spin" size={18} /> Ищем дубли…
        </p>
      )}
      {tab !== 'trash' && (
        <>
          <p className="muted">
            {groups.length} групп.
            {tab === 'texts' ? ' Сравнивается содержимое без оформления и лишних пробелов.' : ''}
          </p>
          {groups.map((group, i) => (
            <DuplicateGroup
              key={group.map((m) => m.id).join(':')}
              items={group.filter((m) =>
                (tab === 'texts' ? archive.data.texts : archive.data.media).some((x) => x.id === m.id),
              )}
              kind={tab === 'texts' ? 'texts' : 'media'}
              number={i + 1}
              similar={tab === 'similar'}
              onDelete={(ids, keepId) =>
                setDeletion({ kind: tab === 'texts' ? 'texts' : 'media', ids, keepId })
              }
            />
          ))}
          {!loading && !groups.length && (
            <Empty>
              {tab === 'similar' ? 'Запустите поиск похожих фотографий.' : 'Точных дублей не найдено.'}
            </Empty>
          )}
        </>
      )}
      {tab === 'trash' && (
        <>
          <div className="toolbar wrap">
            <select
              aria-label="Материалы в корзине"
              value={trashKind}
              onChange={(e) => {
                setTrashKind(e.target.value as 'media' | 'texts');
                setSelected([]);
              }}
            >
              <option value="media">Фотографии и документы</option>
              <option value="texts">Тексты</option>
            </select>
            <SearchBox value={query} onChange={setQuery} placeholder="Найти в корзине" />
            <button disabled={!trash.length} onClick={() => setSelected(trash.map((m) => m.id))}>
              Выбрать найденные
            </button>
            <button
              className="primary"
              disabled={!selected.length || busy}
              onClick={async () => {
                const ok = await run(async () => {
                  await api('restore_items', { kind: trashKind, ids: selected });
                  return true;
                }, 'Материалы восстановлены');
                if (ok) setSelected([]);
              }}
            >
              <RotateCcw size={16} />
              Восстановить {selected.length || ''}
            </button>
            <button
              className="danger-button"
              disabled={!selected.length || busy}
              onClick={() => setPermanent({ kind: trashKind, ids: selected })}
            >
              <Trash2 size={16} />
              Удалить окончательно {selected.length || ''}
            </button>
          </div>
          <p className="muted">Корзина сохраняет оригиналы, подписи и отметки. Автоматической очистки нет.</p>
          <div className="trash-grid">
            {trash.map((m) => (
              <article key={m.id} className="trash-card">
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(m.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? [...selected, m.id] : selected.filter((id) => id !== m.id),
                      )
                    }
                  />
                  <span>{m.title}</span>
                </label>
                {trashKind === 'media' && m.mime?.startsWith('image/') ? (
                  <MediaImage id={m.id} alt={m.title} />
                ) : trashKind === 'texts' ? (
                  <p>{plainText(m.content).slice(0, 250)}</p>
                ) : (
                  <p>{m.filename}</p>
                )}
                <small>
                  {m.trash_reason === 'duplicate' ? 'Дубликат · ' : 'Удалено · '}
                  {new Date(m.trashed_at).toLocaleDateString('ru-RU')}
                </small>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(() => api('restore_items', { kind: trashKind, ids: [m.id] }), 'Материал восстановлен')
                  }
                >
                  <RotateCcw size={15} />
                  Восстановить
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() => setPermanent({ kind: trashKind, ids: [m.id] })}
                >
                  <Trash2 size={15} />
                  Удалить окончательно
                </button>
              </article>
            ))}
          </div>
          {!trash.length && <Empty>Корзина пуста.</Empty>}
        </>
      )}
      {deletion && (
        <TrashDialog
          {...deletion}
          onClose={() => setDeletion(null)}
          onDone={() => {
            if (tab === 'similar')
              setGroups((g) =>
                g
                  .map((items) => items.filter((m) => !deletion.ids.includes(m.id)))
                  .filter((items) => items.length > 1),
              );
          }}
        />
      )}
      {permanent && (
        <TrashDialog
          {...permanent}
          permanent
          onClose={() => setPermanent(null)}
          onDone={() => setSelected([])}
        />
      )}
    </>
  );
}
function DuplicateGroup({
  items,
  kind,
  number,
  similar,
  onDelete,
}: {
  items: Item[];
  kind: 'media' | 'texts';
  number: number;
  similar: boolean;
  onDelete: (ids: string[], keepId?: string) => void;
}) {
  const { photo, text } = useArchive();
  const [keep, setKeep] = useState(items[0]?.id),
    [selected, setSelected] = useState<string[]>(items.slice(1).map((m) => m.id));
  if (items.length < 2) return null;
  return (
    <section className="duplicate-group">
      <div className="section-title">
        <h2>
          Группа {number} <span className="count">{items.length}</span>
        </h2>
        <button disabled={!selected.length} onClick={() => onDelete(selected, similar ? undefined : keep)}>
          <Trash2 size={16} />
          {similar ? 'Выбранные в корзину' : 'Объединить и убрать повторы'}
        </button>
      </div>
      <div className="duplicate-items">
        {items.map((m) => (
          <article key={m.id} className={keep === m.id && !similar ? 'keep' : ''}>
            <button
              className="duplicate-preview"
              onClick={() => (kind === 'media' ? photo(m.id) : text(m.id))}
            >
              {kind === 'media' && m.mime?.startsWith('image/') ? (
                <MediaImage id={m.id} alt={m.title} />
              ) : (
                <p>{kind === 'texts' ? plainText(m.content).slice(0, 350) : m.filename}</p>
              )}
              <strong>{m.title}</strong>
            </button>
            <small>
              {m.date || ''}
              {m.linked_people ? ` · Связано людей: ${m.linked_people}` : ''}
            </small>
            {m.comment && <p>{m.comment}</p>}
            {!similar && (
              <button
                className="keep-control"
                aria-pressed={keep === m.id}
                onClick={() => {
                  setKeep(m.id);
                  setSelected(items.filter((x) => x.id !== m.id).map((x) => x.id));
                }}
              >
                <Check size={15} />
                {keep === m.id ? 'Основной материал' : 'Оставить этот'}
              </button>
            )}
            <label className="selection-label">
              <input
                type="checkbox"
                disabled={!similar && keep === m.id}
                checked={selected.includes(m.id)}
                onChange={(e) =>
                  setSelected(e.target.checked ? [...selected, m.id] : selected.filter((id) => id !== m.id))
                }
              />
              В корзину
            </label>
          </article>
        ))}
      </div>
    </section>
  );
}
