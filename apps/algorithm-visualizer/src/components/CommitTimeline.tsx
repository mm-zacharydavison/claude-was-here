import React, { useMemo, useEffect, useState } from 'react';
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useVisualizationStore } from '../lib/store';
import { fetchFileWithAuthorship, FileWithAuthorship } from '../lib/api';
import { MiniEditor } from './MiniEditor';

// Custom node component for commits with file content
const CommitFileNode: React.FC<NodeProps> = ({ data }) => {
  return (
    <div style={{
      background: 'white',
      border: `2px solid ${data.hasAuthorship ? '#3b82f6' : '#94a3b8'}`,
      borderRadius: '8px',
      padding: '12px',
      width: '800px', // Fixed width to ensure consistent spacing
      maxWidth: '800px',
      boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
    }}>
      <Handle type="target" position={Position.Left} style={{ background: data.hasAuthorship ? '#3b82f6' : '#94a3b8' }} />
      
      {/* Commit header */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ 
          fontSize: '12px', 
          fontWeight: 'bold', 
          marginBottom: '4px', 
          color: '#374151',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>🔗 {data.hash?.substring(0, 8)}</span>
          {data.hasAuthorship && (
            <span style={{ 
              fontSize: '9px', 
              color: '#3b82f6',
              fontWeight: 'bold',
              padding: '1px 4px',
              background: '#dbeafe',
              borderRadius: '3px'
            }}>
              AI
            </span>
          )}
        </div>
        <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '2px' }}>
          {data.timestamp ? new Date(data.timestamp).toLocaleString() : ''}
        </div>
        <div style={{ fontSize: '11px', color: '#374151' }}>
          {data.message}
        </div>
      </div>
      
      {/* File content */}
      {data.fileData ? (
        <MiniEditor
          lines={data.fileData.lines}
          fileName={data.fileName || 'file'}
          maxLines={undefined}
          showLineNumbers={true}
          highlightChanges={false}
        />
      ) : (
        <div style={{
          padding: '20px',
          background: '#f3f4f6',
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          textAlign: 'center',
          fontSize: '12px',
          color: '#6b7280'
        }}>
          Loading file content...
        </div>
      )}
      
      <Handle type="source" position={Position.Right} style={{ background: data.hasAuthorship ? '#3b82f6' : '#94a3b8' }} />
    </div>
  );
};

