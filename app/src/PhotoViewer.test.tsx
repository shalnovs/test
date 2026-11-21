// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from './context';
import { PhotoViewer } from './PhotoViewer';
import { api, type Archive, type Item } from './api';
import { detectFaces } from './faceDetection';
import { useRotatingSelection } from './useRotatingSelection';

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  mediaUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
}));
vi.mock('./faceDetection', () => ({ detectFaces: vi.fn() }));
const person = vi.fn(),
  notify = vi.fn(),
  close = vi.fn();
const archive = (tags: Item[] = []): Archive => ({
  tree_id: 'test',
  title: 'Test',
  root: '',
  history: [],
  data: {
    people: [
      { id: 'p1', given_name: 'Анна', surname: 'Тестовая' },
      { id: 'p2', given_name: 'Иван', surname: 'Тестовый' },
    ],
    media: [{ id: 'm1', mime: 'image/jpeg', title: 'Тестовое фото' }],
    tags,
    relationships: [],
    texts: [],
    text_links: [],
    sources: [],
    facts: [],
  },
});
function setup(tags: Item[] = []) {
  const context = {
    archive: archive(tags),
    run: async <T,>(fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch {
        return undefined;
      }
    },
    reload: vi.fn(),
    notify,
    person,
    photo: vi.fn(),
    text: vi.fn(),
    navigate: vi.fn(),
    busy: false,
  };
  return render(
    <AppContext.Provider value={context}>
      <PhotoViewer id="m1" onClose={close} />
    </AppContext.Provider>,
  );
}
async function prepare(tags: Item[] = []) {
  const view = setup(tags);
  const img = await screen.findByAltText('Тестовое фото');
  fireEvent.load(img);
  fireEvent.click(screen.getByRole('button', { name: 'Разметка' }));
  const stage = view.container.querySelector('.image-stage') as HTMLDivElement;
  stage.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 500,
    height: 400,
    right: 500,
    bottom: 400,
    toJSON: () => ({}),
  });
  return stage;
}
function drag(stage: HTMLDivElement) {
  fireEvent.pointerDown(stage, { button: 0, pointerId: 1, clientX: 50, clientY: 40 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 150, clientY: 160 });
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 150, clientY: 160 });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({});
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => true;
  HTMLElement.prototype.releasePointerCapture = vi.fn();
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('photo annotation', () => {
  it('automatically saves a known person once, retaining an existing unframed tag', async () => {
    const stage = await prepare([
      { id: 'tag1', media_id: 'm1', person_id: 'p1', comment: 'Existing source', x: null },
    ]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Выбрать до выделения' }), {
      target: { value: 'p1' },
    });
    drag(stage);
    fireEvent.pointerUp(stage, { clientX: 150, clientY: 160 });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const record = vi.mocked(api).mock.calls[0][1]?.record;
    expect(record).toMatchObject({ id: 'tag1', person_id: 'p1', comment: 'Existing source', x: 0.1, y: 0.1 });
    expect(record.w).toBeCloseTo(0.2);
    expect(record.h).toBeCloseTo(0.3);
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Выбор человека для отметки' })).toBeNull(),
    );
  });
  it('keeps an unknown draft by the photograph until an explicit icon save', async () => {
    const stage = await prepare();
    drag(stage);
    expect(api).not.toHaveBeenCalled();
    expect(stage.contains(screen.getByRole('group', { name: 'Выбор человека для отметки' }))).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Человек пока неизвестен' }), {
      target: { value: 'p2' },
    });
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить отметку' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api).mock.calls[0][1]?.record.person_id).toBe('p2');
  });
  it('cancels unknown selections and aborted drags without writing', async () => {
    const stage = await prepare();
    drag(stage);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить отметку' }));
    fireEvent.pointerDown(stage, { button: 0, clientX: 50, clientY: 40 });
    fireEvent.pointerMove(stage, { clientX: 150, clientY: 160 });
    fireEvent.pointerCancel(stage);
    fireEvent.pointerUp(stage, { clientX: 150, clientY: 160 });
    expect(api).not.toHaveBeenCalled();
    expect(stage.querySelector('.draft')).toBeNull();
  });
  it('retains a failed autosave for retry and reuses its ID', async () => {
    const stage = await prepare();
    fireEvent.change(screen.getByRole('combobox', { name: 'Выбрать до выделения' }), {
      target: { value: 'p1' },
    });
    vi.mocked(api).mockRejectedValueOnce(new Error('Disk unavailable'));
    drag(stage);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const recordId = vi.mocked(api).mock.calls[0][1]?.record.id;
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Сохранить отметку' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить отметку' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api).mock.calls[1][1]?.record.id).toBe(recordId);
  });
  it('opens a person in view mode and switches markers to editing only on request', async () => {
    setup([{ id: 't1', media_id: 'm1', person_id: 'p1', x: 0.1, y: 0.2, w: 0.2, h: 0.3 }]);
    fireEvent.load(await screen.findByAltText('Тестовое фото'));
    const hotspot = screen
      .getAllByRole('button', { name: 'Тестовая Анна' })
      .find((b) => b.classList.contains('face-tag'))!;
    expect(hotspot.classList.contains('view-only')).toBe(true);
    fireEvent.click(hotspot);
    expect(person).toHaveBeenCalledWith('p1');
    expect(api).not.toHaveBeenCalled();
  });
  it('never saves or assigns identity to detected faces without a manual choice', async () => {
    const stage = await prepare();
    fireEvent.change(screen.getByRole('combobox', { name: 'Выбрать до выделения' }), {
      target: { value: 'p1' },
    });
    vi.mocked(detectFaces).mockResolvedValue([{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Найти лица' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Найденное лицо 1' }));
    expect(
      (screen.getByRole('combobox', { name: 'Человек пока неизвестен' }) as HTMLSelectElement).value,
    ).toBe('');
    expect(api).not.toHaveBeenCalled();
    expect(stage.querySelector('.tag-popover')).not.toBeNull();
  });
});

it('rotates both home sections after one minute and clears the timer on unmount', () => {
  vi.useFakeTimers();
  const items = Array.from({ length: 8 }, (_, i) => ({ id: String(i) }));
  function Preview() {
    const result = useRotatingSelection(items, items);
    return <output>{JSON.stringify(result)}</output>;
  }
  const view = render(<Preview />);
  const before = JSON.parse(screen.getByRole('status').textContent!);
  act(() => {
    vi.advanceTimersByTime(59_999);
  });
  expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(before);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  const after = JSON.parse(screen.getByRole('status').textContent!);
  expect(after.photos.some((p: Item) => before.photos.some((old: Item) => old.id === p.id))).toBe(false);
  expect(after.stories.some((p: Item) => before.stories.some((old: Item) => old.id === p.id))).toBe(false);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
