import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowUpRight, Focus, Maximize, Pause, Play, RotateCcw } from 'lucide-react';
import { useArchive } from './context';
import { Avatar } from './components';
import { fullName, years, type Item } from './api';
import { graphModel, createFamilySimulation } from './graphLayout';
const colors: Record<string, string> = {
  parent: '#739f84',
  partner: '#c2a264',
  full: '#61a6a1',
  half: '#71a778',
  shared: '#879e9d',
  step: '#be916d',
  cousin: '#a18ac7',
};
function GraphPerson({ data }: NodeProps) {
  const p = data.person as Item;
  const { person } = useArchive();
  return (
    <div
      className={`graph-person ${data.focus ? 'focus' : ''} ${data.dim ? 'dim' : ''}`}
      title={`${fullName(p)} · ${years(p)}`}
    >
      {(['Top', 'Bottom', 'Left', 'Right'] as const).flatMap((side) => [
        <Handle key={'o' + side} id={'out-' + side} type="source" position={Position[side]} />,
        <Handle key={'i' + side} id={'in-' + side} type="target" position={Position[side]} />,
      ])}
      <button
        className="graph-avatar"
        aria-label={`В центр: ${fullName(p)}`}
        onClick={() => (data.onFocus as (id: string) => void)(p.id)}
      >
        <Avatar p={p} size="sm" />
      </button>
      <span className="graph-name">{fullName(p)}</span>
      <button
        className="graph-card-link nodrag"
        aria-label={`Карточка: ${fullName(p)}`}
        title="Открыть карточку"
        onClick={() => person(p.id)}
      >
        <ArrowUpRight size={14} />
      </button>
    </div>
  );
}
const types = { person: GraphPerson };
function Canvas({
  root,
  mode,
  extended,
  group,
  focusTick,
  onFocus,
}: {
  root: string;
  mode: string;
  extended: boolean;
  group: string;
  focusTick: number;
  onFocus: (id: string) => void;
}) {
  const { archive } = useArchive(),
    { setCenter, fitView } = useReactFlow();
  const model = useMemo(
    () => graphModel(archive.data, root, mode, extended, group),
    [archive.data, root, mode, extended, group],
  );
  const previous = useRef(new Map<string, { x: number; y: number }>()),
    simulation = useRef<ReturnType<typeof createFamilySimulation> | null>(null),
    dragging = useRef(false);
  const [positions, setPositions] = useState(new Map<string, { x: number; y: number }>()),
    [measurements, setMeasurements] = useState(new Map<string, { width: number; height: number }>()),
    [hover, setHover] = useState(''),
    [paused, setPaused] = useState(false),
    [restart, setRestart] = useState(0);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Controlled nodes must retain React Flow's measurements between simulation ticks.
    // Dropping them resets both node visibility and the endpoints of every relationship.
    if (changes.some((c) => c.type === 'dimensions' && c.dimensions)) {
      setMeasurements((prev) => {
        let next = prev;
        for (const c of changes) {
          if (c.type !== 'dimensions' || !c.dimensions) continue;
          const old = prev.get(c.id);
          if (old?.width === c.dimensions.width && old?.height === c.dimensions.height) continue;
          if (next === prev) next = new Map(prev);
          next.set(c.id, c.dimensions);
        }
        return next;
      });
    }
    if (changes.some((c) => c.type === 'position' && c.position)) {
      setPositions((prev) => {
        let next = prev;
        for (const c of changes) {
          if (c.type !== 'position' || !c.position) continue;
          const point = { x: c.position.x + 30, y: c.position.y + 30 };
          const old = prev.get(c.id);
          if (old?.x === point.x && old?.y === point.y) continue;
          if (next === prev) next = new Map(prev);
          next.set(c.id, point);
        }
        return next;
      });
    }
  }, []);
  useEffect(() => {
    const sim = createFamilySimulation(
      model.nodes.map((n) => ({ ...n })),
      model.links.map((l) => ({ ...l })),
      root,
      previous.current,
    );
    simulation.current = sim;
    let last = 0;
    const publish = () => {
      const points = new Map(sim.nodes().map((n) => [n.id, { x: n.x || 0, y: n.y || 0 }]));
      previous.current = points;
      setPositions(points);
    };
    sim.tick(35);
    publish();
    sim
      .on('tick', () => {
        const now = Date.now();
        if (now - last > 32) {
          last = now;
          publish();
        }
      })
      .on('end', publish);
    if (!paused) sim.restart();
    const timer = setTimeout(() => setCenter(0, 0, { zoom: 0.9, duration: 400 }), 80);
    return () => {
      sim.stop();
      clearTimeout(timer);
    };
  }, [model, root, restart, setCenter, focusTick]);
  useEffect(() => {
    if (paused) simulation.current?.stop();
    else simulation.current?.alpha(0.3).restart();
  }, [paused]);
  const adjacent = new Set([hover]);
  if (hover)
    for (const l of model.links) {
      if (l.source === hover) adjacent.add(l.target as string);
      if (l.target === hover) adjacent.add(l.source as string);
    }
  const nodes = model.nodes.map((n) => {
    const p = positions.get(n.id) || { x: 0, y: 0 };
    return {
      id: n.id,
      type: 'person',
      position: { x: p.x - 30, y: p.y - 30 },
      measured: measurements.get(n.id),
      draggable: n.id !== root,
      data: {
        person: archive.data.people.find((p) => p.id === n.id)!,
        focus: n.id === root,
        dim: !!hover && !adjacent.has(n.id),
        onFocus: (id: string) => {
          if (!dragging.current) onFocus(id);
        },
      },
    };
  });
  const edges = model.links.map((l) => {
    const a = positions.get(l.source as string) || { x: 0, y: 0 },
      b = positions.get(l.target as string) || { x: 0, y: 0 },
      dx = b.x - a.x,
      dy = b.y - a.y;
    const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'Right' : 'Left') : dy > 0 ? 'Bottom' : 'Top';
    const opposite = { Right: 'Left', Left: 'Right', Top: 'Bottom', Bottom: 'Top' }[side];
    const lit = !hover || l.source === hover || l.target === hover;
    return {
      id: l.id,
      source: l.source as string,
      target: l.target as string,
      sourceHandle: 'out-' + side,
      targetHandle: 'in-' + opposite,
      type: 'straight',
      label: hover && lit ? l.label : undefined,
      style: {
        stroke: colors[l.kind] || '#a18ac7',
        strokeWidth: lit ? 1.8 : 1,
        opacity: lit ? 0.8 : 0.12,
        strokeDasharray: l.kind === 'partner' ? '5 5' : undefined,
      },
      labelStyle: { fontSize: 11, fill: '#425c4c' },
      labelBgStyle: { fill: '#f7f9f3' },
      data: { kind: l.kind },
    };
  });
  const drag = (id: string, x: number, y: number, release = false) => {
    const sim = simulation.current,
      n = sim?.nodes().find((n) => n.id === id);
    if (!sim || !n || id === root) return;
    n.fx = release ? null : x + 30;
    n.fy = release ? null : y + 30;
    n.x = x + 30;
    n.y = y + 30;
    setPositions(new Map(sim.nodes().map((v) => [v.id, { x: v.x || 0, y: v.y || 0 }])));
    if (!paused) sim.alpha(0.35).restart();
  };
  return (
    <div className="tree-canvas family-graph" aria-label="Интерактивный граф семьи">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={types}
        minZoom={0.05}
        maxZoom={2.2}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        onNodeMouseEnter={(_, n) => setHover(n.id)}
        onNodeMouseLeave={() => setHover('')}
        onNodeDragStart={() => {
          dragging.current = true;
        }}
        onNodeDrag={(_, n) => drag(n.id, n.position.x, n.position.y)}
        onNodeDragStop={(_, n) => {
          drag(n.id, n.position.x, n.position.y, true);
          setTimeout(() => {
            dragging.current = false;
          }, 0);
        }}
        onNodesChange={onNodesChange}
      >
        <Background gap={30} color="#d4ded4" />
        <Controls showInteractive={false} />
        <MiniMap nodeColor={(n) => (n.data.focus ? '#b28e4e' : '#85a999')} pannable zoomable />
      </ReactFlow>
      <div className="graph-help">
        Перетаскивайте круги и фон · Колёсико — масштаб · Наведите на человека, чтобы подсветить связи
      </div>
      <div className="tree-view-buttons">
        <button onClick={() => setCenter(0, 0, { zoom: 0.9, duration: 350 })}>
          <Focus size={16} />К выбранному
        </button>
        <button onClick={() => fitView({ padding: 0.18, maxZoom: 1, duration: 350 })}>
          <Maximize size={16} />
          Весь граф
        </button>
        <button aria-pressed={paused} onClick={() => setPaused(!paused)}>
          {paused ? <Play size={16} /> : <Pause size={16} />} {paused ? 'Оживить' : 'Пауза'}
        </button>
        <button
          title="Перестроить граф"
          onClick={() => {
            previous.current.clear();
            setRestart((n) => n + 1);
          }}
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="graph-legend">
        {extended ? (
          <span>Линии показывают степень родства с выбранным человеком</span>
        ) : (
          <>
            <span>
              <i style={{ background: colors.parent }} />
              Родители и дети
            </span>
            <span>
              <i style={{ background: colors.partner }} />
              Брак
            </span>
          </>
        )}
      </div>
    </div>
  );
}
export function FamilyGraph(props: Parameters<typeof Canvas>[0]) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
