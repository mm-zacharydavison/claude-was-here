import { writeFile, mkdir, copyFile } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.ts';

const PRE_MERGE_WORKFLOW = `name: claude-was-here Preserve git Notes (Pre-merge)

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  collect-claude-was-here-notes:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Fetch full history to access all commits
          
      - name: Fetch git notes
        run: |
          # Fetch default git notes if they exist
          git fetch origin refs/notes/commits:refs/notes/commits 2>/dev/null || echo "No git notes found yet"
          # Show what notes we have
          echo "Checking for existing notes..."
          git log --oneline --notes=commits -n 5 || true
          
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
          
      - name: Get base and head commits
        id: commits
        run: |
          BASE_COMMIT=\$(git merge-base HEAD origin/\${{ github.base_ref }})
          HEAD_COMMIT=\$(git rev-parse HEAD)
          echo "base_commit=\$BASE_COMMIT" >> \$GITHUB_OUTPUT
          echo "head_commit=\$HEAD_COMMIT" >> \$GITHUB_OUTPUT
          echo "Base commit: \$BASE_COMMIT"
          echo "Head commit: \$HEAD_COMMIT"
          
      - name: Collect and consolidate Claude notes
        run: |
          bun run .github/scripts/github-synchronize-pr.js --base "\${{ steps.commits.outputs.base_commit }}" --head "\${{ steps.commits.outputs.head_commit }}"
          
      - name: Upload Claude notes data as artifact
        if: hashFiles('claude-notes-data.json') != ''
        uses: actions/upload-artifact@v4
        with:
          name: claude-notes-pr-\${{ github.event.number }}
          path: claude-notes-data.json
          retention-days: 30`;

const POST_MERGE_WORKFLOW = `name: claude-was-here Preserve git Notes (Post-merge)

on:
  pull_request:
    types: [closed]

jobs:
  attach-claude-was-here-notes:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      contents: write
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: \${{ github.event.pull_request.base.ref }}  # Checkout the target branch
          
      - name: Find and download Claude notes artifact
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          # Find the most recent workflow run for this PR that created the artifact
          ARTIFACT_NAME="claude-notes-pr-\${{ github.event.number }}"
          echo "Looking for artifact: \$ARTIFACT_NAME"
          
          # Get the workflow runs for pull_request events on this PR
          WORKFLOW_RUNS=\$(gh api repos/\${{ github.repository }}/actions/runs \\
            --jq '.workflow_runs[] | select(.event == "pull_request" and .head_sha == "\${{ github.event.pull_request.head.sha }}") | .id' \\
            | head -10)
          
          echo "Found workflow runs: \$WORKFLOW_RUNS"
          
          # Try to find and download the artifact from each run
          mkdir -p ./artifacts/
          FOUND=false
          
          for run_id in \$WORKFLOW_RUNS; do
            echo "Checking run \$run_id for artifacts..."
            
            # Get the artifact ID for this run
            artifact_id=\$(gh api repos/\${{ github.repository }}/actions/runs/\$run_id/artifacts --jq '.artifacts[] | select(.name == "'\$ARTIFACT_NAME'") | .id' | head -1)
            
            if [ -n "\$artifact_id" ]; then
              echo "Found artifact \$artifact_id in run \$run_id, downloading..."
              
              # Download the artifact
              if gh api repos/\${{ github.repository }}/actions/artifacts/\$artifact_id/zip > artifact.zip 2>/dev/null && [ -s artifact.zip ]; then
                unzip -q artifact.zip -d ./artifacts/
                echo "Successfully downloaded and extracted artifact"
                FOUND=true
                break
              else
                echo "Failed to download artifact \$artifact_id"
              fi
            else
              echo "No matching artifact found in run \$run_id"
            fi
          done
          
          if [ "\$FOUND" = "false" ]; then
            echo "No Claude notes artifact found for PR \${{ github.event.number }}"
            echo "This might mean there were no Claude Code contributions in this PR"
          fi
        
      - name: Check if Claude notes exist
        id: check-notes
        run: |
          if [ -f "./artifacts/claude-notes-data.json" ]; then
            echo "notes_exist=true" >> \$GITHUB_OUTPUT
            echo "Found Claude notes artifact"
          else
            echo "notes_exist=false" >> \$GITHUB_OUTPUT
            echo "No Claude notes artifact found"
          fi
          
      - name: Setup Bun
        if: steps.check-notes.outputs.notes_exist == 'true'
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
          
      - name: Apply consolidated Claude notes to squashed commit
        if: steps.check-notes.outputs.notes_exist == 'true'
        run: |
          # Configure git user for creating notes
          git config --local user.name "claude-was-here[bot]"
          git config --local user.email "claude-was-here[bot]@users.noreply.github.com"
          
          # Fetch existing notes from remote to avoid conflicts
          git fetch origin refs/notes/commits:refs/notes/commits || echo "No existing notes to fetch"
          
          # Get the latest commit (should be the merge/squash commit)
          MERGE_COMMIT=\$(git rev-parse HEAD)
          echo "Merge commit: \$MERGE_COMMIT"
          
          # Get the base commit to compare against
          BASE_COMMIT=\$(git merge-base HEAD origin/\${{ github.event.pull_request.base.ref }})
          echo "Base commit: \$BASE_COMMIT"
          
          # Use claude-was-here to apply consolidated notes to the squashed commit
          bun run .github/scripts/github-squash-pr.js --data-file "./artifacts/claude-notes-data.json" --base "\$BASE_COMMIT" --merge "\$MERGE_COMMIT"
          
          # Show what notes were added for debugging
          echo "📝 Git notes added to commit \$MERGE_COMMIT:"
          git notes show "\$MERGE_COMMIT" || echo "No notes found"`;

