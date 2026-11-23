import { useCallback, useEffect, useState } from 'react';
import { installNativeClose } from './nativeClose';
import { useSelectedPerson } from './selectedPerson';
import {
  Home,
  GitBranch,
  Users,
  Images,
  BookOpen,
  ArrowLeftRight,
  Library,
  History,
  FolderOpen,
  ShieldCheck,
  ArrowUpRight,
  CheckCircle2,
  X,
  LoaderCircle,
  Undo2,
  Leaf,
  Download,
  CalendarDays,
  MapPin,
  CalendarRange,
  ScanFace,
  Copy,
  Files,
} from 'lucide-react';
import { api, chooseLibrary, clearMedia, fullName, openUrl, plainText, type Archive, type Item } from './api';
import { AppContext, useArchive } from './context';
import { Avatar, Empty, MediaImage } from './components';
import { People, PersonPanel } from './People';
import { Tree } from './Tree';
import { Photos } from './Photos';
import { PhotoViewer } from './PhotoViewer';
import { FeaturedPhoto } from './FeaturedPhoto';
import { useRotatingSelection } from './useRotatingSelection';
import { Texts } from './Texts';
import { Exchange } from './Exchange';
import { Events, EventPanel } from './Events';
import { FamilyMap } from './FamilyMap';
import { ArchiveCleanup } from './ArchiveCleanup';
import { Faces } from './Faces';
import { RelatedMaterials } from './RelatedMaterials';
import type { MaterialSelection } from './materials';
const nav = [
  ['home', 'Обзор', Home],
  ['tree', 'Дерево', GitBranch],
  ['people', 'Люди', Users],
  ['photos', 'Фотоальбом', Images],
  ['documents', 'Документы', Files],
  ['faces', 'Поиск лиц', ScanFace],
  ['events', 'События', CalendarRange],
  ['calendar', 'Календарь', CalendarDays],
  ['map', 'Карта', MapPin],
  ['texts', 'Тексты', BookOpen],
  ['sources', 'Источники', Library],
  ['cleanup', 'Дубли и корзина', Copy],
  ['exchange', 'Обмен ветками', ArrowLeftRight],
  ['history', 'История', History],
] as const;
const titles = Object.fromEntries(nav.map(([key, title]) => [key, title]));
export default function App() {
  const [archive, setArchive] = useState<Archive | null>(null);
  const [selectedPersonId, selectPerson] = useSelectedPerson(archive);
  const [page, setPage] = useState('home');
  const [personId, setPerson] = useState('');
  const [photoId, setPhoto] = useState('');
  const [textId, setText] = useState('');
  const [eventId, setEvent] = useState('');
  const [related, setRelated] = useState<MaterialSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setArchive(await api<Archive>('load'));
  }, []);
  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [reload]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 5500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => installNativeClose((error) => setError(String(error))), []);
  const leave = () => !window.__archiveDirty || window.confirm('Текст изменён. Перейти без сохранения?');
  const navigate = (target: string) => {
    if (!leave()) return;
    window.__archiveDirty = false;
    setPage(target);
    setRelated(null);
    setPerson('');
    setPhoto('');
    setEvent('');
  };
  async function run<T>(action: () => Promise<T>, message?: string): Promise<T | undefined> {
    setBusy(true);
    try {
      const result = await action();
      await reload();
      if (message) setToast(message);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  const person = (id: string) => {
    selectPerson(id);
    setRelated(null);
    setEvent('');
    setPhoto('');
    setPerson(id);
  };
  const photo = (id: string) => {
    setRelated(null);
    setEvent('');
    setPerson('');
    setPhoto(id);
  };
  const event = (id: string) => {
    setRelated(null);
    setPerson('');
    setPhoto('');
    setEvent(id);
  };
  const text = (id: string) => {
    if (!leave()) return;
    window.__archiveDirty = false;
    setText(id);
    setRelated(null);
    setPage('texts');
    setEvent('');
    setPerson('');
    setPhoto('');
  };
  const switchLibrary = () => {
    if (!leave()) return;
    run(async () => {
      const path = await chooseLibrary();
      if (!path) return;
      await api('switch_library', { path });
      clearMedia();
      setRelated(null);
      setPerson('');
      setPhoto('');
      setText('');
      setEvent('');
      setPage('home');
    }, 'Архив открыт');
  };
  if (!archive)
    return (
      <div className="startup">
        <Leaf size={48} />
        <h1>Родословная</h1>
        <p>{error || 'Открываем семейный архив…'}</p>
        {error && (
          <button
            onClick={() => {
              setError('');
              reload().catch((e) => setError(String(e)));
            }}
          >
            Повторить
          </button>
        )}
      </div>
    );
  return (
    <AppContext.Provider
      value={{
        archive,
        reload,
        run,
        notify: setToast,
        person,
        photo,
        text,
        event,
        browse: setRelated,
        navigate,
        busy,
        selectedPersonId,
        selectPerson,
      }}
    >
      <div className="app-shell">
        <aside className="sidebar">
          <button className="brand" onClick={() => navigate('home')}>
            <span className="brand-symbol">
              <GitBranch size={30} />
            </span>
            <span>
              <strong>Родословная</strong>
              <small>История вашей семьи</small>
            </span>
          </button>
          <div className="archive-label">
            <span className="status-dot" />
            ЛИЧНЫЙ АРХИВ
          </div>
          <nav>
            {nav.map(([key, title, Icon]) => (
              <button className={page === key ? 'active' : ''} key={key} onClick={() => navigate(key)}>
                <Icon size={19} />
                <span>{title}</span>
                {key === 'people' && <small>{archive.data.people.length}</small>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="local-note">
              <ShieldCheck size={18} />
              <span>
                Ваши данные — у вас<small>Архив на этом компьютере</small>
              </span>
            </div>
            <button onClick={switchLibrary}>
              <FolderOpen size={17} />
              Открыть / создать архив
            </button>
            <span className="app-version">Родословная 1.6 · Локальный архив</span>
          </div>
        </aside>
        <div className="app-main">
          <header className="topbar">
            <div>
              <span>{archive.title}</span>
              <span className="breadcrumb">/</span>
              <strong>{titles[page]}</strong>
            </div>
            <button className="top-share" onClick={() => navigate('exchange')}>
              <ArrowLeftRight size={16} />
              Поделиться историей
            </button>
          </header>
          <main className={'page page-' + page}>
            {page === 'home' ? (
              <Overview key={archive.tree_id} />
            ) : page === 'tree' ? (
              <Tree key={archive.tree_id} />
            ) : page === 'people' ? (
              <People />
            ) : page === 'photos' ? (
              <Photos key={`${archive.tree_id}:photos`} />
            ) : page === 'documents' ? (
              <Photos key={`${archive.tree_id}:documents`} documents />
            ) : page === 'faces' ? (
              <Faces key={archive.tree_id} />
            ) : page === 'cleanup' ? (
              <ArchiveCleanup key={archive.tree_id} />
            ) : page === 'events' || page === 'calendar' ? (
              <Events key={`${archive.tree_id}:${page}`} calendar={page === 'calendar'} />
            ) : page === 'map' ? (
              <FamilyMap key={archive.tree_id} />
            ) : page === 'texts' ? (
              <Texts selected={textId} onSelect={text} />
            ) : page === 'sources' ? (
              <Sources />
            ) : page === 'exchange' ? (
              <Exchange />
            ) : (
              <HistoryPage />
            )}
          </main>
        </div>
      </div>
      {personId && <PersonPanel key={personId} id={personId} onClose={() => setPerson('')} />}
      {photoId && <PhotoViewer key={photoId} id={photoId} onClose={() => setPhoto('')} />}
      {eventId && <EventPanel key={eventId} id={eventId} onClose={() => setEvent('')} />}
      {related && <RelatedMaterials selection={related} onClose={() => setRelated(null)} />}
      {busy && (
        <div className="busy-indicator">
          <LoaderCircle size={18} className="spin" />
          Сохраняем изменения…
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button className="icon-button" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <div>
            <strong>Действие не выполнено</strong>
            <p>{error}</p>
          </div>
          <button className="icon-button" title="Закрыть сообщение" onClick={() => setError('')}>
            <X size={18} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
function Overview() {
  const { archive, navigate, person, photo, text, selectedPersonId } = useArchive();
  const d = archive.data;
  const photos = d.media.filter((m) => m.kind === 'photo' && m.thumb);
  const rotating = useRotatingSelection(photos, d.texts);
  const featured =
    d.people.find((p) => p.id === selectedPersonId) ||
    d.people.find((p) => p.external_id === 'I1') ||
    d.people[0];
  const stats = [
    ['people', 'Люди', d.people.length, Users],
    ['tree', 'Семейные пары', d.relationships.filter((r) => r.kind === 'partner').length, GitBranch],
    ['photos', 'Фото и документы', d.media.length, Images],
    ['texts', 'Тексты и истории', d.texts.length, BookOpen],
  ] as const;
  return (
    <>
      <div className="overview-hero">
        <div>
          <div className="eyebrow">СОХРАНЯЕМ ТО, ЧТО СВЯЗЫВАЕТ</div>
          <h1>
            У каждой семьи
            <br />
            есть своя история.
          </h1>
          <p>
            Люди, воспоминания и фотографии —<br />в одном пространстве, для будущих поколений.
          </p>
          <button className="primary" onClick={() => navigate('tree')}>
            Открыть семейное дерево
            <ArrowUpRight size={18} />
          </button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-branch b1" />
          <div className="art-branch b2" />
          <div className="art-branch b3" />
          <div className="art-leaf l1" />
          <div className="art-leaf l2" />
          <div className="art-leaf l3" />
          <div className="art-leaf l4" />
          <div className="art-ring r1" />
          <div className="art-ring r2" />
          <span className="art-caption">Корни. Память. Продолжение.</span>
        </div>
      </div>
      <div className="stats-grid">
        {stats.map(([key, label, count, Icon]) => (
          <button key={key} onClick={() => navigate(key)} className="stat-card">
            <span className="stat-icon">
              <Icon size={22} />
            </span>
            <span>
              <strong>{count}</strong>
              <small>{label}</small>
            </span>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
      <div className="overview-columns">
        <section>
          <div className="section-title">
            <h2>Лица семейной истории</h2>
            <button className="text-button" onClick={() => navigate('photos')}>
              Весь альбом
              <ArrowUpRight size={16} />
            </button>
          </div>
          <p className="rotation-caption">Случайные фотографии и истории · обновляются каждую минуту</p>
          <div className="featured-photos">
            {rotating.photos.map((m) => (
              <FeaturedPhoto key={m.id} media={m} />
            ))}
          </div>
          {!photos.length && <Empty>Добавьте первую семейную фотографию.</Empty>}
          <div className="section-title stories-title">
            <h2>Из семейных воспоминаний</h2>
            <button className="text-button" onClick={() => navigate('texts')}>
              Все тексты
              <ArrowUpRight size={16} />
            </button>
          </div>
          {rotating.stories.map((t) => (
            <button className="story-preview" key={t.id} onClick={() => text(t.id)}>
              <BookOpen size={23} />
              <div>
                <h3>{t.title}</h3>
                <p>{plainText(t.content).slice(0, 160)}…</p>
              </div>
              <ArrowUpRight size={17} />
            </button>
          ))}
        </section>
        <aside>
          <section className="overview-person">
            <div className="eyebrow">ЧЕЛОВЕК В ДЕРЕВЕ</div>
            {featured ? (
              <>
                <Avatar p={featured} size="lg" />
                <h2>{fullName(featured)}</h2>
                <p>{featured.birth_place || 'Семейная история начинается с человека'}</p>
                <button onClick={() => person(featured.id)}>
                  Открыть карточку
                  <ArrowUpRight size={16} />
                </button>
              </>
            ) : (
              <button onClick={() => navigate('people')}>Добавить человека</button>
            )}
          </section>
          <section className="share-card">
            <GitBranch size={30} />
            <h2>Дерево растёт вместе с вами</h2>
            <p>Передайте близким свою ветку и объедините семейные открытия.</p>
            <button className="text-button" onClick={() => navigate('exchange')}>
              Перейти к обмену
              <ArrowRightIcon />
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}
function ArrowRightIcon() {
  return <ArrowUpRight size={16} />;
}
function Sources() {
  const { archive, photo, run } = useArchive();
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ОТКУДА МЫ ЗНАЕМ</div>
          <h1>Источники</h1>
          <p>Исходные документы, старые выгрузки и происхождение сведений</p>
        </div>
      </div>
      <div className="sources-list">
        {archive.data.sources.map((s) => (
          <article className="source-card" key={s.id}>
            <span className="source-icon">
              <Library size={24} />
            </span>
            <div>
              <span className="eyebrow">
                {s.kind === '1c'
                  ? 'БАЗА 1С'
                  : s.kind === 'exchange'
                    ? 'ОБМЕН ВЕТКАМИ'
                    : s.kind === 'link'
                      ? 'ВНЕШНИЙ ИСТОЧНИК'
                      : 'ИСХОДНЫЙ МАТЕРИАЛ'}
              </span>
              <h3>{s.title}</h3>
              <p>{s.description}</p>
            </div>
            {s.attachment_id && (
              <button onClick={() => photo(s.attachment_id)}>
                <Download size={16} />
                Материал
              </button>
            )}
            {s.url && (
              <button onClick={() => run(() => openUrl(s.url))}>
                <ArrowUpRight size={16} />
                Открыть ссылку
              </button>
            )}
          </article>
        ))}
      </div>
      {!archive.data.sources.length && <Empty>Здесь появятся источники импортированных сведений.</Empty>}
    </>
  );
}
function HistoryPage() {
  const { archive, run } = useArchive();
  const [check, setCheck] = useState('');
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ИЗМЕНЕНИЯ БЕЗ ПОТЕРЬ</div>
          <h1>История архива</h1>
          <p>Изменения и объединения можно последовательно отменить</p>
        </div>
        <button
          onClick={() =>
            run(async () => {
              const r = await api('integrity');
              setCheck(
                r.database === 'ok' ? 'База и связи проверены. Ошибок не обнаружено.' : JSON.stringify(r),
              );
            })
          }
        >
          <ShieldCheck size={17} />
          Проверить архив
        </button>
      </div>
      {check && (
        <div className="notice">
          <CheckCircle2 size={20} />
          {check}
        </div>
      )}
      <div className="history-list">
        {archive.history.map((h) => (
          <article key={h.id} className={'history-item ' + (h.undone ? 'undone' : '')}>
            <span className="history-dot" />
            <div>
              <strong>{h.title}</strong>
              <small>
                {new Date(h.created_at).toLocaleString('ru-RU')}
                {h.undone ? ' · Отменено' : ''}
              </small>
            </div>
            {h.can_undo && (
              <button
                onClick={() =>
                  window.confirm('Отменить это действие? Состояние архива будет восстановлено.') &&
                  run(() => api('undo', { id: h.id }), 'Действие отменено')
                }
              >
                <Undo2 size={17} />
                Отменить
              </button>
            )}
          </article>
        ))}
      </div>
      {!archive.history.length && <Empty>Начальные данные загружены. Здесь появятся ваши изменения.</Empty>}
      <div className="storage-info">
        <FolderOpen size={19} />
        <div>
          <strong>Папка текущего архива</strong>
          <p>{archive.root}</p>
          <small>
            Для передачи всех данных и резервного копирования используйте «Обмен ветками → Весь архив».
          </small>
        </div>
      </div>
    </>
  );
}

