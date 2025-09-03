import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, access, readdir, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { constants } from 'fs';
import { homedir } from 'os';
import { rollupAuthorship, getFileStats } from '../../src/lib/authorship-rollup.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Store current working directory for git commands
let currentWorkingDirectory = process.cwd();
const recentRepositories: string[] = [];
const RECENT_REPOS_FILE = path.join(__dirname, '.recent-repos.json');

// Load recent repositories on startup
async function loadRecentRepositories() {
  try {
    const data = await readFile(RECENT_REPOS_FILE, 'utf-8');
    recentRepositories.push(...JSON.parse(data));
  } catch {
    // File doesn't exist yet
  }
}

loadRecentRepositories();

// Save recent repositories
async function saveRecentRepositories() {
  try {
    await writeFile(RECENT_REPOS_FILE, JSON.stringify(recentRepositories.slice(0, 10)));
  } catch (error) {
    console.error('Failed to save recent repositories:', error);
  }
}

// Get git root directory
async function getGitRoot(): Promise<string> {
  const { stdout } = await execAsync('git rev-parse --show-toplevel', { cwd: currentWorkingDirectory });
  return stdout.trim();
}

// Execute git command in current working directory
async function execGitCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(command, { cwd: currentWorkingDirectory });
}

// Parse git notes
function parseGitNote(noteText: string) {
  const lines = noteText.split('\n');
  if (lines[0] !== 'claude-was-here') return null;
  
  const files = [];
  let startIndex = lines[1]?.startsWith('version: ') ? 2 : 1;
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes(': ')) continue;
    
    const [filePath, rangesStr] = line.split(': ', 2);
    const ranges = [];
    
    if (rangesStr) {
      const rangeStrings = rangesStr.split(', ');
      for (const rangeStr of rangeStrings) {
        if (rangeStr.includes('-')) {
          const [start, end] = rangeStr.split('-').map(n => parseInt(n, 10));
          ranges.push({ start, end });
        } else {
          const lineNumber = parseInt(rangeStr, 10);
          ranges.push({ start: lineNumber, end: lineNumber });
        }
      }
    }
    
    files.push({
      filePath,
      aiAuthoredRanges: ranges
    });
  }
  
  return { version: '1.0', files };
}

// Set repository
app.post('/api/repository', async (req, res) => {
  const { path: repoPath } = req.body;
  
  try {
    // Check if path exists and is a git repository
    await access(repoPath, constants.F_OK);
    const { stdout: gitCheck } = await execAsync('git rev-parse --git-dir', { cwd: repoPath });
    
    // Update current working directory
    currentWorkingDirectory = repoPath;
    
    // Get repository info
    const { stdout: repoName } = await execGitCommand('git rev-parse --show-toplevel');
    const { stdout: branch } = await execGitCommand('git branch --show-current');
    
    // Check if claude tracking is enabled
    let hasClaudeTracking = false;
    try {
      await access(path.join(repoPath, '.claude', 'was-here'), constants.F_OK);
      hasClaudeTracking = true;
    } catch {
      // Directory doesn't exist
    }
    
    res.json({
      success: true,
      path: repoPath,
      name: path.basename(repoName.trim()),
      branch: branch.trim() || 'main',
      hasClaudeTracking
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'Invalid repository path or not a git repository'
    });
  }
});

// Get recent repositories
app.get('/api/recent-repositories', async (req, res) => {
  res.json(recentRepositories);
});

// Add to recent repositories
app.post('/api/recent-repositories', async (req, res) => {
  const { path: repoPath } = req.body;
  
  // Remove if already exists and add to front
  const index = recentRepositories.indexOf(repoPath);
  if (index > -1) {
    recentRepositories.splice(index, 1);
  }
  recentRepositories.unshift(repoPath);
  
  // Keep only last 10
  if (recentRepositories.length > 10) {
    recentRepositories.length = 10;
  }
  
  await saveRecentRepositories();
  res.json({ success: true });
});

