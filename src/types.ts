export interface StructuredPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface ClaudeEdit {
  old_string?: string;
  new_string?: string;
}

export type ClaudeEditInput = ClaudeEdit & {
  file_path: string;
}

export interface ClaudeEditResponse {
  filePath?: string;
  oldString?: string;
  newString?: string;
  originalFile?: string;
  structuredPatch?: StructuredPatchHunk[];
  userModified?: boolean;
  replaceAll?: boolean;
}

export interface ClaudeMultiEditInput {
  file_path?: string;
  edits?: ClaudeEdit[];
}

export interface ClaudeMultiEditResponse {
  filePath?: string;
  edits?: ClaudeEdit & { replace_all: boolean }[];
  structuredPatch: StructuredPatchHunk[];
}

export interface ClaudePostToolUseHookData {
  tool_name: string;
  tool_input: ClaudeEditInput | ClaudeMultiEditInput;
  tool_response?: ClaudeEditResponse | ClaudeMultiEditResponse;
}

// Hook data structures
export interface ClaudeHookData {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: any;
  tool_response: any;
}

// Tracking data structures
export interface FileChangeRecord {
  filePath: string;
  toolName: string;
  sessionId: string;
  timestamp: number;
  structuredPatch: StructuredPatchHunk[];
  originalContent?: string;
  newContent?: string;
}

export interface WorkingTrackingData {
  records: FileChangeRecord[];
}

// Post-commit data structures
export interface LineRange {
  start: number;
  end: number;
}

export interface FileAuthorshipInfo {
  filePath: string;
  aiAuthoredRanges: LineRange[];
}

export interface CommitAuthorshipData {
  version: string;
  files: FileAuthorshipInfo[];
}

export interface LineAuthorshipResult {
  lineNumber: number;
  isAiAuthored: boolean;
}