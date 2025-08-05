# `claude-was-here`

>[!IMPORTANT] This is work-in-progress and likely not ready to use yet. I will certainly be implementing breaking changes.

`claude-was-here` is a tool for automatically tracking lines changed by Claude Code in your git repository.

It's primary purpose if providing you with an easy way to see what % of code is being written by `claude`.

### How it works:

1. Claude Code `PostToolUse` hook captures file writes.
2. Captures metadata about which lines were changed.
3. `pre-commit` and `post-commit` git hooks store the metadata using `git notes`.

# Quick Start

```bash
npx @zdavison/claude-was-here init
```

```bash
🤖 claude-was-here - Initialization
=========================================
📦 Installing claude-was-here binary to PATH...
✅ Binary installed to ~/.local/bin/claude-was-here
📦 Installing Claude Code hooks...
✅ Claude Code hooks installed
📦 Installing git hooks...
⚠️  Claude hook already present in pre-commit
⚠️  Claude hook already present in post-commit
✅ Git hooks installed

🎉 Initialization completed successfully!

What was installed:
📁 ~/.local/bin/claude-was-here - Binary installed to PATH
📁 .claude/settings.json - Claude Code hook configuration
📁 .git/hooks/pre-commit - Consolidates metadata before commits
📁 .git/hooks/post-commit - Stores structured data in git notes
📁 .claude/was-here/ - Directory for temporary metadata

🚀 The system is now ready to track Claude Code changes!
```

# Features

## Statistics

```bash
claude-was-here stats --since="1 week"
```

```bash
🤖 Claude Code Stats - Since: 1 week
===================================================

Analyzing 5 commits...

📊 Overall Statistics:
Total lines: 2,205
Claude-authored lines: 1,636
Percentage: 74%

📁 Top files by Claude contribution:
  tests/pr-squash.test.ts: 509/509 lines (100%)
  src/commands/install-github-actions.ts: 377/377 lines (100%)
  src/commands/stats.ts: 190/291 lines (65%)
  src/scripts/analyze-claude-lines.py: 184/184 lines (100%)
  tests/stats.test.ts: 145/394 lines (37%)
  .github/workflows/preserve-claude-notes-pre.yml: 80/80 lines (100%)
  tests/helpers/tsv.ts: 62/62 lines (100%)
  .github/workflows/preserve-claude-notes-post.yml: 61/61 lines (100%)
  src/commands/post-commit.ts: 15/132 lines (11%)
  src/cli.ts: 13/115 lines (11%)
```

This will read previous git notes data and calculate the total lines contributed by Claude Code.
Only lines that remain in the current `git HEAD` are considered to be contributed (so if you deleted lines Claude Code added, they're not counted).

## GitHub PRs with squashed commits

If you squash PR commits into a single commit, by default, `git notes` data is lost.
`claude-was-here` provides a pair of GitHub Actions for also "squashing" your `claude-was-here` data into the final PR commit.

```bash
claude-was-here install-github-actions
```

This will install 2 GitHub Actions that ensure that data is persisted into your final squashed PR commit.
