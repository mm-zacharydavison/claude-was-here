import type { GitNoteData } from '../../src/types.ts';

export function gitNoteDataToTsv(noteData: GitNoteData): string {
  const lines: string[] = ['claude-was-here', `version: ${noteData.claude_was_here.version}`];
  
  // Calculate the maximum filename length for alignment
  const filePaths = Object.keys(noteData.claude_was_here.files);
  const maxLength = Math.max(...filePaths.map(path => path.length));
  
  for (const [filePath, fileData] of Object.entries(noteData.claude_was_here.files)) {
    const rangeStr = fileData.ranges
      .map(([start, end]) => `${start}-${end}`)
      .join(',');
    const paddedPath = `${filePath}:`.padEnd(maxLength + 2); // +2 for ": "
    lines.push(`${paddedPath} ${rangeStr}`);
  }
  
  return lines.join('\n');
}

export function parseTsvToGitNoteData(tsv: string): GitNoteData {
  const lines = tsv.trim().split('\n');
  if (lines.length < 2) throw new Error('Invalid format');
  
  // First line should be "claude-was-here"
  if (lines[0] !== 'claude-was-here') throw new Error('Invalid format');
  
  // Second line should be "version: X.X"
  const versionMatch = lines[1].match(/^version:\s*(.+)$/);
  if (!versionMatch) throw new Error('Invalid format');
  
  const noteData: GitNoteData = {
    claude_was_here: {
      version: versionMatch[1],
      files: {}
    }
  };
  
  // Parse file entries (from line 2 onwards)
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Find the colon and split there
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    
    const filePath = line.substring(0, colonIndex);
    const rangesStr = line.substring(colonIndex + 1).trim();
    
    if (!filePath || !rangesStr) continue;
    
    const ranges = rangesStr.split(',').map(range => {
      const [start, end] = range.split('-').map(n => parseInt(n, 10));
      return [start, end] as [number, number];
    });
    
    noteData.claude_was_here.files[filePath] = { ranges };
  }
  
  return noteData;
}