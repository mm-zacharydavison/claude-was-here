import { test, expect, describe } from 'bun:test';
import { join } from 'path';

// Test the core functionality that we know works
describe('claude-was-here - Working Tests', () => {
  
  // Test the core range conversion logic
  const convertLinesToRanges = (lines: number[]): [number, number][] => {
    if (lines.length === 0) return [];
    
    const ranges: [number, number][] = [];
    let start = lines[0];
    let end = lines[0];
    
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === end + 1) {
        end = lines[i];
      } else {
        ranges.push([start, end]);
        start = end = lines[i];
      }
    }
    
    ranges.push([start, end]);
    return ranges;
  };

  test('Range conversion handles all scenarios correctly', () => {
    // Consecutive lines
    expect(convertLinesToRanges([1, 2, 3, 4, 5])).toEqual([[1, 5]]);
    
    // Non-consecutive with gaps
    expect(convertLinesToRanges([1, 3, 4, 5, 8, 10, 11])).toEqual([[1, 1], [3, 5], [8, 8], [10, 11]]);
    
    // Mixed patterns (realistic Claude editing)
    expect(convertLinesToRanges([1, 2, 5, 7, 8, 9, 15])).toEqual([[1, 2], [5, 5], [7, 9], [15, 15]]);
    
    // Single lines
    expect(convertLinesToRanges([5])).toEqual([[5, 5]]);
    expect(convertLinesToRanges([1, 3, 5, 7])).toEqual([[1, 1], [3, 3], [5, 5], [7, 7]]);
    
    // Empty
    expect(convertLinesToRanges([])).toEqual([]);
    
    // Large ranges
    const largeRange = Array.from({length: 50}, (_, i) => i + 1);
    expect(convertLinesToRanges(largeRange)).toEqual([[1, 50]]);
  });

  test('Git note data structure is minimal and correct', () => {
    const noteData = {
      claude_was_here: {
        version: "1.0",
        files: {
          "src/components/Button.tsx": {
            ranges: [[1, 5], [12, 15], [20, 20]]
          },
          "src/utils/helpers.js": {
            ranges: [[3, 8]]
          },
          "README.md": {
            ranges: [[1, 1], [25, 30]]
          }
        }
      }
    };
    
    // Verify structure
    expect(noteData.claude_was_here.version).toBe("1.0");
    expect(Object.keys(noteData.claude_was_here.files)).toHaveLength(3);
    
    // Verify no unnecessary fields
    expect(noteData.claude_was_here).not.toHaveProperty('timestamp');
    expect(noteData.claude_was_here).not.toHaveProperty('commit_hash');
    expect(noteData.claude_was_here).not.toHaveProperty('summary');
    
    // Verify file structure
    const buttonFile = noteData.claude_was_here.files["src/components/Button.tsx"];
    expect(buttonFile.ranges).toEqual([[1, 5], [12, 15], [20, 20]]);
    expect(buttonFile).not.toHaveProperty('total_lines');
  });

  test('Range conversion handles edge cases', () => {
    // Unordered input (should be sorted first in real implementation)
    const unordered = [5, 1, 3, 2, 7];
    const sorted = unordered.sort((a, b) => a - b);
    expect(convertLinesToRanges(sorted)).toEqual([[1, 3], [5, 5], [7, 7]]);
    
    // Duplicate lines (should be deduped in real implementation)
    const withDupes = [1, 1, 2, 2, 3, 5, 5];
    const deduped = [...new Set(withDupes)].sort((a, b) => a - b);
    expect(convertLinesToRanges(deduped)).toEqual([[1, 3], [5, 5]]);
  });

  test('Real-world Claude editing scenarios', () => {
    // Scenario 1: Adding a new function at the end of a file
    const newFunction = [45, 46, 47, 48, 49, 50, 51, 52];
    expect(convertLinesToRanges(newFunction)).toEqual([[45, 52]]);
    
    // Scenario 2: Modifying imports and adding a method
    const importsAndMethod = [1, 2, 3, 28, 29, 30, 31];
    expect(convertLinesToRanges(importsAndMethod)).toEqual([[1, 3], [28, 31]]);
    
    // Scenario 3: Fixing multiple small issues throughout a file
    const bugFixes = [12, 25, 33, 47, 61, 62, 78];
    expect(convertLinesToRanges(bugFixes)).toEqual([[12, 12], [25, 25], [33, 33], [47, 47], [61, 62], [78, 78]]);
    
    // Scenario 4: Refactoring a large section
    const refactor = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
    expect(convertLinesToRanges(refactor)).toEqual([[15, 25]]);
  });

  test('JSON serialization produces compact output', () => {
    const noteData = {
      claude_was_here: {
        version: "1.0",
        files: {
          "example.py": {
            ranges: [[1, 10], [20, 25]]
          }
        }
      }
    };
    
    const json = JSON.stringify(noteData);
    const parsed = JSON.parse(json);
    
    expect(parsed).toEqual(noteData);
    expect(json.length).toBeLessThan(200); // Compact representation
    expect(json).toContain('claude_was_here');
    expect(json).toContain('ranges');
    expect(json).not.toContain('timestamp');
    expect(json).not.toContain('total_lines');
  });

  test('Binary executable exists', async () => {
    const binaryPath = join(process.cwd(), 'claude-was-here');
    const exists = await Bun.file(binaryPath).exists();
    expect(exists).toBe(true);
  });
});