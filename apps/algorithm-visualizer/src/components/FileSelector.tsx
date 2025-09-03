import React, { useState, useEffect } from 'react';
import { useVisualizationStore } from '../lib/store';
import { fetchFiles } from '../lib/api';

export const FileSelector: React.FC = () => {
  const { selectedFile, setSelectedFile } = useVisualizationStore();
  const [files, setFiles] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  useEffect(() => {
    const loadFiles = async () => {
      setIsLoading(true);
      try {
        const fileList = await fetchFiles();
        setFiles(fileList);
      } catch (error) {
        console.error('Failed to load files:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadFiles();
  }, []);
  
  const filteredFiles = files.filter(file =>
    file.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  return (
    <div className="file-selector" style={{
      width: '300px',
      height: '100%',
      borderRight: '1px solid #e5e7eb',
      padding: '16px',
      overflowY: 'auto'
    }}>
      <h3 style={{ marginTop: 0, marginBottom: '16px' }}>Files</h3>
      
      <input
        type="text"
        placeholder="Search files..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        style={{
          width: '100%',
          padding: '8px',
          marginBottom: '16px',
          border: '1px solid #e5e7eb',
          borderRadius: '4px',
          fontSize: '14px'
        }}
      />
      
      {isLoading ? (
        <div style={{ textAlign: 'center', color: '#6b7280' }}>
          Loading files...
        </div>
      ) : (
        <div className="file-list">
          {filteredFiles.map(file => (
            <div
              key={file}
              className={`file-item ${selectedFile === file ? 'selected' : ''}`}
              onClick={() => setSelectedFile(file)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                borderRadius: '4px',
                marginBottom: '4px',
                fontSize: '14px',
                background: selectedFile === file ? '#3b82f6' : 'transparent',
                color: selectedFile === file ? 'white' : '#374151',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                if (selectedFile !== file) {
                  e.currentTarget.style.background = '#f3f4f6';
                }
              }}
              onMouseLeave={(e) => {
                if (selectedFile !== file) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              {file}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};