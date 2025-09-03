import React, { useEffect, useState, useMemo } from 'react';
import 'prismjs/themes/prism-tomorrow.css';
import { useVisualizationStore } from '../lib/store';
import { fetchFileContent } from '../lib/api';

interface LineWithAuthorship {
  lineNumber: number;
  content: string;
  isAiAuthored: boolean;
  commitHash?: string;
}

export const AuthorshipVisualization: React.FC = () => {
  const { selectedFile, selectedCommit, fileAuthorship } = useVisualizationStore();
  const [fileContent, setFileContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  
  useEffect(() => {
    if (!selectedFile) {
      setFileContent('');
      return;
    }
    
    const loadContent = async () => {
      setIsLoading(true);
      try {
        const content = await fetchFileContent(selectedFile, selectedCommit || undefined);
        setFileContent(content);
      } catch (error) {
        console.error('Failed to load file content:', error);
        setFileContent('');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadContent();
  }, [selectedFile, selectedCommit]);
  
  const linesWithAuthorship = useMemo(() => {
    if (!fileContent || !selectedFile) return [];
    
    const lines = fileContent.split('\n');
    const authorship = fileAuthorship.get(selectedFile);
    
    return lines.map((content, index): LineWithAuthorship => {
      const lineNumber = index + 1;
      const authorshipEntry = authorship?.authorshipMap.get(lineNumber);
      
      return {
        lineNumber,
        content,
        isAiAuthored: authorshipEntry?.isAiAuthored || false,
        commitHash: authorshipEntry?.commitHash
      };
    });
  }, [fileContent, selectedFile, fileAuthorship]);
  
  const stats = useMemo(() => {
    const totalLines = linesWithAuthorship.length;
    const aiLines = linesWithAuthorship.filter(l => l.isAiAuthored).length;
    const humanLines = totalLines - aiLines;
    const aiPercentage = totalLines > 0 ? (aiLines / totalLines) * 100 : 0;
    
    return { totalLines, aiLines, humanLines, aiPercentage };
  }, [linesWithAuthorship]);
  
  if (!selectedFile) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        height: '100%',
        color: '#6b7280'
      }}>
        Select a file to view its authorship
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
        Loading...
      </div>
    );
  }
  
  return (
    <div className="authorship-visualization" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="stats-header" style={{
        padding: '16px',
        borderBottom: '1px solid #e5e7eb',
        background: '#f9fafb'
      }}>
        <h3 style={{ margin: 0, marginBottom: '8px' }}>{selectedFile}</h3>
        <div style={{ display: 'flex', gap: '24px', fontSize: '14px' }}>
          <div>
            <span style={{ color: '#6b7280' }}>Total Lines: </span>
            <strong>{stats.totalLines}</strong>
          </div>
          <div>
            <span style={{ color: '#6b7280' }}>AI Lines: </span>
            <strong style={{ color: '#10b981' }}>{stats.aiLines}</strong>
            <span style={{ color: '#6b7280' }}> ({stats.aiPercentage.toFixed(1)}%)</span>
          </div>
          <div>
            <span style={{ color: '#6b7280' }}>Human Lines: </span>
            <strong style={{ color: '#3b82f6' }}>{stats.humanLines}</strong>
          </div>
        </div>
        <div style={{ marginTop: '8px' }}>
          <div style={{ 
            width: '100%', 
            height: '8px', 
            background: '#e5e7eb',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${stats.aiPercentage}%`,
              height: '100%',
              background: '#10b981',
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>
      </div>
      
      <div className="code-view" style={{ 
        flex: 1, 
        overflow: 'auto',
        fontSize: '13px',
        fontFamily: 'monospace',
        lineHeight: '1.6'
      }}>
        <div style={{ display: 'flex' }}>
          <div className="line-numbers" style={{
            background: '#1f2937',
            color: '#6b7280',
            padding: '16px 0',
            textAlign: 'right',
            userSelect: 'none',
            position: 'sticky',
            left: 0,
            zIndex: 1
          }}>
            {linesWithAuthorship.map(line => (
              <div 
                key={line.lineNumber}
                style={{ 
                  paddingRight: '12px',
                  paddingLeft: '12px',
                  background: hoveredLine === line.lineNumber ? '#374151' : 'transparent'
                }}
                onMouseEnter={() => setHoveredLine(line.lineNumber)}
                onMouseLeave={() => setHoveredLine(null)}
              >
                {line.lineNumber}
              </div>
            ))}
          </div>
          
          <div className="code-content" style={{ flex: 1 }}>
            {linesWithAuthorship.map(line => (
              <div 
                key={line.lineNumber}
                style={{
                  background: line.isAiAuthored 
                    ? 'rgba(16, 185, 129, 0.1)' 
                    : hoveredLine === line.lineNumber 
                      ? 'rgba(59, 130, 246, 0.05)' 
                      : 'transparent',
                  borderLeft: line.isAiAuthored ? '3px solid #10b981' : '3px solid transparent',
                  paddingLeft: '12px',
                  paddingRight: '16px',
                  position: 'relative',
                  minHeight: '24px',
                  whiteSpace: 'pre',
                  transition: 'background 0.2s ease'
                }}
                onMouseEnter={() => setHoveredLine(line.lineNumber)}
                onMouseLeave={() => setHoveredLine(null)}
                title={line.isAiAuthored ? `AI authored (commit: ${line.commitHash?.substring(0, 7)})` : 'Human authored'}
              >
                <code>{line.content || ' '}</code>
                {line.isAiAuthored && (
                  <span style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: '11px',
                    color: '#10b981',
                    fontFamily: 'sans-serif'
                  }}>
                    AI
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};