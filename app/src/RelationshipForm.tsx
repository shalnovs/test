import { useState } from 'react';
import { Check, Plus, UserPlus, Users } from 'lucide-react';
import { api, fullName, type Item } from './api';
import { useArchive } from './context';
import { Field, Modal } from './components';
import { PersonSearch } from './PersonSearch';

const blankPerson = (relation: string) => ({
  surname: '',
  given_name: '',
  patronymic: '',
  birth_surname: '',
  second_surname: '',
  birth_date: '',
  death_date: '',
  birth_place: '',
  comment: '',
  gender: relation === 'mother' ? 'F' : relation === 'father' ? 'M' : 'U',
  alive: null as boolean | null,
});

export function RelationshipForm({ root, onClose }: { root: string; onClose: () => void }) {
  const { archive, run, busy, selectPerson } = useArchive();
  const [target, setTarget] = useState('');
  const [relation, setRelation] = useState('mother');
  const [date, setDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(() => blankPerson('mother'));
  const [keepOpen, setKeepOpen] = useState(false);
  const canSave = creating
    ? !![draft.surname, draft.given_name, draft.patronymic].some((s) => s.trim())
    : !!target;
  const original = archive.data.people.find((p) => p.id === root);
  const normalized = (s: string) => s.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const possible =
    creating && draft.given_name.trim() && draft.surname.trim()
      ? archive.data.people
          .filter(
            (p) =>
              p.id !== root &&
              normalized(p.given_name || '') === normalized(draft.given_name) &&
              [p.surname, p.birth_surname, p.second_surname].some(
                (s) => normalized(s || '') === normalized(draft.surname),
              ),
          )
          .slice(0, 6)
      : [];
  const close = () => {
    if (!busy) onClose();
  };
  const save = () =>
    run(
      async () => {
        const saved = await api('save_relative', {
          tree_id: archive.tree_id,
          root_id: root,
          relation,
          target_id: creating ? '' : target,
          ...(creating ? { new_person: draft } : {}),
          start_date: relation === 'partner' ? date : '',
        });
        selectPerson?.(saved.id);
        if (keepOpen) {
          setTarget('');
          setDate('');
          setCreating(false);
          setDraft(blankPerson(relation));
        } else onClose();
      },
      creating ? 'Человек и связь сохранены' : 'Родственная связь сохранена',
    );
  return (
    <Modal title="Родственная связь" onClose={close}>
      <p className="muted">
        Добавить родственника: <strong>{fullName(original)}</strong>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave && !busy) void save();
        }}
      >
        <fieldset className="relationship-fields" disabled={busy}>
          <Field label="Кем приходится выбранному человеку" wide>
            <select
              value={relation}
              onChange={(e) => {
                setRelation(e.target.value);
                if (creating && ['mother', 'father'].includes(e.target.value))
                  setDraft((d) => ({ ...d, gender: e.target.value === 'mother' ? 'F' : 'M' }));
              }}
            >
              <option value="mother">Мать</option>
              <option value="father">Отец</option>
              <option value="child">Ребёнок</option>
              <option value="partner">Супруг / супруга</option>
            </select>
          </Field>
          <div className="relationship-choice" role="group" aria-label="Выбор человека для связи">
            <button
              type="button"
              className={!creating ? 'active' : ''}
              aria-pressed={!creating}
              onClick={() => setCreating(false)}
            >
              <Users size={16} /> Выбрать из архива
            </button>
            <button
              type="button"
              className={creating ? 'active' : ''}
              aria-pressed={creating}
              onClick={() => {
                if (!creating && !fullName(draft).trim()) setDraft(blankPerson(relation));
                setCreating(true);
              }}
            >
              <UserPlus size={16} /> Создать человека
            </button>
          </div>
          {creating ? (
            <section className="relative-draft" aria-label="Новый родственник">
              <h3>Новый человек</h3>
              <p className="muted small">Карточка и родственная связь сохранятся вместе.</p>
              <div className="form-grid">
                {(
                  [
                    ['surname', 'Фамилия'],
                    ['given_name', 'Имя'],
                    ['patronymic', 'Отчество'],
                    ['birth_surname', 'Фамилия при рождении'],
                    ['second_surname', 'Вторая фамилия'],
                    ['birth_date', 'Дата рождения'],
                    ['death_date', 'Дата смерти'],
                    ['birth_place', 'Место рождения'],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      value={draft[key]}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                      placeholder={key.endsWith('_date') ? 'ГГГГ-ММ-ДД или только год' : ''}
                    />
                  </Field>
                ))}
                <Field label="Пол">
                  <select
                    value={draft.gender}
                    onChange={(e) => setDraft((d) => ({ ...d, gender: e.target.value }))}
                  >
                    <option value="U">Не указан</option>
                    <option value="M">Мужской</option>
                    <option value="F">Женский</option>
                  </select>
                </Field>
                <Field label="Статус">
                  <select
                    value={draft.alive === null ? 'unknown' : draft.alive ? 'yes' : 'no'}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        alive: e.target.value === 'unknown' ? null : e.target.value === 'yes',
                      }))
                    }
                  >
                    <option value="unknown">Неизвестно</option>
                    <option value="yes">Живёт</option>
                    <option value="no">Умер / умерла</option>
                  </select>
                </Field>
                <Field label="Заметки" wide>
                  <textarea
                    rows={3}
                    value={draft.comment}
                    onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
                  />
                </Field>
              </div>
              {!!possible.length && (
                <div className="notice relative-duplicates">
                  <strong>В архиве есть люди с таким именем</strong>
                  {possible.map((p: Item) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setTarget(p.id);
                        selectPerson?.(p.id);
                        setCreating(false);
                      }}
                    >
                      Выбрать: {fullName(p)}
                      {p.birth_date ? ` · ${p.birth_date}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <div className="relative-person-picker">
              <span className="field-label">Человек</span>
              <PersonSearch
                value={target}
                onChange={setTarget}
                exclude={[root]}
                empty="Найти родственника"
                disabled={busy}
              />
            </div>
          )}
          {relation === 'partner' && (
            <Field label="Дата брака" wide>
              <input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder="ГГГГ-ММ-ДД или только год"
              />
            </Field>
          )}
          <label className="check-row">
            <input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} />
            После сохранения добавить ещё одного родственника
          </label>
        </fieldset>
        <footer className="modal-footer">
          <button type="button" onClick={close} disabled={busy}>
            Отмена
          </button>
          <button type="submit" className="primary" disabled={!canSave || busy}>
            {creating ? <Plus size={17} /> : <Check size={17} />}
            {creating ? 'Создать и сохранить связь' : 'Сохранить связь'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
