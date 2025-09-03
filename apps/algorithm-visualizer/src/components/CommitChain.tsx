import React, { useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Position,
  Handle,
  NodeProps
} from 'react-flow-renderer';
import { useVisualizationStore } from '../lib/store';

const CommitNodeComponent: React.FC<NodeProps> = ({ data }) => {
  const { setSelectedCommit, selectedCommit } = useVisualizationStore();
  const isSelected = selectedCommit === data.hash;
  
  return (
    <div
      className={`commit-node ${isSelected ? 'selected' : ''}`}
      onClick={() => setSelectedCommit(data.hash)}
      style={{
        padding: '10px',
        borderRadius: '8px',
        border: `2px solid ${data.hasAuthorship ? '#4ade80' : '#94a3b8'}`,
        background: isSelected ? '#f0f9ff' : 'white',
        cursor: 'pointer',
        minWidth: '200px'
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>
        {data.hash.substring(0, 7)}
      </div>
      <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
        {new Date(data.timestamp).toLocaleString()}
      </div>
      <div style={{ fontSize: '11px' }}>
        {data.message}
      </div>
      {data.hasAuthorship && (
        <div style={{ 
          fontSize: '10px', 
          color: '#4ade80',
          marginTop: '4px',
          fontWeight: 'bold'
        }}>
          Claude was here ✓
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
};

const nodeTypes = {
  commitNode: CommitNodeComponent
};

export const CommitChain: React.FC = () => {
  const { commits, selectedFile } = useVisualizationStore();
  
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    
    const filteredCommits = selectedFile
      ? commits.filter(c => c.files.includes(selectedFile))
      : commits;
    
    filteredCommits.forEach((commit, index) => {
      nodes.push({
        id: commit.id,
        type: 'commitNode',
        position: { x: index * 250, y: 100 },
        data: {
          ...commit,
          hasAuthorship: !!commit.authorshipData
        }
      });
      
      if (index > 0) {
        edges.push({
          id: `e${index}`,
          source: filteredCommits[index - 1].id,
          target: commit.id,
          animated: false,
          style: { stroke: '#94a3b8' }
        });
      }
    });
    
    return { nodes, edges };
  }, [commits, selectedFile]);
  
  const [nodesState, , onNodesChange] = useNodesState(nodes);
  const [edgesState, , onEdgesChange] = useEdgesState(edges);
  
  return (
    <div style={{ width: '100%', height: '300px' }}>
      <ReactFlow
        nodes={nodesState}
        edges={edgesState}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={[1, 2]}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
};