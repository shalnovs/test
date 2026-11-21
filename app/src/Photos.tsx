import { useRef, useState } from 'react';
import { Plus, UserRound, Image as ImageIcon } from 'lucide-react';
import { api, fileBase64, thumbnail } from './api';
import { useArchive } from './context';
import { Empty, MediaImage, PersonPicker, SearchBox } from './components';
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
