import { useEffect, useRef, useState, type ReactNode, type ReactEventHandler } from 'react';
import type { Rect } from './photoGeometry';
import { X, Search, Image as ImageIcon, LoaderCircle } from 'lucide-react';
import { fullName, initials, mediaUrl, type Item } from './api';
import { useArchive } from './context';
export function MediaImage({
  id,
  thumb = true,
  crop,
  ...props
}: {
  id: string;
  thumb?: boolean;
  alt: string;
  className?: string;
  onLoad?: ReactEventHandler<HTMLImageElement>;
  crop?: Rect;
}) {
  const [src, setSrc] = useState('');
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc('');
    setSize({ w: 0, h: 0 });
    setError(false);
    if (id)
      mediaUrl(id, thumb)
        .then((s) => live && setSrc(s))
        .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [id, thumb]);
  return src && crop && size.w ? (
    <svg
      className={props.className || 'portrait-image'}
      role="img"
      aria-label={props.alt}
      viewBox={`${crop.x * size.w} ${crop.y * size.h} ${crop.w * size.w} ${crop.h * size.h}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <image href={src} width={size.w} height={size.h} />
    </svg>
  ) : src ? (
    <img
      {...props}
      src={src}
      loading={thumb ? 'lazy' : 'eager'}
      onLoad={(e) => {
        setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
        props.onLoad?.(e);
      }}
    />
  ) : (
    <div
      className={'image-placeholder ' + (props.className || '')}
      aria-label={error ? 'Изображение недоступно' : 'Загрузка изображения'}
    >
      {error ? <ImageIcon size={22} /> : <LoaderCircle size={20} className="spin" />}
    </div>
  );
}
export function Avatar({ p, size = 'md' }: { p?: Partial<Item>; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`avatar ${size} ${p?.gender === 'F' ? 'female' : ''}`}>
      {p?.avatar_id ? (
        <MediaImage id={p.avatar_id} alt={fullName(p)} crop={p.avatar_crop || undefined} />
      ) : (
        initials(p)
      )}
    </span>
  );
}
export function PersonPicker({
  value,
  onChange,
  empty = 'Выберите человека',
  exclude = [],
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  empty?: string;
  exclude?: string[];
  disabled?: boolean;
}) {
  const { archive, selectPerson: selection } = useArchive();
  return (
    <select
      aria-label={empty}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.value);
        if (e.target.value) selection?.(e.target.value);
      }}
    >
      <option value="">{empty}</option>
      {[...archive.data.people]
        .filter((p) => !exclude.includes(p.id))
        .sort((a, b) => fullName(a).localeCompare(fullName(b), 'ru'))
        .map((p) => (
          <option key={p.id} value={p.id}>
            {fullName(p)}
            {p.birth_date ? ' · ' + p.birth_date.slice(0, 4) : ''}
          </option>
        ))}
    </select>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = 'Найти в архиве',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search">
      <Search size={18} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && (
        <button className="icon-button" title="Очистить поиск" onClick={() => onChange('')}>
          <X size={16} />
        </button>
      )}
    </label>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const cb = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (e.key === 'Escape' && dialogs[dialogs.length - 1] === dialog.current) {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', cb);
    return () => window.removeEventListener('keydown', cb);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={'modal ' + (wide ? 'wide' : '')}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" title="Закрыть" onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-symbol">◇</span>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={'field ' + (wide ? 'full' : '')}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Chip({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="chip" onClick={onClick}>
      {children}
    </button>
  );
}
