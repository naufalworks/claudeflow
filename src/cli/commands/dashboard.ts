/**
 * Dashboard Command
 *
 * Launch the beautiful TUI dashboard
 */

import { TUIDashboard } from '../ui/dashboard.js';
import { logger } from '../utils/logger.js';

/**
 * Dashboard command
 *
 * Shows real-time dashboard with:
 * - Account status
 * - Token consumption
 * - Auto-refresh monitoring
 * - Credit tracking
 */
export async function dashboardCommand(): Promise<void> {
  try {
    logger.info('Starting dashboard command');

    const dashboard = new TUIDashboard();
    await dashboard.start();

    logger.info('Dashboard command completed');
  } catch (error) {
    logger.error('Dashboard command failed', error);
    console.error('✗ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
