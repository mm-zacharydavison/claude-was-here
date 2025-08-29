import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execCommand } from './helpers/exec.ts';
import { ClaudeHookData, WorkingTrackingData } from '../src/types.ts';

let testDir: string;
let originalCwd: string;

describe('claude-was-here track-changes', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = await mkdtemp(join(tmpdir(), 'claude-track-test-'));
    
    // Initialize git repo
    await execCommand('git', ['init'], testDir);
    await execCommand('git', ['config', 'user.name', 'Test User'], testDir);
    await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir);
    
    // Change to test directory
    process.chdir(testDir);
  });

  afterEach(async () => {
    // Restore original directory
    process.chdir(originalCwd);
    
    // Clean up test directory
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  async function runTrackChanges(hookData: ClaudeHookData): Promise<void> {
    const hookDataJson = JSON.stringify(hookData);
    // Write JSON to a temporary file to avoid shell escaping issues
    const tempFile = join(process.cwd(), 'hook-data.json');
    await writeFile(tempFile, hookDataJson);
    
    const result = await execCommand('sh', ['-c', `cat "${tempFile}" | bun run ${join(originalCwd, 'src/cli.ts')} track-changes`], process.cwd());
    
    // Clean up temp file
    await rm(tempFile);
    
    if (result.code !== 0) {
      throw new Error(`track-changes failed: ${result.stderr}`);
    }
  }

  async function readTrackingData(): Promise<WorkingTrackingData> {
    const trackingFile = join(process.cwd(), '.claude', 'was-here', 'working', 'tracking-data.json');
    try {
      const content = await readFile(trackingFile, 'utf-8');
      return JSON.parse(content) as WorkingTrackingData;
    } catch {
      return { records: [] };
    }
  }

  test('WILL store MultiEdit claude changes', async () => {
    const hookData: ClaudeHookData = {
      session_id: 'test-session-multiedit',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: testDir,
      hook_event_name: 'PostToolUse',
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: 'multi.js',
        edits: [
          { old_string: 'const old = "value";', new_string: 'const new = "value";' },
          { old_string: 'console.log(old);', new_string: 'console.log(new);' }
        ]
      },
      tool_response: {
        filePath: 'multi.js',
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ['-const old = "value";', '+const new = "value";']
          },
          {
            oldStart: 5,
            oldLines: 1,
            newStart: 5,
            newLines: 1,
            lines: ['-console.log(old);', '+console.log(new);']
          }
        ],
        success: true
      }
    };

    await runTrackChanges(hookData);
    
    const trackingData = await readTrackingData();
    expect(trackingData.records).toHaveLength(1);
    
    const record = trackingData.records[0];
    expect(record.filePath).toBe('multi.js');
    expect(record.toolName).toBe('MultiEdit');
    expect(record.sessionId).toBe('test-session-multiedit');
    expect(record.structuredPatch).toHaveLength(2);
  });

  test('WILL store Write claude changes', async () => {
    const hookData: ClaudeHookData = {
      session_id: 'test-session-write',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: testDir,
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: {
        file_path: 'script.js',
        content: '#!/usr/bin/env node\nconsole.log("New script");\nprocess.exit(0);'
      },
      tool_response: {
        filePath: 'script.js',
        success: true
      }
    };

    await runTrackChanges(hookData);
    
    const trackingData = await readTrackingData();
    expect(trackingData.records).toHaveLength(1);
    
    const record = trackingData.records[0];
    expect(record.filePath).toBe('script.js');
    expect(record.toolName).toBe('Write');
    expect(record.sessionId).toBe('test-session-write');
    expect(record.structuredPatch).toHaveLength(1);
    expect(record.structuredPatch[0].newLines).toBe(3);
  });

  test('WILL store Edit claude changes', async () => {
    const hookData: ClaudeHookData = {
      session_id: 'test-session-edit',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: testDir,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: {
        file_path: 'test.js',
        old_string: 'function hello() {\n  console.log("hello");\n}',
        new_string: 'function hello() {\n  console.log("hello world");\n}'
      },
      tool_response: {
        filePath: 'test.js',
        success: true
      }
    };

    await runTrackChanges(hookData);
    
    const trackingData = await readTrackingData();
    expect(trackingData.records).toHaveLength(1);
    
    const record = trackingData.records[0];
    expect(record.filePath).toBe('test.js');
    expect(record.toolName).toBe('Edit');
    expect(record.sessionId).toBe('test-session-edit');
    expect(record.structuredPatch).toHaveLength(1);
  });

  test('WILL use a different working directory for each repository being worked on', async () => {
    // Create second test repository
    const testDir2 = await mkdtemp(join(tmpdir(), 'claude-track-test2-'));
    await execCommand('git', ['init'], testDir2);
    await execCommand('git', ['config', 'user.name', 'Test User'], testDir2);
    await execCommand('git', ['config', 'user.email', 'test@example.com'], testDir2);
    
    try {
      // Track change in first repo
      const hookData1: ClaudeHookData = {
        session_id: 'session1',
        transcript_path: '/tmp/transcript.jsonl',
        cwd: testDir,
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: 'repo1.js',
          content: 'console.log("repo1");'
        },
        tool_response: {
          filePath: 'repo1.js',
          success: true
        }
      };
      
      await runTrackChanges(hookData1);
      
      // Switch to second repo and track change there
      process.chdir(testDir2);
      
      const hookData2: ClaudeHookData = {
        session_id: 'session2',
        transcript_path: '/tmp/transcript.jsonl',
        cwd: testDir2,
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: 'repo2.js',
          content: 'console.log("repo2");'
        },
        tool_response: {
          filePath: 'repo2.js',
          success: true
        }
      };
      
      await runTrackChanges(hookData2);
      
      // Verify tracking data is separate
      const trackingData2 = await readTrackingData();
      expect(trackingData2.records).toHaveLength(1);
      expect(trackingData2.records[0].filePath).toBe('repo2.js');
      
      // Switch back to first repo and verify its data
      process.chdir(testDir);
      const trackingData1 = await readTrackingData();
      expect(trackingData1.records).toHaveLength(1);
      expect(trackingData1.records[0].filePath).toBe('repo1.js');
      
    } finally {
      await rm(testDir2, { recursive: true, force: true });
    }
  });
});