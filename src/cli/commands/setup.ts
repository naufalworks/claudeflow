/**
 * Setup Command
 * 
 * Interactive setup wizard for first-time configuration
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { ConfigService } from '../services/config-service.js';
import { AuthService } from '../services/auth-service.js';
import { HealthService } from '../services/health-service.js';
import { RedisClientWrapper } from '../../infrastructure/redis.js';
import { logger } from '../utils/logger.js';

/**
 * Setup wizard command
 */
export async function setupCommand(): Promise<void> {
  try {
    logger.info('Starting setup wizard');

    // Welcome message
    console.log(chalk.blue.bold('\n🚀 Welcome to ClaudeFlow CLI Setup\n'));
    console.log(chalk.gray('This wizard will help you configure ClaudeFlow for first use.\n'));

    // Initialize services
    const configService = new ConfigService();
    await configService.initialize();

    // Check if already configured
    const existingConfig = await configService.getConfig();
    if (existingConfig.accounts.length > 0) {
      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'reconfigure',
          message: 'Configuration already exists. Do you want to reconfigure?',
          default: false,
        },
      ]);

      if (!answers.reconfigure) {
        console.log(chalk.yellow('\n⚠ Setup cancelled'));
        return;
      }
    }

    // Step 1: Kiro Account Configuration
    console.log(chalk.blue.bold('\n📝 Step 1: Kiro Account Configuration\n'));
    console.log(chalk.gray('You need a Kiro account to use ClaudeFlow.'));
    console.log(chalk.gray('If you don\'t have one, visit: https://kiro.ai/signup\n'));

    const accountAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'machineId',
        message: 'Enter your Kiro Machine ID:',
        validate: (input: string) => {
          if (!input || input.trim() === '') {
            return 'Machine ID is required';
          }
          if (input.length < 10) {
            return 'Machine ID must be at least 10 characters';
          }
          return true;
        },
      },
      {
        type: 'password',
        name: 'apiKey',
        message: 'Enter your Kiro API Key:',
        mask: '*',
        validate: (input: string) => {
          if (!input || input.trim() === '') {
            return 'API Key is required';
          }
          if (input.length < 20) {
            return 'API Key must be at least 20 characters';
          }
          return true;
        },
      },
      {
        type: 'input',
        name: 'mitmRouterUrl',
        message: 'MITM Router URL:',
        default: 'http://3.68.219.151:20128',
        validate: (input: string) => {
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      },
    ]);

    // Authenticate account
    const spinner = ora('Authenticating with Kiro...').start();

    try {
      // Create Redis client for AuthService
      const config = await configService.getConfig();
      const redisClient = new RedisClientWrapper({ url: config.infrastructure.redisUrl });
      await redisClient.connect();

      const authService = new AuthService(configService, redisClient);
      const session = await authService.authenticate(
        accountAnswers.machineId,
        accountAnswers.apiKey,
        accountAnswers.mitmRouterUrl
      );

      spinner.succeed('Authentication successful');

      // Add account to config (OAuth/Kiro account type)
      await configService.addAccount({
        id: `account-${Date.now()}`,
        provider: 'kiro',
        apiKey: accountAnswers.apiKey,
        kiroConfig: {
          machineId: accountAnswers.machineId,
          mitmRouterUrl: accountAnswers.mitmRouterUrl,
          sessionToken: session.sessionToken,
          sessionExpiry: session.expiresAt,
        },
        lastUsed: Date.now(),
        requestCount: 0,
      });

      // Disconnect Redis client
      await redisClient.disconnect();

      console.log(chalk.green('\n✓ Account configured successfully'));
    } catch (error) {
      spinner.fail('Authentication failed');
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      console.log(chalk.yellow('\nPlease verify your credentials and try again.'));
      process.exit(1);
    }

    // Step 2: Infrastructure Configuration
    console.log(chalk.blue.bold('\n📝 Step 2: Infrastructure Configuration\n'));
    console.log(chalk.gray('Configure connections to required services.\n'));

    const infraAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'qdrantUrl',
        message: 'Qdrant URL:',
        default: 'http://localhost:6333',
        validate: (input: string) => {
          try {
            new URL(input);
            return true;
          } catch {
            return 'Please enter a valid URL';
          }
        },
      },
      {
        type: 'input',
        name: 'redisUrl',
        message: 'Redis URL:',
        default: 'redis://localhost:6379',
        validate: (input: string) => {
          if (!input || input.trim() === '') {
            return 'Redis URL is required';
          }
          return true;
        },
      },
      {
        type: 'password',
        name: 'voyageApiKey',
        message: 'Voyage AI API Key (optional):',
        mask: '*',
      },
    ]);

    // Update infrastructure config
    const infraConfig = await configService.getConfig();
    infraConfig.infrastructure = {
      qdrantUrl: infraAnswers.qdrantUrl,
      redisUrl: infraAnswers.redisUrl,
      voyageApiKey: infraAnswers.voyageApiKey || '',
      mitmRouterUrl: accountAnswers.mitmRouterUrl,
    };
    await configService.save(infraConfig);

    // Step 3: Verify Connectivity
    console.log(chalk.blue.bold('\n📝 Step 3: Verifying Connectivity\n'));

    const healthConfig = await configService.getConfig();
    const healthService = new HealthService();
    const healthSpinner = ora('Checking service connectivity...').start();

    try {
      const healthResult = await healthService.checkAll(
        healthConfig.accounts,
        healthConfig.infrastructure.qdrantUrl,
        healthConfig.infrastructure.redisUrl,
        healthConfig.infrastructure.voyageApiKey
      );

      healthSpinner.stop();

      console.log(chalk.gray('─'.repeat(60)));
      for (const component of healthResult.components) {
        const icon = component.healthy ? chalk.green('✓') : chalk.red('✗');
        const statusText = component.healthy ? chalk.green('Healthy') : chalk.red('Unhealthy');
        console.log(`${icon} ${chalk.bold(component.name)}: ${statusText}`);
        if (component.message) {
          console.log(chalk.gray(`  ${component.message}`));
        }
      }
      console.log(chalk.gray('─'.repeat(60)));

      // Check if any critical services are unhealthy
      const criticalServices = ['qdrant', 'redis'];
      const unhealthyCritical = healthResult.components.filter(
        (component) => criticalServices.includes(component.name.toLowerCase()) && !component.healthy
      );

      if (unhealthyCritical.length > 0) {
        console.log(chalk.yellow('\n⚠ Warning: Some critical services are unavailable'));
        console.log(chalk.gray('ClaudeFlow may not work correctly until these services are running.'));
        console.log(chalk.gray(`Unhealthy services: ${unhealthyCritical.map(c => c.name).join(', ')}`));
      } else {
        console.log(chalk.green('\n✓ All critical services are healthy'));
      }
    } catch (error) {
      healthSpinner.fail('Health check failed');
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      console.log(chalk.yellow('\nYou can continue setup, but some features may not work.'));
    }

    // Step 4: Daemon Configuration
    console.log(chalk.blue.bold('\n📝 Step 4: Daemon Configuration\n'));

    const daemonAnswers = await inquirer.prompt([
      {
        type: 'number',
        name: 'port',
        message: 'Daemon port:',
        default: 3000,
        validate: (input: number) => {
          if (input < 1024 || input > 65535) {
            return 'Port must be between 1024 and 65535';
          }
          return true;
        },
      },
      {
        type: 'list',
        name: 'logLevel',
        message: 'Log level:',
        choices: ['debug', 'info', 'warn', 'error'],
        default: 'info',
      },
      {
        type: 'confirm',
        name: 'autoRestart',
        message: 'Enable auto-restart on failure?',
        default: true,
      },
    ]);

    // Update daemon config
    const currentConfig = await configService.getConfig();
    currentConfig.daemon = {
      port: daemonAnswers.port,
      host: 'localhost',
      logLevel: daemonAnswers.logLevel,
      autoRestart: daemonAnswers.autoRestart,
    };
    await configService.save(currentConfig);

    // Step 5: Preferences
    console.log(chalk.blue.bold('\n📝 Step 5: Preferences\n'));

    const preferencesAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'colorOutput',
        message: 'Enable colored output?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'progressBars',
        message: 'Enable progress bars?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'autoUpdate',
        message: 'Enable automatic updates?',
        default: false,
      },
    ]);

    // Update preferences
    const finalConfig = await configService.getConfig();
    finalConfig.preferences = {
      colorOutput: preferencesAnswers.colorOutput,
      progressBars: preferencesAnswers.progressBars,
      autoUpdate: preferencesAnswers.autoUpdate,
    };
    await configService.save(finalConfig);

    // Step 6: Start Daemon
    console.log(chalk.blue.bold('\n📝 Step 6: Start Daemon\n'));

    const startAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'startDaemon',
        message: 'Start ClaudeFlow daemon now?',
        default: true,
      },
    ]);

    if (startAnswers.startDaemon) {
      const daemonSpinner = ora('Starting ClaudeFlow daemon...').start();

      try {
        const { DaemonService } = await import('../services/daemon-service.js');
        const daemonService = new DaemonService();
        await daemonService.start();

        const latestConfig = await configService.getConfig();
        daemonSpinner.succeed('Daemon started successfully');
        console.log(chalk.green(`\n✓ ClaudeFlow is running on http://localhost:${latestConfig.daemon.port}`));
      } catch (error) {
        daemonSpinner.fail('Failed to start daemon');
        console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
        console.log(chalk.gray('\nYou can start the daemon later with: claudeflow daemon start'));
      }
    }

    // Setup complete
    console.log(chalk.blue.bold('\n🎉 Setup Complete!\n'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.green('✓ Configuration saved to:'), configService.getConfigPath());
    console.log(chalk.gray('─'.repeat(60)));
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('  • View configuration: claudeflow config show'));
    console.log(chalk.gray('  • Check daemon status: claudeflow daemon status'));
    console.log(chalk.gray('  • View quota: claudeflow quota show'));
    console.log(chalk.gray('  • View analytics: claudeflow analytics show'));
    console.log(chalk.gray('  • Get help: claudeflow --help'));
    console.log(chalk.gray('\nFor more information, visit: https://docs.claudeflow.ai\n'));

    logger.info('Setup wizard completed successfully');
  } catch (error) {
    logger.error('Setup wizard failed', error);
    console.error(chalk.red('\n✗ Setup failed:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
