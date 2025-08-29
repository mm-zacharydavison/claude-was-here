import { readFile, writeFile, appendFile } from 'fs/promises';
import { join, relative } from 'path';
import { ensureDirectory, getClaudeWasHereDir } from '../utils/files.ts';
import type { ClaudeEditInput, ClaudeEditResponse, ClaudePostToolUseHookData, ClaudeMultiEditInput, ClaudeMultiEditResponse, FileMetadata } from '../types.ts';

export async function trackChanges(): Promise<void> {
  const debugLog = join(getClaudeWasHereDir(), 'debug.log');
  
  async function log(message: string) {
    // Only log if DEBUG environment variable is set
    if (!process.env.DEBUG) return;
    
    try {
      await ensureDirectory(getClaudeWasHereDir());
      await appendFile(debugLog, `${new Date().toISOString()}: ${message}\n`);
    } catch {
      // Ignore logging errors
    }
  }
  
  try {
    await log('trackChanges() called');
    
    // Read hook input from stdin
    const input = await new Response(Bun.stdin).text();
    await log(`stdin input: "${input}"`);
    await log(`stdin length: ${input.length}`);
    
    if (!input.trim()) {
      await log('No input received, returning');
      return;
    }
    
    const hookData: ClaudePostToolUseHookData = JSON.parse(input);
    await log(`Parsed hook data: ${JSON.stringify(hookData, null, 2)}`);
    
    const toolName = hookData.tool_name;
    const toolInput = hookData.tool_input;
    await log(`Tool name: ${toolName}`);
    await log(`Tool use: ${JSON.stringify(toolInput, null, 2)}`);
    
    if (!['Edit', 'MultiEdit', 'Write'].includes(toolName)) {
      await log(`Tool ${toolName} not tracked, returning`);
      return;
    }
    
    const filePath = toolInput.file_path;
    await log(`File path: ${filePath}`);
    if (!filePath) {
      await log('No file path provided, returning');
      return;
    }
    
    // Make file_path relative to repo root
    const repoRoot = process.cwd();
    let relPath: string;
    try {
      relPath = relative(repoRoot, filePath);
    } catch {
      // File is outside repo, skip
      return;
    }
    
    // Prepare metadata
    const metadata: FileMetadata = {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: relPath,
      lines: []
    };
    
    if (toolName === 'Write') {
      // For Write operations, assume entire file is Claude-authored
      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        metadata.lines = Array.from({ length: lines.length }, (_, i) => i + 1);
      } catch {
        metadata.lines = [];
      }
    } else if (toolName === 'Edit') {
      // Use structuredPatch if available for precise line tracking
      const editInput = hookData.tool_input as ClaudeEditInput;
      const toolResponse = hookData.tool_response as ClaudeEditResponse;
      if (toolResponse?.structuredPatch) {
        const allLines = new Set<number>();
        
        for (const hunk of toolResponse.structuredPatch) {
          // Only track lines that were actually added by Claude
          // In a patch hunk:
          // - oldLines: number of lines in the original content
          // - newLines: number of lines in the new content
          // - If newLines > oldLines, then (newLines - oldLines) lines were added
          
          const linesAdded = Math.max(0, hunk.newLines - hunk.oldLines);
          
          if (linesAdded > 0) {
            // Lines were added - track the last 'linesAdded' lines in the new range
            // These are the lines that Claude actually authored
            const addedLinesStart = hunk.newStart + hunk.oldLines;
            const addedLinesEnd = addedLinesStart + linesAdded - 1;
            
            for (let lineNum = addedLinesStart; lineNum <= addedLinesEnd; lineNum++) {
              if (lineNum > 0) { // Ensure valid line numbers
                allLines.add(lineNum);
              }
            }
          }
          // If linesAdded <= 0, this was a deletion or replacement - no new lines to track
        }
        
        metadata.lines = Array.from(allLines).sort((a, b) => a - b);
        await log(`Edit detected using structuredPatch: lines ${metadata.lines.join(', ')}`);
      } else {
        // Fallback to old method if structuredPatch not available
        const oldString = editInput.old_string || '';
        const newString = editInput.new_string || '';
        
        if (oldString && newString) {
          try {
            const content = await readFile(filePath, 'utf-8');
            
            // Find where the new content appears in the file
            const newStringIndex = content.indexOf(newString);
            if (newStringIndex !== -1) {
              // Count lines up to the start of the new content
              const contentBeforeChange = content.substring(0, newStringIndex);
              const linesBeforeChange = contentBeforeChange.split('\n').length - 1;
              const startLine = linesBeforeChange + 1;
              
              // Count lines in the new content
              const newLines = newString.split('\n').length;
              const endLine = startLine + newLines - 1;
              
              metadata.lines = Array.from({ length: endLine - startLine + 1 }, (_, i) => startLine + i);
              await log(`Edit detected (fallback): lines ${startLine}-${endLine}`);
            } else {
              await log(`Could not find new_string in file content`);
              metadata.lines = [];
            }
          } catch (error) {
            await log(`Error processing Edit: ${error}`);
            metadata.lines = [];
          }
        }
      }
    } else if (toolName === 'MultiEdit') {
      // Use structuredPatch if available for precise line tracking
      const multiEditInput = hookData.tool_input as ClaudeMultiEditInput;
      const toolResponse = hookData.tool_response as ClaudeMultiEditResponse;
      if (toolResponse?.structuredPatch) {
        const allLines = new Set<number>();
        
        for (const hunk of toolResponse.structuredPatch) {
          // Only track lines that were actually added by Claude
          // In a patch hunk:
          // - oldLines: number of lines in the original content
          // - newLines: number of lines in the new content
          // - If newLines > oldLines, then (newLines - oldLines) lines were added
          
          const linesAdded = Math.max(0, hunk.newLines - hunk.oldLines);
          
          if (linesAdded > 0) {
            // Lines were added - track the last 'linesAdded' lines in the new range
            // These are the lines that Claude actually authored
            const addedLinesStart = hunk.newStart + hunk.oldLines;
            const addedLinesEnd = addedLinesStart + linesAdded - 1;
            
            for (let lineNum = addedLinesStart; lineNum <= addedLinesEnd; lineNum++) {
              if (lineNum > 0) { // Ensure valid line numbers
                allLines.add(lineNum);
              }
            }
          }
          // If linesAdded <= 0, this was a deletion or replacement - no new lines to track
        }
        
        metadata.lines = Array.from(allLines).sort((a, b) => a - b);
        await log(`MultiEdit detected using structuredPatch: lines ${metadata.lines.join(', ')}`);
      } else {
        // Fallback to old method if structuredPatch not available
        // Note: This fallback is less accurate and may cause duplicate tracking
        const edits = multiEditInput.edits || [];
        const allLines = new Set<number>();
        
        try {
          const content = await readFile(filePath, 'utf-8');
          
          for (const edit of edits) {
            const oldString = edit.old_string || '';
            const newString = edit.new_string || '';
            
            if (oldString && newString) {
              const newStringIndex = content.indexOf(newString);
              if (newStringIndex !== -1) {
                // Calculate lines added (net new lines)
                const oldLines = oldString.split('\n').length;
                const newLines = newString.split('\n').length;
                const linesAdded = Math.max(0, newLines - oldLines);
                
                if (linesAdded > 0) {
                  // Find the starting line of the edit
                  const contentBeforeChange = content.substring(0, newStringIndex);
                  const linesBeforeChange = contentBeforeChange.split('\n').length - 1;
                  const editStartLine = linesBeforeChange + 1;
                  
                  // The added lines are at the end of the replacement
                  const addedLinesStart = editStartLine + oldLines;
                  const addedLinesEnd = addedLinesStart + linesAdded - 1;
                  
                  for (let i = addedLinesStart; i <= addedLinesEnd; i++) {
                    if (i > 0 && isFinite(i)) { // Ensure valid line numbers
                      allLines.add(i);
                    }
                  }
                }
              }
            }
          }
          
          metadata.lines = Array.from(allLines).sort((a, b) => a - b);
          await log(`MultiEdit detected (fallback): lines ${metadata.lines.join(', ')}`);
        } catch {
          metadata.lines = [];
        }
      }
    }
    
    // Store traditional metadata for backward compatibility
    const wasHereDir = getClaudeWasHereDir();
    await ensureDirectory(wasHereDir);
    
    const metadataFile = join(wasHereDir, `${relPath.replace(/[/\\]/g, '_')}.json`);
    
    // Load existing metadata or create new
    let existingData: FileMetadata[] = [];
    try {
      const existing = await readFile(metadataFile, 'utf-8');
      existingData = JSON.parse(existing);
    } catch {
      existingData = [];
    }
    
    existingData.push(metadata);
    
    // Save updated metadata
    await writeFile(metadataFile, JSON.stringify(existingData, null, 2));
    await log(`Traditional metadata saved to: ${metadataFile}`);
    
    // Hash-based tracking removed to eliminate duplicate tracking systems
    await log(`Tracking completed for ${relPath}: ${metadata.lines.length} lines tracked`);
    
  } catch (error) {
    await log(`Error in trackChanges: ${error}`);
    // Don't fail the hook, just log error
    const errorLog = join(getClaudeWasHereDir(), 'hook_errors.log');
    const errorMessage = `${new Date().toISOString()}: ${error}\n`;
    try {
      await appendFile(errorLog, errorMessage);
    } catch {
      // Ignore logging errors
    }
  }
}