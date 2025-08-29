import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger.ts';

const PRE_MERGE_WORKFLOW = `name: claude-was-here Preserve git Notes (Pre-merge)

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  collect-claude-notes:
    runs-on: ubuntu-latest
    container:
      image: oven/bun:latest
    permissions:
      contents: read
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Fetch full history to access all commits
          
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
          bunx @zdavison/claude-was-here@latest github-synchronize-pr --base "\${{ steps.commits.outputs.base_commit }}" --head "\${{ steps.commits.outputs.head_commit }}"
          
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
  attach-claude-notes:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    container:
      image: oven/bun:latest
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
          if [ -f "./artifacts/claude-notes-data.json" ]; then
            echo "notes_exist=true" >> \$GITHUB_OUTPUT
            echo "Found Claude notes artifact"
          else
            echo "notes_exist=false" >> \$GITHUB_OUTPUT
            echo "No Claude notes artifact found"
          fi
          
      - name: Apply consolidated Claude notes to squashed commit
        if: steps.check-notes.outputs.notes_exist == 'true'
        run: |
          # Get the latest commit (should be the merge/squash commit)
          MERGE_COMMIT=\$(git rev-parse HEAD)
          echo "Merge commit: \$MERGE_COMMIT"
          
          # Get the base commit to compare against
          BASE_COMMIT=\$(git merge-base HEAD origin/\${{ github.event.pull_request.base.ref }})
          echo "Base commit: \$BASE_COMMIT"
          
          # Use claude-was-here to apply consolidated notes to the squashed commit
          bunx @zdavison/claude-was-here@latest github-squash-pr --data-file "./artifacts/claude-notes-data.json" --base "\$BASE_COMMIT" --merge "\$MERGE_COMMIT"`;

export async function installGitHubActions(): Promise<void> {
  const workflowsDir = join(process.cwd(), '.github', 'workflows');
  
  // Check if we're in a git repository
  if (!existsSync(join(process.cwd(), '.git'))) {
    throw new Error('Not in a git repository. Please run this command from the root of your git repository.');
  }
  
  logger.log('🔧 Installing GitHub Actions workflows...');
  
  // Create .github/workflows directory
  await mkdir(workflowsDir, { recursive: true });
  
  // Write the pre-merge workflow
  const preWorkflowPath = join(workflowsDir, 'preserve-claude-notes-pre.yml');
  await writeFile(preWorkflowPath, PRE_MERGE_WORKFLOW);
  logger.log(`✅ Created ${preWorkflowPath}`);
  
  // Write the post-merge workflow
  const postWorkflowPath = join(workflowsDir, 'preserve-claude-notes-post.yml');
  await writeFile(postWorkflowPath, POST_MERGE_WORKFLOW);
  logger.log(`✅ Created ${postWorkflowPath}`);
  
  logger.log('\n🎉 GitHub Actions workflows installed successfully!');
  logger.log('\nWhat was installed:');
  logger.log('📁 .github/workflows/preserve-claude-notes-pre.yml - Collects Claude notes from PR commits');
  logger.log('📁 .github/workflows/preserve-claude-notes-post.yml - Attaches consolidated notes to squashed commits');
  logger.log('\n📝 These workflows will:');
  logger.log('   • Preserve Claude Code tracking data when PRs are squashed');
  logger.log('   • Use bunx to run claude-was-here commands directly');
  logger.log('   • Automatically run on pull request events');
  logger.log('   • Ensure accurate attribution in the final commit notes');
  logger.log('\n💡 The workflows require GitHub repository permissions:');
  logger.log('   • contents: read/write - to access and modify git notes');
  logger.log('   • pull-requests: read - to access PR information');
  logger.log('\n🚀 The workflows use bunx to run claude-was-here commands:');
  logger.log('   • github-synchronize-pr - Collects and consolidates notes from PR commits');
  logger.log('   • github-squash-pr - Applies consolidated notes to squashed merge commits');
}