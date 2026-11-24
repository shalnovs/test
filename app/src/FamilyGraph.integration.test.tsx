// @vitest-environment jsdom
import { StrictMode, Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppContext } from './context';
import type { Archive } from './api';
import { Tree } from './Tree';
// Use the real React Flow renderer and store. Only browser measurements are supplied by this test.
const observers = new Set<TestResizeObserver>();
class TestResizeObserver {
  elements = new Set<Element>();
  constructor(public callback: ResizeObserverCallback) {
    observers.add(this);
  }
  observe = (element: Element) => this.elements.add(element);
  unobserve = (element: Element) => this.elements.delete(element);
  disconnect = () => {
    this.elements.clear();
    observers.delete(this);
  };
}
async function measure() {
  await act(async () => {
    for (const observer of [...observers])
      observer.callback(
        [...observer.elements].map((target) => ({
          target,
          contentRect: target.getBoundingClientRect(),
        })) as ResizeObserverEntry[],
        observer as unknown as ResizeObserver,
      );
  });
}
const archive: Archive = {
  tree_id: 'graph-test',
  root: '',
  title: '',
  history: [],
  data: {
    people: [
      { id: 'child', given_name: 'Анна' },
      { id: 'father', given_name: 'Иван' },
      { id: 'sister', given_name: 'Мария' },
    ],
    relationships: [
      { id: 'a', kind: 'parent', from_id: 'father', to_id: 'child' },
      { id: 'b', kind: 'parent', from_id: 'father', to_id: 'sister' },
    ],
    media: [],
    tags: [],
    texts: [],
    text_links: [],
    sources: [],
    facts: [],
  },
};
const person = vi.fn();
function setup() {
  let renders = 0;
  return render(
    <Profiler
      id="graph"
      onRender={() => {
        if (++renders > 200) throw new Error('Graph update loop: more than 200 commits');
      }}
    >
      <StrictMode>
        <AppContext.Provider
          value={{
            archive,
            person,
            run: async (fn) => fn(),
            reload: vi.fn(),
            notify: vi.fn(),
            photo: vi.fn(),
            text: vi.fn(),
            navigate: vi.fn(),
            busy: false,
          }}
        >
          <Tree />
        </AppContext.Provider>
      </StrictMode>
    </Profiler>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22 = 1;
    },
  );
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 100, height: 16 }),
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('react-flow__node') ? 60 : 900;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('react-flow__node') ? 60 : 600;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: this.offsetWidth,
      bottom: this.offsetHeight,
      width: this.offsetWidth,
      height: this.offsetHeight,
      toJSON() {
        return {};
      },
    };
  });
});
afterEach(() => {
  cleanup();
  observers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (SVGElement.prototype as any).getBBox;
});
it('keeps measured people and relationship lines visible after simulation and hover updates', async () => {
  const view = setup();
  await measure();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
  await measure();
  const nodes = [...view.container.querySelectorAll<HTMLElement>('.react-flow__node')];
  expect(nodes).toHaveLength(3);
  expect(nodes.every((n) => n.style.visibility !== 'hidden')).toBe(true);
  expect(view.container.querySelectorAll('.react-flow__edge-path')).toHaveLength(2);
  fireEvent.mouseEnter(nodes[1]);
  expect(nodes.every((n) => n.style.visibility !== 'hidden')).toBe(true);
  fireEvent.mouseLeave(nodes[1]);
  fireEvent.click(screen.getByRole('button', { name: /Показать братьев/ }));
  await measure();
  expect(view.container.querySelectorAll('.react-flow__node')).toHaveLength(2);
  expect(view.container.querySelectorAll('.react-flow__edge-path')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Вся семья' }));
  await measure();
  expect(view.container.querySelectorAll('.react-flow__edge-path')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'В центр: Иван' }));
  await measure();
  expect(view.container.querySelector('[data-id=father] .graph-person.focus')).toBeTruthy();
  expect(
    [...view.container.querySelectorAll<HTMLElement>('.react-flow__node')].every(
      (n) => n.style.visibility !== 'hidden',
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Карточка: Иван' }));
  expect(person).toHaveBeenCalledWith('father');
});
