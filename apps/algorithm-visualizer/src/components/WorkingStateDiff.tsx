import React, { useEffect, useState } from 'react';
import { diffLines as diffLinesFunc, Change } from 'diff';
import { useVisualizationStore } from '../lib/store';
import { fetchFileContent, fetchWorkingState } from '../lib/api';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber?: number;
}

export const WorkingStateDiff: React.FC = () => {
  const { selectedFile } = useVisualizationStore();
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  useEffect(() => {
    if (!selectedFile) {
      setDiffLines([]);
      return;
    }
    
    const loadDiff = async () => {
      setIsLoading(true);
      try {
        // Get current working state
        const working = await fetchWorkingState(selectedFile);
        
        // Get last committed version
        const committed = await fetchFileContent(selectedFile);
        
        // Calculate diff
        const changes = diffLinesFunc(committed, working.content);
        const lines: DiffLine[] = [];
        let lineNum = 1;
        
        changes.forEach((change: Change) => {
          if (change.added) {
            const addedLines = (change.value || '').split('\n').filter(l => l !== '');
            addedLines.forEach(line => {
              lines.push({ type: 'added', content: line });
            });
          } else if (change.removed) {
            const removedLines = (change.value || '').split('\n').filter(l => l !== '');
            removedLines.forEach(line => {
              lines.push({ type: 'removed', content: line, lineNumber: lineNum++ });
            });
          } else {
            const unchangedLines = (change.value || '').split('\n').filter(l => l !== '');
            unchangedLines.forEach(line => {
              lines.push({ type: 'unchanged', content: line, lineNumber: lineNum++ });
            });
          }
        });
        
        setDiffLines(lines);
      } catch (error) {
        console.error('Failed to load diff:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadDiff();
  }, [selectedFile]);
  
  const stats = {
    added: diffLines.filter(l => l.type === 'added').length,
    removed: diffLines.filter(l => l.type === 'removed').length,
    unchanged: diffLines.filter(l => l.type === 'unchanged').length
  };
  
  if (!selectedFile) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#6b7280'
      }}>
        Select a file to view working state changes
      </div>
    );
  }
  
  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#6b7280'
      }}>
        Loading diff...
      </div>
    );
  }
  
  const hasChanges = stats.added > 0 || stats.removed > 0;
  
  return (
    <div className="working-state-diff" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="diff-header" style={{
        padding: '16px',
        borderBottom: '1px solid #e5e7eb',
        background: '#f9fafb'
      }}>
        <h3 style={{ margin: 0, marginBottom: '8px' }}>Working State Changes</h3>
        <div style={{ display: 'flex', gap: '24px', fontSize: '14px' }}>
          <div>
            <span style={{ color: '#10b981' }}>+{stats.added}</span> added
          </div>
          <div>
            <span style={{ color: '#ef4444' }}>-{stats.removed}</span> removed
          </div>
          <div>
            <span style={{ color: '#6b7280' }}>{stats.unchanged}</span> unchanged
          </div>
        </div>
      </div>
      
      {!hasChanges ? (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#6b7280',
          fontSize: '14px'
        }}>
          No changes in working directory
        </div>
      ) : (
        <div className="diff-content" style={{
          flex: 1,
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: '13px',
          lineHeight: '1.6',
          padding: '16px'
        }}>
          {diffLines.map((line, index) => (
            <div
              key={index}
              style={{
                background: 
                  line.type === 'added' ? 'rgba(16, 185, 129, 0.1)' :
                  line.type === 'removed' ? 'rgba(239, 68, 68, 0.1)' :
                  'transparent',
                borderLeft: 
                  line.type === 'added' ? '3px solid #10b981' :
                  line.type === 'removed' ? '3px solid #ef4444' :
                  '3px solid transparent',
                paddingLeft: '12px',
                paddingRight: '16px',
                minHeight: '24px',
                whiteSpace: 'pre',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <span style={{
                width: '20px',
                marginRight: '12px',
                color: 
                  line.type === 'added' ? '#10b981' :
                  line.type === 'removed' ? '#ef4444' :
                  'transparent',
                fontWeight: 'bold'
              }}>
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ''}
              </span>
              <code style={{ flex: 1 }}>{line.content || ' '}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};