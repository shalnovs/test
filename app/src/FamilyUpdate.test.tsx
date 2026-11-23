// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppContext } from './context';
import { api, type Archive } from './api';
import { Tree } from './Tree';
import { Photos } from './Photos';
import { TrashDialog } from './ArchiveCleanup';
import { Events, EventPanel } from './Events';
import { PlaceSearch } from './FamilyMap';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  mediaUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
}));
const flow = vi.hoisted(() => ({ fitView: vi.fn(), setCenter: vi.fn() }));
vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: any) => children,
  ReactFlow: ({ nodes, nodeTypes }: any) => (
    <div data-testid="tree">
      {nodes.map((n: any) => {
        const Component = nodeTypes[n.type];
        return (
          <div
            key={n.id}
            data-focused={n.data.focus}
            data-person={n.id}
            data-x={n.position.x}
            data-y={n.position.y}
          >
            <Component data={n.data} />
          </div>
        );
      })}
    </div>
  ),
  useReactFlow: () => flow,
  Handle: () => null,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));
vi.mock('./MapCanvas', () => ({ MapCanvas: () => null }));
const person = vi.fn(),
  browse = vi.fn(),
  close = vi.fn(),
  done = vi.fn();
const base: Archive = {
  tree_id: 't',
  title: 'Тест',
  root: '',
  history: [],
  data: {
    people: [
      { id: 'p', given_name: 'Анна', birth_date: '2001-11-22' },
      { id: 'father', given_name: 'Иван' },
      { id: 'sister', given_name: 'Мария' },
    ],
    relationships: [
      { id: 'r1', kind: 'parent', from_id: 'father', to_id: 'p' },
      { id: 'r2', kind: 'parent', from_id: 'father', to_id: 'sister' },
    ],
    media: [
      { id: 'photo', title: 'Фотография', kind: 'photo', mime: 'image/jpeg', date: '2026-11-22' },
      { id: 'scan', title: 'Скан свидетельства', kind: 'document', mime: 'image/jpeg', date: '2026-11-22' },
      { id: 'pdf', title: 'PDF документ', kind: 'document', mime: 'application/pdf' },
    ],
    tags: [],
    texts: [],
    text_links: [],
    sources: [],
    facts: [],
    events: [],
  },
  trash: { media: [{ id: 'gone', title: 'Старое фото', trashed_at: '2026-11-22' }], texts: [] },
};
function setup(node: ReactNode, archive = base) {
  return render(
    <AppContext.Provider
      value={{
        archive,
        person,
        browse,
        busy: false,
        reload: vi.fn(),
        run: async (fn) => fn(),
        notify: vi.fn(),
        photo: vi.fn(),
        text: vi.fn(),
        event: vi.fn(),
        navigate: vi.fn(),
      }}
    >
      {node}
    </AppContext.Provider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({});
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
it('centers a clicked person while the separate arrow opens their card', async () => {
  setup(<Tree />);
  fireEvent.click(screen.getByRole('button', { name: 'В центр: Иван' }));
  const focused = screen.getByTestId('tree').querySelector('[data-focused="true"]')!;
  expect(focused.getAttribute('data-person')).toBe('father');
  expect(+focused.getAttribute('data-x')! + 30).toBe(0);
  expect(+focused.getAttribute('data-y')! + 30).toBe(0);
  expect(person).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(flow.setCenter).toHaveBeenCalledWith(0, 0, expect.objectContaining({ zoom: 0.9 })),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Карточка: Иван' }));
  expect(person).toHaveBeenCalledWith('father');
});
it('shows sibling relationships on request and refocuses from that list', () => {
  setup(<Tree />);
  fireEvent.click(screen.getByRole('button', { name: /Показать братьев/ }));
  fireEvent.click(screen.getByText('Список родственников и объяснение связей'));
  expect(screen.getByText(/Второй родитель указан не у всех/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'В центр' }));
  expect(screen.getByTestId('tree').querySelector('[data-focused="true"]')?.getAttribute('data-person')).toBe(
    'sister',
  );
});
it('keeps image documents out of the photo album and offers them in Documents', () => {
  const view = setup(<Photos />);
  expect(screen.getByRole('button', { name: /Фотография/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Скан свидетельства/ })).toBeNull();
  view.unmount();
  setup(<Photos documents />);
  expect(screen.getByRole('button', { name: /Скан свидетельства/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /PDF документ/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Фотография/ })).toBeNull();
});
it('searches for villages with district details and selects the supplied coordinates', async () => {
  const onChoose = vi.fn();
  vi.mocked(api).mockResolvedValue([
    {
      id: 123,
      name: 'Шоршелы',
      kind: 'село',
      region: 'Чувашия',
      district: 'Мариинско-Посадский',
      country: 'Россия',
      lat: 56.1,
      lon: 47.4,
    },
  ]);
  setup(<PlaceSearch onChoose={onChoose} />);
  fireEvent.change(screen.getByLabelText('Найти город, село или деревню'), {
    target: { value: 'село Шорш' },
  });
  fireEvent.click(await screen.findByRole('button', { name: /Шоршелы.*Мариинско-Посадский/ }));
  expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ name: 'Шоршелы', lat: 56.1, lon: 47.4 }));
  expect(api).toHaveBeenCalledWith('search_places', { query: 'село Шорш' });
});
it('shows annual person dates and documents on a calendar day and opens the shared selection', () => {
  setup(<Events calendar />);
  fireEvent.change(screen.getByLabelText('Месяц календаря'), { target: { value: '2026-11' } });
  const day = screen.getByRole('gridcell', { name: '22.11.2026: событий 1, фотографий 1, документов 1' });
  fireEvent.click(day);
  expect(browse).toHaveBeenCalledWith(expect.objectContaining({ kind: 'date', value: '2026-11-22' }));
  expect(screen.getByRole('button', { name: /Юбилей — 25 лет/ })).toBeTruthy();
});
it('opens a generated anniversary as read-only and navigates to the source person', () => {
  setup(<EventPanel id="vital-birth:p@2026" onClose={close} />);
  expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Изменить событие' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Открыть карточку человека' }));
  expect(person).toHaveBeenCalledWith('p');
});
it('warns and requires a separate irreversible deletion action after preview', async () => {
  vi.mocked(api).mockImplementation(async (op) =>
    op === 'purge_preview'
      ? { count: 1, people: [base.data.people[0]], tags: 1, events: 0 }
      : { count: 1, pending_files: 0 },
  );
  setup(<TrashDialog kind="media" ids={['gone']} permanent onClose={close} onDone={done} />);
  await screen.findByRole('alert');
  expect(screen.getByText(/без возможности восстановления/)).toBeTruthy();
  expect(vi.mocked(api).mock.calls.map(([op]) => op)).toEqual(['purge_preview']);
  fireEvent.click(screen.getByRole('button', { name: 'Удалить навсегда' }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith(
    'purge_items',
    expect.objectContaining({ kind: 'media', ids: ['gone'], confirm_permanent: true }),
  );
});
