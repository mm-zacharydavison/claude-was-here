import type { GitNoteData } from '../../src/types.ts';

export function gitNoteDataToTsv(noteData: GitNoteData): string {
  const lines: string[] = [`version\t${noteData.claude_was_here.version}`];
  
  for (const [filePath, fileData] of Object.entries(noteData.claude_was_here.files)) {
    const rangeStr = fileData.ranges
      .map(([start, end]) => `${start}-${end}`)
      .join(',');
    lines.push(`${filePath}\t${rangeStr}`);
  }
  
  return lines.join('\n');
}

export function parseTsvToGitNoteData(tsv: string): GitNoteData {
  const lines = tsv.trim().split('\n');
  if (lines.length === 0) throw new Error('Empty TSV');
  
  const [metaKey, metaValue] = lines[0].split('\t');
  if (metaKey !== 'version') throw new Error('Invalid TSV format');
  
  const noteData: GitNoteData = {
    claude_was_here: {
      version: metaValue || "1.0",
      files: {}
    }
  };
  
  for (let i = 1; i < lines.length; i++) {
    const [filePath, rangesStr] = lines[i].split('\t');
    if (!filePath || !rangesStr) continue;
    
    const ranges = rangesStr.split(',').map(range => {
      const [start, end] = range.split('-').map(n => parseInt(n, 10));
      return [start, end] as [number, number];
    });
    
    noteData.claude_was_here.files[filePath] = { ranges };
  }
  
  return noteData;
}