export async function installGitHubActions(): Promise<void> {
  const workflowsDir = join(process.cwd(), '.github', 'workflows');
  const scriptsDir = join(process.cwd(), '.github', 'scripts');
  
  // Check if we're in a git repository
  if (!existsSync(join(process.cwd(), '.git'))) {
    throw new Error('Not in a git repository. Please run this command from the root of your git repository.');
  }
  
  logger.log('🔧 Installing GitHub Actions workflows and scripts...');
  
  // Create .github/workflows and .github/scripts directories
  await mkdir(workflowsDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });
  
  // Copy bundled scripts
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const distScriptsDir = join(__dirname, '..', '..', 'dist', 'scripts');
  
  try {
    // Copy the bundled scripts
    const syncScript = join(distScriptsDir, 'github-synchronize-pr.js');
    const squashScript = join(distScriptsDir, 'github-squash-pr.js');
    
    if (existsSync(syncScript) && existsSync(squashScript)) {
      await copyFile(syncScript, join(scriptsDir, 'github-synchronize-pr.js'));
      await copyFile(squashScript, join(scriptsDir, 'github-squash-pr.js'));
      logger.log('✅ Copied bundled scripts to .github/scripts/');
    } else {
      // Fallback: create inline scripts if bundled versions don't exist
      await createInlineScripts(scriptsDir);
      logger.log('✅ Created inline scripts in .github/scripts/');
    }
  } catch (error) {
    // Fallback: create inline scripts if copying fails
    await createInlineScripts(scriptsDir);
    logger.log('✅ Created inline scripts in .github/scripts/');
  }
  
  // Write the pre-merge workflow
  const preWorkflowPath = join(workflowsDir, 'preserve-claude-notes-pre.yml');
  await writeFile(preWorkflowPath, PRE_MERGE_WORKFLOW);
  logger.log(`✅ Created ${preWorkflowPath}`);
  
  // Write the post-merge workflow
  const postWorkflowPath = join(workflowsDir, 'preserve-claude-notes-post.yml');
  await writeFile(postWorkflowPath, POST_MERGE_WORKFLOW);
  logger.log(`✅ Created ${postWorkflowPath}`);
  
  logger.log('\n🎉 GitHub Actions workflows and scripts installed successfully!');
  logger.log('\nWhat was installed:');
  logger.log('📁 .github/workflows/preserve-claude-notes-pre.yml - Collects Claude notes from PR commits');
  logger.log('📁 .github/workflows/preserve-claude-notes-post.yml - Attaches consolidated notes to squashed commits');
  logger.log('📁 .github/scripts/github-synchronize-pr.js - Script to collect notes from PR commits');
  logger.log('📁 .github/scripts/github-squash-pr.js - Script to apply notes to squashed commits');
  logger.log('\n📝 These workflows will:');
  logger.log('   • Preserve Claude Code tracking data when PRs are squashed');
  logger.log('   • Use local bundled scripts in .github/scripts/');
  logger.log('   • Automatically run on pull request events');
  logger.log('   • Ensure accurate attribution in the final commit notes');
  logger.log('\n💡 The workflows require GitHub repository permissions:');
  logger.log('   • contents: read/write - to access and modify git notes');
  logger.log('   • pull-requests: read - to access PR information');
  logger.log('\n🚀 The bundled scripts handle:');
  logger.log('   • github-synchronize-pr - Collects and consolidates notes from PR commits');
  logger.log('   • github-squash-pr - Applies consolidated notes to squashed merge commits');
}

