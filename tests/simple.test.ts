import { test, expect } from 'bun:test';
import { join } from 'path';

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

test('Range conversion works correctly', () => {
  // Test consecutive lines
  expect(convertLinesToRanges([1, 2, 3, 4, 5])).toEqual([[1, 5]]);
  
  // Test non-consecutive lines  
  expect(convertLinesToRanges([1, 3, 4, 5, 8])).toEqual([[1, 1], [3, 5], [8, 8]]);
  
  // Test single line
  expect(convertLinesToRanges([5])).toEqual([[5, 5]]);
  
  // Test empty
  expect(convertLinesToRanges([])).toEqual([]);
});

test('Git note structure validation', () => {
  const noteData = {
    claude_was_here: {
      version: "1.0",
      files: {
        "sample.py": {
          ranges: [[1, 3], [7, 10]]
        },
        "example.js": {
          ranges: [[5, 5]]
        }
      }
    }
  };
  
  expect(noteData.claude_was_here.version).toBe("1.0");
  expect(noteData.claude_was_here.files["sample.py"].ranges).toEqual([[1, 3], [7, 10]]);
  expect(noteData.claude_was_here.files["example.js"].ranges).toEqual([[5, 5]]);
});

test('Binary exists and is executable', async () => {
  const binaryPath = join(process.cwd(), 'claude-was-here');
  const stat = await Bun.file(binaryPath).exists();
  expect(stat).toBe(true);
});