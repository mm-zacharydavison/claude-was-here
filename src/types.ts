export interface StructuredPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * An individual edit in an 'Edit' or 'MultiEdit' tool input or response.
 */
export interface ClaudeEdit {
  old_string?: string;
  new_string?: string;
}

/**
 * tool_input for an 'Edit' tool call.
 */
export type ClaudeEditInput = ClaudeEdit & {
  file_path: string;
}

/**
 * tool_response for an 'Edit' tool call.
 */
export interface ClaudeEditResponse {
  filePath?: string;
  oldString?: string;
  newString?: string;
  originalFile?: string;
  structuredPatch?: StructuredPatchHunk[];
  userModified?: boolean;
  replaceAll?: boolean;
}

/**
 * tool_input for a 'MultiEdit' tool call.
 */
export interface ClaudeMultiEditInput {
  file_path?: string;
  edits?: ClaudeEdit[];
}

/**
 * tool_response for a 'MultiEdit' tool call.
 */
export interface ClaudeMultiEditResponse {
  filePath?: string;
  edits?: ClaudeEdit & { replace_all: boolean }[];
  structuredPatch: StructuredPatchHunk[];
}

/**
 * Data provided to a 'PostToolUse' hook call.
 */
export interface ClaudePostToolUseHookData {
  tool_name: string;
  tool_input: /* ClaudeWriteInput | */ ClaudeEditInput | ClaudeMultiEditInput;
  tool_response?: /* ClaudeWriteResponse | */ ClaudeEditResponse | ClaudeMultiEditResponse;
}

export interface FileMetadata {
  timestamp: string;
  tool: string;
  file: string;
  lines: number[];
}

export interface CommitSummary {
  total_files: number;
  claude_modified_files: number;
  claude_modified_lines: number;
  files: Record<string, {
    claude_lines: number[];
    total_claude_lines: number;
  }>;
}

export interface GitNoteData {
  claude_was_here: {
    version: string;
    files: Record<string, {
      ranges: LineRange[];
    }>;
  };
}

export type LineRange = [number, number];