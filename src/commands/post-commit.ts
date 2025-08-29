import { readFile, rm } from 'fs/promises';
import { 
  WorkingTrackingData, 
  FileChangeRecord, 
  LineAuthorshipResult,
  LineRange,
  FileAuthorshipInfo,
  CommitAuthorshipData,
  StructuredPatchHunk
} from '../types.ts';
import { getTrackingDataFile, fileExists } from '../utils/files.ts';
import { getCurrentCommitHash, addGitNote } from '../utils/git.ts';
import { logger } from '../utils/logger.ts';

/**
 * Analyzes which lines in a file are still AI-authored vs human-modified
 * Uses content-based matching to handle moved lines correctly
 */
function analyzeLineAuthorship(
  originalContent: string, 
  currentContent: string, 
  structuredPatches: StructuredPatchHunk[]
): LineAuthorshipResult[] {
  const currentLines = currentContent.split('\n');
  const results: LineAuthorshipResult[] = [];
  
  // Extract AI-authored line content from patches
  const aiAuthoredContent = new Set<string>();
  
  for (const patch of structuredPatches) {
    const newLines = patch.lines
      .filter(line => line.startsWith('+'))
      .map(line => line.substring(1));
    
    for (const line of newLines) {
      aiAuthoredContent.add(line);
    }
  }
  
  // If we have original content, do more sophisticated analysis
  if (originalContent && aiAuthoredContent.size > 0) {
    // Reconstruct what the file should look like if AI changes were applied
    const expectedLines = originalContent.split('\n');
    
    // Apply patches to get expected content
    for (const patch of structuredPatches) {
      const newLines = patch.lines
        .filter(line => line.startsWith('+'))
        .map(line => line.substring(1));
      
      // Replace the old lines with new lines
      const startIdx = patch.newStart - 1; // Convert to 0-based
      expectedLines.splice(startIdx, patch.oldLines, ...newLines);
    }
    
    // For each line in current content, check if it's AI-authored
    for (let i = 0; i < currentLines.length; i++) {
      const currentLine = currentLines[i];
      const lineNumber = i + 1; // 1-based line numbers
      
      // Line is AI-authored if:
      // 1. The line content matches any AI-authored content from patches
      // 2. AND the line appears in the expected content (ensuring it wasn't just coincidentally similar)
      const isAiAuthored = aiAuthoredContent.has(currentLine) && expectedLines.includes(currentLine);
      
      results.push({
        lineNumber,
        isAiAuthored
      });
    }
  } else {
    // Fallback: mark lines as AI-authored if they match AI-authored content
    for (let i = 0; i < currentLines.length; i++) {
      const currentLine = currentLines[i];
      const lineNumber = i + 1;
      const isAiAuthored = aiAuthoredContent.has(currentLine);
      
      results.push({
        lineNumber,
        isAiAuthored
      });
    }
  }
  
  return results;
}

/**
 * Converts line authorship results to compact line ranges
 */
function convertToLineRanges(authorshipResults: LineAuthorshipResult[]): LineRange[] {
  const ranges: LineRange[] = [];
  const aiLines = authorshipResults
    .filter(result => result.isAiAuthored)
    .map(result => result.lineNumber)
    .sort((a, b) => a - b);
  
  if (aiLines.length === 0) return ranges;
  
  let rangeStart = aiLines[0];
  let rangeEnd = aiLines[0];
  
  for (let i = 1; i < aiLines.length; i++) {
    const currentLine = aiLines[i];
    
    // If this line is consecutive to the previous range, extend the range
    if (currentLine === rangeEnd + 1) {
      rangeEnd = currentLine;
    } else {
      // Non-consecutive, so close the current range and start a new one
      ranges.push({ start: rangeStart, end: rangeEnd });
      rangeStart = currentLine;
      rangeEnd = currentLine;
    }
  }
  
  // Don't forget the last range
  ranges.push({ start: rangeStart, end: rangeEnd });
  
  return ranges;
}

/**
 * Processes a file's track changes to determine AI authorship
 */
async function processFileAuthorship(records: FileChangeRecord[], filePath: string): Promise<FileAuthorshipInfo> {
  // Merge all patches for this file
  const allPatches: StructuredPatchHunk[] = [];
  let originalContent = '';
  
  for (const record of records) {
    allPatches.push(...record.structuredPatch);
    if (record.originalContent) {
      originalContent = record.originalContent;
    }
  }
  
  // Read current file content
  let currentContent = '';
  try {
    currentContent = await readFile(filePath, 'utf-8');
  } catch {
    // File might not exist or be readable
    return {
      filePath,
      aiAuthoredRanges: []
    };
  }
  
  // Analyze line authorship
  const authorshipResults = analyzeLineAuthorship(originalContent, currentContent, allPatches);
  
  // Convert to line ranges
  const aiAuthoredRanges = convertToLineRanges(authorshipResults);
  
  return {
    filePath,
    aiAuthoredRanges
  };
}

/**
 * Formats commit authorship data as human-readable text
 */
function formatCommitNote(data: CommitAuthorshipData): string {
  let note = `claude-was-here\nversion: ${data.version}\n`;
  
  for (const fileInfo of data.files) {
    if (fileInfo.aiAuthoredRanges.length > 0) {
      const ranges = fileInfo.aiAuthoredRanges
        .map(range => range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`)
        .join(', ');
      
      note += `${fileInfo.filePath}: ${ranges}\n`;
    }
  }
  
  return note.trim();
}

export async function postCommitHook(): Promise<void> {
  try {
    // Read current tracking data
    const trackingFile = getTrackingDataFile();
    if (!(await fileExists(trackingFile))) {
      logger.log('No tracking data found, nothing to process');
      return;
    }
    
    const trackingData: WorkingTrackingData = JSON.parse(
      await readFile(trackingFile, 'utf-8')
    );
    
    if (trackingData.records.length === 0) {
      logger.log('No track changes to process');
      return;
    }
    
    // Group records by file path
    const fileRecords = new Map<string, FileChangeRecord[]>();
    for (const record of trackingData.records) {
      const existing = fileRecords.get(record.filePath) || [];
      existing.push(record);
      fileRecords.set(record.filePath, existing);
    }
    
    // Process each file to determine authorship
    const fileAuthorshipInfos: FileAuthorshipInfo[] = [];
    for (const [filePath, records] of fileRecords) {
      const fileInfo = await processFileAuthorship(records, filePath);
      fileAuthorshipInfos.push(fileInfo);
    }
    
    // Create commit authorship data
    const commitData: CommitAuthorshipData = {
      version: '1.1',
      files: fileAuthorshipInfos.filter(info => info.aiAuthoredRanges.length > 0)
    };
    
    // Get current commit hash and add git note
    const commitHash = await getCurrentCommitHash();
    const noteText = formatCommitNote(commitData);
    
    await addGitNote(commitHash, noteText);
    
    // Clear the tracking data
    await rm(trackingFile);
    
    logger.log(`Added claude-was-here note to commit ${commitHash.substring(0, 8)}`);
  } catch (error) {
    logger.error('Error in post-commit hook:', error);
    process.exit(1);
  }
}