/**
 * Create inline scripts as a fallback when bundled scripts aren't available
 */
async function createInlineScripts(scriptsDir: string): Promise<void> {
  // Create github-synchronize-pr.js
  const syncScriptContent = `#!/usr/bin/env bun
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
    const commitsResult = await execGitCommand(['log', '--first-parent', '--format=%H', \`\${baseCommit}..\${headCommit}\`]);
    if (commitsResult.code !== 0) {
      throw new Error(\`Failed to get commits: \${commitsResult.stderr}\`);
    }
    const commits = commitsResult.stdout.split('\\n').filter(hash => hash.trim());
    
    const contributions = [];
    const contentSignatures = new Set();
    
    for (const commitHash of commits) {
      const notesResult = await execGitCommand(['notes', 'show', commitHash]);
      if (notesResult.code === 0) {
        const noteLines = notesResult.stdout.split('\\n');
        
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
          
          const match = line.match(/^([^:]+):\\s+(.+)$/);
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
    
    console.log(\`✅ Successfully collected Claude notes from \${commits.length} commits\`);
    console.log(\`📁 Output saved to: \${outputPath}\`);
    
  } catch (error) {
    console.error('❌ Error collecting Claude notes:', error);
    process.exit(1);
  }
}

main();
`;
  
  await writeFile(join(scriptsDir, 'github-synchronize-pr.js'), syncScriptContent);
  
  // Create github-squash-pr.js
  const squashScriptContent = `#!/usr/bin/env bun
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
        ranges.push(\`\${start}-\${end}\`);
      }
      start = end = sortedLines[i];
    }
  }
  
  if (start === end) {
    ranges.push(start.toString());
  } else {
    ranges.push(\`\${start}-\${end}\`);
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
        const totalLines = fileContent.split('\\n').length;
        
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
        console.warn(\`⚠️  Skipping \${filepath} - file not found in final version\`);
      }
    }
    
    // Generate note content
    let noteContent = 'claude-was-here\\nversion: 1.1\\n';
    
    const filesWithLines = Object.keys(existingFiles).filter(
      filepath => existingFiles[filepath].size > 0
    );
    
    if (filesWithLines.length > 0) {
      const maxLength = Math.max(...filesWithLines.map(path => path.length));
      
      for (const filepath of filesWithLines.sort()) {
        const lineSet = existingFiles[filepath];
        const ranges = convertLinesToRanges(Array.from(lineSet));
        if (ranges) {
          const paddedPath = \`\${filepath}:\`.padEnd(maxLength + 2);
          noteContent += \`\${paddedPath} \${ranges}\\n\`;
        }
      }
    }
    
    if (data.contentSignatures && data.contentSignatures.length > 0) {
      noteContent += '\\n';
      noteContent += \`content-signatures: \${data.contentSignatures.join(',')}\\n\`;
    }
    
    // Write note to temp file and apply
    const noteFilePath = join(process.cwd(), 'final-claude-note.txt');
    await writeFile(noteFilePath, noteContent);
    
    const addNoteResult = await execGitCommand(['notes', 'add', '-F', noteFilePath, mergeCommit]);
    if (addNoteResult.code !== 0) {
      throw new Error(\`Failed to add note: \${addNoteResult.stderr}\`);
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
`;
  
  await writeFile(join(scriptsDir, 'github-squash-pr.js'), squashScriptContent);
}