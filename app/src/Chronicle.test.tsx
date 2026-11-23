// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppContext } from './context';
import { api, type Archive } from './api';
import { MediaForm, PhotoViewer } from './PhotoViewer';
import { Events } from './Events';
import { FamilyMap } from './FamilyMap';
import { RelatedMaterials } from './RelatedMaterials';
import { AutobiographyEditor, PersonPanel } from './People';
import { placeSelection } from './materials';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  mediaUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
}));
vi.mock('./MapCanvas', () => ({
  MapCanvas: ({ points = [], onSelect, onPick }: any) => (
    <div>
      {points.map((p: any) => (
        <button type="button" key={p.id} onClick={() => onSelect?.(p.id)}>
          Точка: {p.title}
        </button>
      ))}
      {onPick && (
        <button type="button" onClick={() => onPick(56.12, 47.24)}>
          Выбрать координаты
        </button>
      )}
    </div>
  ),
}));
const close = vi.fn(),
  browse = vi.fn(),
  photo = vi.fn(),
  event = vi.fn();
const archive: Archive = {
  tree_id: 'tree',
  title: 'Архив',
  root: '',
  history: [],
  data: {
    people: [{ id: 'p', given_name: 'Анна', autobiography: 'Я родилась в деревне.\nУчилась в городе.' }],
    relationships: [],
    tags: [],
    texts: [],
    text_links: [],
    sources: [],
    facts: [],
    media: [
      {
        id: 'm',
        title: 'Фото семьи',
        kind: 'photo',
        mime: 'image/jpeg',
        date: '29 Февраль 2024 г.',
        place: 'Чебоксары',
        comment: 'Комментарий',
      },
      { id: 'linked', title: 'Фото события', kind: 'photo', mime: 'image/jpeg' },
    ],
    events: [
      {
        id: 'e',
        title: 'Поездка',
        start_date: '2024-02-29',
        place: 'Чебоксары',
        media_ids: ['linked'],
        person_ids: ['p'],
      },
    ],
  },
};
function setup(node: ReactNode) {
  return render(
    <AppContext.Provider
      value={{
        archive,
        run: async (fn) => {
          try {
            return await fn();
          } catch {
            return undefined;
          }
        },
        busy: false,
        reload: vi.fn(),
        navigate: vi.fn(),
        notify: vi.fn(),
        person: vi.fn(),
        text: vi.fn(),
        photo,
        event,
        browse,
      }}
    >
      {node}
    </AppContext.Provider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ id: 'saved' });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
it('edits a real date and a map point while preserving the source date and comment', async () => {
  setup(<MediaForm media={archive.data.media[0]} onClose={close} />);
  const date = screen.getByLabelText('Дата', { exact: true }) as HTMLInputElement;
  expect(date.type).toBe('date');
  expect(date.value).toBe('2024-02-29');
  fireEvent.change(date, { target: { value: '1953-03-25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Указать на карте' }));
  fireEvent.click(screen.getByRole('button', { name: 'Выбрать координаты' }));
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith(
    'save',
    expect.objectContaining({
      kind: 'media',
      record: expect.objectContaining({
        date: '1953-03-25',
        date_precision: 'day',
        date_source_text: '29 Февраль 2024 г.',
        latitude: 56.12,
        longitude: 47.24,
        location_precision: 'point',
        comment: 'Комментарий',
      }),
    }),
  );
});
it('keeps unknown date precision and never invents the first day of a year', async () => {
  setup(<MediaForm media={{ id: 'y', title: 'Старое фото', date: '1947 г.' }} onClose={close} />);
  expect((screen.getByLabelText('Год') as HTMLInputElement).value).toBe('1947');
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      'save',
      expect.objectContaining({
        record: expect.objectContaining({
          date: '1947',
          date_precision: 'year',
          date_source_text: '1947 г.',
        }),
      }),
    ),
  );
});
it('selects a city and clears obsolete coordinates when its name is changed', async () => {
  setup(<MediaForm media={archive.data.media[1]} onClose={close} />);
  fireEvent.change(screen.getByLabelText('Найти город, село или деревню'), { target: { value: 'Чебокс' } });
  fireEvent.click(screen.getByRole('button', { name: /Чебоксары/ }));
  expect((screen.getByLabelText('Место съёмки или документа') as HTMLInputElement).value).toBe('Чебоксары');
  fireEvent.change(screen.getByLabelText('Место съёмки или документа'), {
    target: { value: 'Другое место' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      'save',
      expect.objectContaining({
        record: expect.objectContaining({ place: 'Другое место', latitude: null, longitude: null }),
      }),
    ),
  );
});
it('opens a shared list from a calendar day with both direct and event-attached photos', () => {
  setup(<Events calendar />);
  fireEvent.change(screen.getByLabelText('Месяц календаря'), { target: { value: '2024-02' } });
  fireEvent.click(screen.getByRole('gridcell', { name: '29.02.2024: событий 1, фотографий 2' }));
  expect(browse).toHaveBeenCalledWith(expect.objectContaining({ kind: 'date', value: '2024-02-29' }));
});
it('opens all materials for one grouped map marker rather than one overlapping event', () => {
  setup(<FamilyMap />);
  const marker = screen.getByRole('button', { name: 'Точка: Чебоксары · 1 событий, 2 фото, 0 документов' });
  fireEvent.click(marker);
  expect(browse).toHaveBeenCalledWith(expect.objectContaining({ kind: 'place', title: 'Чебоксары' }));
});
it('shows related photographs and events and opens the chosen record', () => {
  setup(<RelatedMaterials selection={placeSelection(archive.data.media[0])!} onClose={close} />);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getAllByRole('button').length).toBe(4);
  fireEvent.click(within(dialog).getByRole('button', { name: /Фото события/ }));
  expect(photo).toHaveBeenCalledWith('linked');
  expect(close).toHaveBeenCalledOnce();
  fireEvent.click(within(dialog).getByRole('button', { name: /Поездка/ }));
  expect(event).toHaveBeenCalledWith('e');
});
it('opens date and place lists directly from a photo', () => {
  setup(<PhotoViewer id="m" onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: '29.02.2024' }));
  expect(browse).toHaveBeenCalledWith({ kind: 'date', value: '2024-02-29' });
  fireEvent.click(screen.getByRole('button', { name: 'Чебоксары' }));
  expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'place', title: 'Чебоксары' }));
});
it('shows an autobiography and saves edits without overwriting other person fields', async () => {
  const view = setup(<PersonPanel id="p" onClose={close} />);
  expect(screen.getByText(/Я родилась в деревне/)).toBeTruthy();
  view.unmount();
  setup(<AutobiographyEditor person={archive.data.people[0]} onClose={close} />);
  fireEvent.change(screen.getByLabelText('Автобиография'), { target: { value: 'Мой рассказ\nНовая глава' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить автобиографию' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('save', {
      kind: 'people',
      record: { id: 'p', autobiography: 'Мой рассказ\nНовая глава' },
      title: 'Изменена автобиография',
    }),
  );
  expect(close).toHaveBeenCalledOnce();
});
