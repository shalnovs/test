// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppContext } from './context';
import { api, pickFile, type Archive } from './api';
import { ImportBranch } from './Exchange';

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  pickFile: vi.fn(),
  mediaUrl: vi.fn().mockResolvedValue(''),
}));
const archive: Archive = {
  tree_id: 'tree',
  title: 'Тест',
  root: '',
  history: [],
  data: {
    people: [{ id: 'local', given_name: 'Анна', surname: 'Тестова', birth_date: '1980' }],
    relationships: [],
    media: [],
    tags: [],
    texts: [],
    text_links: [],
    sources: [],
    facts: [],
    events: [],
  },
};
const preview = {
  title: 'GEDCOM — family.ged',
  gedcom_version: '5.5.1',
  encoding: 'UTF-8',
  fingerprint: 'fingerprint',
  tree_id: 'tree',
  counts: { people: 2, relationships: 1, media: 1, texts: 1, events: 1 },
  warnings: ['Дата «ABT 1950» сохранена как неточная'],
  people: [
    {
      incoming: {
        id: 'i1',
        given_name: 'Анна',
        surname: 'Тестова',
        birth_date: '1981',
        second_surname: 'Примерова',
      },
      known_id: null,
      candidates: [{ id: 'local', name: 'Тестова Анна', reasons: ['имя и фамилия'] }],
    },
    { incoming: { id: 'i2', given_name: 'Иван', surname: 'Примеров' }, known_id: null, candidates: [] },
  ],
};
function context(tree = 'tree') {
  return {
    archive: { ...archive, tree_id: tree },
    busy: false,
    reload: vi.fn(),
    notify: vi.fn(),
    person: vi.fn(),
    photo: vi.fn(),
    text: vi.fn(),
    navigate: vi.fn(),
    run: async <T,>(fn: () => Promise<T>) => fn(),
  };
}
function setup(format: 'gedcom' | 'familyzip' = 'gedcom') {
  return render(
    <AppContext.Provider value={context()}>
      <ImportBranch format={format} />
    </AppContext.Provider>,
  );
}
async function choose() {
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать GEDCOM' }));
  await screen.findByText('Сопоставьте людей');
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pickFile).mockResolvedValue('family.ged');
  vi.mocked(api).mockImplementation(async (op) =>
    op.endsWith('preview') ? structuredClone(preview) : { added: 1, matched: 1, conflicts: 1 },
  );
});
afterEach(cleanup);

it('previews first, requires ambiguous matches to be decided, then imports the reviewed file', async () => {
  setup();
  await choose();
  expect(pickFile).toHaveBeenCalledWith(false, '', ['ged', 'gedcom']);
  expect(api).toHaveBeenCalledExactlyOnceWith('gedcom_preview', {
    path: 'family.ged',
    encoding: 'auto',
    include_media: false,
  });
  expect(screen.getByText(/ABT 1950/)).toBeTruthy();
  expect(screen.getByText('Примерова')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Подтвердить импорт' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByRole('combobox', { name: 'Сопоставление: Тестова Анна' }), {
    target: { value: 'local' },
  });
  expect(button.disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '1 различий' }));
  fireEvent.click(screen.getByRole('radio', { name: /В полученной ветке/ }));
  fireEvent.click(button);
  await screen.findByText('История семьи дополнена');
  expect(api).toHaveBeenLastCalledWith('gedcom_import', {
    path: 'family.ged',
    encoding: 'auto',
    include_media: false,
    tree_id: 'tree',
    fingerprint: 'fingerprint',
    decisions: { i1: 'local', i2: '__new__' },
    resolutions: { 'i1:birth_date': 'incoming' },
  });
});
it('does not read or import a file after the chooser is cancelled', async () => {
  vi.mocked(pickFile).mockResolvedValue(null);
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать GEDCOM' }));
  await waitFor(() => expect(pickFile).toHaveBeenCalledOnce());
  expect(api).not.toHaveBeenCalled();
});
it('requires a new preview after encoding or attachment settings change', async () => {
  setup();
  await choose();
  fireEvent.click(screen.getByRole('checkbox', { name: /Загрузить фотографии/ }));
  expect(screen.queryByText('Сопоставьте людей')).toBeNull();
  await choose();
  expect(api).toHaveBeenLastCalledWith('gedcom_preview', {
    path: 'family.ged',
    encoding: 'auto',
    include_media: true,
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Кодировка GEDCOM' }), {
    target: { value: 'windows-1251' },
  });
  expect(screen.queryByText('Сопоставьте людей')).toBeNull();
  await choose();
  expect(api).toHaveBeenLastCalledWith('gedcom_preview', {
    path: 'family.ged',
    encoding: 'windows-1251',
    include_media: true,
  });
});
it('discards preview and matching decisions when the active archive changes', async () => {
  const view = setup();
  await choose();
  view.rerender(
    <AppContext.Provider value={context('other')}>
      <ImportBranch format="gedcom" />
    </AppContext.Provider>,
  );
  expect(screen.queryByText('Сопоставьте людей')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Подтвердить импорт' })).toBeNull();
});
it('keeps the existing familyzip import available with its original command', async () => {
  setup('familyzip');
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать файл' }));
  await screen.findByText('Сопоставьте людей');
  expect(pickFile).toHaveBeenCalledWith(false, '', ['familyzip']);
  expect(api).toHaveBeenCalledWith('import_preview', expect.objectContaining({ path: 'family.ged' }));
});
