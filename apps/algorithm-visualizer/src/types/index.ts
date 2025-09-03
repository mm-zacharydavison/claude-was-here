export interface LineRange {
  start: number;
  end: number;
}

export interface CommitAuthorshipData {
  version: string;
  files: FileAuthorshipInfo[];
}

export interface FileAuthorshipInfo {
  filePath: string;
  aiAuthoredRanges: LineRange[];
}

export interface AuthorshipEntry {
  lineNumber: number;
  isAiAuthored: boolean;
  commitHash: string;
  timestamp: number;
}

export interface FileAuthorshipState {
  filePath: string;
  totalLines: number;
  authorshipMap: Map<number, AuthorshipEntry>;
}

export interface CommitNode {
  id: string;
  hash: string;
  message: string;
  timestamp: number;
  authorshipData?: CommitAuthorshipData;
  files: string[];
  parent?: string;
}

export interface WorkingState {
  filePath: string;
  content: string;
  changes: {
    added: LineRange[];
    removed: LineRange[];
    modified: LineRange[];
  };
}

export interface VisualizationState {
  selectedFile: string | null;
  selectedCommit: string | null;
  commits: CommitNode[];
  workingState: WorkingState | null;
  fileAuthorship: Map<string, FileAuthorshipState>;
}