import { CommitNode, CommitAuthorshipData, WorkingState } from '../types';

const API_BASE = '/api';

export async function setRepository(path: string): Promise<any> {
  const response = await fetch(`${API_BASE}/repository`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });
  if (!response.ok) throw new Error('Failed to set repository');
  return response.json();
}

export async function getRecentRepositories(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/recent-repositories`);
  if (!response.ok) throw new Error('Failed to get recent repositories');
  return response.json();
}

export async function addRecentRepository(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}/recent-repositories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  });
  if (!response.ok) throw new Error('Failed to add recent repository');
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface BrowseResult {
  currentPath: string;
  parentPath: string;
  directories: DirectoryEntry[];
}

export async function browseDirectories(path?: string): Promise<BrowseResult> {
  const url = path 
    ? `${API_BASE}/browse-directories?path=${encodeURIComponent(path)}`
    : `${API_BASE}/browse-directories`;
    
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to browse directories');
  return response.json();
}

export async function fetchCommits(filePath?: string): Promise<CommitNode[]> {
  const url = filePath 
    ? `${API_BASE}/commits?file=${encodeURIComponent(filePath)}`
    : `${API_BASE}/commits`;
    
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch commits');
  return response.json();
}

export async function fetchFileContent(filePath: string, commitHash?: string): Promise<string> {
  const url = commitHash
    ? `${API_BASE}/file/${encodeURIComponent(filePath)}?commit=${commitHash}`
    : `${API_BASE}/file/${encodeURIComponent(filePath)}`;
    
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch file content');
  return response.text();
}

export async function fetchWorkingState(filePath: string): Promise<WorkingState> {
  const response = await fetch(`${API_BASE}/working-state/${encodeURIComponent(filePath)}`);
  if (!response.ok) throw new Error('Failed to fetch working state');
  return response.json();
}

export async function fetchAuthorship(filePath: string): Promise<CommitAuthorshipData[]> {
  const response = await fetch(`${API_BASE}/authorship/${encodeURIComponent(filePath)}`);
  if (!response.ok) throw new Error('Failed to fetch authorship');
  return response.json();
}

export async function fetchFiles(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/files`);
  if (!response.ok) throw new Error('Failed to fetch files');
  return response.json();
}