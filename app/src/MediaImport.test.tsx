// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppContext } from './context';
import { api, type Archive } from './api';
import { useMediaImport } from './MediaImport';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  fileBase64: vi.fn().mockResolvedValue('YQ=='),
  thumbnail: vi.fn().mockResolvedValue('dGh1bWI='),
  mediaUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
}));
const archive: Archive = {
  tree_id: 't',
  title: '',
  root: '',
  history: [],
  data: {
    people: [],
    relationships: [],
    tags: [],
    media: [],
    texts: [],
    text_links: [],
    sources: [],
    facts: [],
  },
};
const duplicate = { id: 'existing', title: 'Семейное фото', mime: 'image/jpeg', marked_count: 2 };
const done = vi.fn();
function Upload() {
  const { importFile, duplicateDialog } = useMediaImport();
  return (
    <>
      <button
        onClick={async () => done(await importFile(new File(['a'], 'new.jpg', { type: 'image/jpeg' })))}
      >
        Добавить
      </button>
      {duplicateDialog}
    </>
  );
}
function setup() {
  return render(
    <AppContext.Provider
      value={{
        archive,
        busy: false,
        run: async (fn) => fn(),
        reload: vi.fn(),
        notify: vi.fn(),
        photo: vi.fn(),
        person: vi.fn(),
        text: vi.fn(),
        navigate: vi.fn(),
      }}
    >
      <Upload />
    </AppContext.Provider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);
it('adds a unique file directly after checking its content', async () => {
  vi.mocked(api).mockImplementation(async (op) =>
    op === 'check_media' ? { duplicates: [] } : { id: 'new' },
  );
  setup();
  fireEvent.click(screen.getByText('Добавить'));
  await waitFor(() => expect(done).toHaveBeenCalledWith({ id: 'new' }));
  expect(vi.mocked(api).mock.calls.map(([op]) => op)).toEqual(['check_media', 'add_media']);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it.each([
  ['Использовать имеющееся', 'use', false],
  ['Добавить отдельную копию', 'copy', false],
  ['Восстановить из корзины', 'restore', true],
] as const)('previews a duplicate and only imports after %s', async (button, action, trashed) => {
  vi.mocked(api).mockImplementation(async (op) =>
    op === 'check_media'
      ? { duplicates: [{ ...duplicate, ...(trashed ? { trashed_at: '2026-11-22' } : {}) }] }
      : { id: 'existing' },
  );
  setup();
  fireEvent.click(screen.getByText('Добавить'));
  await screen.findByRole('dialog');
  expect(screen.getByAltText('Добавляемая фотография')).toBeTruthy();
  expect(await screen.findByAltText('Существующая фотография')).toBeTruthy();
  expect(screen.getByText(/есть отметки людей: 2/)).toBeTruthy();
  expect(vi.mocked(api).mock.calls.map(([op]) => op)).toEqual(['check_media']);
  fireEvent.click(screen.getByRole('button', { name: button }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(api).toHaveBeenLastCalledWith(
    'add_media',
    expect.objectContaining({ tree_id: 't', duplicate_action: action, duplicate_id: 'existing' }),
  );
});
it('skipping a duplicate creates no new record', async () => {
  vi.mocked(api).mockResolvedValue({ duplicates: [duplicate] });
  setup();
  fireEvent.click(screen.getByText('Добавить'));
  fireEvent.click(await screen.findByRole('button', { name: 'Пропустить файл' }));
  await waitFor(() => expect(done).toHaveBeenCalledWith(null));
  expect(vi.mocked(api).mock.calls.map(([op]) => op)).toEqual(['check_media']);
});
it('requests confirmation again if a duplicate appears after the preflight check', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({ duplicates: [] })
    .mockResolvedValueOnce({ needs_confirmation: true, duplicates: [duplicate] })
    .mockResolvedValueOnce({ id: 'existing', reused: true });
  setup();
  fireEvent.click(screen.getByText('Добавить'));
  await screen.findByRole('dialog');
  expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Использовать имеющееся' }));
  await waitFor(() => expect(done).toHaveBeenCalledWith({ id: 'existing', reused: true }));
  expect(api).toHaveBeenLastCalledWith(
    'add_media',
    expect.objectContaining({ duplicate_action: 'use', duplicate_id: 'existing' }),
  );
});
it('leaving the screen cancels an open duplicate decision', async () => {
  vi.mocked(api).mockResolvedValue({ duplicates: [duplicate] });
  const view = setup();
  fireEvent.click(screen.getByText('Добавить'));
  await screen.findByRole('dialog');
  await act(async () => view.unmount());
  expect(done).toHaveBeenCalledWith(null);
  expect(vi.mocked(api).mock.calls.map(([op]) => op)).toEqual(['check_media']);
});
