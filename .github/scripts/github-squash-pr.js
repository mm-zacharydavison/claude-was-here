#!/usr/bin/env bun
// Inline version of github-squash-pr
const { spawn } = require('child_process');
const { readFile, writeFile } = require('fs/promises');
const { join } = require('path');

const execGitCommand = (args) => {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());
    
    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code || 0 });
    });
  });
};

function convertLinesToRanges(lines) {
  if (lines.length === 0) return '';
  
  const sortedLines = [...new Set(lines)].sort((a, b) => a - b);
  const ranges = [];
  let start = sortedLines[0];
  let end = sortedLines[0];
  
  for (let i = 1; i < sortedLines.length; i++) {
    if (sortedLines[i] === end + 1) {
      end = sortedLines[i];
    } else {
      if (start === end) {
        ranges.push(start.toString());
      } else {
        ranges.push(`${start}-${end}`);
      }
      start = end = sortedLines[i];
    }
  }
  
  if (start === end) {
    ranges.push(start.toString());
  } else {
    ranges.push(`${start}-${end}`);
  }
  
  return ranges.join(',');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--data-file' || args[2] !== '--base' || args[4] !== '--merge') {
    console.error('Usage: github-squash-pr --data-file <path> --base <commit> --merge <commit>');
    process.exit(1);
  }
  
  const dataFilePath = args[1];
  const baseCommit = args[3];
  const mergeCommit = args[5];
  
  try {
    const dataContent = await readFile(dataFilePath, 'utf-8');
    const data = JSON.parse(dataContent);
    
    // Consolidate contributions
    const claudeLineMapping = {};
    
    for (const contribution of data.contributions) {
      const { filepath, ranges } = contribution;
      
      if (!claudeLineMapping[filepath]) {
        claudeLineMapping[filepath] = new Set();
      }
      
      // Parse ranges
      for (const rangeStr of ranges.split(',')) {
        const trimmed = rangeStr.trim();
        if (trimmed.includes('-')) {
          const [start, end] = trimmed.split('-').map(n => parseInt(n));
          for (let i = start; i <= end; i++) {
            claudeLineMapping[filepath].add(i);
          }
        } else {
          claudeLineMapping[filepath].add(parseInt(trimmed));
        }
      }
    }
    
    // Filter and validate
    const existingFiles = {};
    for (const [filepath, lineSet] of Object.entries(claudeLineMapping)) {
      try {
        const fileContent = await readFile(join(process.cwd(), filepath), 'utf-8');
        const totalLines = fileContent.split('\n').length;
        
        const validLines = new Set();
        for (const lineNum of lineSet) {
          if (lineNum >= 1 && lineNum <= totalLines) {
            validLines.add(lineNum);
          }
        }
        
        if (validLines.size > 0) {
          existingFiles[filepath] = validLines;
        }
      } catch (error) {
        console.warn(`⚠️  Skipping ${filepath} - file not found in final version`);
      }
    }
    
    // Generate note content
    let noteContent = 'claude-was-here\nversion: 1.1\n';
    
    const filesWithLines = Object.keys(existingFiles).filter(
      filepath => existingFiles[filepath].size > 0
    );
    
    if (filesWithLines.length > 0) {
      const maxLength = Math.max(...filesWithLines.map(path => path.length));
      
      for (const filepath of filesWithLines.sort()) {
        const lineSet = existingFiles[filepath];
        const ranges = convertLinesToRanges(Array.from(lineSet));
        if (ranges) {
          const paddedPath = `${filepath}:`.padEnd(maxLength + 2);
          noteContent += `${paddedPath} ${ranges}\n`;
        }
      }
    }
    
    if (data.contentSignatures && data.contentSignatures.length > 0) {
      noteContent += '\n';
      noteContent += `content-signatures: ${data.contentSignatures.join(',')}\n`;
    }
    
    // Write note to temp file and apply
    const noteFilePath = join(process.cwd(), 'final-claude-note.txt');
    await writeFile(noteFilePath, noteContent);
    
    const addNoteResult = await execGitCommand(['notes', 'add', '-F', noteFilePath, mergeCommit]);
    if (addNoteResult.code !== 0) {
      throw new Error(`Failed to add note: ${addNoteResult.stderr}`);
    }
    
    const pushResult = await execGitCommand(['push', 'origin', 'refs/notes/commits']);
    if (pushResult.code !== 0) {
      console.warn('⚠️  Warning: Could not push git notes to remote:', pushResult.stderr);
    }
    
    console.log('✅ Successfully applied Claude notes to merge commit');
    
  } catch (error) {
    console.error('❌ Error applying Claude notes:', error);
    process.exit(1);
  }
}

main();
