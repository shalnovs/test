// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Events, EventForm } from './Events';
import { MediaPicker } from './MediaPicker';
import { PersonForm } from './People';
import { AppContext } from './context';
import { api, type Archive } from './api';
import type { ReactNode } from 'react';

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  mediaUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
}));
vi.mock('./FamilyMap', () => ({ MapCanvas: () => null, PlaceSearch: () => null, eventPoint: () => null }));
const close = vi.fn(),
  openEvent = vi.fn(),
  photo = vi.fn();
const archive: Archive = {
  tree_id: 'test',
  root: '',
  title: 'test',
  history: [],
  data: {
    people: [
      {
        id: 'p',
        surname: 'Петрова',
        given_name: 'Анна',
        patronymic: 'Павловна',
        birth_surname: 'Сидорова',
        second_surname: 'Иванова',
      },
    ],
    media: [
      { id: 'm', kind: 'photo', mime: 'image/jpeg', title: 'Точное фото', date: '29 Февраль 2024 г.' },
      { id: 'y', kind: 'photo', mime: 'image/jpeg', title: 'Фото без дня', date: '2024 г.' },
    ],
    tags: [{ id: 't', person_id: 'p', media_id: 'm', x: 0.2, y: 0.1, w: 0.2, h: 0.3 }],
    relationships: [],
    texts: [],
    text_links: [],
    sources: [],
    facts: [],
    events: [
      {
        id: 'e',
        title: 'Поездка',
        description: 'История',
        start_date: '2024-02-28',
        end_date: '2024-03-02',
        place: 'Город',
        person_ids: ['p'],
        media_ids: ['m'],
        cover_media_id: 'm',
      },
    ],
  },
};
function setup(children: ReactNode) {
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
        notify: vi.fn(),
        person: vi.fn(),
        photo,
        text: vi.fn(),
        event: openEvent,
        navigate: vi.fn(),
      }}
    >
      {children}
    </AppContext.Provider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ id: 'saved' });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('event forms and calendar interactions without visual testing', () => {
  it('lists existing events and opens their cards', () => {
    setup(<Events />);
    fireEvent.click(screen.getByRole('button', { name: /Поездка/ }));
    expect(openEvent).toHaveBeenCalledWith('e');
  });
  it('shows dated photos and multi-day events, while keeping year-only photos off individual days', () => {
    setup(<Events calendar />);
    fireEvent.change(screen.getByLabelText('Месяц календаря'), { target: { value: '2024-02' } });
    const day = screen.getByRole('gridcell', { name: '29.02.2024: событий 1, фотографий 1' });
    expect(screen.getByRole('button', { name: /Фото без дня/ })).toBeTruthy();
    fireEvent.click(day);
    expect(screen.queryByRole('button', { name: /Фото без дня/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Точное фото/ }));
    expect(photo).toHaveBeenCalledWith('m');
    fireEvent.change(screen.getByLabelText('Месяц календаря'), { target: { value: '2024-03' } });
    expect(screen.getByRole('gridcell', { name: '01.03.2024: событий 1, фотографий 1' })).toBeTruthy();
  });
  it('validates dates then saves all event fields, participants and selected photographs', async () => {
    setup(<EventForm onClose={close} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Заголовок' }), {
      target: { value: 'Семейная встреча' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Начало' }), { target: { value: '2024-02-29' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Окончание' }), { target: { value: '2023-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить событие' }));
    expect(screen.getByRole('alert').textContent).toContain('раньше');
    expect(api).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Окончание' }), { target: { value: '2024-03-02' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Место события' }), {
      target: { value: 'Чебоксары' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Описание' }), {
      target: { value: 'История встречи' },
    });
    const input = screen.getByRole('combobox', { name: 'Добавить участника' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Иван Пав' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать фотографии' }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать фото: Точное фото' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить фотографии' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить событие' }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenCalledWith(
      'save',
      expect.objectContaining({
        kind: 'events',
        record: expect.objectContaining({
          title: 'Семейная встреча',
          start_date: '2024-02-29',
          end_date: '2024-03-02',
          place: 'Чебоксары',
          description: 'История встречи',
          person_ids: ['p'],
          media_ids: ['m'],
          cover_media_id: 'm',
        }),
      }),
    );
  });
  it('leaves a failed save editable and closes only the top gallery on Escape', async () => {
    vi.mocked(api).mockRejectedValue(new Error('Disk full'));
    setup(<EventForm original={archive.data.events![0]} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить событие' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать фотографии' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(close).not.toHaveBeenCalled();
  });
  it('selects a profile portrait through the gallery and preserves its tagged face crop', async () => {
    setup(<PersonForm person={archive.data.people[0]} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: /Добавить главное фото/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать фото: Точное фото' }));
    const preview = await screen.findByAltText('Предпросмотр портрета');
    Object.defineProperty(preview, 'naturalWidth', { value: 1000 });
    Object.defineProperty(preview, 'naturalHeight', { value: 800 });
    fireEvent.load(preview);
    fireEvent.click(screen.getByRole('button', { name: 'Использовать отмеченное лицо' }));
    fireEvent.click(screen.getByRole('button', { name: 'Применить портрет' }));
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const record = vi.mocked(api).mock.calls[0][1]?.record;
    expect(record.avatar_id).toBe('m');
    for (const [key, value] of Object.entries({ x: 0.12, y: 0.025, w: 0.36, h: 0.45 }))
      expect(record.avatar_crop[key]).toBeCloseTo(value);
  });
});
