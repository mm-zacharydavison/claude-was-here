import { create } from 'zustand';
import { VisualizationState, CommitNode, WorkingState, FileAuthorshipState } from '../types';

interface RepositoryInfo {
  path: string;
  name: string;
  branch: string;
  hasClaudeTracking: boolean;
}

interface VisualizationStore extends VisualizationState {
  currentRepository: RepositoryInfo | null;
  setCurrentRepository: (repo: RepositoryInfo | null) => void;
  setSelectedFile: (file: string | null) => void;
  setSelectedCommit: (commit: string | null) => void;
  setCommits: (commits: CommitNode[]) => void;
  setWorkingState: (state: WorkingState | null) => void;
  updateFileAuthorship: (filePath: string, authorship: FileAuthorshipState) => void;
  resetState: () => void;
}

const initialState: VisualizationState & { currentRepository: RepositoryInfo | null } = {
  currentRepository: null,
  selectedFile: null,
  selectedCommit: null,
  commits: [],
  workingState: null,
  fileAuthorship: new Map()
};

export const useVisualizationStore = create<VisualizationStore>((set) => ({
  ...initialState,
  
  setCurrentRepository: (repo) => set({ 
    currentRepository: repo,
    // Reset other state when repository changes
    selectedFile: null,
    selectedCommit: null,
    commits: [],
    workingState: null,
    fileAuthorship: new Map()
  }),
  
  setSelectedFile: (file) => set({ selectedFile: file }),
  
  setSelectedCommit: (commit) => set({ selectedCommit: commit }),
  
  setCommits: (commits) => set({ commits }),
  
  setWorkingState: (state) => set({ workingState: state }),
  
  updateFileAuthorship: (filePath, authorship) => 
    set((state) => {
      const newMap = new Map(state.fileAuthorship);
      newMap.set(filePath, authorship);
      return { fileAuthorship: newMap };
    }),
  
  resetState: () => set(initialState)
}));