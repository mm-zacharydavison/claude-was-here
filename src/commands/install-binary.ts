import { copyFile, access, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

// Find the project root by looking for package.json
function findProjectRoot(): string {
  let dir = __dirname;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  // Fallback to current working directory
  return process.cwd();
}

export async function installBinary(): Promise<void> {
  console.log('📦 Installing claude-was-here binary to PATH...');
  
  const projectRoot = findProjectRoot();
  const currentBinary = join(projectRoot, 'claude-was-here');
  const localBinDir = join(homedir(), '.local', 'bin');
  const targetPath = join(localBinDir, 'claude-was-here');
  
  // Check if we're running from the installed location to avoid "Text file busy" error
  // When running from installed binary, Bun shows /$bunfs/root/claude-was-here
  const currentExecutable = process.argv[1] || process.execPath;
  const isBunVirtualPath = currentExecutable.includes('$bunfs') && currentExecutable.endsWith('/claude-was-here');
  
  if (isBunVirtualPath) {
    // We're running from the installed binary (Bun's virtual filesystem)
    console.log('✅ Already running from installed location:', targetPath);
    console.log('   To update, run: bun run build:binary && cp claude-was-here ~/.local/bin/');
    return;
  }
  
  // Check if current binary exists
  try {
    await access(currentBinary);
  } catch {
    throw new Error('claude-was-here binary not found. Run "bun run build:binary" first.');
  }
  
  try {
    // Ensure ~/.local/bin directory exists
    await mkdir(localBinDir, { recursive: true });
    
    // Copy binary to ~/.local/bin
    await copyFile(currentBinary, targetPath);
    
    // Make it executable
    const fs = await import('fs');
    await fs.promises.chmod(targetPath, 0o755);
    
    console.log(`✅ Binary installed to ${targetPath}`);
    
    // Check if ~/.local/bin is in PATH
    const currentPath = process.env.PATH || '';
    if (!currentPath.includes(localBinDir)) {
      console.log('\n⚠️  Note: ~/.local/bin is not in your PATH.');
      console.log('   Add this to your shell profile (.bashrc, .zshrc, etc.):');
      console.log(`   export PATH="${localBinDir}:$PATH"`);
      console.log('   Then restart your terminal or run: source ~/.bashrc');
    }
  } catch (error) {
    console.log('⚠️  Could not install binary automatically.');
    console.log(`   Please run manually: cp claude-was-here ${targetPath}`);
    console.log(`   Then: chmod +x ${targetPath}`);
    throw error;
  }
}