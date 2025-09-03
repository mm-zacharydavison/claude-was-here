# Algorithm Visualizer

Interactive web UI for visualizing the claude-was-here rollup algorithm and AI authorship tracking.

## Features

- **Directory Picker**: Open any git repository from your filesystem with recent repositories list
- **Commit Timeline**: View commits as an interactive chain with Miro-style UI
- **File Selector**: Browse and select files to analyze
- **Authorship Visualization**: See line-by-line AI vs human authorship with visual indicators
- **Working State Diff**: View uncommitted changes and their impact on authorship
- **Rollup Algorithm**: Uses the same core rollup algorithm as the main claude-was-here tool
- **Repository Management**: Switch between repositories, track Claude tracking status

## Getting Started

1. Install dependencies:
```bash
cd apps/algorithm-visualizer
bun install
```

2. Start the development server:
```bash
bun run start
```

This will start both the API server (port 3001) and the Vite dev server (port 5173).

3. Open http://localhost:5173 in your browser

## Architecture

- **Frontend**: React + TypeScript + Vite
- **State Management**: Zustand
- **Visualization**: React Flow for commit chain, custom components for code view
- **Backend**: Express server that interfaces with git commands
- **Shared Code**: Uses the same rollup algorithm from the main tool

## Components

- `CommitChain`: Interactive commit timeline visualization
- `FileSelector`: File browser with search
- `AuthorshipVisualization`: Line-by-line authorship display
- `WorkingStateDiff`: Uncommitted changes visualization

## API Endpoints

- `POST /api/repository` - Set current repository
- `GET /api/recent-repositories` - Get recent repositories list
- `POST /api/recent-repositories` - Add repository to recent list
- `GET /api/files` - List all tracked files
- `GET /api/commits` - Get commit history
- `GET /api/file/:path` - Get file content
- `GET /api/working-state/:path` - Get working state changes
- `GET /api/authorship/:path` - Get authorship data

## Usage

1. Start the visualizer from the project root:
   ```bash
   bun run visualizer
   ```

2. In the web interface:
   - Use the directory picker at the top to browse and open a git repository
   - Recent repositories are saved for quick access
   - Select files from the sidebar to analyze their authorship history
   - View commit timeline to see authorship changes over time
   - Check working state diff to see uncommitted changes