#!/usr/bin/env bun
// Inline version of github-synchronize-pr
const { spawn } = require('child_process');
const { writeFile } = require('fs/promises');
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

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--base' || args[2] !== '--head') {
    console.error('Usage: github-synchronize-pr --base <commit> --head <commit>');
    process.exit(1);
  }
  
  const baseCommit = args[1];
  const headCommit = args[3];
  
  try {
    const commitsResult = await execGitCommand(['log', '--format=%H', `${baseCommit}..${headCommit}`]);
    if (commitsResult.code !== 0) {
      throw new Error(`Failed to get commits: ${commitsResult.stderr}`);
    }
    const commits = commitsResult.stdout.split('\n').filter(hash => hash.trim());
    
    const contributions = [];
    const contentSignatures = new Set();
    
    for (const commitHash of commits) {
      const notesResult = await execGitCommand(['notes', 'show', commitHash]);
      if (notesResult.code === 0) {
        const noteLines = notesResult.stdout.split('\n');
        
        for (const line of noteLines) {
          if (line === 'claude-was-here' || line.startsWith('version:')) {
            continue;
          }
          
          if (line.startsWith('content-signatures:')) {
            const hashesStr = line.substring('content-signatures:'.length).trim();
            if (hashesStr) {
              hashesStr.split(',').map(h => h.trim()).filter(h => h).forEach(hash => contentSignatures.add(hash));
            }
            continue;
          }
          
          const match = line.match(/^([^:]+):\s+(.+)$/);
          if (match) {
            const filepath = match[1].trim();
            const ranges = match[2].trim();
            contributions.push({ commitHash, filepath, ranges });
          }
        }
      }
    }
    
    const outputData = {
      baseCommit,
      headCommit,
      contributions,
      contentSignatures: Array.from(contentSignatures)
    };
    
    const outputPath = join(process.cwd(), 'claude-notes-data.json');
    await writeFile(outputPath, JSON.stringify(outputData, null, 2));
    
    console.log(`✅ Successfully collected Claude notes from ${commits.length} commits`);
    console.log(`📁 Output saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Error collecting Claude notes:', error);
    process.exit(1);
  }
}

main();
