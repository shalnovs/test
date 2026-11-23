import { fullName, type Item } from './api';
import { rectStyle, validRect, type Rect } from './photoGeometry';

export function PhotoHotspots({
  tags,
  people,
  editing = false,
  selected = '',
  highlighted = '',
  pulse = 0,
  onSelect,
}: {
  tags: Item[];
  people: Item[];
  editing?: boolean;
  selected?: string;
  highlighted?: string;
  pulse?: number;
  onSelect: (tag: Item) => void;
}) {
  return (
    <>
      {tags
        .filter((t) => validRect(t))
        .map((t) => {
          const name = t.person_id
            ? fullName(people.find((p) => p.id === t.person_id))
            : t.label || 'Неизвестный человек';
          return (
            <button
              key={`${t.id}:${highlighted === t.id ? pulse : 0}`}
              type="button"
              aria-label={name}
              className={`face-tag ${editing ? 'editable' : 'view-only'} ${selected === t.id ? 'selected' : ''} ${highlighted === t.id ? 'highlighted' : ''}`}
              data-tag-id={t.id}
              style={{
                ...rectStyle(t as Item & Rect),
                pointerEvents: editing && selected === t.id ? 'none' : undefined,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(t);
              }}
            >
              <span className={`${t.x > 0.5 ? 'align-right' : ''} ${t.y + t.h > 0.8 ? 'above' : ''}`}>
                {name}
              </span>
            </button>
          );
        })}
    </>
  );
}
