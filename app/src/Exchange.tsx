import { useEffect, useState } from 'react';
import {
  GitBranch,
  Download,
  Upload,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  FileArchive,
  Users,
} from 'lucide-react';
import { api, fullName, pickFile, type Item } from './api';
import { useArchive } from './context';
import { Avatar, Empty, Field, PersonPicker } from './components';
const labels: Record<string, string> = {
  surname: 'Фамилия',
  given_name: 'Имя',
  patronymic: 'Отчество',
  birth_surname: 'Фамилия при рождении',
  birth_date: 'Дата рождения',
  death_date: 'Дата смерти',
  birth_place: 'Место рождения',
  death_place: 'Место смерти',
  occupation: 'Занятие',
  residence: 'Место проживания',
  comment: 'Заметки',
  autobiography: 'Автобиография',
  alive: 'Живёт',
  gender: 'Пол',
  email: 'Эл. почта',
};
export function Exchange() {
  const [tab, setTab] = useState('export');
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ОБЩАЯ ИСТОРИЯ</div>
          <h1>Обмен ветками</h1>
          <p>Делитесь частью дерева и дополняйте его вместе с близкими</p>
        </div>
        <div className="page-badge">
          <GitBranch size={18} />С сохранением связей
        </div>
      </div>
      <div className="exchange-intro">
        <div className="exchange-step">
          <span>1</span>
          <div>
            <strong>Выберите ветку</strong>
            <small>Люди и связанные материалы</small>
          </div>
        </div>
        <ArrowRight />
        <div className="exchange-step">
          <span>2</span>
          <div>
            <strong>Передайте файл</strong>
            <small>Любым удобным способом</small>
          </div>
        </div>
        <ArrowRight />
        <div className="exchange-step">
          <span>3</span>
          <div>
            <strong>Сопоставьте людей</strong>
            <small>Подтвердите объединение</small>
          </div>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}>
          <Download size={17} />
          Поделиться веткой
        </button>
        <button className={tab === 'import' ? 'active' : ''} onClick={() => setTab('import')}>
          <Upload size={17} />
          Получить и объединить
        </button>
      </div>
      {tab === 'export' ? <ExportBranch /> : <ImportBranch />}
    </>
  );
}
function ExportBranch() {
  const { archive, run, notify, busy } = useArchive();
  const [root, setRoot] = useState(
    archive.data.people.find((p) => p.external_id === 'I1')?.id || archive.data.people[0]?.id || '',
  );
  const [mode, setMode] = useState('maternal');
  const [media, setMedia] = useState(true);
  const [texts, setTexts] = useState(true);
  const [title, setTitle] = useState('Ветка моей семьи');
  const [preview, setPreview] = useState<any>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [done, setDone] = useState('');
  useEffect(() => {
    let live = true;
    api('branch_preview', { root_id: root, mode, include_media: media, include_texts: texts })
      .then((v) => {
        if (live) {
          setPreview(v);
          setChosen(v.people.map((p: Item) => p.id));
        }
      })
      .catch((e) => notify(String(e)));
    return () => {
      live = false;
    };
  }, [root, mode, media, texts]);
  const exportNow = () =>
    run(async () => {
      const path = await pickFile(true, (title || 'Ветка семьи') + '.familyzip');
      if (!path) return;
      const result = await api('export', {
        path,
        root_id: root,
        mode: mode === 'all' && chosen.length !== archive.data.people.length ? 'custom' : mode,
        people_ids: chosen,
        include_media: media,
        include_texts: texts,
        title,
      });
      setDone(result.path);
    }, 'Ветка сохранена');
  return (
    <div className="exchange-layout">
      <section className="surface">
        <h2>Что передать</h2>
        <div className="form-stack">
          <Field label="Название ветки">
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Часть дерева">
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="maternal">По материнской линии</option>
              <option value="paternal">По отцовской линии</option>
              <option value="ancestors">Все предки</option>
              <option value="descendants">Все потомки</option>
              <option value="all">Весь архив / резервная копия</option>
            </select>
          </Field>
          {mode !== 'all' && (
            <Field label="От кого считать родство">
              <PersonPicker value={root} onChange={setRoot} />
            </Field>
          )}
          <label className="check-row">
            <input type="checkbox" checked={media} onChange={(e) => setMedia(e.target.checked)} />
            Фотографии, документы и отметки
          </label>
          <label className="check-row">
            <input type="checkbox" checked={texts} onChange={(e) => setTexts(e.target.checked)} />
            Тексты и упоминания людей
          </label>
          <p className="muted small">
            Материнская и отцовская линии включают выбранного человека, соответствующего родителя и его
            предков. Включённые фотографии и тексты передаются целиком; сведения о других людях могут
            оставаться в самом содержимом.
          </p>
          <button className="primary" disabled={!chosen.length || busy} onClick={exportNow}>
            <Download size={18} />
            Сохранить ветку · {chosen.length} чел.
          </button>
        </div>
        {done && (
          <div className="success-box">
            <CheckCircle2 size={20} />
            <div>
              <strong>Файл готов к передаче</strong>
              <p>{done}</p>
            </div>
          </div>
        )}
      </section>
      <section className="surface">
        <div className="section-title">
          <h2>Люди в ветке</h2>
          <span className="count">{chosen.length}</span>
        </div>
        <p className="muted">Проверьте состав. Ненужных людей можно исключить.</p>
        {preview && (
          <div className="branch-people">
            {preview.people.map((p: Item) => (
              <label className="branch-person" key={p.id}>
                <input
                  type="checkbox"
                  checked={chosen.includes(p.id)}
                  onChange={(e) =>
                    setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((id) => id !== p.id))
                  }
                />
                <Avatar p={p} size="sm" />
                <div>
                  <strong>{fullName(p)}</strong>
                  <small>{p.birth_date || 'Дата рождения не указана'}</small>
                </div>
              </label>
            ))}
          </div>
        )}
        {!chosen.length && <Empty>Выберите людей для передачи.</Empty>}
      </section>
    </div>
  );
}
function ImportBranch() {
  const { archive, run, busy, notify } = useArchive();
  const [path, setPath] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [expanded, setExpanded] = useState('');
  const choose = () =>
    run(async () => {
      const path = await pickFile();
      if (!path) return;
      const p = await api('import_preview', { path });
      setPath(path);
      setPreview(p);
      setResult(null);
      setResolutions({});
      setDecisions(
        Object.fromEntries(
          p.people.map((x: any) => [x.incoming.id, x.known_id || (x.candidates.length ? '' : '__new__')]),
        ),
      );
    });
  const unresolved = preview?.people.filter((x: any) => !decisions[x.incoming.id]).length || 0;
  const merge = () =>
    run(async () => {
      const r = await api('import', { path, decisions, resolutions });
      setResult(r);
    }, 'Ветка объединена');
  if (result)
    return (
      <section className="surface merge-success">
        <CheckCircle2 size={52} />
        <h2>{result.duplicate ? 'Эта ветка уже была получена' : 'История семьи дополнена'}</h2>
        <div className="merge-totals">
          <div>
            <strong>{result.added || 0}</strong>
            <span>новых людей</span>
          </div>
          <div>
            <strong>{result.matched || 0}</strong>
            <span>сопоставлено</span>
          </div>
          <div>
            <strong>{result.conflicts || 0}</strong>
            <span>различий сохранено</span>
          </div>
        </div>
        <p>Связи, фотографии и тексты объединены. Отменить операцию можно в разделе «История».</p>
        <button
          onClick={() => {
            setPreview(null);
            setResult(null);
          }}
        >
          Получить другую ветку
        </button>
      </section>
    );
  return (
    <>
      <section className="import-file surface">
        <FileArchive size={34} />
        <div>
          <h2>{preview ? preview.title : 'Откройте полученную ветку'}</h2>
          <p>
            {preview
              ? `${preview.people.length} человек · ${preview.counts.media || 0} материалов · ${preview.counts.texts || 0} текстов`
              : 'Выберите файл .familyzip, который вам передали'}
          </p>
        </div>
        <button className="primary" onClick={choose} disabled={busy}>
          <Upload size={17} />
          {preview ? 'Другой файл' : 'Выбрать файл'}
        </button>
      </section>
      {preview?.already_imported && (
        <div className="notice">
          <ShieldCheck size={20} />
          Этот файл уже импортирован. Повторная загрузка не создаст дубликатов.
        </div>
      )}
      {preview && !preview.already_imported && (
        <>
          <div className="section-title import-title">
            <div>
              <h2>Сопоставьте людей</h2>
              <p className="muted">
                Подсказки учитывают имя, фамилию и дату рождения. Новые совпадения подтверждаете вы.
              </p>
            </div>
            <span className="count">
              {unresolved ? `Осталось решить: ${unresolved}` : 'Все действия выбраны'}
            </span>
          </div>
          <div className="match-list">
            {preview.people.map((row: any) => {
              const p = row.incoming;
              const decision = decisions[p.id] || '';
              const local = archive.data.people.find((p) => p.id === decision);
              const differences = local
                ? Object.entries(labels).filter(
                    ([k]) =>
                      p[k] !== undefined &&
                      p[k] !== null &&
                      p[k] !== '' &&
                      local[k] !== undefined &&
                      local[k] !== null &&
                      local[k] !== '' &&
                      JSON.stringify(p[k]) !== JSON.stringify(local[k]),
                  )
                : [];
              return (
                <div className={'match-card ' + (!decision ? 'needs-review' : '')} key={p.id}>
                  <div className="match-main">
                    <div className="incoming-person">
                      <Avatar p={p} size="sm" />
                      <div>
                        <strong>{fullName(p)}</strong>
                        <small>
                          {p.birth_date || 'Дата рождения неизвестна'}
                          {row.known_id ? ' · Уже сопоставлен' : ''}
                        </small>
                      </div>
                    </div>
                    <ArrowRight size={18} />
                    <select
                      aria-label={'Сопоставление: ' + fullName(p)}
                      value={decision}
                      onChange={(e) => setDecisions({ ...decisions, [p.id]: e.target.value })}
                    >
                      <option value="">Выберите действие…</option>
                      <option value="__new__">Добавить как нового человека</option>
                      <option value="__skip__">Не включать в объединение</option>
                      {row.candidates.length > 0 && (
                        <optgroup label="Возможные совпадения">
                          {row.candidates.map((c: any) => (
                            <option value={c.id} key={c.id}>
                              {c.name} · {c.reasons.join(', ')}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Все люди моего архива">
                        {archive.data.people.map((p) => (
                          <option value={p.id} key={p.id}>
                            {fullName(p)}
                            {p.birth_date ? ' · ' + p.birth_date : ''}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    {differences.length > 0 && (
                      <button
                        className="difference-button"
                        onClick={() => setExpanded(expanded === p.id ? '' : p.id)}
                      >
                        {differences.length} различий
                      </button>
                    )}
                  </div>
                  {expanded === p.id && local && (
                    <div className="field-conflicts">
                      <p>
                        Выберите основное значение. Вторая версия останется в карточке человека с указанием
                        источника.
                      </p>
                      {differences.map(([k, label]) => (
                        <div className="field-conflict" key={k}>
                          <strong>{label}</strong>
                          <label>
                            <input
                              type="radio"
                              name={p.id + k}
                              checked={resolutions[p.id + ':' + k] !== 'incoming'}
                              onChange={() => setResolutions({ ...resolutions, [p.id + ':' + k]: 'local' })}
                            />
                            <span>
                              <small>В моём архиве</small>
                              {String(local[k])}
                            </span>
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={p.id + k}
                              checked={resolutions[p.id + ':' + k] === 'incoming'}
                              onChange={() =>
                                setResolutions({ ...resolutions, [p.id + ':' + k]: 'incoming' })
                              }
                            />
                            <span>
                              <small>В полученной ветке</small>
                              {String(p[k])}
                            </span>
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="merge-bar">
            <div>
              <strong>Различия не теряются</strong>
              <p>Объединение сохраняется одной операцией с возможностью отмены.</p>
            </div>
            <button className="primary" disabled={!!unresolved || busy} onClick={merge}>
              <GitBranch size={18} />
              Объединить ветку
            </button>
          </div>
        </>
      )}
    </>
  );
}
