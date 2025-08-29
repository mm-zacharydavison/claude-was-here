/**
 * Simple logger that suppresses output during test runs
 */

const isTestMode = (): boolean => {
  // Detect test mode by checking if we're in a temp test directory
  const cwd = process.cwd();
  return cwd.includes('/tmp/') && (
    cwd.includes('claude-') || 
    cwd.includes('test-') ||
    process.env.NODE_ENV === 'test'
  );
};

export const logger = {
  log: (...args: any[]) => {
    if (!isTestMode()) {
      console.log(...args);
    }
  },
  warn: (...args: any[]) => {
    if (!isTestMode()) {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    if (!isTestMode()) {
      console.error(...args);
    }
  }
};