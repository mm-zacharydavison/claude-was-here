import React from 'react';
import { LineWithAuthorship } from '../lib/api';

interface MiniEditorProps {
  lines: LineWithAuthorship[];
  fileName: string;
  maxLines?: number;
  showLineNumbers?: boolean;
  highlightChanges?: boolean;
  previousLines?: LineWithAuthorship[];
}

const getFileLanguage = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'java':
      return 'java';
    case 'cpp':
    case 'cc':
    case 'cxx':
      return 'cpp';
    case 'c':
      return 'c';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'yml':
    case 'yaml':
      return 'yaml';
    default:
      return 'text';
  }
};

const getLineChangeType = (
  line: LineWithAuthorship,
  previousLines?: LineWithAuthorship[]
): 'added' | 'removed' | 'modified' | 'unchanged' => {
  if (!previousLines) return 'unchanged';
  
  const prevLine = previousLines.find(pl => pl.lineNumber === line.lineNumber);
  if (!prevLine) return 'added';
  if (prevLine.content !== line.content) return 'modified';
  return 'unchanged';
};

export const MiniEditor: React.FC<MiniEditorProps> = ({
  lines,
  fileName,
  maxLines,
  showLineNumbers = true,
  highlightChanges = false,
  previousLines
}) => {
  console.log('MiniEditor rendering with:', { fileName, linesCount: lines.length });
  
  const language = getFileLanguage(fileName);
  const displayLines = (maxLines && maxLines > 0) ? lines.slice(0, maxLines) : lines;
  const hasMore = (maxLines && maxLines > 0) ? lines.length > maxLines : false;
  
  console.log('MiniEditor display logic:', { 
    maxLines, 
    totalLines: lines.length, 
    displayCount: displayLines.length, 
    hasMore 
  });
  
  return (
    <div className="mini-editor" style={{
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      overflow: 'hidden',
      fontFamily: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
      fontSize: '11px',
      lineHeight: '1.4',
      background: '#1e1e1e',
      color: '#d4d4d4'
    }}>
      {/* Header */}
      <div style={{
        background: '#2d2d30',
        padding: '6px 10px',
        borderBottom: '1px solid #3c3c3c',
        fontSize: '10px',
        color: '#cccccc',
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }}>
        <span style={{ color: '#569cd6' }}>📄</span>
        <span>{fileName}</span>
        <span style={{ color: '#6a9955' }}>({language})</span>
        <span style={{ marginLeft: 'auto', color: '#808080' }}>
          {lines.length} lines
        </span>
      </div>
      
      {/* Editor content */}
      <div style={{ 
        maxHeight: maxLines ? '400px' : 'none', 
        overflowY: maxLines ? 'auto' : 'visible',
        background: '#1e1e1e'
      }}>
        {displayLines.map((line) => {
          const changeType = highlightChanges ? getLineChangeType(line, previousLines) : 'unchanged';
          
          let bgColor = 'transparent';
          let borderLeft = '3px solid transparent';
          
          if (line.isAiAuthored) {
            bgColor = 'rgba(59, 130, 246, 0.1)'; // Blue for Claude
            borderLeft = '3px solid #3b82f6';
          }
          
          if (highlightChanges) {
            if (changeType === 'added') {
              bgColor = 'rgba(34, 197, 94, 0.2)'; // Green for added lines
              borderLeft = '3px solid #22c55e';
            } else if (changeType === 'modified') {
              bgColor = 'rgba(234, 179, 8, 0.2)'; // Yellow for modified lines
              borderLeft = '3px solid #eab308';
            }
          }
          
          return (
            <div
              key={line.lineNumber}
              style={{
                display: 'flex',
                background: bgColor,
                borderLeft,
                minHeight: '16px',
                alignItems: 'flex-start'
              }}
            >
              {showLineNumbers && (
                <div style={{
                  width: '35px',
                  textAlign: 'right',
                  paddingRight: '8px',
                  paddingLeft: '4px',
                  color: '#858585',
                  userSelect: 'none',
                  flexShrink: 0,
                  fontSize: '10px',
                  paddingTop: '1px'
                }}>
                  {line.lineNumber}
                </div>
              )}
              
              <div style={{
                flex: 1,
                paddingRight: '8px',
                paddingLeft: showLineNumbers ? '0' : '8px',
                whiteSpace: 'pre',
                paddingTop: '1px',
                minHeight: '14px'
              }}>
                <code style={{ 
                  color: line.isAiAuthored ? '#60a5fa' : '#d4d4d4',
                  fontWeight: line.isAiAuthored ? '500' : '400'
                }}>
                  {line.content || ' '}
                </code>
              </div>
              
              {line.isAiAuthored && (
                <div style={{
                  fontSize: '8px',
                  color: '#3b82f6',
                  paddingRight: '6px',
                  paddingTop: '2px',
                  flexShrink: 0
                }}>
                  AI
                </div>
              )}
            </div>
          );
        })}
        
        {hasMore && (
          <div style={{
            padding: '8px',
            textAlign: 'center',
            color: '#808080',
            fontSize: '10px',
            fontStyle: 'italic',
            background: '#252526'
          }}>
            ... {lines.length - maxLines} more lines
          </div>
        )}
        
        {lines.length === 0 && (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: '#808080',
            fontSize: '11px',
            fontStyle: 'italic'
          }}>
            Empty file
          </div>
        )}
      </div>
      
      {/* Stats footer */}
      <div style={{
        background: '#2d2d30',
        padding: '4px 10px',
        borderTop: '1px solid #3c3c3c',
        fontSize: '9px',
        color: '#cccccc',
        display: 'flex',
        justifyContent: 'space-between'
      }}>
        <span>
          {lines.filter(l => l.isAiAuthored).length} AI lines
        </span>
        <span>
          {lines.filter(l => !l.isAiAuthored).length} human lines  
        </span>
      </div>
    </div>
  );
};