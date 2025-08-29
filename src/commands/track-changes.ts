import { readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { 
  ClaudeHookData, 
  FileChangeRecord, 
  WorkingTrackingData, 
  StructuredPatchHunk 
} from '../types.ts';
import { ensureDirectory, getWorkingTrackingDir, getTrackingDataFile, fileExists } from '../utils/files.ts';

/**
 * Creates a structured patch from old and new content strings
 */
function createStructuredPatch(oldContent: string, newContent: string): StructuredPatchHunk[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  // Simple diff algorithm - find changed sections
  const patches: StructuredPatchHunk[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    // Find next difference
    let oldStart = oldIndex;
    let newStart = newIndex;
    
    // Skip identical lines
    while (
      oldIndex < oldLines.length && 
      newIndex < newLines.length && 
      oldLines[oldIndex] === newLines[newIndex]
    ) {
      oldIndex++;
      newIndex++;
    }
    
    if (oldIndex >= oldLines.length && newIndex >= newLines.length) {
      break; // No more differences
    }
    
    // Find the end of the difference
    const diffOldStart = oldIndex;
    const diffNewStart = newIndex;
    
    // Find how many lines are different
    let oldDiffLines = 0;
    let newDiffLines = 0;
    
    // Simple approach: assume all remaining different lines until we find a match
    const tempOldIndex = oldIndex;
    const tempNewIndex = newIndex;
    
    // Look ahead to find next matching section
    let foundMatch = false;
    let matchOldIndex = oldIndex;
    let matchNewIndex = newIndex;
    
    for (let lookAhead = 1; lookAhead <= 10 && !foundMatch; lookAhead++) {
      for (let oldOffset = 0; oldOffset <= lookAhead && tempOldIndex + oldOffset < oldLines.length; oldOffset++) {
        for (let newOffset = 0; newOffset <= lookAhead && tempNewIndex + newOffset < newLines.length; newOffset++) {
          if (
            tempOldIndex + oldOffset < oldLines.length &&
            tempNewIndex + newOffset < newLines.length &&
            oldLines[tempOldIndex + oldOffset] === newLines[tempNewIndex + newOffset]
          ) {
            matchOldIndex = tempOldIndex + oldOffset;
            matchNewIndex = tempNewIndex + newOffset;
            foundMatch = true;
            break;
          }
        }
        if (foundMatch) break;
      }
    }
    
    if (!foundMatch) {
      // Take all remaining lines
      matchOldIndex = oldLines.length;
      matchNewIndex = newLines.length;
    }
    
    oldDiffLines = matchOldIndex - diffOldStart;
    newDiffLines = matchNewIndex - diffNewStart;
    
    if (oldDiffLines > 0 || newDiffLines > 0) {
      const hunkLines: string[] = [];
      
      // Add removed lines
      for (let i = diffOldStart; i < matchOldIndex; i++) {
        hunkLines.push(`-${oldLines[i]}`);
      }
      
      // Add added lines  
      for (let i = diffNewStart; i < matchNewIndex; i++) {
        hunkLines.push(`+${newLines[i]}`);
      }
      
      patches.push({
        oldStart: diffOldStart + 1, // 1-based line numbers
        oldLines: oldDiffLines,
        newStart: diffNewStart + 1, // 1-based line numbers  
        newLines: newDiffLines,
        lines: hunkLines
      });
    }
    
    oldIndex = matchOldIndex;
    newIndex = matchNewIndex;
  }
  
  return patches;
}

/**
 * Processes edit tool data and returns file change record
 */
function processEditTool(hookData: ClaudeHookData): FileChangeRecord | null {
  const { tool_input, tool_response } = hookData;
  
  if (!tool_input?.file_path || !tool_response?.filePath) {
    return null;
  }
  
  const filePath = tool_response.filePath;
  let structuredPatch: StructuredPatchHunk[] = [];
  
  // Try to get structured patch from response first
  if (tool_response.structuredPatch && Array.isArray(tool_response.structuredPatch)) {
    structuredPatch = tool_response.structuredPatch;
  } else if (tool_input.old_string && tool_input.new_string) {
    // Fallback: create patch from old/new strings
    structuredPatch = createStructuredPatch(tool_input.old_string, tool_input.new_string);
  }
  
  return {
    filePath,
    toolName: hookData.tool_name,
    sessionId: hookData.session_id,
    timestamp: Date.now(),
    structuredPatch,
    originalContent: tool_input.old_string,
    newContent: tool_input.new_string
  };
}

/**
 * Processes multi-edit tool data and returns file change record
 */  
function processMultiEditTool(hookData: ClaudeHookData): FileChangeRecord | null {
  const { tool_input, tool_response } = hookData;
  
  if (!tool_input?.file_path || !tool_response?.filePath) {
    return null;
  }
  
  const filePath = tool_response.filePath;
  let structuredPatch: StructuredPatchHunk[] = [];
  
  // Get structured patch from response
  if (tool_response.structuredPatch && Array.isArray(tool_response.structuredPatch)) {
    structuredPatch = tool_response.structuredPatch;
  }
  
  return {
    filePath,
    toolName: hookData.tool_name,
    sessionId: hookData.session_id,  
    timestamp: Date.now(),
    structuredPatch
  };
}

/**
 * Processes write tool data and returns file change record
 */
function processWriteTool(hookData: ClaudeHookData): FileChangeRecord | null {
  const { tool_input, tool_response } = hookData;
  
  if (!tool_input?.file_path || !tool_response?.filePath) {
    return null;
  }
  
  const filePath = tool_response.filePath;
  
  // For Write tool, we treat the entire file as new content
  // Create a patch that represents the whole file being replaced
  let structuredPatch: StructuredPatchHunk[] = [];
  
  if (tool_input.content) {
    const newLines = tool_input.content.split('\n');
    structuredPatch = [{
      oldStart: 1,
      oldLines: 0, // Assume no old content (new file)
      newStart: 1,
      newLines: newLines.length,
      lines: newLines.map((line: string) => `+${line}`)
    }];
  }
  
  return {
    filePath,
    toolName: hookData.tool_name,
    sessionId: hookData.session_id,
    timestamp: Date.now(), 
    structuredPatch,
    newContent: tool_input.content
  };
}

/**
 * Reads existing tracking data from file
 */
async function readTrackingData(): Promise<WorkingTrackingData> {
  const trackingFile = getTrackingDataFile();
  
  if (await fileExists(trackingFile)) {
    try {
      const content = await readFile(trackingFile, 'utf-8');
      const data = JSON.parse(content) as WorkingTrackingData;
      return data;
    } catch (error) {
      console.warn('Failed to read tracking data, starting fresh:', error);
    }
  }
  
  return { records: [] };
}

/**
 * Writes tracking data to file
 */
async function writeTrackingData(data: WorkingTrackingData): Promise<void> {
  const trackingDir = getWorkingTrackingDir();
  const trackingFile = getTrackingDataFile();
  
  await ensureDirectory(trackingDir);
  await writeFile(trackingFile, JSON.stringify(data, null, 2));
}

export async function trackChanges(): Promise<void> {
  try {
    // Read hook data from stdin
    let stdinData = '';
    
    // Read from stdin
    for await (const chunk of process.stdin) {
      stdinData += chunk;
    }
    
    if (!stdinData.trim()) {
      console.error('No hook data received from stdin');
      return;
    }
    
    const hookData: ClaudeHookData = JSON.parse(stdinData);
    
    // Process based on tool type
    let changeRecord: FileChangeRecord | null = null;
    
    switch (hookData.tool_name) {
      case 'Edit':
        changeRecord = processEditTool(hookData);
        break;
      case 'MultiEdit':
        changeRecord = processMultiEditTool(hookData);
        break;
      case 'Write':
        changeRecord = processWriteTool(hookData);
        break;
      default:
        console.log(`Ignoring unsupported tool: ${hookData.tool_name}`);
        return;
    }
    
    if (!changeRecord) {
      console.error('Failed to process tool data');
      return;
    }
    
    // Load existing tracking data
    const trackingData = await readTrackingData();
    
    // Add new record
    trackingData.records.push(changeRecord);
    
    // Write back to file
    await writeTrackingData(trackingData);
    
    console.log(`Tracked changes to ${changeRecord.filePath}`);
  } catch (error) {
    console.error('Error tracking changes:', error);
    process.exit(1);
  }
}