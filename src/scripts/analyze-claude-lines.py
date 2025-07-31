#!/usr/bin/env python3
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
    
    for line in result.stdout.split('\n'):
        if line.startswith('+++'):
            # Extract filename, removing '+++ b/' prefix
            current_file = line[6:] if len(line) > 6 else None
        elif line.startswith('@@') and current_file:
            # Parse hunk header like @@ -1,4 +10,8 @@
            match = re.search(r'\+(\d+)(?:,(\d+))?', line)
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
    
    return '\n'.join(lines)


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