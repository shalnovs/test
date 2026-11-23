// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppContext } from './context';
import { ArchiveCleanup, TrashDialog } from './ArchiveCleanup';
import { PhotoViewer } from './PhotoViewer';
import { Faces } from './Faces';
import { api, type Archive } from './api';
import { hamming, similarPhotoGroups } from './photoDuplicates';
import { FACE_VERSION, scanFaces } from './faceRecognition';
import type { ReactNode } from 'react';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  mediaUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
}));
vi.mock('./faceRecognition', () => ({ FACE_VERSION: 'test-v1', scanFaces: vi.fn(), loadPhoto: vi.fn() }));
const close = vi.fn(),
  done = vi.fn();
const archive: Archive = {
  tree_id: 'tree',
  title: 'Архив',
  root: '',
  history: [],
  data: {
    people: [{ id: 'p', surname: 'Петров', given_name: 'Иван', second_surname: 'Сидоров' }],
    relationships: [],
    tags: [{ id: 't', media_id: 'm', person_id: 'p', x: null }],
    media: [
      {
        id: 'm',
        title: 'Фото семьи',
        kind: 'photo',
        mime: 'image/jpeg',
        date: '1947',
        comment: 'Старый комментарий',
      },
      { id: 'doc', title: 'Документ', kind: 'document', mime: 'application/pdf', date: '' },
    ],
    texts: [],
    text_links: [],
    sources: [],
    facts: [],
  },
  trash: {
    media: [
      {
        id: 'gone',
        title: 'Из корзины',
        filename: 'paper.pdf',
        mime: 'application/pdf',
        trashed_at: '2026-11-21T12:00:00Z',
      },
    ],
    texts: [],
  },
};
function setup(child: ReactNode) {
  return render(
    <AppContext.Provider
      value={{
        archive,
        busy: false,
        reload: vi.fn(),
        run: async (fn) => {
          try {
            return await fn();
          } catch {
            return undefined;
          }
        },
        person: vi.fn(),
        photo: vi.fn(),
        text: vi.fn(),
        navigate: vi.fn(),
        notify: vi.fn(),
      }}
    >
      {child}
    </AppContext.Provider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (op) =>
    op === 'trash_preview'
      ? { people: archive.data.people, count: 1, tags: 1, events: 0 }
      : op === 'find_duplicates'
        ? []
        : {},
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('warns about marked people and does not delete before the explicit basket action', async () => {
  setup(<TrashDialog kind="media" ids={['m']} onClose={close} onDone={done} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('Петров Иван')).toBeTruthy();
  expect(api).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'В корзину' }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith('trash_items', {
    kind: 'media',
    ids: ['m'],
    keep_id: undefined,
    confirm_marked: true,
  });
});
it('cancelling deletion preserves the material', async () => {
  setup(<TrashDialog kind="media" ids={['m']} onClose={close} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(close).toHaveBeenCalledOnce();
  expect(vi.mocked(api).mock.calls.some(([op]) => op === 'trash_items')).toBe(false);
});
it('updates dates and comments for documents through the same editor as photos', async () => {
  setup(<PhotoViewer id="doc" onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: 'Дата и комментарий' }));
  fireEvent.change(screen.getByLabelText('Дата', { exact: true }), {
    target: { value: '1953-03-25' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Комментарий' }), {
    target: { value: 'Комментарий к документу' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      'save',
      expect.objectContaining({
        kind: 'media',
        record: expect.objectContaining({
          id: 'doc',
          date: '1953-03-25',
          comment: 'Комментарий к документу',
        }),
      }),
    ),
  );
});
it('restores a basket item without involving deletion or duplicate merging', async () => {
  setup(<ArchiveCleanup />);
  fireEvent.click(screen.getByRole('button', { name: 'Корзина' }));
  fireEvent.click(
    screen
      .getAllByRole('button', { name: /^Восстановить$/ })
      .find((b) => !(b as HTMLButtonElement).disabled)!,
  );
  await waitFor(() => expect(api).toHaveBeenCalledWith('restore_items', { kind: 'media', ids: ['gone'] }));
});
it('groups close photo fingerprints but separates different aspects and distant pictures', () => {
  expect(hamming('0000000000000000', '0000000000000003')).toBe(2);
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const prints = [
    ['a', '0000000000000000', 1],
    ['b', '0000000000000001', 1.01],
    ['c', 'ffffffffffffffff', 1],
    ['d', '0000000000000000', 2],
  ].map(([id, hash, aspect]) => ({
    media_id: String(id),
    sha256: String(id),
    payload: { hash: String(hash), aspect: Number(aspect) },
  }));
  expect(similarPhotoGroups(items, prints).map((g) => g.map((m) => m.id))).toEqual([['a', 'b']]);
});
it('keeps a face group selected while choosing its person and submits only selected faces', async () => {
  const faces = [
    { id: 'm:f1', media_id: 'm', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    { id: 'm:f2', media_id: 'm', x: 0.6, y: 0.1, w: 0.2, h: 0.2 },
  ];
  vi.mocked(api).mockImplementation(async (op) =>
    op === 'face_matches'
      ? { faces: [], automatic: [], groups: [faces], people: [], indexed_faces: 2, indexed_photos: 1 }
      : op === 'face_tag_batch'
        ? { assigned: 1, confirmed: 0, conflicts: 0 }
        : {},
  );
  setup(<Faces />);
  await screen.findByText('2');
  fireEvent.click(screen.getByRole('button', { name: 'Группы похожих лиц' }));
  fireEvent.click(await screen.findByRole('button', { name: /Просмотреть группу 1/ }));
  expect(screen.getByRole('dialog', { name: /Группа 1/ })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Выбрать лицо на фото: Фото семьи' }).every(b => b.getAttribute('aria-pressed') === 'true')).toBe(true);
  const choice = screen.getByRole('combobox', { name: 'Кто в выбранной группе' });
  fireEvent.focus(choice);
  fireEvent.change(choice, { target: { value: 'Сид Ив' } });
  fireEvent.keyDown(choice, { key: 'Enter' });
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Выбрать лицо на фото: Фото семьи' })).toHaveLength(2),
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Выбрать лицо на фото: Фото семьи' })[1]);
  expect(vi.mocked(api).mock.calls.some(([op]) => op === 'face_tag_batch')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Указать человека на выбранных (1)' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('face_tag_batch', {
      version: FACE_VERSION,
      tree_id: 'tree',
      mode: 'review',
      person_id: 'p',
      face_ids: ['m:f1'],
    }),
  );
});
it('automatic marking is a separate explicit action, not a side effect of viewing suggestions', async () => {
  vi.mocked(api).mockImplementation(async (op) =>
    op === 'face_matches'
      ? {
          faces: [],
          automatic: [
            {
              id: 'm:f',
              media_id: 'm',
              suggested_person_id: 'p',
              x: 0.1,
              y: 0.1,
              w: 0.2,
              h: 0.2,
              strong: true,
            },
          ],
          groups: [],
          people: [{ id: 'p', examples: 2 }],
          indexed_faces: 3,
          indexed_photos: 3,
        }
      : { assigned: 1, confirmed: 0, conflicts: 0 },
  );
  setup(<Faces />);
  fireEvent.click(await screen.findByRole('button', { name: 'Автоматические предложения · 1' }));
  expect(vi.mocked(api).mock.calls.some(([op]) => op === 'face_tag_batch')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Автоотметить уверенные (1)' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('face_tag_batch', expect.objectContaining({ mode: 'auto' })),
  );
});
