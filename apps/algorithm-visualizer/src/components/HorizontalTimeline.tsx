import React, { useMemo, useEffect, useState } from 'react';
import { useVisualizationStore } from '../lib/store';
import { fetchFileWithAuthorship, FileWithAuthorship } from '../lib/api';
import { MiniEditor } from './MiniEditor';

export const HorizontalTimeline: React.FC = () => {
  const { commits, selectedFile } = useVisualizationStore();
  const [fileDataMap, setFileDataMap] = useState<Map<string, FileWithAuthorship>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  
  // Load file data for all relevant commits and current state
  useEffect(() => {
    if (!selectedFile) {
      setFileDataMap(new Map());
      return;
    }
    
    const loadAllFileData = async () => {
      setIsLoading(true);
      const filteredCommits = commits.filter(c => c.files.includes(selectedFile));
      const newFileDataMap = new Map<string, FileWithAuthorship>();
      
      try {
        console.log('Loading file data for', selectedFile, 'across', filteredCommits.length, 'commits');
        
        // Load current file state
        const currentFileData = await fetchFileWithAuthorship(selectedFile);
        newFileDataMap.set('current', currentFileData);
        console.log('Loaded current file data:', currentFileData.lines.length, 'lines');
        
        // Load file data for each commit
        for (const commit of filteredCommits) {
          try {
            const commitFileData = await fetchFileWithAuthorship(selectedFile, commit.hash);
            newFileDataMap.set(commit.hash, commitFileData);
            console.log(`Loaded commit ${commit.hash.substring(0, 8)} data:`, commitFileData.lines.length, 'lines');
          } catch (error) {
            console.error(`Failed to load file data for commit ${commit.hash}:`, error);
          }
        }
        
        setFileDataMap(newFileDataMap);
      } catch (error) {
        console.error('Failed to load file data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadAllFileData();
  }, [selectedFile, commits]);
  
  const filteredCommits = useMemo(() => {
    return commits.filter(c => c.files.includes(selectedFile));
  }, [commits, selectedFile]);
  
  if (!selectedFile) {
    return (
      <div style={{ 
        height: '100%',
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        color: '#6b7280',
        fontSize: '16px'
      }}>
        Select a file to view its commit timeline
      </div>
    );
  }
  
  if (isLoading) {
    return (
      <div style={{ 
        height: '100%',
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        color: '#6b7280',
        fontSize: '16px'
      }}>
        Loading timeline for {selectedFile}...
      </div>
    );
  }
  
  const currentFileData = fileDataMap.get('current');
  
  return (
    <div style={{
      padding: '20px',
      height: '100%',
      overflow: 'auto',
      background: '#f9fafb'
    }}>
      <div style={{
        position: 'sticky',
        top: 0,
        background: 'white',
        padding: '12px 16px',
        marginBottom: '20px',
        borderRadius: '6px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        fontSize: '16px',
        fontWeight: '600',
        color: '#374151',
        zIndex: 10
      }}>
        📊 Timeline: {selectedFile}
      </div>
      
      <div style={{
        display: 'flex',
        gap: '30px',
        overflowX: 'auto',
        paddingBottom: '20px',
        minHeight: 'calc(100vh - 200px)'
      }}>
        {/* Commit nodes */}
        {filteredCommits.map((commit, index) => {
          const commitFileData = fileDataMap.get(commit.hash);
          
          return (
            <div key={commit.id} style={{ position: 'relative' }}>
              {/* Connector line */}
              {index < filteredCommits.length - 1 && (
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  right: '-30px',
                  width: '30px',
                  height: '3px',
                  background: commit.authorshipData ? '#3b82f6' : '#94a3b8',
                  zIndex: 1
                }} />
              )}
              
              {/* Commit card */}
              <div style={{
                minWidth: '450px',
                background: 'white',
                border: `2px solid ${commit.authorshipData ? '#3b82f6' : '#94a3b8'}`,
                borderRadius: '12px',
                padding: '16px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                position: 'relative',
                zIndex: 2
              }}>
                {/* Commit header */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ 
                    fontSize: '13px', 
                    fontWeight: 'bold', 
                    marginBottom: '6px', 
                    color: '#374151',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span>🔗 {commit.hash.substring(0, 8)}</span>
                    {commit.authorshipData && (
                      <span style={{ 
                        fontSize: '10px', 
                        color: '#3b82f6',
                        fontWeight: 'bold',
                        padding: '2px 6px',
                        background: '#dbeafe',
                        borderRadius: '4px'
                      }}>
                        AI
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
                    {new Date(commit.timestamp).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '12px', color: '#374151' }}>
                    {commit.message}
                  </div>
                </div>
                
                {/* File content */}
                {commitFileData ? (
                  <MiniEditor
                    lines={commitFileData.lines}
                    fileName={selectedFile.split('/').pop() || selectedFile}
                    maxLines={20}
                    showLineNumbers={true}
                    highlightChanges={false}
                  />
                ) : (
                  <div style={{
                    padding: '30px',
                    background: '#f3f4f6',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    textAlign: 'center',
                    fontSize: '12px',
                    color: '#6b7280'
                  }}>
                    Loading commit content...
                  </div>
                )}
              </div>
            </div>
          );
        })}
        
        {/* Final connector to current file */}
        {filteredCommits.length > 0 && (
          <div style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center'
          }}>
            <div style={{
              width: '40px',
              height: '3px',
              background: 'repeating-linear-gradient(to right, #10b981 0, #10b981 8px, transparent 8px, transparent 16px)',
              marginRight: '20px'
            }} />
          </div>
        )}
        
        {/* Current file node */}
        {currentFileData && (
          <div style={{
            minWidth: '450px',
            background: 'white',
            border: '3px solid #10b981',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}>
            {/* Header */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ 
                fontSize: '13px', 
                fontWeight: 'bold', 
                marginBottom: '6px', 
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
              <div style={{ fontSize: '11px', color: '#6b7280' }}>
                Working Directory
              </div>
            </div>
            
            <MiniEditor
              lines={currentFileData.lines}
              fileName={selectedFile.split('/').pop() || selectedFile}
              maxLines={20}
              showLineNumbers={true}
              highlightChanges={false}
            />
          </div>
        )}
      </div>
    </div>
  );
};