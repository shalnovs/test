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
  observe = (element: Element) => {
    observers.add(this);
    this.elements.add(element);
  };
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
function setup(testArchive = archive) {
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
            archive: testArchive,
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
  localStorage.clear();
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
    return this.classList.contains('react-flow__node')
      ? this.querySelector('.tree-person-node')
        ? 250
        : 60
      : 900;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('react-flow__node')
      ? this.querySelector('.tree-person-node')
        ? 112
        : 60
      : 600;
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

it('switches real graph and tree renderers without losing focus, filters, people or relationship lines', async () => {
  const view = setup();
  await measure();
  fireEvent.click(screen.getByRole('button', { name: 'В центр: Иван' }));
  fireEvent.click(screen.getByRole('button', { name: 'Дерево' }));
  await measure();
  expect(screen.getByRole('heading', { name: 'Семейное дерево' })).toBeTruthy();
  expect(view.container.querySelector('[data-id=father] .tree-person-node.focus')).toBeTruthy();
  expect(
    [...view.container.querySelectorAll<HTMLElement>('.react-flow__node')].every(
      (n) => n.style.visibility !== 'hidden',
    ),
  ).toBe(true);
  expect(view.container.querySelectorAll('.react-flow__edge-path')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'В центр: Анна' }));
  fireEvent.click(screen.getByRole('button', { name: 'Предки' }));
  await measure();
  for (const kind of ['Граф', 'Дерево']) {
    fireEvent.click(screen.getByRole('button', { name: kind }));
    await measure();
    const nodes = [...view.container.querySelectorAll<HTMLElement>('.react-flow__node')];
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.style.visibility !== 'hidden')).toBe(true);
    expect(view.container.querySelector('[data-id=child] .focus')).toBeTruthy();
    expect(view.container.querySelectorAll('.react-flow__edge-path')).toHaveLength(1);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Карточка: Анна' }));
  expect(person).toHaveBeenCalledWith('child');
  view.unmount();
  const again = setup();
  await measure();
  expect(screen.getByRole('button', { name: 'Дерево' }).getAttribute('aria-pressed')).toBe('true');
  expect(again.container.querySelectorAll('.react-flow__node')).toHaveLength(3);
  expect(
    [...again.container.querySelectorAll<HTMLElement>('.react-flow__node')].every(
      (n) => n.style.visibility !== 'hidden',
    ),
  ).toBe(true);
  again.unmount();
  setup({ ...archive, tree_id: 'another-archive' });
  expect(screen.getByRole('button', { name: 'Граф' }).getAttribute('aria-pressed')).toBe('true');
});

it('shows the connecting parent in tree mode and preserves the siblings filter when switching back to graph', async () => {
  const view = setup();
  await measure();
  fireEvent.click(screen.getByRole('button', { name: /Показать братьев/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Дерево' }));
  await measure();
  expect(view.container.querySelectorAll('.react-flow__node')).toHaveLength(3);
  expect(view.container.querySelector('[data-id=father]')).toBeTruthy();
  expect(view.container.querySelectorAll('.react-flow__edge-path')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Граф' }));
  await measure();
  expect(view.container.querySelectorAll('.react-flow__node')).toHaveLength(2);
  expect(view.container.querySelector('[data-id=father]')).toBeNull();
  expect(view.container.querySelectorAll('.react-flow__edge-path')).toHaveLength(1);
});

it('keeps the initial graph still and returns to a still layout after ordering an animated graph', async () => {
  const view = setup();
  await measure();
  const positions = () =>
    [...view.container.querySelectorAll<HTMLElement>('.react-flow__node')].map((n) => [
      n.dataset.id,
      n.style.transform,
    ]);
  const initial = positions();
  expect(screen.getByRole('button', { name: 'Оживить' })).toBeTruthy();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
  expect(positions()).toEqual(initial);
  fireEvent.click(screen.getByRole('button', { name: 'Оживить' }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
  expect(screen.getByRole('button', { name: 'Пауза' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Упорядочить' }));
  await measure();
  const arranged = positions();
  expect(screen.getByRole('button', { name: 'Оживить' })).toBeTruthy();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
  expect(positions()).toEqual(arranged);
  expect(view.container.querySelectorAll('.react-flow__edge-path')).toHaveLength(2);
  expect(
    [...view.container.querySelectorAll<HTMLElement>('.react-flow__node')].every(
      (n) => n.style.visibility !== 'hidden',
    ),
  ).toBe(true);
});

it('preserves the arrangement when choosing another person as the graph center', async () => {
  const view = setup();
  await measure();
  const points = () =>
    new Map(
      [...view.container.querySelectorAll<HTMLElement>('.react-flow__node')].map((n) => {
        const values = n.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/)!;
        return [n.dataset.id!, { x: +values[1], y: +values[2] }];
      }),
    );
  const before = points(),
    father = before.get('father')!;
  fireEvent.click(screen.getByRole('button', { name: 'В центр: Иван' }));
  await measure();
  const after = points();
  expect(after.get('father')).toEqual({ x: -30, y: -30 });
  for (const [id, p] of before) {
    expect(after.get(id)!.x).toBeCloseTo(p.x - father.x - 30);
    expect(after.get(id)!.y).toBeCloseTo(p.y - father.y - 30);
  }
});

it('keeps a manually dragged person in place while automatic movement is off', async () => {
  const view = setup();
  await measure();
  const node = view.container.querySelector<HTMLElement>('[data-id=father]')!;
  const browserWindow = node.ownerDocument.defaultView!;
  const before = node.style.transform;
  const mouse = (target: HTMLElement | Window, type: string, init: MouseEventInit) => {
    const event = new MouseEvent(type, { ...init, bubbles: true, cancelable: true });
    // Vitest wraps Window; provide the normal browser event view after jsdom's constructor brand check.
    Object.defineProperty(event, 'view', { value: browserWindow });
    fireEvent(target, event);
  };
  mouse(node, 'mousedown', { clientX: 100, clientY: 100, button: 0, buttons: 1 });
  mouse(browserWindow, 'mousemove', { clientX: 105, clientY: 105, buttons: 1 });
  mouse(browserWindow, 'mousemove', { clientX: 340, clientY: 230, buttons: 1 });
  mouse(browserWindow, 'mouseup', { clientX: 340, clientY: 230, button: 0 });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  const moved = node.style.transform;
  expect(moved).not.toBe(before);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
  });
  expect(node.style.transform).toBe(moved);
  expect(screen.getByRole('button', { name: 'Оживить' })).toBeTruthy();
});
