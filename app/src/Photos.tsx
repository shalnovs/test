import { useEffect, useRef, useState } from 'react';
import { Plus, UserRound, Image as ImageIcon, Trash2, Copy, CheckSquare, ScanFace } from 'lucide-react';
import { useMediaImport } from './MediaImport';
import { useArchive } from './context';
import { Empty, MediaImage, PersonPicker, SearchBox } from './components';
import { TrashDialog } from './ArchiveCleanup';
import { mediaDateLabel, isPhoto } from './materials';
export function Photos({ documents = false }: { documents?: boolean }) {
  const { archive, photo, run, busy, navigate, notify, reload } = useArchive();
  const { importFile, duplicateDialog } = useMediaImport();
  const [q, setQ] = useState('');
  const [pid, setPid] = useState('');
  const [limit, setLimit] = useState(48);
  const [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setSelected([]);
  }, [q, pid, documents]);
  const file = useRef<HTMLInputElement>(null);
  const list = archive.data.media.filter(
    (m) =>
      (documents ? !isPhoto(m) : isPhoto(m)) &&
      (!pid ||
        archive.data.tags.some((t) => t.media_id === m.id && t.person_id === pid) ||
        archive.data.people.some((p) => p.id === pid && p.avatar_id === m.id)) &&
      [m.title, m.description, m.comment, m.place, m.date, m.date_source_text]
        .join(' ')
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  const upload = async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files);
    const result = await run(async () => {
      const stats = { added: 0, reused: 0, restored: 0, skipped: 0 };
      for (const f of selected) {
        const value = await importFile(f, documents ? 'document' : 'photo');
        if (!value) stats.skipped++;
        else if (value.reused) stats.reused++;
        else if (value.restored) stats.restored++;
        else stats.added++;
      }
      return stats;
    });
    if (result)
      notify(
        `Добавлено: ${result.added}. Использовано имеющихся: ${result.reused}. Восстановлено: ${result.restored}. Пропущено: ${result.skipped}.`,
      );
    else await reload();
    if (file.current) file.current.value = '';
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{documents ? 'ДОКУМЕНТЫ СЕМЬИ' : 'МГНОВЕНИЯ СЕМЬИ'}</div>
          <h1>{documents ? 'Документы' : 'Фотоальбом'}</h1>
          <p>
            {documents
              ? 'Письма, свидетельства, справки и сканы'
              : 'Сохраняйте фотографии и отмечайте близких'}
          </p>
        </div>
        <div className="row">
          {!documents && (
            <button onClick={() => navigate('faces')}>
              <ScanFace size={17} />
              Поиск человека
            </button>
          )}
          <button onClick={() => navigate('cleanup')}>
            <Copy size={17} />
            Дубли и корзина
          </button>
          <button className="primary" disabled={busy} onClick={() => file.current?.click()}>
            <Plus size={18} />
            {documents ? 'Добавить документы' : 'Добавить фотографии'}
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept={documents ? undefined : 'image/*'}
          multiple
          hidden
          onChange={(e) => upload(e.target.files)}
        />
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
        <span className="muted">{list.length} материалов</span>
        <button
          aria-pressed={selecting}
          onClick={() => {
            setSelecting(!selecting);
            setSelected([]);
          }}
        >
          <CheckSquare size={16} />
          {selecting ? 'Завершить выбор' : 'Выбрать'}
        </button>
      </div>
      {selecting && (
        <div className="batch-media-toolbar">
          <button onClick={() => setSelected(list.map((m) => m.id))}>
            Выбрать все найденные ({list.length})
          </button>
          <button disabled={!selected.length} onClick={() => setSelected([])}>
            Снять выбор
          </button>
          <button disabled={!selected.length || busy} onClick={() => setDeleting(true)}>
            <Trash2 size={16} />В корзину ({selected.length})
          </button>
        </div>
      )}
      <div className="photo-grid">
        {list.slice(0, limit).map((m) => (
          <div key={m.id} className={`selectable-photo ${selected.includes(m.id) ? 'selected' : ''}`}>
            {selecting && (
              <label className="photo-selection">
                <input
                  type="checkbox"
                  aria-label={`Выбрать: ${m.title}`}
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    setSelected(e.target.checked ? [...selected, m.id] : selected.filter((id) => id !== m.id))
                  }
                />
              </label>
            )}
            <button className="photo-card" onClick={() => photo(m.id)}>
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
                <small>
                  {m.date
                    ? mediaDateLabel(m)
                    : m.place || (m.kind === 'photo' ? 'Семейная фотография' : 'Документ')}
                </small>
              </div>
            </button>
          </div>
        ))}
      </div>
      {!list.length && <Empty>Материалы не найдены.</Empty>}
      {list.length > limit && (
        <div className="load-more">
          <button onClick={() => setLimit(limit + 48)}>Показать ещё</button>
        </div>
      )}
      {deleting && (
        <TrashDialog
          kind="media"
          ids={selected}
          onClose={() => setDeleting(false)}
          onDone={() => setSelected([])}
        />
      )}
      {duplicateDialog}
    </>
  );
}
