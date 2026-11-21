import { useMemo, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type NodeProps,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import { Maximize, GitBranch } from 'lucide-react';
import { useArchive } from './context';
import { Avatar, PersonPicker, Empty } from './components';
import { years, fullName, type Item } from './api';
function PersonNode({ data }: NodeProps) {
  const p = data.person as Item;
  const { person } = useArchive();
  return (
    <button className={'tree-person ' + (data.focus ? 'focus' : '')} onClick={() => person(p.id)}>
      <Handle type="target" position={Position.Top} />
      <Avatar p={p} size="sm" />
      <span>
        <strong>{p.surname || p.given_name}</strong>
        <small>{p.surname ? [p.given_name, p.patronymic].filter(Boolean).join(' ') : p.patronymic}</small>
        <em>{years(p)}</em>
      </span>
      <Handle type="source" position={Position.Bottom} />
    </button>
  );
}
const nodeTypes = { person: PersonNode };
function TreeCanvas({ root, mode }: { root: string; mode: string }) {
  const { archive } = useArchive();
  const { fitView } = useReactFlow();
  const { nodes, edges } = useMemo(() => {
    const d = archive.data;
    const selected = new Set<string>();
    if (mode === 'all' || !root) d.people.forEach((p) => selected.add(p.id));
    else {
      selected.add(root);
      const queue = [root];
      while (queue.length) {
        const cur = queue.pop();
        for (const r of d.relationships) {
          if (r.kind !== 'parent') continue;
          const next =
            (mode === 'descendants' ? r.from_id : r.to_id) === cur
              ? mode === 'descendants'
                ? r.to_id
                : r.from_id
              : '';
          if (next && !selected.has(next)) {
            selected.add(next);
            queue.push(next);
          }
        }
      }
    }
    const ps = d.people.filter((p) => selected.has(p.id));
    const rs = d.relationships.filter((r) => selected.has(r.from_id) && selected.has(r.to_id));
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 32, ranksep: 85, marginx: 35, marginy: 35 });
    g.setDefaultEdgeLabel(() => ({}));
    ps.forEach((p) => g.setNode(p.id, { width: 234, height: 92 }));
    rs.filter((r) => r.kind === 'parent').forEach((r) => g.setEdge(r.from_id, r.to_id));
    dagre.layout(g);
    return {
      nodes: ps.map((p) => ({
        id: p.id,
        type: 'person',
        position: { x: g.node(p.id).x - 117, y: g.node(p.id).y - 46 },
        data: { person: p, focus: p.id === root },
      })),
      edges: rs.map((r) => ({
        id: r.id,
        source: r.from_id,
        target: r.to_id,
        type: r.kind === 'partner' ? 'straight' : 'smoothstep',
        style: {
          stroke: r.kind === 'partner' ? '#bb9b72' : '#86a295',
          strokeWidth: r.kind === 'partner' ? 1 : 1.6,
          strokeDasharray: r.kind === 'partner' ? '5 5' : undefined,
        },
        label: r.kind === 'partner' ? 'брак' : undefined,
        labelStyle: { fill: '#8d7559', fontSize: 10 },
      })),
    };
  }, [archive, root, mode]);
  useEffect(() => {
    const id = setTimeout(() => fitView({ padding: 0.12, maxZoom: 1 }), 120);
    return () => clearTimeout(id);
  }, [nodes, fitView]);
  return (
    <div className="tree-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        minZoom={0.08}
        maxZoom={1.6}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="#d2dacf" gap={24} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor="#91ad9b" maskColor="#eef2ebbd" pannable zoomable />
      </ReactFlow>
      <div className="tree-legend">
        <span className="line" />
        Родитель → ребёнок <span className="line marriage" />
        Брак
      </div>
      <button className="tree-fit" onClick={() => fitView({ padding: 0.12, maxZoom: 1 })}>
        <Maximize size={16} />
        Дерево целиком
      </button>
    </div>
  );
}
export function Tree() {
  const { archive } = useArchive();
  const [root, setRoot] = useState(
    () => archive.data.people.find((p) => p.external_id === 'I1')?.id || archive.data.people[0]?.id || '',
  );
  const [mode, setMode] = useState('ancestors');
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">СВЯЗИ ПОКОЛЕНИЙ</div>
          <h1>Семейное дерево</h1>
          <p>Нажмите на человека, чтобы открыть его историю</p>
        </div>
        <div className="page-badge">
          <GitBranch size={18} />
          {archive.data.people.length} человек
        </div>
      </div>
      <div className="toolbar tree-toolbar">
        <PersonPicker value={root} onChange={setRoot} empty="От кого строить дерево" />
        <div className="segmented">
          {[
            ['ancestors', 'Предки'],
            ['descendants', 'Потомки'],
            ['all', 'Вся семья'],
          ].map(([m, label]) => (
            <button className={mode === m ? 'active' : ''} onClick={() => setMode(m)} key={m}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {archive.data.people.length ? (
        <ReactFlowProvider>
          <TreeCanvas root={root} mode={mode} />
        </ReactFlowProvider>
      ) : (
        <Empty>Добавьте первого человека в разделе «Люди».</Empty>
      )}
    </>
  );
}
