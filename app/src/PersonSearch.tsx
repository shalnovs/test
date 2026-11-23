import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { fullName, years } from './api';
import { useArchive } from './context';
import { Avatar } from './components';
import { personMatches } from './nameMatching';

export function PersonSearch({
  value,
  onChange,
  empty = 'Найти человека',
  disabled = false,
  exclude = [],
}: {
  value: string;
  onChange: (id: string) => void;
  empty?: string;
  disabled?: boolean;
  exclude?: string[];
}) {
  const { archive, selectPerson } = useArchive();
  const uid = useId();
  const [query, setQuery] = useState(''),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open, query]);
  const selected = archive.data.people.find((p) => p.id === value);
  const matches = archive.data.people
    .filter((p) => !exclude.includes(p.id) && personMatches(p, query))
    .sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'));
  const choose = (id: string) => {
    if (id) selectPerson?.(id);
    onChange(id);
    setOpen(false);
    setQuery('');
    setActive(0);
  };
  return (
    <div
      className="person-search"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <div className="person-search-input">
        <Search size={16} />
        <input
          role="combobox"
          aria-label={empty}
          aria-expanded={open}
          aria-controls={uid}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${uid}-${active}` : undefined}
          disabled={disabled}
          placeholder="Фамилия, имя, отчество…"
          value={open ? query : selected ? fullName(selected) : ''}
          onFocus={() => {
            setOpen(true);
            setQuery('');
            setActive(0);
          }}
          onClick={() => {
            if (!open) {
              setOpen(true);
              setQuery('');
              setActive(0);
            }
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              setActive((i) =>
                Math.max(0, Math.min(matches.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))),
              );
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (open && matches[active]) choose(matches[active].id);
            }
            if (e.key === 'Escape' && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="icon-button"
            aria-label="Очистить выбранного человека"
            disabled={disabled}
            onClick={() => choose('')}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <div ref={list} className="person-search-results" role="listbox" id={uid} aria-label="Найденные люди">
          <small>По первым буквам · включая вторую фамилию</small>
          {matches.length ? (
            matches.map((p, i) => (
              <button
                type="button"
                role="option"
                aria-selected={active === i}
                id={`${uid}-${i}`}
                key={p.id}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(p.id)}
              >
                <Avatar p={p} size="sm" />
                <span>
                  <strong>{fullName(p)}</strong>
                  <small>
                    {[
                      p.birth_surname && p.birth_surname !== p.surname
                        ? `при рождении ${p.birth_surname}`
                        : '',
                      p.second_surname,
                      years(p),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p>Совпадений нет. Попробуйте другую часть имени.</p>
          )}
        </div>
      )}
    </div>
  );
}
