/**
 * Health Command
 * 
 * Check system health and run diagnostics
 */

import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { HealthService } from '../services/health-service.js';
import { ConfigService } from '../services/config-service.js';
import { logger } from '../utils/logger.js';

/**
 * Format response time
 */
function formatResponseTime(ms: number): string {
  if (ms < 100) {
    return chalk.green(`${ms}ms`);
  } else if (ms < 500) {
    return chalk.yellow(`${ms}ms`);
  } else {
    return chalk.red(`${ms}ms`);
  }
}

/**
 * Health check command
 */
export async function healthCheckCommand(): Promise<void> {
  try {
    logger.info('Starting health check command');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();
    const healthService = new HealthService();

    // Run health checks
    const spinner = ora('Checking system health...').start();

    const result = await healthService.checkAll(
      config.infrastructure.qdrantUrl,
      config.infrastructure.redisUrl,
      config.infrastructure.voyageApiKey,
      config.infrastructure.mitmRouterUrl
    );

    spinner.stop();

    // Display results
    console.log(chalk.blue.bold('\n🏥 System Health Check\n'));

    // Create status table
    const table = new Table({
      head: [
        chalk.cyan('Component'),
        chalk.cyan('Status'),
        chalk.cyan('Response Time'),
        chalk.cyan('Details'),
      ],
      colWidths: [20, 15, 20, 30],
    });

    for (const component of result.components) {
      const status = component.healthy
        ? chalk.green('✓ Healthy')
        : chalk.red('✗ Unhealthy');

      const responseTime = component.responseTime
        ? formatResponseTime(component.responseTime)
        : 'N/A';

      const details = component.details
        ? JSON.stringify(component.details)
        : component.message;

      table.push([component.name, status, responseTime, details]);
    }

    console.log(table.toString());

    // Overall status
    console.log();
    if (result.overall) {
      console.log(chalk.green.bold('✓ All systems operational'));
    } else {
      console.log(chalk.red.bold('✗ Some systems are unhealthy'));
      console.log(chalk.gray('\nTroubleshooting:'));
      
      for (const component of result.components) {
        if (!component.healthy) {
          console.log(chalk.gray(`  • ${component.name}: ${component.message}`));
        }
      }
    }

    console.log(chalk.gray(`\nChecked at: ${new Date(result.timestamp).toLocaleString()}`));

    logger.info('Health check command completed successfully', { overall: result.overall });
  } catch (error) {
    logger.error('Health check command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Health test command (E2E test)
 */
export async function healthTestCommand(): Promise<void> {
  try {
    logger.info('Starting health test command (E2E)');

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    const config = await configService.getConfig();
    const healthService = new HealthService();

    // Build daemon URL
    const daemonUrl = `http://${config.daemon.host}:${config.daemon.port}`;

    // Run E2E test
    const spinner = ora('Running end-to-end test...').start();

    const result = await healthService.runE2ETest(daemonUrl);

    spinner.stop();

    // Display results
    console.log(chalk.blue.bold('\n🧪 End-to-End Test\n'));

    if (result.success) {
      console.log(chalk.green('✓ Test passed'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`${chalk.bold('Response Time:')} ${formatResponseTime(result.responseTime)}`);
      
      if (result.details) {
        console.log(`${chalk.bold('Model:')} ${result.details.model || 'N/A'}`);
        
        if (result.details.usage) {
          console.log(`${chalk.bold('Input Tokens:')} ${result.details.usage.input_tokens || 0}`);
          console.log(`${chalk.bold('Output Tokens:')} ${result.details.usage.output_tokens || 0}`);
        }
      }
      
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.green('\n✓ ClaudeFlow is working correctly'));
    } else {
      console.log(chalk.red('✗ Test failed'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`${chalk.bold('Error:')} ${result.message}`);
      console.log(`${chalk.bold('Response Time:')} ${formatResponseTime(result.responseTime)}`);
      console.log(chalk.gray('─'.repeat(50)));
      
      console.log(chalk.yellow('\n⚠ Possible issues:'));
      console.log(chalk.gray('  • Daemon is not running (start with: claudeflow daemon start)'));
      console.log(chalk.gray('  • No accounts configured (add with: claudeflow account add)'));
      console.log(chalk.gray('  • Infrastructure services are down (check with: claudeflow health)'));
    }

    logger.info('Health test command completed', { success: result.success });

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    logger.error('Health test command failed', error);
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
