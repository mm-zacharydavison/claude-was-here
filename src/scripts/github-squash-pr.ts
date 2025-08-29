#!/usr/bin/env bun
/**
 * Standalone script for GitHub Actions to apply Claude notes to squashed commits
 * This gets bundled and copied to .github/scripts/ when running install-github-actions
 */

import { githubSquashPR } from '../commands/github-actions.ts';

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length !== 6 || args[0] !== '--data-file' || args[2] !== '--base' || args[4] !== '--merge') {
  console.error('Usage: github-squash-pr --data-file <path> --base <commit> --merge <commit>');
  process.exit(1);
}

const dataFile = args[1];
const baseCommit = args[3];
const mergeCommit = args[5];

// Run the command
githubSquashPR(dataFile, baseCommit, mergeCommit).catch((error) => {
  console.error('Failed:', error);
  process.exit(1);
});