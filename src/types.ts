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

// TODO: Define new tracking data structures