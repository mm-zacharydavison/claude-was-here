import { $ } from 'bun';

export const isGitAvailable = (): boolean => {
  try {
    const result = Bun.spawnSync(['which', 'git']);
    return result.exitCode === 0;
  } catch {
    return false;
  }
};

export const execCommand = async (command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> => {
  try {
    // Add --quiet flag to git commands to reduce test noise  
    let adjustedArgs = args;
    if (command === 'git') {
      const subcommand = args[0];
      // Add --quiet flag if not already present and if the command supports it
      if (!args.includes('--quiet') && !args.includes('-q')) {
        if (subcommand === 'init') {
          adjustedArgs = ['init', '--quiet', ...args.slice(1)];
        } else if (subcommand === 'commit') {
          adjustedArgs = ['commit', '--quiet', ...args.slice(1)];
        }
      }
    }
    
    // Use Bun's $ template literal for command execution
    const result = await $`${command} ${adjustedArgs}`.cwd(cwd).nothrow().quiet();
    
    return {
      stdout: result.stdout?.toString().trim() || '',
      stderr: result.stderr?.toString().trim() || '',
      code: result.exitCode || 0
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: error?.toString() || 'Command execution failed',
      code: 1
    };
  }
};