import { useEffect, useState, useRef } from 'react';
import { Mark, mergeAttributes } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Plus,
  BookOpen,
  Save,
  Bold,
  Italic,
  List,
  Link2,
  Unlink,
  Edit3,
  ArrowLeft,
  Copy,
  Trash2,
} from 'lucide-react';
import { api, fullName, plainText, mentionedPeople, type Item } from './api';
import { useArchive } from './context';
import { Chip, Empty, PersonPicker, SearchBox } from './components';
import { TrashDialog } from './ArchiveCleanup';
declare global {
  interface Window {
    __archiveDirty?: boolean;
  }
}
const PersonLink = Mark.create({
  name: 'personLink',
  inclusive: false,
  addAttributes() {
    return {
      personId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-person-id'),
        renderHTML: (attrs) => ({ 'data-person-id': attrs.personId }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-person-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'person-mention', role: 'link', tabindex: '0' }),
      0,
    ];
  },
});
export function Texts({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const { archive, run, navigate } = useArchive();
  const [q, setQ] = useState('');
  const [pid, setPid] = useState('');
  const current = archive.data.texts.find((t) => t.id === selected);
  const list = archive.data.texts.filter(
    (t) =>
      (!pid ||
        t.author_id === pid ||
        archive.data.text_links.some((l) => l.text_id === t.id && l.person_id === pid) ||
        mentionedPeople(t.content).includes(pid)) &&
      [t.title, plainText(t.content)].join(' ').toLowerCase().includes(q.toLowerCase()),
  );
  if (current) return <TextEditor key={selected} text={current} onBack={() => onSelect('')} />;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ГОЛОСА СЕМЬИ</div>
          <h1>Тексты и воспоминания</h1>
          <p>Истории, письма и биографии, связанные с людьми</p>
        </div>
        <button
          className="primary"
          onClick={() =>
            run(async () => {
              const result = await api('save', {
                kind: 'texts',
                record: {
                  title: 'Новое воспоминание',
                  content: { type: 'doc', content: [{ type: 'paragraph' }] },
                  author_id: '',
                },
                subjects: [],
                title: 'Добавлен текст',
              });
              await api('load');
              onSelect(result.id);
            }, 'Текст создан')
          }
        >
          <Plus size={18} />
          Новый текст
        </button>
      </div>
      <div className="toolbar">
        <button onClick={() => navigate('cleanup')}>
          <Copy size={16} />
          Дубли и корзина
        </button>
        <SearchBox value={q} onChange={setQ} placeholder="Искать в названиях и содержании" />
        <PersonPicker value={pid} onChange={setPid} empty="Все люди" />
      </div>
      <div className="texts-grid">
        {list.map((t) => (
          <button className="text-card" key={t.id} onClick={() => onSelect(t.id)}>
            <div className="text-card-icon">
              <BookOpen size={21} />
            </div>
            <h3>{t.title}</h3>
            <p>{plainText(t.content).slice(0, 230)}</p>
            <footer>
              <span>
                {t.author_id
                  ? fullName(archive.data.people.find((p) => p.id === t.author_id))
                  : 'Автор не указан'}
              </span>
              <small>{Math.max(1, Math.round(plainText(t.content).length / 1100))} мин чтения</small>
            </footer>
          </button>
        ))}
      </div>
      {!list.length && <Empty>Добавьте историю вашей семьи.</Empty>}
    </>
  );
}
function TextEditor({ text, onBack }: { text: Item; onBack: () => void }) {
  const { archive, run, person } = useArchive();
  const [title, setTitle] = useState(text.title);
  const [author, setAuthor] = useState(text.author_id || '');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [subjects, setSubjects] = useState<string[]>(
    archive.data.text_links.filter((l) => l.text_id === text.id).map((l) => l.person_id),
  );
  const [mention, setMention] = useState('');
  const selection = useRef({ from: 0, to: 0 });
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false }), PersonLink],
    content: text.content,
    editable: false,
    onUpdate: () => setDirty(true),
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from !== to) selection.current = { from, to };
    },
    editorProps: {
      attributes: { class: 'story-body', 'aria-label': 'Текст воспоминания' },
      handleClick: (_view, _pos, event) => {
        const target = (event.target as HTMLElement).closest('[data-person-id]');
        if (target && !window.__archiveDirty) {
          const id = target.getAttribute('data-person-id');
          if (id) {
            person(id);
            return true;
          }
        }
        return false;
      },
    },
  });
  useEffect(() => {
    editor?.setEditable(editing, false);
  }, [editor, editing]);
  useEffect(() => {
    window.__archiveDirty = dirty;
    return () => {
      window.__archiveDirty = false;
    };
  }, [dirty]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const save = () =>
    run(async () => {
      await api('save', {
        kind: 'texts',
        record: {
          ...text,
          title: title.trim() || 'Без названия',
          author_id: author,
          content: editor?.getJSON(),
        },
        subjects,
        title: 'Сохранён текст: ' + title,
      });
      setDirty(false);
      setEditing(false);
    }, 'Текст и ссылки сохранены');
  const addMention = () => {
    if (!editor || !mention) return;
    const { from, to } = selection.current;
    if (from === to) {
      window.alert('Сначала выделите в тексте имя или нужные слова.');
      return;
    }
    editor.chain().focus().setTextSelection({ from, to }).setMark('personLink', { personId: mention }).run();
    setMention('');
  };
  return (
    <>
      <div className="story-top">
        <button className="subtle" onClick={onBack}>
          <ArrowLeft size={17} />
          Все тексты
        </button>
        <div className="row">
          <button
            className="icon-button danger-on-hover"
            aria-label="Переместить текст в корзину"
            title="В корзину"
            onClick={() => {
              if (
                !dirty ||
                window.confirm('Есть несохранённые изменения. Переместить сохранённый текст в корзину?')
              )
                setDeleting(true);
            }}
          >
            <Trash2 size={18} />
          </button>
          <span className={'save-state ' + (dirty ? 'dirty' : '')}>
            {dirty ? 'Есть несохранённые изменения' : 'Сохранено'}
          </span>
          {editing ? (
            <button className="primary" onClick={save}>
              <Save size={17} />
              Сохранить
            </button>
          ) : (
            <button onClick={() => setEditing(true)}>
              <Edit3 size={17} />
              Редактировать и отмечать
            </button>
          )}
        </div>
      </div>
      <div className="story-layout">
        <article className="story-paper">
          <div className="eyebrow">СЕМЕЙНАЯ ИСТОРИЯ</div>
          {editing ? (
            <input
              className="story-title-input"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              aria-label="Название текста"
            />
          ) : (
            <h1>{title}</h1>
          )}
          <p className="story-byline">
            {author ? fullName(archive.data.people.find((p) => p.id === author)) : 'Автор не указан'}
          </p>
          {editing && (
            <div className="editor-toolbar">
              <button
                title="Полужирный"
                className={editor?.isActive('bold') ? 'active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              >
                <Bold size={16} />
              </button>
              <button
                title="Курсив"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              >
                <Italic size={16} />
              </button>
              <button
                title="Список"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              >
                <List size={16} />
              </button>
              <span className="divider" />
              <PersonPicker value={mention} onChange={setMention} empty="Кто упомянут в выделенном тексте" />
              <button title="Связать выделенный текст с человеком" disabled={!mention} onClick={addMention}>
                <Link2 size={17} />
                Отметить
              </button>
              <button
                title="Убрать ссылку на человека"
                onClick={() => editor?.chain().focus().unsetMark('personLink').run()}
              >
                <Unlink size={16} />
              </button>
            </div>
          )}
          <EditorContent editor={editor} />
        </article>
        <aside className="story-sidebar">
          <h3>О ком этот текст</h3>
          <p className="muted">Связь относится ко всему документу.</p>
          <div className="chip-list">
            {subjects.map((id) => (
              <span className="subject-chip" key={id}>
                <button onClick={() => person(id)}>
                  {fullName(archive.data.people.find((p) => p.id === id))}
                </button>
                {editing && (
                  <button
                    title="Убрать связь с текстом"
                    onClick={() => {
                      setSubjects(subjects.filter((x) => x !== id));
                      setDirty(true);
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          {editing && (
            <PersonPicker
              value=""
              exclude={subjects}
              onChange={(id) => {
                if (id) {
                  setSubjects([...subjects, id]);
                  setDirty(true);
                }
              }}
              empty="Связать весь текст с человеком"
            />
          )}
          <div className="sidebar-rule" />
          <h3>Автор</h3>
          {editing ? (
            <PersonPicker
              value={author}
              onChange={(id) => {
                setAuthor(id);
                setDirty(true);
              }}
              empty="Автор не указан"
            />
          ) : (
            <p>{author ? fullName(archive.data.people.find((p) => p.id === author)) : 'Не указан'}</p>
          )}
          <div className="sidebar-rule" />
          <h3>Упоминания в тексте</h3>
          <p className="muted">
            В режиме редактирования выделите любые слова и нажмите «Отметить». Ссылка останется связана с
            человеком при редактировании и обмене ветками.
          </p>
          <div className="chip-list">
            {mentionedPeople(editor?.getJSON() || text.content).map((id) => (
              <Chip key={id} onClick={() => person(id)}>
                {fullName(archive.data.people.find((p) => p.id === id))}
              </Chip>
            ))}
          </div>
        </aside>
      </div>
      {deleting && (
        <TrashDialog
          kind="texts"
          ids={[text.id]}
          onClose={() => setDeleting(false)}
          onDone={() => {
            window.__archiveDirty = false;
            onBack();
          }}
        />
      )}
    </>
  );
}
