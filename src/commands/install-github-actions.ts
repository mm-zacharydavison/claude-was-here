import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const PRE_MERGE_WORKFLOW = `name: claude-was-here Preserve git Notes (Pre-merge)

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  collect-claude-notes:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Fetch full history to access all commits
          
      - name: Get PR commits
        id: get-commits
        run: |
          # Get all commit hashes in this PR
          git log --format="%H" origin/\${{ github.base_ref }}..HEAD > pr_commits.txt
          echo "Found $(wc -l < pr_commits.txt) commits in PR"
          
      - name: Collect and analyze Claude notes from PR commits
        id: collect-notes
        run: |
          commit_count=0
          
          # Create a mapping of files to all Claude-touched lines across commits
          echo "{}" > claude_files_map.json
          
          while IFS= read -r commit_hash; do
            if [ -n "$commit_hash" ]; then
              # Check if this commit has a git note
              if git notes show "$commit_hash" 2>/dev/null; then
                echo "Processing commit: $commit_hash"
                
                # Parse the note to extract file paths and line ranges
                git notes show "$commit_hash" | while IFS= read -r line; do
                  # Skip header lines
                  if [[ "$line" == "claude-was-here" ]] || [[ "$line" == "version:"* ]]; then
                    continue
                  fi
                  
                  # Parse lines like "src/file.ts: 10-20,25-30"
                  if [[ "$line" =~ ^([^:]+):[[:space:]]+(.+)$ ]]; then
                    filepath="\${BASH_REMATCH[1]}"
                    ranges="\${BASH_REMATCH[2]}"
                    
                    echo "File: $filepath, Ranges: $ranges" >> claude_files_debug.txt
                    
                    # Store this information for later processing
                    echo "$commit_hash|$filepath|$ranges" >> claude_commits_data.txt
                  fi
                done
                
                commit_count=$((commit_count + 1))
              fi
            fi
          done < pr_commits.txt
          
          echo "commits_with_notes=$commit_count" >> $GITHUB_OUTPUT
          
          if [ -f "claude_commits_data.txt" ]; then
            echo "Found Claude notes in $commit_count commits"
          else
            echo "No Claude notes found in this PR"
          fi
          
      - name: Upload Claude notes as artifact
        if: steps.collect-notes.outputs.commits_with_notes != '0'
        uses: actions/upload-artifact@v4
        with:
          name: claude-notes-pr-\${{ github.event.number }}
          path: |
            claude_commits_data.txt
            claude_files_debug.txt
          retention-days: 30`;