// Custom node component for current file
const CurrentFileNode: React.FC<NodeProps> = ({ data }) => {
  return (
    <div style={{
      background: 'white',
      border: '3px solid #10b981',
      borderRadius: '12px',
      padding: '12px',
      width: '800px', // Fixed width to match commit nodes
      maxWidth: '800px',
      boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
    }}>
      <Handle type="target" position={Position.Left} style={{ background: '#10b981' }} />
      
      {/* Header */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ 
          fontSize: '12px', 
          fontWeight: 'bold', 
          marginBottom: '4px', 
          color: '#065f46',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>⚡ Current File</span>
          <span style={{ 
            background: '#10b981', 
            color: 'white', 
            padding: '2px 6px', 
            borderRadius: '12px', 
            fontSize: '9px' 
          }}>
            LIVE
          </span>
        </div>
        <div style={{ fontSize: '10px', color: '#6b7280' }}>
          Working Directory
        </div>
      </div>
      
      {/* File content */}
      {data.fileData ? (
        <MiniEditor
          lines={data.fileData.lines}
          fileName={data.fileName || 'file'}
          maxLines={undefined}
          showLineNumbers={true}
          highlightChanges={false}
        />
      ) : (
        <div style={{
          padding: '20px',
          background: '#f3f4f6',
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          textAlign: 'center',
          fontSize: '12px',
          color: '#6b7280'
        }}>
          Loading current file content...
        </div>
      )}
    </div>
  );
};

// Register the custom node types
const nodeTypes = {
  commitFile: CommitFileNode,
  currentFile: CurrentFileNode
};


export const CommitTimeline: React.FC = () => {
  const { commits, selectedFile } = useVisualizationStore();
  const [fileDataMap, setFileDataMap] = useState<Map<string, FileWithAuthorship>>(new Map());
  
  // Load file data for all relevant commits and current state
  useEffect(() => {
    if (!selectedFile) {
      setFileDataMap(new Map());
      return;
    }
    
    const loadAllFileData = async () => {
      const filteredCommits = commits.filter(c => c.files.includes(selectedFile));
      const newFileDataMap = new Map<string, FileWithAuthorship>();
      
      try {
        // Load current file state
        const currentFileData = await fetchFileWithAuthorship(selectedFile);
        newFileDataMap.set('current', currentFileData);
        
        // Load file data for each commit
        for (const commit of filteredCommits) {
          try {
            const commitFileData = await fetchFileWithAuthorship(selectedFile, commit.hash);
            newFileDataMap.set(commit.hash, commitFileData);
          } catch (error) {
            console.error(`Failed to load file data for commit ${commit.hash}:`, error);
          }
        }
        
        setFileDataMap(newFileDataMap);
        console.log('Loaded file data for', selectedFile, ':', {
          currentLines: newFileDataMap.get('current')?.lines.length,
          commitsWithData: Array.from(newFileDataMap.keys()).filter(k => k !== 'current'),
          currentFileData: newFileDataMap.get('current')
        });
      } catch (error) {
        console.error('Failed to load file data:', error);
      }
    };
    
    loadAllFileData();
  }, [selectedFile, commits]);
  
  const { nodes, edges } = useMemo(() => {
    console.log('Creating nodes/edges with:', { selectedFile, commits: commits.length, fileDataMap: fileDataMap.size });
    
    if (!selectedFile) {
      return { nodes: [], edges: [] };
    }
    
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    
    // Filter commits for the selected file
    const filteredCommits = commits.filter(c => c.files.includes(selectedFile));
    const currentFileData = fileDataMap.get('current');
    
    console.log('Filtered commits:', filteredCommits.length, 'Current file data:', !!currentFileData);
    
    // Always create at least one node for testing
    if (filteredCommits.length === 0 && !currentFileData) {
      // Create a test node to verify ReactFlow is working
      nodes.push({
        id: 'test-no-data',
        position: { x: 100, y: 100 },
        data: { label: `No commits found for ${selectedFile}` },
        style: { background: '#f59e0b', color: 'white', padding: '10px', borderRadius: '8px' }
      });
      console.log('Created test node for no data scenario');
    }
    
    // FORCE create at least one node for testing - always add current file
    nodes.push({
      id: 'current-file',
      position: { x: (filteredCommits.length) * 600, y: 100 },
      data: {
        label: `📄 Current: ${selectedFile.split('/').pop() || selectedFile} (${currentFileData?.lines?.length || 0} lines)`
      },
      style: { background: '#10b981', color: 'white', border: '2px solid #10b981', borderRadius: '8px', padding: '10px', minWidth: '200px', minHeight: '50px' }
    });
    
    // FORCE create a test node to ensure we have something visible
    nodes.push({
      id: 'force-test',
      position: { x: 100, y: 200 },
      data: {
        label: `Test Node for ${selectedFile}`
      },
      style: { background: '#ef4444', color: 'white', border: '2px solid #ef4444', borderRadius: '8px', padding: '10px', minWidth: '200px', minHeight: '50px' }
    });
    
    // Add commit nodes (left to right, oldest to newest)
    filteredCommits.forEach((commit, index) => {
      const commitFileData = fileDataMap.get(commit.hash);
      const previousCommitFileData = index > 0 
        ? fileDataMap.get(filteredCommits[index - 1].hash)
        : undefined;
      
      // Using default node type for testing
      nodes.push({
        id: commit.id,
        position: { x: index * 600, y: 100 },
        data: {
          label: `🔗 ${commit.hash.substring(0, 8)}: ${commit.message} (${commitFileData?.lines?.length || 0} lines)`
        },
        style: { 
          background: commit.authorshipData ? '#3b82f6' : '#94a3b8', 
          color: 'white', 
          border: `2px solid ${commit.authorshipData ? '#3b82f6' : '#94a3b8'}`,
          borderRadius: '8px', 
          padding: '10px',
          minWidth: '300px'
        }
      });
      
      // Connect to next commit or current file
      if (index < filteredCommits.length - 1) {
        edges.push({
          id: `e${index}`,
          source: commit.id,
          target: filteredCommits[index + 1].id,
          animated: false,
          style: { 
            stroke: commit.authorshipData ? '#3b82f6' : '#94a3b8',
            strokeWidth: commit.authorshipData ? 3 : 2
          }
        });
      } else {
        // Connect last commit to current file
        edges.push({
          id: `e${index}-current`,
          source: commit.id,
          target: 'current-file',
          animated: true,
          style: { 
            stroke: '#10b981', 
            strokeWidth: 3,
            strokeDasharray: '5,5'
          }
        });
      }
    });
    
    // If no commits for this file, show just the current file node
    if (filteredCommits.length === 0) {
      if (nodes.length > 0) {
        nodes[0].position.x = 250; // Center it
      }
    }
    
    console.log('ReactFlow nodes and edges:', { nodes, edges, selectedFile, commitsCount: filteredCommits.length });
    return { nodes, edges };
  }, [commits, selectedFile, fileDataMap]);
  
  // Additional debug: let's see what's in the useMemo dependencies
  console.log('useMemo dependencies:', { 
    commitsLength: commits.length, 
    selectedFile, 
    fileDataMapSize: fileDataMap.size,
    fileDataMapKeys: Array.from(fileDataMap.keys())
  });
  
  // Create real commit timeline nodes
  const dynamicNodes = useMemo(() => {
    if (!selectedFile) return [];
    
    const nodes: any[] = [];
    // No need to filter - commits are already filtered by the API when fetchCommits(selectedFile) is called
    const relevantCommits = commits;
    const currentFileData = fileDataMap.get('current');
    
    console.log('Creating real nodes for:', selectedFile);
    console.log('Total commits for this file:', relevantCommits.length);
    console.log('Commit details:', relevantCommits.map(c => ({
      id: c.id,
      hash: c.hash.substring(0, 8),
      message: c.message,
      files: c.files.length > 0 ? c.files : 'no files listed'
    })));
    
    // Add commit nodes with file content - increase spacing to avoid overlap
    relevantCommits.forEach((commit, index) => {
      const commitFileData = fileDataMap.get(commit.hash);
      const previousCommitFileData = index > 0 
        ? fileDataMap.get(relevantCommits[index - 1].hash)
        : undefined;
      
      nodes.push({
        id: commit.id,
        type: 'commitFile',
        position: { x: index * 900, y: 50 }, // Increased spacing and aligned at top
        data: {
          ...commit,
          fileName: selectedFile.split('/').pop() || selectedFile,
          hasAuthorship: !!commit.authorshipData,
          fileData: commitFileData,
          previousFileData: previousCommitFileData
        }
      });
    });
    
    // Add current file node with content
    nodes.push({
      id: 'current-file',
      type: 'currentFile',
      position: { x: relevantCommits.length * 900, y: 50 }, // Aligned at top
      data: {
        fileName: selectedFile.split('/').pop() || selectedFile,
        fullPath: selectedFile,
        fileData: currentFileData
      }
    });
    
    return nodes;
  }, [selectedFile, commits, fileDataMap]);
  
  const [nodesState, setNodesState, onNodesChange] = useNodesState([]);
  const [edgesState, , onEdgesChange] = useEdgesState([]);
  
  // Create edges to connect nodes
  const dynamicEdges = useMemo(() => {
    if (!selectedFile) return [];
    
    const edges: any[] = [];
    const relevantCommits = commits; // Already filtered by API
    
    // Connect commits in sequence
    relevantCommits.forEach((commit, index) => {
      if (index < relevantCommits.length - 1) {
        edges.push({
          id: `edge-${index}`,
          source: commit.id,
          target: relevantCommits[index + 1].id,
          style: { stroke: commit.authorshipData ? '#3b82f6' : '#94a3b8', strokeWidth: 2 }
        });
      } else {
        // Connect last commit to current file
        edges.push({
          id: `edge-${index}-current`,
          source: commit.id,
          target: 'current-file',
          animated: true,
          style: { stroke: '#10b981', strokeWidth: 3, strokeDasharray: '5,5' }
        });
      }
    });
    
    return edges;
  }, [selectedFile, commits]);
  
  // Update nodes and edges when selectedFile changes
  React.useEffect(() => {
    setNodesState(dynamicNodes);
  }, [dynamicNodes, setNodesState]);
  
  console.log('ReactFlow state:', { nodesState: nodesState.length, edgesState: edgesState.length, selectedFile });
  
  if (!selectedFile) {
    // Create a simple test node to verify ReactFlow works
    const testNodes = [
      {
        id: 'test-1',
        position: { x: 100, y: 100 },
        data: { label: 'Test Node 1' },
        style: { width: 200, height: 100, background: '#f0f0f0', border: '1px solid #ccc', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
      },
      {
        id: 'test-2', 
        position: { x: 400, y: 100 },
        data: { label: 'Test Node 2' },
        style: { width: 200, height: 100, background: '#e0f2fe', border: '1px solid #0369a1', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
      }
    ];
    
    const testEdges = [
      { id: 'test-edge', source: 'test-1', target: 'test-2', animated: true }
    ];
    
    return (
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <ReactFlow
          nodes={testNodes}
          edges={testEdges}
          fitView
          style={{ width: '100%', height: '100%' }}
        >
          <Background />
          <Controls />
        </ReactFlow>
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          background: 'rgba(255,255,255,0.9)',
          padding: '12px',
          borderRadius: '6px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          fontSize: '14px',
          color: '#374151'
        }}>
          Select a file to view its commit timeline (ReactFlow Test Mode)
        </div>
      </div>
    );
  }
  
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      
      <ReactFlow
        nodes={nodesState}
        edges={dynamicEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        style={{ width: '100%', height: '100%', background: '#f9fafb' }}
        fitView={true}
      >
        <Background color="#aaa" gap={16} />
        <Controls />
      </ReactFlow>
      
      <div style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        background: 'white',
        padding: '8px 12px',
        borderRadius: '6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        fontSize: '14px',
        fontWeight: '600',
        color: '#374151'
      }}>
        📊 {selectedFile} Timeline
      </div>
    </div>
  );
};