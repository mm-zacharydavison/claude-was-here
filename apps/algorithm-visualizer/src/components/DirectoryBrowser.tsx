import React, { useState, useEffect } from 'react';
import { browseDirectories, BrowseResult } from '../lib/api';

interface DirectoryBrowserProps {
  onSelectDirectory: (path: string) => void;
  onClose: () => void;
}

export const DirectoryBrowser: React.FC<DirectoryBrowserProps> = ({ onSelectDirectory, onClose }) => {
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    loadDirectories();
  }, []);
  
  const loadDirectories = async (path?: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await browseDirectories(path);
      setBrowseResult(result);
    } catch (err) {
      setError('Failed to load directories');
      console.error('Directory browsing error:', err);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleDirectoryClick = (path: string, isGitRepo: boolean) => {
    if (isGitRepo) {
      onSelectDirectory(path);
    } else {
      loadDirectories(path);
    }
  };
  
  const handleGoUp = () => {
    if (browseResult?.parentPath) {
      loadDirectories(browseResult.parentPath);
    }
  };
  
  if (isLoading) {
    return (
      <div className="directory-browser-overlay">
        <div className="directory-browser">
          <div className="loading">Loading directories...</div>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="directory-browser-overlay">
        <div className="directory-browser">
          <div className="error">
            <p>{error}</p>
            <button onClick={() => loadDirectories()}>Retry</button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="directory-browser-overlay" onClick={onClose}>
      <div className="directory-browser" onClick={(e) => e.stopPropagation()}>
        <div className="browser-header">
          <div className="current-path">{browseResult?.currentPath}</div>
          <div className="browser-actions">
            <button onClick={handleGoUp} disabled={!browseResult?.parentPath}>
              ↑ Up
            </button>
            <button onClick={onClose}>✕</button>
          </div>
        </div>
        
        <div className="directory-list">
          {browseResult?.directories.map(dir => (
            <div
              key={dir.path}
              className={`directory-item ${dir.isGitRepo ? 'git-repo' : ''}`}
              onClick={() => handleDirectoryClick(dir.path, dir.isGitRepo)}
            >
              <div className="directory-icon">
                {dir.isGitRepo ? '📁' : '📂'}
              </div>
              <div className="directory-name">{dir.name}</div>
              {dir.isGitRepo && (
                <div className="git-badge">Git</div>
              )}
            </div>
          ))}
        </div>
        
        <div className="browser-footer">
          <p>Click on a directory to navigate, or select a Git repository to open</p>
        </div>
      </div>
      
      <style jsx>{`
        .directory-browser-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        
        .directory-browser {
          background: white;
          border-radius: 8px;
          width: 600px;
          max-width: 90vw;
          height: 500px;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
        }
        
        .browser-header {
          padding: 16px;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .current-path {
          font-family: monospace;
          font-size: 14px;
          color: #374151;
          flex: 1;
          margin-right: 16px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        .browser-actions {
          display: flex;
          gap: 8px;
        }
        
        .browser-actions button {
          padding: 6px 12px;
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }
        
        .browser-actions button:hover:not(:disabled) {
          background: #e5e7eb;
        }
        
        .browser-actions button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .directory-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }
        
        .directory-item {
          display: flex;
          align-items: center;
          padding: 10px 12px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.2s;
          margin-bottom: 2px;
        }
        
        .directory-item:hover {
          background: #f3f4f6;
        }
        
        .directory-item.git-repo {
          background: #f0f9ff;
          border: 1px solid #bfdbfe;
        }
        
        .directory-item.git-repo:hover {
          background: #dbeafe;
        }
        
        .directory-icon {
          margin-right: 12px;
          font-size: 16px;
        }
        
        .directory-name {
          flex: 1;
          font-size: 14px;
          color: #374151;
        }
        
        .git-badge {
          background: #3b82f6;
          color: white;
          padding: 2px 6px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 500;
        }
        
        .browser-footer {
          padding: 12px 16px;
          border-top: 1px solid #e5e7eb;
          background: #f9fafb;
          font-size: 13px;
          color: #6b7280;
          text-align: center;
        }
        
        .loading, .error {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 200px;
          color: #6b7280;
        }
        
        .error {
          flex-direction: column;
          gap: 12px;
        }
        
        .error button {
          padding: 8px 16px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          margin: 0 4px;
        }
        
        .error button:hover {
          background: #2563eb;
        }
      `}</style>
    </div>
  );
};