// Generate the TypeScript analysis script with embedded logic
const generateAnalyzeClaudeLinesScript = (): string => {
  return `#!/usr/bin/env -S bun run
/**
 * Analyze Claude Code contributions across commits and map them to final diff lines.
 * 
 * This script is used by GitHub Actions to preserve Claude Code tracking data
 * when PRs are squashed, ensuring accurate attribution in the final commit.
 * 
 * NOTE: This script contains embedded logic from the claude-was-here shared module
 * to avoid import dependencies when installed in other repositories.
 */

import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

interface ClaudeContribution {
  commitHash: string;
  filepath: string;
  ranges: string;
}

interface ClaudeLineMapping {
  [filepath: string]: Set<number>;
}

/**
 * Execute a git command and return the result
 */
const execGitCommand = (args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> => {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { 
      cwd, 
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());
    
    proc.on('close', (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code || 0 });
    });
  });
};

/**
 * Collect Claude notes from all commits in a range
 */
const collectClaudeNotesFromCommits = async (
  testDir: string, 
  baseCommit: string, 
  headCommit: string
): Promise<ClaudeContribution[]> => {
  const commitsResult = await execGitCommand(['log', '--format=%H', \`\${baseCommit}..\${headCommit}\`], testDir);
  const commits = commitsResult.stdout.split('\\n').filter(hash => hash.trim());
  
  const contributions: ClaudeContribution[] = [];
  
  for (const commitHash of commits) {
    const notesResult = await execGitCommand(['notes', 'show', commitHash], testDir);
    if (notesResult.code === 0) {
      const noteLines = notesResult.stdout.split('\\n');
      
      for (const line of noteLines) {
        if (line === 'claude-was-here' || line.startsWith('version:')) {
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
  
  return contributions;
};

// Note: Removed getFinalDiffLines - we now use git notes data directly

/**
 * Consolidate Claude contributions from git notes into final line mappings
 * This directly uses the line authorship data from git notes without pattern matching
 */
const consolidateClaudeContributions = async (
  testDir: string,
  contributions: ClaudeContribution[]
): Promise<ClaudeLineMapping> => {
  const finalClaudeLines: ClaudeLineMapping = {};
  
  // Parse ranges from string like "10-20,25-30" into line numbers
  const parseRanges = (ranges: string): number[] => {
    const lines: number[] = [];
    
    for (const rangeStr of ranges.split(',')) {
      const trimmed = rangeStr.trim();
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(n => parseInt(n));
        for (let i = start; i <= end; i++) {
          lines.push(i);
        }
      } else {
        lines.push(parseInt(trimmed));
      }
    }
    
    return lines;
  };
  
  // Consolidate all Claude contributions by file
  for (const contribution of contributions) {
    const { filepath, ranges } = contribution;
    
    // Initialize file set if not exists
    if (!finalClaudeLines[filepath]) {
      finalClaudeLines[filepath] = new Set();
    }
    
    // Parse the ranges and add all Claude-authored lines
    const lines = parseRanges(ranges);
    for (const lineNum of lines) {
      finalClaudeLines[filepath].add(lineNum);
    }
  }
  
  // Filter out files that don't exist in the final version
  const existingFiles: ClaudeLineMapping = {};
  for (const [filepath, lineSet] of Object.entries(finalClaudeLines)) {
    try {
      await readFile(join(testDir, filepath), 'utf-8');
      existingFiles[filepath] = lineSet;
    } catch (error) {
      // File doesn't exist in final version, skip it
      continue;
    }
  }
  
  return existingFiles;
};

// Note: getFinalDiffLines function is no longer needed since we use git notes data directly

/**
 * Convert line numbers to compact range notation
 */
const convertLinesToRanges = (lines: number[]): string => {
  if (lines.length === 0) return '';
  
  const sortedLines = [...new Set(lines)].sort((a, b) => a - b);
  const ranges: string[] = [];
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
  
  // Add final range
  if (start === end) {
    ranges.push(start.toString());
  } else {
    ranges.push(\`\${start}-\${end}\`);
  }
  
  return ranges.join(',');
};

/**
 * Generate a claude-was-here note in the standard format
 */
const generateClaudeNote = (claudeLineMapping: ClaudeLineMapping): string => {
  let output = 'claude-was-here\\nversion: 1.0\\n';
  
  const filesWithLines = Object.keys(claudeLineMapping).filter(
    filepath => claudeLineMapping[filepath].size > 0
  );
  
  if (filesWithLines.length > 0) {
    const maxLength = Math.max(...filesWithLines.map(path => path.length));
    
    for (const filepath of filesWithLines.sort()) {
      const lineSet = claudeLineMapping[filepath];
      const ranges = convertLinesToRanges(Array.from(lineSet));
      if (ranges) {
        const paddedPath = \`\${filepath}:\`.padEnd(maxLength + 2);
        output += \`\${paddedPath} \${ranges}\\n\`;
      }
    }
  }
  
  return output;
};

/**
 * Main analysis function that combines all steps
 */
const analyzePRSquashClaudeContributions = async (
  testDir: string,
  baseCommit: string,
  headCommit: string
): Promise<string> => {
  // Step 1: Collect Claude notes from all commits in the PR
  const contributions = await collectClaudeNotesFromCommits(testDir, baseCommit, headCommit);
  
  // Step 2: Consolidate Claude contributions directly from git notes data
  const claudeLineMapping = await consolidateClaudeContributions(testDir, contributions);
  
  // Step 3: Generate the final note
  return generateClaudeNote(claudeLineMapping);
};

async function main() {
  if (process.argv.length < 5) {
    console.error("Usage: bun run analyze-claude-lines.ts <claude_data_file> <base_commit> <latest_commit>");
    console.error("");
    console.error("This script analyzes Claude Code contributions across commits and maps them");
    console.error("to the final diff, generating accurate attribution for squashed commits.");
    process.exit(1);
  }
  
  const claudeDataFile = process.argv[2];
  const baseCommit = process.argv[3];
  const latestCommit = process.argv[4];
  
  try {
    // Verify the Claude data file exists
    await readFile(claudeDataFile, 'utf-8');
    console.error(\`Processing Claude contributions from \${claudeDataFile}\`);
    
    // Use the embedded analysis logic
    const noteContent = await analyzePRSquashClaudeContributions(
      process.cwd(),
      baseCommit, 
      latestCommit
    );
    
    // Output the final note content
    console.log(noteContent);
    
  } catch (error) {
    console.error('Error analyzing Claude contributions:', error);
    process.exit(1);
  }
}

main().catch(console.error);
`;
};

