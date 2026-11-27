import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowUpRight, Focus, Maximize } from 'lucide-react';
import { useArchive } from './context';
import { Avatar } from './components';
import { fullName, years, type Item } from './api';
import { treeLayout, TREE_CARD_WIDTH, TREE_CARD_HEIGHT } from './treeLayout';

function TreePerson({ data }: NodeProps) {
  const p = data.person as Item;
  const { person } = useArchive();
  return (
    <div className={`tree-person-node ${data.focus ? 'focus' : ''}`} title={fullName(p)}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      {(['Left', 'Right'] as const).flatMap((side) => [
        <Handle key={'out-' + side} id={'out-' + side} type="source" position={Position[side]} />,
        <Handle key={'in-' + side} id={'in-' + side} type="target" position={Position[side]} />,
      ])}
      <button
        className="tree-person"
        aria-label={`В центр: ${fullName(p)}`}
        onClick={() => (data.onFocus as (id: string) => void)(p.id)}
      >
        <Avatar p={p} size="sm" />
        <span>
          <strong>{p.surname || p.given_name || 'Без имени'}</strong>
          <small>{p.surname ? [p.given_name, p.patronymic].filter(Boolean).join(' ') : p.patronymic}</small>
          <em>{years(p)}</em>
        </span>
      </button>
      <button
        className="tree-open-card icon"
        title="Открыть карточку"
        aria-label={`Карточка: ${fullName(p)}`}
        onClick={() => person(p.id)}
      >
        <ArrowUpRight size={17} />
      </button>
    </div>
  );
}
const nodeTypes = { treePerson: TreePerson };
type Props = {
  root: string;
  mode: string;
  extended: boolean;
  group: string;
  focusTick: number;
  onFocus: (id: string) => void;
};

function Canvas({ root, mode, extended, group, focusTick, onFocus }: Props) {
  const { archive } = useArchive();
  const { setCenter, fitView } = useReactFlow();
  const model = useMemo(
    () => treeLayout(archive.data, root, mode, extended, group),
    [archive.data, root, mode, extended, group],
  );
  const [measurements, setMeasurements] = useState(new Map<string, { width: number; height: number }>());
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (!changes.some((c) => c.type === 'dimensions' && c.dimensions)) return;
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
  }, []);
  const nodes = model.people.map((p) => {
    const point = model.positions.get(p.id)!;
    return {
      id: p.id,
      type: 'treePerson',
      position: { x: point.x - TREE_CARD_WIDTH / 2, y: point.y - TREE_CARD_HEIGHT / 2 },
      measured: measurements.get(p.id),
      data: { person: p, focus: p.id === root, onFocus },
    };
  });
  const edges = model.relationships.map((r) => {
    const marriage = r.kind === 'partner';
    const toRight = model.positions.get(r.from_id)!.x <= model.positions.get(r.to_id)!.x;
    return {
      id: r.id,
      source: r.from_id,
      target: r.to_id,
      sourceHandle: marriage ? 'out-' + (toRight ? 'Right' : 'Left') : undefined,
      targetHandle: marriage ? 'in-' + (toRight ? 'Left' : 'Right') : undefined,
      type: marriage ? 'straight' : 'smoothstep',
      style: {
        stroke: marriage ? '#bb9b72' : '#739580',
        strokeWidth: 1.7,
        strokeDasharray: marriage ? '5 5' : undefined,
      },
      label: marriage
        ? 'брак'
        : r.parentage && r.parentage !== 'birth'
          ? 'приёмная / другая связь'
          : undefined,
      labelStyle: { fill: '#8d7559', fontSize: 10 },
    };
  });
  useEffect(() => {
    const timer = setTimeout(() => setCenter(0, 0, { zoom: 0.85, duration: 350 }), 80);
    return () => clearTimeout(timer);
  }, [model, focusTick, setCenter]);
  return (
    <div className="tree-canvas family-tree" aria-label="Интерактивное дерево семьи">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        minZoom={0.04}
        maxZoom={1.6}
      >
        <Background color="#d2dacf" gap={24} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => (n.data.focus ? '#b79a64' : '#91ad9b')}
          maskColor="#eef2ebbd"
          pannable
          zoomable
        />
      </ReactFlow>
      <div className="tree-view-buttons">
        <button onClick={() => setCenter(0, 0, { zoom: 0.85, duration: 350 })}>
          <Focus size={16} />К выбранному
        </button>
        <button onClick={() => fitView({ padding: 0.15, maxZoom: 1, duration: 350 })}>
          <Maximize size={16} />
          Дерево целиком
        </button>
      </div>
      <div className="tree-legend">
        <span className="line" />
        Родитель → ребёнок <span className="line marriage" />
        Брак
      </div>
    </div>
  );
}
export function FamilyTree(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
