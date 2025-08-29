/**
 * Hash-based content tracking for efficient line attribution.
 * This module provides utilities for storing and matching code content using hashes
 * instead of full text, reducing storage requirements by ~90%.
 */

import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export interface ContentHashEntry {
  content: string;
  contextLines?: string[];
  usageCount: number;
  firstSeen: string; // timestamp
}

export interface ClaudeLineChangeHash {
  type: 'add' | 'modify' | 'delete';
  originalLine: number;
  newLine?: number;
  contentHash: string;
  contextHash?: string;
  signature: string; // First 8 chars of contentHash for quick lookups
}

export interface ClaudeTrackingDataHash {
  timestamp: string;
  tool: string;
  file: string;
  changes: ClaudeLineChangeHash[];
}

export class ContentHashStore {
  private store = new Map<string, ContentHashEntry>();
  private signatureIndex = new Map<string, string[]>(); // signature -> full hashes
  private storePath: string;

  constructor(basePath: string = '.claude/was-here') {
    this.storePath = join(basePath, 'content-store.json');
  }

  /**
   * Generate a SHA-256 hash of normalized content
   */
  static generateContentHash(content: string): string {
    const normalized = content.trim().replace(/\r\n/g, '\n');
    return createHash('sha256').update(normalized, 'utf8').digest('hex');
  }

  /**
   * Generate a hash for a context window around a line
   */
  static generateContextHash(lines: string[], centerIndex: number, windowSize: number = 5): string {
    const start = Math.max(0, centerIndex - Math.floor(windowSize / 2));
    const end = Math.min(lines.length, start + windowSize);
    const context = lines.slice(start, end).map(line => line.trim()).join('\n');
    return createHash('sha256').update(context, 'utf8').digest('hex').substring(0, 16);
  }

  /**
   * Create a short signature for quick lookups
   */
  static createSignature(contentHash: string): string {
    return contentHash.substring(0, 8);
  }

  /**
   * Store a line of content and return its hash information
   */
  storeContent(content: string, contextLines?: string[]): ClaudeLineChangeHash['contentHash'] {
    const contentHash = ContentHashStore.generateContentHash(content);
    const signature = ContentHashStore.createSignature(contentHash);
    const contextHash = contextLines && contextLines.length > 0 
      ? ContentHashStore.generateContextHash(contextLines, Math.floor(contextLines.length / 2))
      : undefined;

    // Store content if not already present
    if (!this.store.has(contentHash)) {
      this.store.set(contentHash, {
        content,
        contextLines,
        usageCount: 1,
        firstSeen: new Date().toISOString()
      });
    } else {
      this.store.get(contentHash)!.usageCount++;
    }

    // Update signature index
    if (!this.signatureIndex.has(signature)) {
      this.signatureIndex.set(signature, []);
    }
    if (!this.signatureIndex.get(signature)!.includes(contentHash)) {
      this.signatureIndex.get(signature)!.push(contentHash);
    }

    return contentHash;
  }

  /**
   * Retrieve content by hash
   */
  getContent(hash: string): string | null {
    return this.store.get(hash)?.content ?? null;
  }

  /**
   * Find all hashes that match a signature (first 8 chars)
   */
  findBySignature(signature: string): string[] {
    return this.signatureIndex.get(signature) ?? [];
  }

  /**
   * Find matching lines in content using hash-based lookup
   */
  findMatchingLines(fileContent: string): Map<string, number[]> {
    const lines = fileContent.split('\n');
    const matches = new Map<string, number[]>();

    lines.forEach((line, index) => {
      const lineHash = ContentHashStore.generateContentHash(line);
      const signature = ContentHashStore.createSignature(lineHash);

      // Quick signature lookup
      if (this.signatureIndex.has(signature)) {
        const candidateHashes = this.signatureIndex.get(signature)!;
        
        // Check for exact hash match
        if (candidateHashes.includes(lineHash)) {
          if (!matches.has(lineHash)) {
            matches.set(lineHash, []);
          }
          matches.get(lineHash)!.push(index + 1); // 1-indexed
        }
      }
    });

    return matches;
  }

