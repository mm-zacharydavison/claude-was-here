// Shared rollup algorithm types and functions
export { 
  type AuthorshipEntry,
  type FileAuthorshipState,
  type RollupResult,
  type CommitInfo,
  rollupAuthorship,
  getFileStats,
  getOverallStats,
  expandLineRanges,
  mergeLineRanges
} from './authorship-rollup.ts';

export type { LineRange, CommitAuthorshipData } from '../types.ts';

// Re-export for visualization purposes
export function expandLineRanges(ranges: import('../types.ts').LineRange[]): number[] {
  const lines: number[] = [];
  
  for (const range of ranges) {
    for (let lineNum = range.start; lineNum <= range.end; lineNum++) {
      lines.push(lineNum);
    }
  }
  
  return lines.sort((a, b) => a - b);
}

export function mergeLineRanges(ranges: import('../types.ts').LineRange[]): import('../types.ts').LineRange[] {
  if (ranges.length === 0) return [];
  
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: import('../types.ts').LineRange[] = [];
  
  let currentRange = sorted[0];
  
  for (let i = 1; i < sorted.length; i++) {
    const nextRange = sorted[i];
    
    if (nextRange.start <= currentRange.end + 1) {
      currentRange = {
        start: currentRange.start,
        end: Math.max(currentRange.end, nextRange.end)
      };
    } else {
      merged.push(currentRange);
      currentRange = nextRange;
    }
  }
  
  merged.push(currentRange);
  return merged;
}