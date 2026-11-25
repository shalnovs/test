import { useMemo, useState, useEffect, useCallback } from 'react';
import { GitBranch, Network, Users, ArrowUpRight, Focus } from 'lucide-react';
import { useArchive } from './context';
import { Avatar, PersonPicker, Empty } from './components';
import { fullName } from './api';
import { siblingsAndCousins } from './kinship';
import { FamilyGraph } from './FamilyGraph';
import { FamilyTree } from './FamilyTree';
import { useFamilyView } from './familyView';
export function Tree() {
  const { archive, person, selectedPersonId, selectPerson } = useArchive();
  const [view, setView] = useFamilyView(archive.tree_id);
  const FamilyCanvas = view === 'tree' ? FamilyTree : FamilyGraph;
  const [localRoot, setRoot] = useState(
    () => archive.data.people.find((p) => p.external_id === 'I1')?.id || archive.data.people[0]?.id || '',
  );
  const root = selectedPersonId || localRoot;
  const [mode, setMode] = useState('all'),
    [extended, setExtended] = useState(false),
    [group, setGroup] = useState(''),
    [focusTick, setFocusTick] = useState(0);
  const choose = useCallback(
    (id: string) => {
      setRoot(id);
      setFocusTick((n) => n + 1);
      selectPerson?.(id);
      setGroup('');
    },
    [selectPerson],
  );
  const relatives = useMemo(() => siblingsAndCousins(archive.data, root), [archive.data, root]);
  useEffect(() => {
    if (!archive.data.people.some((p) => p.id === root) && archive.data.people[0])
      choose(archive.data.people[0].id);
  }, [archive.data.people, root, choose]);
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">СВЯЗИ ПОКОЛЕНИЙ</div>
          <h1>{view === 'tree' ? 'Семейное дерево' : 'Семейный граф'}</h1>
          <p>
            {view === 'tree'
              ? 'Родители расположены выше детей. Нажмите на человека — он станет центром; стрелка открывает его карточку.'
              : 'Нажмите на круг — человек станет центром. Наведите мышку для подсветки связей; круги можно перетаскивать.'}
          </p>
        </div>
        <div className="page-badge">
          <GitBranch size={18} />
          {archive.data.people.length} человек
        </div>
      </div>
      <div className="segmented tree-display-switch" role="group" aria-label="Вид семейных связей">
        <button
          className={view === 'graph' ? 'active' : ''}
          aria-pressed={view === 'graph'}
          onClick={() => setView('graph')}
        >
          <Network size={18} />
          Граф
        </button>
        <button
          className={view === 'tree' ? 'active' : ''}
          aria-pressed={view === 'tree'}
          onClick={() => setView('tree')}
        >
          <GitBranch size={18} />
          Дерево
        </button>
      </div>
      <div className="toolbar tree-toolbar">
        <PersonPicker value={root} onChange={choose} empty="От кого строить дерево" />
        <div className="segmented">
          {[
            ['family', 'Близкие'],
            ['all', 'Вся семья'],
            ['ancestors', 'Предки'],
            ['descendants', 'Потомки'],
          ].map(([m, label]) => (
            <button
              className={!extended && mode === m ? 'active' : ''}
              onClick={() => {
                setMode(m);
                setExtended(false);
              }}
              key={m}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          aria-expanded={extended}
          className={extended ? 'active' : ''}
          onClick={() => setExtended(!extended)}
        >
          <Users size={17} />
          {extended ? 'Скрыть' : 'Показать'} братьев и сестёр ({relatives.length})
        </button>
      </div>
      {extended && (
        <section className="kinship-panel">
          <h2>Братья и сёстры · {fullName(archive.data.people.find((p) => p.id === root))}</h2>
          <p className="muted">
            Родство рассчитано по связям родителей в архиве. Неполнородные имеют одного общего родителя;
            сводные связаны браком родителей. Чем полнее дерево, тем больше дальних родственников здесь
            появится.
          </p>
          <div className="filter-chips">
            <button className={!group ? 'active' : ''} onClick={() => setGroup('')}>
              Все ({relatives.length})
            </button>
            {[...new Set(relatives.map((r) => r.group))].map((label) => (
              <button key={label} className={group === label ? 'active' : ''} onClick={() => setGroup(label)}>
                {label} ({relatives.filter((r) => r.group === label).length})
              </button>
            ))}
          </div>
        </section>
      )}
      {archive.data.people.length ? (
        <FamilyCanvas
          root={root}
          mode={mode}
          extended={extended}
          group={group}
          focusTick={focusTick}
          onFocus={choose}
        />
      ) : (
        <Empty>Добавьте первого человека в разделе «Люди».</Empty>
      )}
      {extended && (
        <section className="kinship-panel">
          <details className="kinship-details">
            <summary>Список родственников и объяснение связей</summary>
            <div className="kinship-grid">
              {relatives
                .filter((r) => !group || r.group === group)
                .map((r) => (
                  <article className="kinship-card" key={r.person.id}>
                    <Avatar p={r.person} size="sm" />
                    <div>
                      <strong>{fullName(r.person)}</strong>
                      <small>{r.group}</small>
                      <p>{r.reason}</p>
                      <div className="actions">
                        <button onClick={() => choose(r.person.id)}>
                          <Focus size={15} />В центр
                        </button>
                        <button onClick={() => person(r.person.id)}>
                          <ArrowUpRight size={15} />
                          Карточка
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
            </div>
          </details>
          {!relatives.length && <Empty>Родство пока не найдено. Добавьте родителей и связи предков.</Empty>}
        </section>
      )}
    </>
  );
}
