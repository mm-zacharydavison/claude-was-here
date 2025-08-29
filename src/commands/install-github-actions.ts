import { writeFile, mkdir, readFile } from 'fs/promises';
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

/**
 * Get the pre-built GitHub script from the dist directory
 */
const getBundledAnalyzeClaudeLinesScript = async (): Promise<string> => {
  const bundledScriptPath = join(__dirname, '..', '..', 'dist', 'github-scripts', 'analyze-claude-lines.js');
  
  if (!existsSync(bundledScriptPath)) {
    throw new Error(
      'Bundled GitHub script not found. Please run "bun run build" first to generate the bundled script.'
    );
  }
  
  return await readFile(bundledScriptPath, 'utf-8');
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
          
      - name: Setup Node.js
        if: steps.check-notes.outputs.notes_exist == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          
      - name: Process and attach Claude notes to merge commit
        if: steps.check-notes.outputs.notes_exist == 'true'
        run: |
          # Get the latest commit (should be the merge/squash commit)
          latest_commit=$(git rev-parse HEAD)
          echo "Latest commit: $latest_commit"
          
          # Get the base commit to compare against
          base_commit=$(git merge-base HEAD origin/\${{ github.event.pull_request.base.ref }})
          echo "Base commit: $base_commit"
          
          # Run the Claude lines analysis using the bundled JavaScript script
          node .github/scripts/analyze-claude-lines.js ./artifacts/claude_commits_data.txt "$base_commit" "$latest_commit" > final_claude_note.txt
          
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
  
  // Copy the pre-built bundled script
  const scriptDestPath = join(scriptsDir, 'analyze-claude-lines.js');
  console.log('📦 Using pre-built GitHub analysis script...');
  const bundledContent = await getBundledAnalyzeClaudeLinesScript();
  // Add Node.js shebang to make it executable
  const executableContent = `#!/usr/bin/env node\n${bundledContent}`;
  await writeFile(scriptDestPath, executableContent);
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
  console.log('📁 .github/scripts/analyze-claude-lines.js - Bundled JavaScript script for analyzing Claude contributions');
  console.log('\n📝 These workflows will:');
  console.log('   • Preserve Claude Code tracking data when PRs are squashed');
  console.log('   • Automatically run on pull request events');
  console.log('   • Ensure accurate attribution in the final commit notes');
  console.log('\n💡 The workflows require GitHub repository permissions:');
  console.log('   • contents: read/write - to access and modify git notes');
  console.log('   • pull-requests: read - to access PR information');
}