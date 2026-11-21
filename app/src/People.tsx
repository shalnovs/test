import { useState } from 'react';
import { Plus, ArrowUpRight, Edit3, Trash2, Check, Link2 } from 'lucide-react';
import { api, dateLabel, fullName, years, mentionedPeople, type Item } from './api';
import { useArchive } from './context';
import { Avatar, Chip, Empty, Field, MediaImage, Modal, PersonPicker, SearchBox } from './components';
export function People() {
  const { archive, person } = useArchive();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = archive.data.people
    .filter((p) =>
      [fullName(p), p.birth_surname, p.birth_place].join(' ').toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">СЕМЕЙНЫЙ АРХИВ</div>
          <h1>Люди</h1>
          <p>Каждая жизнь — часть общей истории</p>
        </div>
        <button className="primary" onClick={() => setAdding(true)}>
          <Plus size={18} />
          Добавить человека
        </button>
      </div>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Имя, фамилия или место рождения" />
        <span className="muted">{list.length} человек</span>
      </div>
      <div className="people-grid">
        {list.map((p) => (
          <button key={p.id} className="person-tile" onClick={() => person(p.id)}>
            <Avatar p={p} size="lg" />
            <div>
              <strong>{fullName(p)}</strong>
              <span>{years(p)}</span>
              <small>{p.birth_place || p.residence || 'Место не указано'}</small>
            </div>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
      {!list.length && <Empty>Здесь появятся люди вашего дерева.</Empty>}
      {adding && <PersonForm onClose={() => setAdding(false)} />}
    </>
  );
}
export function PersonForm({ person: original, onClose }: { person?: Item; onClose: () => void }) {
  const { run, person, archive } = useArchive();
  const [p, setP] = useState<any>(
    original || {
      given_name: '',
      surname: '',
      patronymic: '',
      birth_surname: '',
      gender: 'U',
      birth_date: '',
      death_date: '',
      birth_place: '',
      death_place: '',
      occupation: '',
      residence: '',
      comment: '',
      alive: true,
      avatar_id: '',
    },
  );
  const set = (k: string, v: any) => setP({ ...p, [k]: v });
  const submit = () =>
    run(async () => {
      const result = await api('save', {
        kind: 'people',
        record: p,
        title: original ? 'Изменена карточка человека' : 'Добавлен человек',
      });
      onClose();
      person(result.id);
    }, 'Карточка сохранена');
  return (
    <Modal title={original ? 'Изменить карточку' : 'Новый человек'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="form-grid">
          {[
            ['surname', 'Фамилия'],
            ['given_name', 'Имя'],
            ['patronymic', 'Отчество'],
            ['birth_surname', 'Фамилия при рождении'],
            ['birth_date', 'Дата рождения'],
            ['death_date', 'Дата смерти'],
            ['birth_place', 'Место рождения'],
            ['death_place', 'Место смерти'],
            ['occupation', 'Занятие'],
            ['residence', 'Место проживания'],
          ].map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                value={p[k] || ''}
                placeholder={k.endsWith('_date') ? 'ГГГГ-ММ-ДД или только год' : ''}
                onChange={(e) => set(k, e.target.value)}
              />
            </Field>
          ))}
          <Field label="Пол">
            <select value={p.gender} onChange={(e) => set('gender', e.target.value)}>
              <option value="U">Не указан</option>
              <option value="M">Мужской</option>
              <option value="F">Женский</option>
            </select>
          </Field>
          <Field label="Статус">
            <select
              value={p.alive === true ? 'yes' : p.alive === false ? 'no' : 'unknown'}
              onChange={(e) => set('alive', e.target.value === 'unknown' ? null : e.target.value === 'yes')}
            >
              <option value="yes">Живёт</option>
              <option value="no">Умер / умерла</option>
              <option value="unknown">Неизвестно</option>
            </select>
          </Field>
          <Field label="Портрет" wide>
            <select value={p.avatar_id || ''} onChange={(e) => set('avatar_id', e.target.value)}>
              <option value="">Без портрета</option>
              {archive.data.media
                .filter((m) => m.mime?.startsWith('image/'))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Заметки" wide>
            <textarea rows={4} value={p.comment || ''} onChange={(e) => set('comment', e.target.value)} />
          </Field>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" type="submit">
            <Check size={17} />
            Сохранить
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function PersonPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { archive, person, photo, text, run } = useArchive();
  const [edit, setEdit] = useState(false);
  const [link, setLink] = useState(false);
  const [merge, setMerge] = useState(false);
  const d = archive.data;
  const p = d.people.find((p) => p.id === id);
  if (!p) return null;
  const relations = d.relationships.filter((r) => r.from_id === id || r.to_id === id);
  const tagged = d.media.filter(
    (m) => d.tags.some((t) => t.media_id === m.id && t.person_id === id) || m.id === p.avatar_id,
  );
  const texts = d.texts.filter(
    (t) =>
      t.author_id === id ||
      d.text_links.some((l) => l.person_id === id && l.text_id === t.id) ||
      mentionedPeople(t.content).includes(id),
  );
  const facts = d.facts.filter((f) => f.person_id === id);
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="person-drawer">
        <div className="drawer-top">
          <span className="eyebrow">КАРТОЧКА ЧЕЛОВЕКА</span>
          <button onClick={onClose} className="icon-button" title="Закрыть карточку">
            ×
          </button>
        </div>
        <div className="person-hero">
          <Avatar p={p} size="lg" />
          <h2>{fullName(p)}</h2>
          <span className="muted">{years(p)}</span>
          <button className="subtle" onClick={() => setEdit(true)}>
            <Edit3 size={15} />
            Изменить
          </button>
        </div>
        {p.birth_surname && p.birth_surname !== p.surname && (
          <p className="center muted">При рождении: {p.birth_surname}</p>
        )}
        <div className="detail-list">
          {[
            ['Рождение', p.birth_date ? dateLabel(p.birth_date) : ''],
            ['Место рождения', p.birth_place],
            ['Смерть', p.death_date ? dateLabel(p.death_date) : ''],
            ['Место смерти', p.death_place],
            ['Занятие', p.occupation],
            ['Проживание', p.residence],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
        </div>
        {p.comment && <p className="person-note">{p.comment}</p>}
        <section>
          <div className="section-title">
            <h3>Семья</h3>
            <button className="icon-button" title="Добавить родственную связь" onClick={() => setLink(true)}>
              <Plus size={18} />
            </button>
          </div>
          {relations.map((r) => {
            const other = d.people.find((p) => p.id === (r.from_id === id ? r.to_id : r.from_id));
            const role =
              r.kind === 'partner'
                ? 'Супруг / супруга'
                : r.from_id === id
                  ? 'Ребёнок'
                  : r.role === 'mother'
                    ? 'Мать'
                    : r.role === 'father'
                      ? 'Отец'
                      : 'Родитель';
            return (
              <div className="relative" key={r.id}>
                <button onClick={() => other && person(other.id)}>
                  <Avatar p={other} size="sm" />
                  <span>
                    <small>
                      {role}
                      {r.start_date ? ' · ' + dateLabel(r.start_date) : ''}
                    </small>
                    <strong>{fullName(other)}</strong>
                  </span>
                </button>
                <button
                  className="icon-button danger-on-hover"
                  title="Удалить связь"
                  onClick={() =>
                    window.confirm('Удалить эту родственную связь? Люди останутся в архиве.') &&
                    run(() => api('remove', { kind: 'relationships', id: r.id }), 'Связь удалена')
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          {!relations.length && <p className="muted">Родственные связи пока не указаны.</p>}
        </section>
        <section>
          <div className="section-title">
            <h3>Фотографии и документы</h3>
            <span className="count">{tagged.length}</span>
          </div>
          <div className="person-photos">
            {tagged.slice(0, 12).map((m) => (
              <button key={m.id} onClick={() => photo(m.id)} title={m.title}>
                {m.thumb ? <MediaImage id={m.id} alt={m.title} /> : <span>{m.title}</span>}
              </button>
            ))}
          </div>
          {tagged.length > 12 && (
            <button onClick={() => photo(tagged[12].id)}>
              Ещё {tagged.length - 12} материалов в фотоальбоме
            </button>
          )}
        </section>
        <section>
          <div className="section-title">
            <h3>Тексты и воспоминания</h3>
            <span className="count">{texts.length}</span>
          </div>
          {texts.map((t) => (
            <button className="text-link-row" key={t.id} onClick={() => text(t.id)}>
              {t.title}
              <ArrowUpRight size={16} />
            </button>
          ))}
        </section>
        {facts.length > 0 && (
          <section>
            <h3>События и сведения</h3>
            {facts.map((f) => (
              <article className={'fact ' + (f.kind === 'alternative' ? 'alternative' : '')} key={f.id}>
                <strong>{f.title || f.field}</strong>
                {f.date && (
                  <small>
                    {dateLabel(f.date)} {f.place}
                  </small>
                )}
                <p>
                  {typeof f.value === 'object'
                    ? Object.entries(f.value || {})
                        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                        .join('\n')
                    : String(f.value ?? '')}
                </p>
                <small>{d.sources.find((s) => s.id === f.source_id)?.title}</small>
              </article>
            ))}
          </section>
        )}
        <div className="drawer-end">
          <button className="subtle" onClick={() => setMerge(true)}>
            <Link2 size={15} />
            Объединить с другой карточкой
          </button>
        </div>
      </aside>
      {edit && <PersonForm person={p} onClose={() => setEdit(false)} />}
      {link && <RelationshipForm root={id} onClose={() => setLink(false)} />}
      {merge && <MergePeople root={id} onClose={() => setMerge(false)} />}
    </>
  );
}
function RelationshipForm({ root, onClose }: { root: string; onClose: () => void }) {
  const { run } = useArchive();
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState('mother');
  const [date, setDate] = useState('');
  return (
    <Modal title="Родственная связь" onClose={onClose}>
      <div className="form-grid">
        <Field label="Кем приходится выбранному человеку" wide>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="mother">Мать</option>
            <option value="father">Отец</option>
            <option value="child">Ребёнок</option>
            <option value="partner">Супруг / супруга</option>
          </select>
        </Field>
        <Field label="Человек" wide>
          <PersonPicker value={target} onChange={setTarget} exclude={[root]} />
        </Field>
        {kind === 'partner' && (
          <Field label="Дата брака" wide>
            <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="ГГГГ-ММ-ДД" />
          </Field>
        )}
      </div>
      <footer className="modal-footer">
        <button onClick={onClose}>Отмена</button>
        <button
          className="primary"
          disabled={!target}
          onClick={() =>
            run(async () => {
              await api('save', {
                kind: 'relationships',
                record: {
                  kind: kind === 'partner' ? 'partner' : 'parent',
                  from_id: ['mother', 'father'].includes(kind) ? target : root,
                  to_id: ['mother', 'father'].includes(kind) ? root : target,
                  role: ['mother', 'father'].includes(kind) ? kind : '',
                  start_date: date,
                },
                title: 'Добавлена родственная связь',
              });
              onClose();
            }, 'Родственная связь сохранена')
          }
        >
          Сохранить связь
        </button>
      </footer>
    </Modal>
  );
}
function MergePeople({ root, onClose }: { root: string; onClose: () => void }) {
  const { run, person } = useArchive();
  const [target, setTarget] = useState('');
  return (
    <Modal title="Объединить две карточки" onClose={onClose}>
      <p className="muted">
        Выберите карточку, которую нужно сохранить. Все фотографии, тексты и связи перейдут в неё.
        Различающиеся сведения останутся как альтернативные версии. Действие можно отменить в истории.
      </p>
      <PersonPicker value={target} onChange={setTarget} exclude={[root]} />
      <footer className="modal-footer">
        <button onClick={onClose}>Отмена</button>
        <button
          className="primary"
          disabled={!target}
          onClick={() =>
            run(async () => {
              await api('merge_people', { from_id: root, to_id: target });
              onClose();
              person(target);
            }, 'Карточки объединены')
          }
        >
          Объединить
        </button>
      </footer>
    </Modal>
  );
}
