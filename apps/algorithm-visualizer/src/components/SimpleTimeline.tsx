import React from 'react';
import { useVisualizationStore } from '../lib/store';
import { MiniEditor } from './MiniEditor';

export const SimpleTimeline: React.FC = () => {
  const { selectedFile, commits } = useVisualizationStore();
  
  if (!selectedFile) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#6b7280',
        fontSize: '16px'
      }}>
        Select a file to view its timeline
      </div>
    );
  }
  
  const filteredCommits = commits.filter(c => c.files.includes(selectedFile));
  
  return (
    <div style={{
      padding: '20px',
      height: '100%',
      overflow: 'auto',
      background: '#f9fafb'
    }}>
      <h2 style={{ marginBottom: '20px', color: '#374151' }}>
        Timeline for {selectedFile}
      </h2>
      
      <div style={{
        display: 'flex',
        gap: '20px',
        overflowX: 'auto',
        paddingBottom: '20px'
      }}>
        {/* Commit nodes */}
        {filteredCommits.map((commit, index) => (
          <div
            key={commit.id}
            style={{
              minWidth: '400px',
              background: 'white',
              border: `2px solid ${commit.authorshipData ? '#3b82f6' : '#94a3b8'}`,
              borderRadius: '8px',
              padding: '16px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
          >
            <div style={{ marginBottom: '12px' }}>
              <h3 style={{ fontSize: '14px', color: '#374151', margin: '0 0 4px 0' }}>
                🔗 {commit.hash.substring(0, 8)}
              </h3>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                {new Date(commit.timestamp).toLocaleString()}
              </div>
              <div style={{ fontSize: '13px', color: '#374151' }}>
                {commit.message}
              </div>
            </div>
            
            <MiniEditor
              lines={[
                { lineNumber: 1, content: `// Commit ${commit.hash.substring(0, 8)}`, isAiAuthored: false },
                { lineNumber: 2, content: 'function example() {', isAiAuthored: false },
                { lineNumber: 3, content: '  // AI authored changes', isAiAuthored: !!commit.authorshipData },
                { lineNumber: 4, content: '  return "data";', isAiAuthored: !!commit.authorshipData },
                { lineNumber: 5, content: '}', isAiAuthored: false }
              ]}
              fileName={selectedFile.split('/').pop() || selectedFile}
              maxLines={10}
              showLineNumbers={true}
            />
          </div>
        ))}
        
        {/* Current file node */}
        <div
          style={{
            minWidth: '400px',
            background: 'white',
            border: '3px solid #10b981',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}
        >
          <div style={{ marginBottom: '12px' }}>
            <h3 style={{ fontSize: '14px', color: '#065f46', margin: '0 0 4px 0' }}>
              ⚡ Current File
            </h3>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              Working Directory
            </div>
          </div>
          
          <MiniEditor
            lines={[
              { lineNumber: 1, content: '// Current file state', isAiAuthored: false },
              { lineNumber: 2, content: 'function currentState() {', isAiAuthored: false },
              { lineNumber: 3, content: '  // Live changes', isAiAuthored: true },
              { lineNumber: 4, content: '  return "live";', isAiAuthored: true },
              { lineNumber: 5, content: '}', isAiAuthored: false }
            ]}
            fileName={selectedFile.split('/').pop() || selectedFile}
            maxLines={10}
            showLineNumbers={true}
          />
        </div>
      </div>
    </div>
  );
};