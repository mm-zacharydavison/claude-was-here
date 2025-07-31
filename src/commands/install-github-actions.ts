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

// Python script content as a constant to avoid file path issues
const ANALYZE_CLAUDE_LINES_SCRIPT = `#!/usr/bin/env python3
"""
Analyze Claude Code contributions across commits and map them to final diff lines.

This script is used by GitHub Actions to preserve Claude Code tracking data
when PRs are squashed, ensuring accurate attribution in the final commit.
"""

import sys
import re
import subprocess
from collections import defaultdict
from typing import Dict, Set, List, Tuple


def parse_claude_data(filename: str) -> Dict[str, Set[int]]:
    """Parse the collected Claude commit data from the pre-merge workflow."""
    claude_files = defaultdict(set)
    
    try:
        with open(filename, 'r') as f:
            for line in f:
                parts = line.strip().split('|')
                if len(parts) == 3:
                    commit_hash, filepath, ranges = parts
                    
                    # Parse ranges like "10-20,25-30"
                    for range_str in ranges.split(','):
                        range_str = range_str.strip()
                        if '-' in range_str:
                            try:
                                start, end = map(int, range_str.split('-'))
                                claude_files[filepath].update(range(start, end + 1))
                            except ValueError:
                                print(f"Warning: Could not parse range '{range_str}' in file {filepath}")
                        else:
                            try:
                                claude_files[filepath].add(int(range_str))
                            except ValueError:
                                print(f"Warning: Could not parse line number '{range_str}' in file {filepath}")
    except FileNotFoundError:
        print(f"Error: Could not find Claude data file: {filename}")
        return defaultdict(set)
    except Exception as e:
        print(f"Error parsing Claude data: {e}")
        return defaultdict(set)
    
    return claude_files


def get_final_diff_lines(base_commit: str, latest_commit: str) -> Dict[str, Set[int]]:
    """Get the actual lines that were added/modified in the final diff."""
    try:
        result = subprocess.run([
            'git', 'diff', '--unified=0', f'{base_commit}..{latest_commit}'
        ], capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error running git diff: {e}")
        return defaultdict(set)
    
    final_lines = defaultdict(set)
    current_file = None
    
    for line in result.stdout.split('\\n'):
        if line.startswith('+++'):
            # Extract filename, removing '+++ b/' prefix
            current_file = line[6:] if len(line) > 6 else None
        elif line.startswith('@@') and current_file:
            # Parse hunk header like @@ -1,4 +10,8 @@
            match = re.search(r'\\+([0-9]+)(?:,([0-9]+))?', line)
            if match:
                try:
                    start_line = int(match.group(1))
                    count = int(match.group(2)) if match.group(2) else 1
                    
                    # Mark these lines as part of the final diff
                    for i in range(start_line, start_line + count):
                        final_lines[current_file].add(i)
                except ValueError:
                    print(f"Warning: Could not parse hunk header: {line}")
    
    return final_lines


def map_claude_to_final(claude_files: Dict[str, Set[int]], final_lines: Dict[str, Set[int]]) -> Dict[str, Set[int]]:
    """
    Map Claude's original line contributions to final line numbers.
    
    This is a simplified approach that assumes if Claude touched a file
    and the file has changes in the final diff, then Claude contributed
    to those changes. A more sophisticated approach would need to trace
    line-by-line changes through git history.
    """
    final_claude_lines = defaultdict(set)
    
    for filepath in claude_files:
        if filepath in final_lines:
            # Simple mapping: if Claude touched the file and it has final changes,
            # assume Claude contributed to the final changes
            final_claude_lines[filepath] = final_lines[filepath]
    
    return final_claude_lines


def convert_lines_to_ranges(lines: List[int]) -> str:
    """Convert a list of line numbers to compact range notation like '10-20,25-30'."""
    if not lines:
        return ""
    
    sorted_lines = sorted(lines)
    ranges = []
    start = sorted_lines[0]
    end = sorted_lines[0]
    
    for line in sorted_lines[1:]:
        if line == end + 1:
            end = line
        else:
            # Close current range
            if start == end:
                ranges.append(str(start))
            else:
                ranges.append(f"{start}-{end}")
            start = end = line
    
    # Add the final range
    if start == end:
        ranges.append(str(start))
    else:
        ranges.append(f"{start}-{end}")
    
    return ",".join(ranges)


def generate_claude_note(final_claude_lines: Dict[str, Set[int]]) -> str:
    """Generate the final claude-was-here note in the standard format."""
    lines = ['claude-was-here', 'version: 1.0']
    
    if final_claude_lines:
        # Calculate max path length for alignment
        max_length = max(len(path) for path in final_claude_lines.keys())
        
        # Add each file with its ranges
        for filepath in sorted(final_claude_lines.keys()):
            line_set = final_claude_lines[filepath]
            ranges_str = convert_lines_to_ranges(list(line_set))
            if ranges_str:
                padded_path = f"{filepath}:".ljust(max_length + 2)
                lines.append(f"{padded_path} {ranges_str}")
    
    return '\\n'.join(lines)


def main():
    """Main execution function."""
    if len(sys.argv) < 4:
        print("Usage: python analyze_claude_lines.py <claude_data_file> <base_commit> <latest_commit>")
        print("")
        print("This script analyzes Claude Code contributions across commits and maps them")
        print("to the final diff, generating accurate attribution for squashed commits.")
        sys.exit(1)
    
    claude_data_file = sys.argv[1]
    base_commit = sys.argv[2]
    latest_commit = sys.argv[3]
    
    # Parse Claude's original contributions
    claude_files = parse_claude_data(claude_data_file)
    print(f"Found Claude contributions in {len(claude_files)} files", file=sys.stderr)
    
    # Get final diff lines
    final_lines = get_final_diff_lines(base_commit, latest_commit)
    print(f"Final diff affects {len(final_lines)} files", file=sys.stderr)
    
    # Map Claude contributions to final lines
    final_claude_lines = map_claude_to_final(claude_files, final_lines)
    
    # Generate and output the final note
    note_content = generate_claude_note(final_claude_lines)
    print(note_content)


if __name__ == "__main__":
    main()
`;

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
          
      - name: Process and attach Claude notes to merge commit
        if: steps.check-notes.outputs.notes_exist == 'true'
        run: |
          # Get the latest commit (should be the merge/squash commit)
          latest_commit=$(git rev-parse HEAD)
          echo "Latest commit: $latest_commit"
          
          # Get the base commit to compare against
          base_commit=$(git merge-base HEAD origin/\${{ github.event.pull_request.base.ref }})
          echo "Base commit: $base_commit"
          
          # Run the Claude lines analysis using the installed script
          python3 .github/scripts/analyze-claude-lines.py ./artifacts/claude_commits_data.txt "$base_commit" "$latest_commit" > final_claude_note.txt
          
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
  
  // Write the Python analysis script
  const scriptDestPath = join(scriptsDir, 'analyze-claude-lines.py');
  await writeFile(scriptDestPath, ANALYZE_CLAUDE_LINES_SCRIPT);
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
  console.log('📁 .github/scripts/analyze-claude-lines.py - Python script for analyzing Claude contributions');
  console.log('\n📝 These workflows will:');
  console.log('   • Preserve Claude Code tracking data when PRs are squashed');
  console.log('   • Automatically run on pull request events');
  console.log('   • Ensure accurate attribution in the final commit notes');
  console.log('\n💡 The workflows require GitHub repository permissions:');
  console.log('   • contents: read/write - to access and modify git notes');
  console.log('   • pull-requests: read - to access PR information');
}