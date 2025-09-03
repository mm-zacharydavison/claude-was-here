# GitHub E2E Tests

This directory contains end-to-end tests for the `claude-was-here` GitHub Actions integration.

## Prerequisites

Before running these tests, you need:

1. **GitHub CLI (`gh`)** installed and available in your PATH
   ```bash
   # macOS
   brew install gh
   
   # Ubuntu/Debian  
   sudo apt install gh
   
   # Other platforms: https://cli.github.com/
   ```

2. **GitHub CLI Authentication** - you must be logged in to GitHub
   ```bash
   gh auth login
   ```

3. **GitHub Account Access** - the tests will create and delete repositories, so you need:
   - Write access to create repositories in your account/organization
   - Sufficient API rate limits for repository operations

## Running the Tests

### Quick Unit/Integration Tests (fast)
```bash
# Run all non-GitHub tests (completes in ~2 seconds)
bun run test

# Watch mode for development
bun run test:watch
```

### GitHub E2E Tests (slow) 
```bash
# Run all GitHub-related tests (~1-2 minutes)
bun run test:github

# Or run setup tests only (always run first)
bun test tests/github/setup.test.ts

# Or run specific E2E test
bun test tests/github/e2e.test.ts
```

### All Tests
```bash
# Run everything (unit + integration + GitHub E2E)
bun run test:all
```

## Test Structure

### `setup.test.ts`
- Verifies GitHub CLI is installed and working
- Checks authentication status  
- Tests basic GitHub API access
- Validates that all required GitHub CLI commands are available

**This test always passes** - it's designed to provide informational output about your GitHub CLI setup.

### `e2e.test.ts` 
- **Full End-to-End GitHub Integration Test**
- Creates a real GitHub repository
- Installs GitHub Actions workflows
- Creates feature branch with Claude-authored commits
- Creates a pull request
- Waits for and verifies GitHub Actions execution
- Tests squash-merge workflow
- Verifies Claude notes preservation
- **Preserves repositories for inspection** (use cleanup script when ready)

**This test is skipped** if GitHub CLI is not available or not authenticated.

## What the E2E Test Does

1. **Repository Creation**: Creates a unique test repository on GitHub
2. **Action Installation**: Installs the `claude-was-here` GitHub Actions workflows  
3. **Simulated Claude Work**: Creates commits with Claude notes attached
4. **PR Workflow**: Creates a pull request and verifies the pre-merge workflow runs
5. **Merge Workflow**: Merges the PR and verifies the post-merge workflow runs
6. **Verification**: Checks that Claude notes are properly preserved on the merge commit
7. **Preservation**: Leaves the test repository for manual inspection

## Test Timeouts

The E2E test has a 2-minute timeout to account for:
- GitHub API rate limits
- GitHub Actions workflow execution time
- Network latency

## Troubleshooting

### Tests are being skipped
- Check that `gh --version` works
- Verify authentication with `gh auth status`  
- Ensure you have permission to create repositories

### E2E test failures
- Check GitHub Actions are enabled in your account/organization
- Verify sufficient API rate limits
- Look for workflow execution errors in the GitHub repository
- Check that the test repository was created successfully

### Rate Limiting
If you hit GitHub API rate limits:
- Wait for the rate limit to reset (usually 1 hour)
- Consider using a GitHub App token instead of personal token
- Run tests less frequently

## Security Notes

- Tests create public repositories by default
- Test repositories are **preserved for inspection** - not automatically deleted
- No sensitive information should be included in test content
- Repository names include timestamps and random strings to avoid conflicts

## Repository Cleanup

Test repositories are preserved by default for inspection. Clean them up when ready:

```bash
# Use the built-in cleanup script
bun run test:cleanup

# Or manually delete specific repositories
gh repo delete OWNER/REPO_NAME --yes

# List all test repositories
gh repo list --limit 100 | grep claude-was-here-e2e-test
```

**Note**: You may need to add the `delete_repo` scope to your GitHub CLI:
```bash
gh auth refresh -h github.com -s delete_repo
```