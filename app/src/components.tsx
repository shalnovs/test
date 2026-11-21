import { useEffect, useState, type ReactNode } from 'react';
import { X, Search, Image as ImageIcon, LoaderCircle } from 'lucide-react';
import { fullName, initials, mediaUrl, type Item } from './api';
import { useArchive } from './context';
export function MediaImage({
  id,
  thumb = true,
  ...props
}: {
  id: string;
  thumb?: boolean;
  alt: string;
  className?: string;
  onLoad?: () => void;
}) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc('');
    setError(false);
    if (id)
      mediaUrl(id, thumb)
        .then((s) => live && setSrc(s))
        .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [id, thumb]);
  return src ? (
    <img {...props} src={src} loading={thumb ? 'lazy' : 'eager'} />
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
      {p?.avatar_id ? <MediaImage id={p.avatar_id} alt={fullName(p)} /> : initials(p)}
    </span>
  );
}
export function PersonPicker({
  value,
  onChange,
  empty = 'Выберите человека',
  exclude = [],
}: {
  value: string;
  onChange: (id: string) => void;
  empty?: string;
  exclude?: string[];
}) {
  const { archive } = useArchive();
  return (
    <select aria-label={empty} value={value} onChange={(e) => onChange(e.target.value)}>
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
  useEffect(() => {
    const cb = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', cb);
    return () => window.removeEventListener('keydown', cb);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-label={title} className={'modal ' + (wide ? 'wide' : '')}>
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
