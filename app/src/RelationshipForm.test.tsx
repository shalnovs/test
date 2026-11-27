// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppContext } from './context';
import { api, type Archive } from './api';
import { RelationshipForm } from './RelationshipForm';

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  mediaUrl: vi.fn().mockResolvedValue(''),
}));
const close = vi.fn(),
  person = vi.fn(),
  selectPerson = vi.fn(),
  error = vi.fn();
const archive: Archive = {
  tree_id: 'tree',
  title: 'Тест',
  root: '',
  history: [],
  data: {
    people: [
      { id: 'root', given_name: 'Иван' },
      { id: 'known', surname: 'Тестова', given_name: 'Мария', birth_date: '1950' },
    ],
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
function setup() {
  return render(
    <AppContext.Provider
      value={{
        archive,
        busy: false,
        reload: vi.fn(),
        notify: vi.fn(),
        person,
        selectPerson,
        photo: vi.fn(),
        text: vi.fn(),
        navigate: vi.fn(),
        run: async (fn) => {
          try {
            return await fn();
          } catch (e) {
            error(e);
            return undefined;
          }
        },
      }}
    >
      <RelationshipForm root="root" onClose={close} />
    </AppContext.Provider>,
  );
}
function create() {
  fireEvent.click(screen.getByRole('button', { name: 'Создать человека' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Фамилия' }), {
    target: { value: 'Тестова' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Имя' }), { target: { value: 'Мария' } });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ id: 'new' });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

it('creates a person and their relationship in one request without leaving the original card', async () => {
  setup();
  create();
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Создать и сохранить связь' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledExactlyOnceWith(
    'save_relative',
    expect.objectContaining({
      tree_id: 'tree',
      root_id: 'root',
      relation: 'mother',
      target_id: '',
      new_person: expect.objectContaining({ surname: 'Тестова', given_name: 'Мария', gender: 'F' }),
    }),
  );
  expect(person).not.toHaveBeenCalled();
  expect(selectPerson).toHaveBeenCalledWith('new');
});
it('cancels an unsaved relative without creating a card', () => {
  setup();
  create();
  fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(api).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it('retains the draft and original relationship when saving fails', async () => {
  vi.mocked(api).mockRejectedValue(new Error('Дата смерти раньше рождения'));
  setup();
  create();
  fireEvent.click(screen.getByRole('button', { name: 'Создать и сохранить связь' }));
  await waitFor(() => expect(error).toHaveBeenCalledOnce());
  expect((screen.getByRole('textbox', { name: 'Имя' }) as HTMLInputElement).value).toBe('Мария');
  expect(close).not.toHaveBeenCalled();
  expect(selectPerson).not.toHaveBeenCalled();
});
it('offers a matching person and saves only a link if that person is chosen', async () => {
  setup();
  create();
  fireEvent.click(screen.getByRole('button', { name: /Выбрать: Тестова Мария/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить связь' }));
  await waitFor(() => expect(api).toHaveBeenCalledOnce());
  expect(vi.mocked(api).mock.calls[0]).toEqual([
    'save_relative',
    {
      tree_id: 'tree',
      root_id: 'root',
      relation: 'mother',
      target_id: 'known',
      start_date: '',
    },
  ]);
});
it('can continue adding relatives to the same person after a successful save', async () => {
  setup();
  create();
  fireEvent.click(screen.getByRole('checkbox', { name: /После сохранения/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Создать и сохранить связь' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Найти родственника' })).toBeTruthy());
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Создать человека' }));
  expect((screen.getByRole('textbox', { name: 'Имя' }) as HTMLInputElement).value).toBe('');
  expect(screen.getByText('Иван')).toBeTruthy();
});
