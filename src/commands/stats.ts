interface StatsOptions {
  since?: string;
}

export async function showStats(options: StatsOptions): Promise<void> {
  console.log('❌ Stats not available - tracking system needs to be implemented');
  process.exit(1);
}