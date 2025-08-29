# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
# Run the CLI in development mode
bun run src/cli.ts

# Run tests
bun test tests/

# Run tests in watch mode
bun test tests/ --watch

# Type check
tsc --noEmit

# Build ESM module
bun build src/cli.ts --outdir dist --target bun --format esm

# Build standalone binary
bun build src/cli.ts --compile --outfile claude-was-here
```

### Testing Individual Commands
```bash
# Test specific command
bun run src/cli.ts stats --since="1 week"
bun run src/cli.ts init
bun run src/cli.ts track-changes < test-input.json
```

## Architecture

### Hook-Based Integration System
The project operates through a three-layer hook system:

1. **Claude Code Hooks** (`PostToolUse`): Capture Edit/MultiEdit/Write operations via `.claude/settings.json` configuration
2. **Git Hooks** (pre-commit/post-commit): Process and store metadata in Git notes
3. **Git Notes Storage**: Persistent attribution data that survives rebases and merges

### Data Flow Pipeline
```
Claude Code Edit → track-changes → .claude/was-here/ → pre-commit → post-commit → git notes
                                    (temporary files)    (consolidate)  (persist)
```

### Core Components

**CLI Commands** (`src/commands/`):
- `init.ts`: Full installation flow (binary, Claude hooks, Git hooks)
- `track-changes.ts`: Parses Claude tool usage, extracts line changes from structuredPatch data
- `pre-commit.ts`: Consolidates temporary metadata before commit
- `post-commit.ts`: Transforms metadata to Git notes format
- `stats.ts`: Analyzes Git notes across commit history for contribution statistics
- `install-github-actions.ts`: Sets up workflows for PR squash scenarios

**Utilities** (`src/utils/`):
- `git.ts`: Git command wrapper and repository operations
- `fs.ts`: File system operations with error handling
- `format.ts`: Output formatting helpers

### Key Technical Details

- **Runtime**: Bun (primary), with Node.js compatibility
- **Metadata Format**: Line ranges stored as `filename: start-end,start-end`
- **Git Notes Ref**: `refs/notes/claude-was-here`
- **Structured Patch Priority**: Uses Claude Code's structuredPatch data when available, falls back to heuristics
- **Python Integration**: `analyze-claude-lines.py` handles complex diff analysis for GitHub Actions

### Testing Approach
Tests use temporary Git repositories created in `/tmp/` with full workflow simulation. Test helpers in `tests/helpers/` provide utilities for Git operations and TSV parsing.