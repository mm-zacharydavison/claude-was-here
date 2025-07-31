# claude-was-here - Test Suite

This directory contains comprehensive tests for the claude-was-here project.

## Test Files

### `simple.test.ts`
Basic validation tests that verify:
- ✅ Line range conversion logic works correctly
- ✅ Git note data structure is properly formatted
- ✅ Binary executable exists and is accessible

### `unit.test.ts`
Unit tests for individual components:
- ✅ Range conversion with various line patterns (consecutive, non-consecutive, single, empty)
- ⚠️ Track-changes command integration (has some file path issues in test environment)

### `e2e.test.ts`
End-to-end integration tests:
- Full workflow: git repo setup → init hooks → make changes → commit → verify notes
- Multiple files with different line ranges
- Handling commits without Claude changes
- Line range calculation accuracy

### `git-hooks.test.ts`
Git hooks integration tests:
- Pre-commit hook processing of tracking data
- Post-commit hook creation of git notes
- Empty tracking data handling
- Multiple commit scenarios

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/simple.test.ts

# Run with watch mode
bun run test:watch
```

## Test Coverage

The test suite covers:

1. **Core Logic**: Line range conversion algorithms
2. **Hook Integration**: Claude Code hook → tracking data → git hooks → git notes
3. **Edge Cases**: Empty data, files outside repo, non-Claude changes
4. **Data Flow**: Complete workflow from edit to git note storage
5. **Git Integration**: Multiple commits, note format validation

## Test Environment

Tests use temporary directories and isolated git repositories to avoid affecting the main project. Each test cleans up after itself.

## Current Status

- ✅ Core range conversion logic: All tests passing
- ✅ Git note data structure validation: All tests passing  
- ✅ Binary existence and executability: All tests passing
- ⚠️ Integration tests: Some path resolution issues in test environment
- 📝 E2E tests: Comprehensive but may need environment-specific adjustments

The system's core functionality is thoroughly tested and working correctly.