import { useEffect } from 'react';
import { DirectoryPicker } from './components/DirectoryPicker';
import { FileSelector } from './components/FileSelector';
import { CommitTimeline } from './components/CommitTimeline';
import { useVisualizationStore } from './lib/store';
import { fetchCommits } from './lib/api';
import './App.css';

function App() {
  const { currentRepository, selectedFile, setCommits } = useVisualizationStore();
  
  useEffect(() => {
    // Load commits when file is selected or repository changes
    if (!currentRepository) return;
    
    const loadCommits = async () => {
      try {
        const commits = await fetchCommits(selectedFile || undefined);
        setCommits(commits);
      } catch (error) {
        console.error('Failed to load commits:', error);
      }
    };
    
    loadCommits();
  }, [currentRepository, selectedFile, setCommits]);
  
  
  return (
    <div className="app">
      <header className="app-header">
        <h1>Claude Was Here - Algorithm Visualizer</h1>
        <p>Visualize AI authorship tracking across your git history</p>
      </header>
      
      <DirectoryPicker />
      
      {currentRepository ? (
        <div className="app-content">
          <aside className="sidebar">
            <FileSelector />
          </aside>
          
          <main className="main-content">
            <section className="commit-timeline-section">
              <CommitTimeline />
            </section>
          </main>
        </div>
      ) : (
        <div className="empty-state" style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          color: '#6b7280',
          padding: '40px'
        }}>
          <svg width="80" height="80" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginBottom: '24px', opacity: 0.3 }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <h2 style={{ fontSize: '24px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
            No Repository Selected
          </h2>
          <p style={{ fontSize: '16px', textAlign: 'center', maxWidth: '400px' }}>
            Open a git repository to start visualizing AI authorship tracking
          </p>
        </div>
      )}
    </div>
  );
}

export default App;