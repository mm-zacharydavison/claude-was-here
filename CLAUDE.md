# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`claude-was-here` is a tool for automatically tracking lines changed by Claude Code in git repositories. It uses git hooks and git notes to track which lines of code were authored by Claude, providing statistics about AI-contributed code.

## Development Commands

```bash
# Build the project
bun build src/cli.ts --outdir dist --target bun --format esm

# Build standalone binary
bun build src/cli.ts --compile --outfile claude-was-here

# Run tests
bun test tests/

# Watch mode for tests
bun test tests/ --watch

# Type checking
bun run type-check  # or: tsc --noEmit

# Development mode
bun run dev

# Run a specific test file
bun test tests/[filename].test.ts

# Remove all claude-was-here data from repository
claude-was-here scrub

# Remove all claude-was-here data without confirmation prompt
claude-was-here scrub --force
```

## Architecture

### Core Flow
1. **Claude Code Hook** (`PostToolUse`): Captures file edits made by Claude and stores metadata in `.claude/was-here/`
2. **Git Pre-commit Hook**: Consolidates metadata from multiple file changes before commit
3. **Git Post-commit Hook**: Stores consolidated metadata in git notes attached to the commit
4. **Stats Command**: Reads git notes history to calculate Claude contribution percentages

### Key Components

- **CLI Entry Point** (`src/cli.ts`): Commander-based CLI with commands for init, stats, and internal hook operations
- **Commands** (`src/commands/`):
  - `track-changes.ts`: Processes Claude Code hook data and stores file change metadata
  - `pre-commit.ts`: Consolidates metadata files into a single commit summary
  - `post-commit.ts`: Stores metadata in git notes using structured format
  - `stats.ts`: Analyzes git notes to calculate Claude contribution statistics
  - Installation commands for binary, Claude hooks, git hooks, and GitHub Actions

### Data Storage

- **Temporary Metadata**: `.claude/was-here/` directory stores individual file change records as JSON
- **Git Notes**: Permanent storage using `refs/notes/claude-was-here` with structured JSON format containing line ranges
- **Note Format**: Each commit's note contains version info and file-to-line-range mappings

### GitHub Integration

When PRs are squashed, git notes are preserved using two GitHub Actions workflows that capture and reapply Claude metadata to the squashed commit.

## Technology Stack

- **Runtime**: Bun (used for building, testing, and as the runtime)
- **Language**: TypeScript with ESM modules and `.ts` extensions in imports
- **Testing**: Bun's built-in test runner
- **CLI**: Commander.js for command-line interface