// Browse filesystem directories
app.get('/api/browse-directories', async (req, res) => {
  try {
    const { path: dirPath } = req.query;
    const targetPath = dirPath ? String(dirPath) : homedir();
    
    // Security check: only allow browsing accessible directories
    await access(targetPath, constants.R_OK);
    
    const entries = await readdir(targetPath);
    const directories = [];
    
    for (const entry of entries) {
      try {
        const fullPath = path.join(targetPath, entry);
        const stats = await stat(fullPath);
        
        if (stats.isDirectory() && !entry.startsWith('.')) {
          // Check if it's a git repository
          let isGitRepo = false;
          try {
            await access(path.join(fullPath, '.git'), constants.F_OK);
            isGitRepo = true;
          } catch {
            // Not a git repo
          }
          
          directories.push({
            name: entry,
            path: fullPath,
            isGitRepo
          });
        }
      } catch {
        // Skip entries we can't access
      }
    }
    
    // Sort directories alphabetically, git repos first
    directories.sort((a, b) => {
      if (a.isGitRepo && !b.isGitRepo) return -1;
      if (!a.isGitRepo && b.isGitRepo) return 1;
      return a.name.localeCompare(b.name);
    });
    
    res.json({
      currentPath: targetPath,
      parentPath: path.dirname(targetPath),
      directories
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to browse directories' });
  }
});

// Get all tracked files
app.get('/api/files', async (req, res) => {
  try {
    const { stdout } = await execGitCommand('git ls-files');
    const files = stdout.split('\n').filter(Boolean);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get files' });
  }
});

// Get commits for a file
app.get('/api/commits', async (req, res) => {
  try {
    const { file } = req.query;
    const cmd = file 
      ? `git log --format="%H|%ct|%s" --reverse -- "${file}"`
      : 'git log --format="%H|%ct|%s" --reverse';
    
    const { stdout } = await execGitCommand(cmd);
    const commits = await Promise.all(
      stdout.split('\n').filter(Boolean).map(async (line, index) => {
        const [hash, timestamp, message] = line.split('|');
        
        // Get git note for this commit
        let authorshipData = null;
        try {
          const { stdout: noteText } = await execGitCommand(`git notes show ${hash}`);
          authorshipData = parseGitNote(noteText);
        } catch {
          // No note for this commit
        }
        
        // Get files changed in this commit
        let files = [];
        try {
          const { stdout: filesOut } = await execGitCommand(
            `git diff-tree --no-commit-id --name-only -r ${hash}`
          );
          files = filesOut.split('\n').filter(Boolean);
        } catch {
          // Ignore errors
        }
        
        return {
          id: `commit-${index}`,
          hash,
          message,
          timestamp: parseInt(timestamp) * 1000,
          authorshipData,
          files
        };
      })
    );
    
    res.json(commits);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get commits' });
  }
});

// Get file content at a commit
app.get('/api/file/:filepath', async (req, res) => {
  try {
    const { filepath } = req.params;
    const { commit } = req.query;
    
    if (commit) {
      const { stdout } = await execGitCommand(`git show ${commit}:"${filepath}"`);
      res.send(stdout);
    } else {
      const gitRoot = await getGitRoot();
      const content = await readFile(path.join(gitRoot, filepath), 'utf-8');
      res.send(content);
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get file content' });
  }
});

// Get working state for a file
app.get('/api/working-state/:filepath', async (req, res) => {
  try {
    const { filepath } = req.params;
    const gitRoot = await getGitRoot();
    
    // Get current content
    const content = await readFile(path.join(gitRoot, filepath), 'utf-8');
    
    // Get diff
    const { stdout: diffOut } = await execGitCommand(`git diff "${filepath}"`);
    
    // Parse diff to get changed line ranges
    const changes = {
      added: [] as any[],
      removed: [] as any[],
      modified: [] as any[]
    };
    
    if (diffOut) {
      const lines = diffOut.split('\n');
      for (const line of lines) {
        if (line.startsWith('@@')) {
          const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
          if (match) {
            const [, oldStart, oldLen, newStart, newLen] = match;
            if (oldLen && newLen) {
              changes.modified.push({
                start: parseInt(newStart),
                end: parseInt(newStart) + parseInt(newLen) - 1
              });
            } else if (oldLen && !newLen) {
              changes.removed.push({
                start: parseInt(oldStart),
                end: parseInt(oldStart) + parseInt(oldLen) - 1
              });
            } else if (!oldLen && newLen) {
              changes.added.push({
                start: parseInt(newStart),
                end: parseInt(newStart) + parseInt(newLen) - 1
              });
            }
          }
        }
      }
    }
    
    res.json({
      filePath: filepath,
      content,
      changes
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get working state' });
  }
});

// Get authorship data for a file
app.get('/api/authorship/:filepath', async (req, res) => {
  try {
    const { filepath } = req.params;
    const { stdout } = await execGitCommand(
      `git log --format="%H" --reverse -- "${filepath}"`
    );
    
    const commits = stdout.split('\n').filter(Boolean);
    const authorshipData = [];
    
    for (const hash of commits) {
      try {
        const { stdout: noteText } = await execGitCommand(`git notes show ${hash}`);
        const parsed = parseGitNote(noteText);
        if (parsed) {
          const fileData = parsed.files.find(f => f.filePath === filepath);
          if (fileData) {
            authorshipData.push({
              commit: hash,
              ...fileData
            });
          }
        }
      } catch {
        // No note for this commit
      }
    }
    
    res.json(authorshipData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get authorship data' });
  }
});

// Get file content and authorship for a specific commit
app.get('/api/file-with-authorship/:filepath', async (req, res) => {
  try {
    const { filepath } = req.params;
    const { commit } = req.query;
    
    // Get file content at commit
    let fileContent = '';
    try {
      if (commit && commit !== 'current') {
        const { stdout } = await execGitCommand(`git show ${commit}:"${filepath}"`);
        fileContent = stdout;
      } else {
        const gitRoot = await getGitRoot();
        const content = await readFile(path.join(gitRoot, filepath), 'utf-8');
        fileContent = content;
      }
    } catch (error) {
      // File might not exist at this commit
      fileContent = '';
    }
    
    // Get authorship data for this specific commit or current working state
    let authorshipRanges = [];
    if (commit && commit !== 'current') {
      // For historical commits, check git notes
      try {
        const { stdout: noteText } = await execGitCommand(`git notes show ${commit}`);
        const parsed = parseGitNote(noteText);
        if (parsed) {
          const fileData = parsed.files.find(f => f.filePath === filepath);
          if (fileData) {
            authorshipRanges = fileData.aiAuthoredRanges;
          }
        }
      } catch {
        // No authorship data for this commit
      }
    } else {
      // For current working state, check .claude/was-here/working/tracking-data.json
      try {
        const gitRoot = await getGitRoot();
        const trackingDataPath = path.join(gitRoot, '.claude', 'was-here', 'working', 'tracking-data.json');
        console.log(`Looking for working state data:`, {
          gitRoot,
          trackingDataPath,
          requestedFile: filepath,
          fullRequestedPath: path.join(gitRoot, filepath)
        });
        
        try {
          const trackingData = JSON.parse(await readFile(trackingDataPath, 'utf-8'));
          
          if (trackingData.records && Array.isArray(trackingData.records)) {
            // Find records for this specific file
            const fileRecords = trackingData.records.filter(record => 
              record.filePath === path.join(gitRoot, filepath)
            );
            
            if (fileRecords.length > 0) {
              console.log(`Found ${fileRecords.length} working state records for ${filepath}`);
              
              // Analyze line authorship from structured patches
              const aiAuthoredLines = new Set();
              
              for (const record of fileRecords) {
                if (record.structuredPatch && Array.isArray(record.structuredPatch)) {
                  for (const hunk of record.structuredPatch) {
                    // Process lines in the hunk to find AI-authored content
                    let newLineNumber = hunk.newStart;
                    
                    for (const line of hunk.lines) {
                      if (line.startsWith('+')) {
                        // This is an added line (AI-authored)
                        aiAuthoredLines.add(newLineNumber);
                        newLineNumber++;
                      } else if (line.startsWith(' ')) {
                        // Context line
                        newLineNumber++;
                      }
                      // Lines starting with '-' are removed, don't increment newLineNumber
                    }
                  }
                }
              }
              
              // Convert Set to ranges for efficiency
              const sortedLines = Array.from(aiAuthoredLines).sort((a, b) => a - b);
              authorshipRanges = [];
              
              if (sortedLines.length > 0) {
                let rangeStart = sortedLines[0];
                let rangeEnd = sortedLines[0];
                
                for (let i = 1; i < sortedLines.length; i++) {
                  if (sortedLines[i] === rangeEnd + 1) {
                    // Consecutive line, extend range
                    rangeEnd = sortedLines[i];
                  } else {
                    // Gap found, close current range and start new one
                    authorshipRanges.push({ start: rangeStart, end: rangeEnd });
                    rangeStart = sortedLines[i];
                    rangeEnd = sortedLines[i];
                  }
                }
                // Add the final range
                authorshipRanges.push({ start: rangeStart, end: rangeEnd });
              }
              
              console.log(`Working state authorship for ${filepath}:`, {
                aiAuthoredLines: sortedLines,
                ranges: authorshipRanges
              });
            }
          }
        } catch (err) {
          console.log('No tracking data found or invalid format:', err.message);
        }
      } catch (err) {
        console.log('Error checking working state authorship:', err.message);
      }
    }
    
    // Split content into lines and mark authorship
    const lines = fileContent.split('\n');
    const linesWithAuthorship = lines.map((content, index) => {
      const lineNumber = index + 1;
      const isAiAuthored = authorshipRanges.some(range => 
        lineNumber >= range.start && lineNumber <= range.end
      );
      
      return {
        lineNumber,
        content,
        isAiAuthored
      };
    });
    
    console.log(`File ${filepath} (commit: ${commit || 'current'}):`, {
      totalLines: lines.length,
      authorshipRanges,
      aiAuthoredLines: linesWithAuthorship.filter(l => l.isAiAuthored).length
    });
    
    res.json({
      filepath,
      commit: commit || 'current',
      totalLines: lines.length,
      lines: linesWithAuthorship
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get file with authorship' });
  }
});

// Get rollup authorship data for a file
app.get('/api/rollup-authorship/:filepath', async (req, res) => {
  try {
    const { filepath } = req.params;
    
    // Change to the repository directory to ensure git commands work properly
    const originalCwd = process.cwd();
    process.chdir(currentWorkingDirectory);
    
    try {
      // Get rollup data from the authorship-rollup algorithm
      const rollupResult = await rollupAuthorship();
      const fileState = rollupResult.files.get(filepath);
      
      if (!fileState) {
        // File not found in rollup data
        res.json({
          filepath,
          totalLines: 0,
          lines: []
        });
        return;
      }
      
      // Get file stats
      const stats = getFileStats(fileState);
      
      // Get current file content to build line-by-line data
      let fileContent = '';
      try {
        const gitRoot = await getGitRoot();
        const content = await readFile(path.join(gitRoot, filepath), 'utf-8');
        fileContent = content;
      } catch (error) {
        console.warn(`Could not read current file content for ${filepath}:`, error.message);
        fileContent = '';
      }
      
      // Split content into lines and mark authorship based on rollup data
      const lines = fileContent.split('\n');
      const linesWithAuthorship = lines.map((content, index) => {
        const lineNumber = index + 1;
        const authorshipEntry = fileState.authorshipMap.get(lineNumber);
        const isAiAuthored = authorshipEntry ? authorshipEntry.isAiAuthored : false;
        
        return {
          lineNumber,
          content,
          isAiAuthored
        };
      });
      
      console.log(`Rollup authorship for ${filepath}:`, {
        totalLines: stats.totalLines,
        aiLines: stats.aiLines,
        humanLines: stats.humanLines,
        aiPercentage: stats.aiPercentage.toFixed(2) + '%',
        rollupResult: {
          totalCommitsProcessed: rollupResult.totalCommitsProcessed,
          totalFiles: rollupResult.files.size
        }
      });
      
      res.json({
        filepath,
        totalLines: stats.totalLines,
        aiLines: stats.aiLines,
        humanLines: stats.humanLines,
        aiPercentage: stats.aiPercentage,
        commitsProcessed: rollupResult.totalCommitsProcessed,
        lines: linesWithAuthorship
      });
    } finally {
      // Restore original working directory
      process.chdir(originalCwd);
    }
  } catch (error) {
    console.error('Failed to get rollup authorship:', error);
    res.status(500).json({ error: 'Failed to get rollup authorship data', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});