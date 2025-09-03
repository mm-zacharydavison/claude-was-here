import React, { useState, useEffect } from 'react';
import { browseDirectories, BrowseResult } from '../lib/api';
import './DirectoryBrowser.css';

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
      
    </div>
  );
};