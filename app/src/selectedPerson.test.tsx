// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSelectedPerson } from './selectedPerson';
import { api, type Archive } from './api';
import App from './App';
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
  mediaUrl: vi.fn().mockResolvedValue('data:image/png;base64,AA=='),
}));
vi.mock('./nativeClose', () => ({ installNativeClose: () => () => {} }));
vi.mock('./MapCanvas', () => ({ MapCanvas: () => null }));
vi.mock('./faceRecognition', () => ({ FACE_VERSION: 'test', scanFaces: vi.fn(), loadPhoto: vi.fn() }));
const archive: Archive = {
  tree_id: 't',
  title: 'Семья',
  root: '',
  history: [],
  data: {
    people: [
      { id: 'a', given_name: 'Анна', external_id: 'I1' },
      { id: 'b', given_name: 'Борис' },
    ],
    relationships: [],
    tags: [],
    media: [],
    texts: [],
    text_links: [],
    sources: [],
    facts: [],
    events: [],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.__archiveDirty = false;
  vi.mocked(api).mockResolvedValue(archive);
});
afterEach(cleanup);
it('persists an explicit selection across restarts and keeps each archive independent', () => {
  const first = renderHook(({ value }) => useSelectedPerson(value), { initialProps: { value: archive } });
  expect(first.result.current[0]).toBe('a');
  act(() => first.result.current[1]('b'));
  expect(first.result.current[0]).toBe('b');
  first.rerender({ value: { ...archive, tree_id: 'second' } });
  expect(first.result.current[0]).toBe('a');
  first.rerender({ value: archive });
  expect(first.result.current[0]).toBe('b');
  first.unmount();
  const next = renderHook(() => useSelectedPerson(archive));
  expect(next.result.current[0]).toBe('b');
  act(() => next.result.current[1](''));
  expect(next.result.current[0]).toBe('b');
});
it('falls back to an existing person when a saved selection is no longer in the archive', () => {
  localStorage.setItem('family-selected-person:t', 'removed');
  const hook = renderHook(() => useSelectedPerson(archive));
  expect(hook.result.current[0]).toBe('a');
});
it('shows the person selected from their card and photo filter on the home page after navigation and restart', async () => {
  const view = render(<App />);
  await screen.findByText('ЧЕЛОВЕК В ДЕРЕВЕ');
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /Люди/ }));
  fireEvent.click(screen.getByRole('button', { name: /Борис/ }));
  fireEvent.click(screen.getByTitle('Закрыть карточку'));
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Обзор' }));
  expect(
    within(document.querySelector('.overview-person') as HTMLElement).getByRole('heading', { name: 'Борис' }),
  ).toBeTruthy();
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Фотоальбом' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a' } });
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Обзор' }));
  expect(
    within(document.querySelector('.overview-person') as HTMLElement).getByRole('heading', { name: 'Анна' }),
  ).toBeTruthy();
  view.unmount();
  render(<App />);
  await screen.findByText('ЧЕЛОВЕК В ДЕРЕВЕ');
  expect(
    within(document.querySelector('.overview-person') as HTMLElement).getByRole('heading', { name: 'Анна' }),
  ).toBeTruthy();
});