  /**
   * Load the content store from disk
   */
  async load(): Promise<void> {
    if (!existsSync(this.storePath)) {
      return; // No store exists yet
    }

    try {
      const data = await readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Restore store
      this.store.clear();
      this.signatureIndex.clear();
      
      for (const [hash, entry] of Object.entries(parsed.store || {})) {
        this.store.set(hash, entry as ContentHashEntry);
        
        // Rebuild signature index
        const signature = ContentHashStore.createSignature(hash);
        if (!this.signatureIndex.has(signature)) {
          this.signatureIndex.set(signature, []);
        }
        this.signatureIndex.get(signature)!.push(hash);
      }
    } catch (error) {
      console.warn('Failed to load content hash store:', error);
    }
  }

  /**
   * Save the content store to disk
   */
  async save(): Promise<void> {
    try {
      await mkdir(join(this.storePath, '..'), { recursive: true });
      
      const data = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        store: Object.fromEntries(this.store)
      };
      
      await writeFile(this.storePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn('Failed to save content hash store:', error);
    }
  }

  /**
   * Get statistics about the store
   */
  getStats(): { totalEntries: number; totalUsage: number; averageUsage: number } {
    const entries = Array.from(this.store.values());
    const totalUsage = entries.reduce((sum, entry) => sum + entry.usageCount, 0);
    
    return {
      totalEntries: entries.length,
      totalUsage,
      averageUsage: entries.length > 0 ? totalUsage / entries.length : 0
    };
  }

  /**
   * Clean up unused entries (with usage count of 1 and older than specified days)
   */
  cleanup(olderThanDays: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    let removed = 0;
    for (const [hash, entry] of this.store.entries()) {
      if (entry.usageCount === 1 && new Date(entry.firstSeen) < cutoffDate) {
        this.store.delete(hash);
        
        // Clean up signature index
        const signature = ContentHashStore.createSignature(hash);
        const hashes = this.signatureIndex.get(signature);
        if (hashes) {
          const index = hashes.indexOf(hash);
          if (index !== -1) {
            hashes.splice(index, 1);
            if (hashes.length === 0) {
              this.signatureIndex.delete(signature);
            }
          }
        }
        
        removed++;
      }
    }
    
    return removed;
  }
}

/**
 * Create line change tracking data with hash-based storage
 */
export function createHashedLineChange(
  type: ClaudeLineChangeHash['type'],
  originalLine: number,
  content: string,
  contextLines: string[],
  hashStore: ContentHashStore,
  newLine?: number
): ClaudeLineChangeHash {
  const contentHash = hashStore.storeContent(content, contextLines);
  const contextHash = contextLines.length > 0 
    ? ContentHashStore.generateContextHash(contextLines, Math.floor(contextLines.length / 2))
    : undefined;
  const signature = ContentHashStore.createSignature(contentHash);

  return {
    type,
    originalLine,
    newLine,
    contentHash,
    contextHash,
    signature
  };
}

/**
 * Convert line numbers and file content to hash-based tracking data
 */
export async function createHashedTrackingData(
  tool: string,
  file: string,
  lines: number[],
  fileContent: string,
  hashStore: ContentHashStore
): Promise<ClaudeTrackingDataHash> {
  const fileLines = fileContent.split('\n');
  const changes: ClaudeLineChangeHash[] = [];

  for (const lineNum of lines) {
    if (lineNum >= 1 && lineNum <= fileLines.length) {
      const content = fileLines[lineNum - 1];
      
      // Get context lines (2 before, 2 after)
      const contextStart = Math.max(0, lineNum - 3);
      const contextEnd = Math.min(fileLines.length, lineNum + 2);
      const contextLines = fileLines.slice(contextStart, contextEnd);

      const change = createHashedLineChange(
        'add', // For now, treat all as additions; could be enhanced with diff analysis
        lineNum,
        content,
        contextLines,
        hashStore,
        lineNum
      );

      changes.push(change);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    tool,
    file,
    changes
  };
}