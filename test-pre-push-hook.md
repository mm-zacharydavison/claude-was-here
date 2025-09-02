# Test Pre-Push Hook

This file tests the pre-push hook that automatically pushes git notes whenever any push operation occurs.

## How it works:
1. Commit creates git notes ✅
2. When you run `git push origin branch-name`, the pre-push hook automatically runs first ✅
3. Pre-push hook executes `git push origin refs/notes/commits` ✅
4. Your branch push completes ✅
5. GitHub Actions can immediately find the notes ✅

This should work regardless of how you push (with or without explicit branch names)!