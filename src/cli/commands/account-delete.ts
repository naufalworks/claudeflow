/**
 * Account Delete Command
 * 
 * Interactive account deletion with inquirer
 */

import inquirer from 'inquirer';
import { ConfigurationManager } from '../../config/manager.js';
import { KeychainStore } from '../../auth/KeychainStore.js';
import type { KiroOAuthAccount } from '../../config/schema.js';

export async function accountDeleteCommand(): Promise<void> {
  console.log('\n🗑️  Delete Kiro Account\n');

  const configManager = new ConfigurationManager();
  const keychainStore = new KeychainStore();

  // Load config
  const configPath = process.env.CLAUDEFLOW_CONFIG || `${process.env.HOME}/.claudeflow/config.json`;
  await configManager.loadConfig(configPath);

  const config = configManager.getConfig();
  const kiroAccounts = config.accounts.filter(
    a => a.provider === 'kiro-oauth'
  ) as KiroOAuthAccount[];

  if (kiroAccounts.length === 0) {
    console.log('No accounts found.\n');
    return;
  }

  // Create choices
  const choices = kiroAccounts.map(account => ({
    name: `${account.id} (${account.region})`,
    value: account.id,
  }));

  choices.push({
    name: '← Cancel',
    value: 'cancel',
  });

  const { accountId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'accountId',
      message: 'Select account to delete:',
      choices,
    },
  ]);

  if (accountId === 'cancel') {
    console.log('\nCancelled.\n');
    return;
  }

  // Confirm deletion
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete ${accountId}?`,
      default: false,
    },
  ]);

  if (!confirm) {
    console.log('\nDeletion cancelled.\n');
    return;
  }

  // Delete from keychain
  try {
    await keychainStore.delete(accountId);
    console.log(`✓ Deleted credentials from keychain`);
  } catch (error) {
    console.log(`⚠ Could not delete from keychain: ${error}`);
  }

  // Delete from config
  const updatedAccounts = config.accounts.filter(a => a.id !== accountId);
  config.accounts = updatedAccounts;

  await configManager.saveConfig(config);

  console.log(`✓ Deleted ${accountId} from config\n`);
}
