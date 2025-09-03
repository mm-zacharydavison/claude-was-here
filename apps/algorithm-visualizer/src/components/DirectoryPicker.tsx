import React, { useState, useEffect } from 'react';
import { useVisualizationStore } from '../lib/store';
import { setRepository, getRecentRepositories, addRecentRepository } from '../lib/api';
import { DirectoryBrowser } from './DirectoryBrowser';

export const DirectoryPicker: React.FC = () => {
  const { currentRepository, setCurrentRepository } = useVisualizationStore();
  const [isLoading, setIsLoading] = useState(false);
  const [recentRepos, setRecentRepos] = useState<string[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [inputPath, setInputPath] = useState('');
  
  useEffect(() => {
    loadRecentRepositories();
  }, []);
  
  const loadRecentRepositories = async () => {
    try {
      const recent = await getRecentRepositories();
      setRecentRepos(recent);
    } catch (error) {
      console.error('Failed to load recent repositories:', error);
    }
  };
  
  const handleDirectorySelect = async (path: string) => {
    if (!path) return;
    
    setIsLoading(true);
    try {
      const result = await setRepository(path);
      if (result.success) {
        setCurrentRepository({
          path: result.path,
          name: result.name,
          branch: result.branch,
          hasClaudeTracking: result.hasClaudeTracking
        });
        await addRecentRepository(path);
        await loadRecentRepositories();
        setInputPath('');
        setShowRecent(false);
      } else {
        alert(result.error || 'Failed to open repository');
      }
    } catch (error) {
      console.error('Failed to set repository:', error);
      alert('Failed to open repository. Make sure it\'s a valid git repository.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputPath(e.target.value);
  };
  
  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputPath) {
      handleDirectorySelect(inputPath);
    }
  };
  
  const handleBrowserSelect = (path: string) => {
    setShowBrowser(false);
    handleDirectorySelect(path);
  };
  
  return (
    <div className="directory-picker" style={{
      padding: '16px',
      background: 'white',
      borderBottom: '1px solid #e5e7eb',
      position: 'relative'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          {currentRepository ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                  {currentRepository.name}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                  {currentRepository.path} • {currentRepository.branch}
                  {currentRepository.hasClaudeTracking && (
                    <span style={{ color: '#10b981', marginLeft: '8px' }}>
                      ✓ Claude tracking enabled
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowRecent(!showRecent)}
                style={{
                  padding: '6px 12px',
                  background: '#f3f4f6',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  color: '#374151'
                }}
              >
                Change Repository
              </button>
            </div>
          ) : (
            <form onSubmit={handleInputSubmit} style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="Enter repository path (e.g., /home/user/project)"
                value={inputPath}
                onChange={handleInputChange}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setShowBrowser(true)}
                style={{
                  padding: '8px 16px',
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  opacity: isLoading ? 0.5 : 1
                }}
                disabled={isLoading}
              >
                Browse
              </button>
              <button
                type="submit"
                style={{
                  padding: '8px 16px',
                  background: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  opacity: isLoading || !inputPath ? 0.5 : 1
                }}
                disabled={isLoading || !inputPath}
              >
                Open
              </button>
            </form>
          )}
        </div>
      </div>
      
      {(showRecent || !currentRepository) && recentRepos.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '16px',
          right: '16px',
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '6px',
          marginTop: '8px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          zIndex: 10,
          maxHeight: '200px',
          overflowY: 'auto'
        }}>
          <div style={{
            padding: '8px 12px',
            fontSize: '12px',
            fontWeight: '600',
            color: '#6b7280',
            borderBottom: '1px solid #e5e7eb'
          }}>
            Recent Repositories
          </div>
          {recentRepos.map(repo => (
            <div
              key={repo}
              onClick={() => handleDirectorySelect(repo)}
              style={{
                padding: '10px 12px',
                fontSize: '13px',
                cursor: 'pointer',
                borderBottom: '1px solid #f3f4f6',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f9fafb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <div style={{ fontWeight: '500', color: '#374151' }}>
                {repo.split('/').pop() || repo}
              </div>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                {repo}
              </div>
            </div>
          ))}
        </div>
      )}
      
      {showBrowser && (
        <DirectoryBrowser
          onSelectDirectory={handleBrowserSelect}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </div>
  );
};