const POST_MERGE_WORKFLOW = `name: claude-was-here Preserve git Notes (Post-merge)

on:
  pull_request:
    types: [closed]

jobs:
  attach-claude-notes:
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
          
      - name: Download Claude notes artifact
        uses: actions/download-artifact@v4
        with:
          name: claude-notes-pr-\${{ github.event.number }}
          path: ./artifacts/
        continue-on-error: true
        
      - name: Check if Claude notes exist
        id: check-notes
        run: |
          if [ -f "./artifacts/claude_commits_data.txt" ]; then
            echo "notes_exist=true" >> $GITHUB_OUTPUT
            echo "Found Claude notes artifact"
          else
            echo "notes_exist=false" >> $GITHUB_OUTPUT
            echo "No Claude notes artifact found"
          fi
          
      - name: Setup Bun
        if: steps.check-notes.outputs.notes_exist == 'true'
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
          
      - name: Process and attach Claude notes to merge commit
        if: steps.check-notes.outputs.notes_exist == 'true'
        run: |
          # Get the latest commit (should be the merge/squash commit)
          latest_commit=$(git rev-parse HEAD)
          echo "Latest commit: $latest_commit"
          
          # Get the base commit to compare against
          base_commit=$(git merge-base HEAD origin/\${{ github.event.pull_request.base.ref }})
          echo "Base commit: $base_commit"
          
          # Run the Claude lines analysis using the TypeScript script
          bun run .github/scripts/analyze-claude-lines.ts ./artifacts/claude_commits_data.txt "$base_commit" "$latest_commit" > final_claude_note.txt
          
          # Add the consolidated note to the merge commit
          git notes add -F final_claude_note.txt "$latest_commit"
          
          # Push the notes
          git push origin refs/notes/commits
          
          echo "Successfully attached consolidated Claude notes to commit $latest_commit"
          echo "Final note content:"
          cat final_claude_note.txt`;

export async function installGitHubActions(): Promise<void> {
  const workflowsDir = join(process.cwd(), '.github', 'workflows');
  const scriptsDir = join(process.cwd(), '.github', 'scripts');
  
  // Check if we're in a git repository
  if (!existsSync(join(process.cwd(), '.git'))) {
    throw new Error('Not in a git repository. Please run this command from the root of your git repository.');
  }
  
  console.log('🔧 Installing GitHub Actions workflows...');
  
  // Create .github/workflows and .github/scripts directories
  await mkdir(workflowsDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });
  
  // Write the TypeScript analysis script with embedded logic
  const scriptDestPath = join(scriptsDir, 'analyze-claude-lines.ts');
  const scriptContent = generateAnalyzeClaudeLinesScript();
  await writeFile(scriptDestPath, scriptContent);
  console.log(`✅ Created ${scriptDestPath}`);
  
  // Write the pre-merge workflow
  const preWorkflowPath = join(workflowsDir, 'preserve-claude-notes-pre.yml');
  await writeFile(preWorkflowPath, PRE_MERGE_WORKFLOW);
  console.log(`✅ Created ${preWorkflowPath}`);
  
  // Write the post-merge workflow
  const postWorkflowPath = join(workflowsDir, 'preserve-claude-notes-post.yml');
  await writeFile(postWorkflowPath, POST_MERGE_WORKFLOW);
  console.log(`✅ Created ${postWorkflowPath}`);
  
  console.log('\n🎉 GitHub Actions workflows installed successfully!');
  console.log('\nWhat was installed:');
  console.log('📁 .github/workflows/preserve-claude-notes-pre.yml - Collects Claude notes from PR commits');
  console.log('📁 .github/workflows/preserve-claude-notes-post.yml - Attaches consolidated notes to squashed commits');
  console.log('📁 .github/scripts/analyze-claude-lines.ts - TypeScript script for analyzing Claude contributions');
  console.log('\n📝 These workflows will:');
  console.log('   • Preserve Claude Code tracking data when PRs are squashed');
  console.log('   • Automatically run on pull request events');
  console.log('   • Ensure accurate attribution in the final commit notes');
  console.log('\n💡 The workflows require GitHub repository permissions:');
  console.log('   • contents: read/write - to access and modify git notes');
  console.log('   • pull-requests: read - to access PR information');
}