/**
 * ConfigService
 * 
 * Manages CLI configuration in ~/.claudeflow/
 */

import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';
import type {
  CLIConfig,
  KiroAccountConfig,
  KiroComboConfig,
  ValidationResult,
} from '../types/cli.types.js';

/**
 * Configuration Schema for validation
 */
const KiroAccountConfigSchema = z.object({
  id: z.string(),
  machineId: z.string(),
  apiKey: z.string(),
  sessionToken: z.string().optional(),
  sessionExpiry: z.number().optional(),
  mitmRouterUrl: z.string().url(),
  lastUsed: z.number().optional(),
  requestCount: z.number().optional(),
});

const KiroComboConfigSchema = z.object({
  name: z.string(),
  accounts: z.array(z.string()),
  strategy: z.enum(['round-robin', 'sticky-round-robin']),
  currentIndex: z.number(),
});

const InfrastructureConfigSchema = z.object({
  qdrantUrl: z.string().url(),
  redisUrl: z.string(),
  voyageApiKey: z.string(),
  mitmRouterUrl: z.string().url(),
});

const DaemonConfigSchema = z.object({
  port: z.number().min(1024).max(65535),
  host: z.string(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
  autoRestart: z.boolean(),
});

const PreferencesConfigSchema = z.object({
  colorOutput: z.boolean(),
  progressBars: z.boolean(),
  autoUpdate: z.boolean(),
});

const CLIConfigSchema = z.object({
  version: z.string(),
  activeProfile: z.string(),
  accounts: z.array(KiroAccountConfigSchema),
  combos: z.array(KiroComboConfigSchema),
  infrastructure: InfrastructureConfigSchema,
  daemon: DaemonConfigSchema,
  preferences: PreferencesConfigSchema,
});

/**
 * Default Configuration
 */
const DEFAULT_CONFIG: CLIConfig = {
  version: '0.1.0',
  activeProfile: 'default',
  accounts: [],
  combos: [],
  infrastructure: {
    qdrantUrl: 'http://localhost:6333',
    redisUrl: 'redis://localhost:6379',
    voyageApiKey: '',
    mitmRouterUrl: 'http://3.68.219.151:20128',
  },
  daemon: {
    port: 3000,
    host: 'localhost',
    logLevel: 'info',
    autoRestart: true,
  },
  preferences: {
    colorOutput: true,
    progressBars: true,
    autoUpdate: false,
  },
};

/**
 * ConfigService
 * 
 * Manages CLI configuration with profile support
 */
export class ConfigService {
  private configDir: string;
  private configPath: string;
  private profilesDir: string;
  private config: CLIConfig | null = null;

  constructor(configDir?: string) {
    this.configDir = configDir || join(homedir(), '.claudeflow');
    this.configPath = join(this.configDir, 'config.json');
    this.profilesDir = join(this.configDir, 'profiles');
  }

  /**
   * Initialize configuration directory structure
   */
  async initialize(): Promise<void> {
    // Create main config directory
    if (!existsSync(this.configDir)) {
      await mkdir(this.configDir, { recursive: true, mode: 0o700 });
    }

    // Create subdirectories
    const subdirs = ['logs', 'profiles', 'backups'];
    for (const subdir of subdirs) {
      const dirPath = join(this.configDir, subdir);
      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true, mode: 0o700 });
      }
    }

    // Create default config if it doesn't exist
    if (!existsSync(this.configPath)) {
      await this.save(DEFAULT_CONFIG);
    }
  }

  /**
   * Load configuration from file
   */
  async load(): Promise<CLIConfig> {
    // Initialize if needed
    await this.initialize();

    try {
      const content = await readFile(this.configPath, 'utf-8');
      const data = JSON.parse(content);

      // Validate configuration
      const validationResult = this.validate(data);
      if (!validationResult.valid) {
        throw new Error(`Invalid configuration: ${validationResult.errors.join(', ')}`);
      }

      this.config = data as CLIConfig;
      return this.config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Config doesn't exist, return default
        this.config = DEFAULT_CONFIG;
        await this.save(this.config);
        return this.config;
      }
      throw error;
    }
  }

  /**
   * Save configuration to file
   */
  async save(config: CLIConfig): Promise<void> {
    // Validate before saving
    const validationResult = this.validate(config);
    if (!validationResult.valid) {
      throw new Error(`Invalid configuration: ${validationResult.errors.join(', ')}`);
    }

    // Ensure directory exists
    await this.initialize();

    // Write config file with proper permissions
    await writeFile(this.configPath, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });

    this.config = config;
  }

  /**
   * Update configuration with partial updates
   */
  async update(updates: Partial<CLIConfig>): Promise<void> {
    const currentConfig = await this.load();
    const updatedConfig = this.mergeConfig(currentConfig, updates);
    await this.save(updatedConfig);
  }

  /**
   * Reset configuration to defaults
   */
  async reset(): Promise<void> {
    await this.save(DEFAULT_CONFIG);
  }

  /**
   * Get current configuration
   */
  async getConfig(): Promise<CLIConfig> {
    if (!this.config) {
      return await this.load();
    }
    return this.config;
  }

  /**
   * Load profile by name
   */
  async loadProfile(name: string): Promise<CLIConfig> {
    const profilePath = join(this.profilesDir, `${name}.json`);

    if (!existsSync(profilePath)) {
      throw new Error(`Profile '${name}' does not exist`);
    }

    const content = await readFile(profilePath, 'utf-8');
    const data = JSON.parse(content);

    // Validate profile
    const validationResult = this.validate(data);
    if (!validationResult.valid) {
      throw new Error(`Invalid profile: ${validationResult.errors.join(', ')}`);
    }

    return data as CLIConfig;
  }

  /**
   * Save profile
   */
  async saveProfile(name: string, config: CLIConfig): Promise<void> {
    // Validate before saving
    const validationResult = this.validate(config);
    if (!validationResult.valid) {
      throw new Error(`Invalid configuration: ${validationResult.errors.join(', ')}`);
    }

    // Ensure profiles directory exists
    if (!existsSync(this.profilesDir)) {
      await mkdir(this.profilesDir, { recursive: true, mode: 0o700 });
    }

    const profilePath = join(this.profilesDir, `${name}.json`);
    await writeFile(profilePath, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
  }

  /**
   * List all profiles
   */
  async listProfiles(): Promise<string[]> {
    if (!existsSync(this.profilesDir)) {
      return [];
    }

    const files = await readdir(this.profilesDir);
    return files
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace('.json', ''));
  }

  /**
   * Switch to a different profile
   */
  async switchProfile(name: string): Promise<void> {
    // Load the profile to verify it exists and is valid
    const profileConfig = await this.loadProfile(name);

    // Update active profile
    profileConfig.activeProfile = name;

    // Save as main config
    await this.save(profileConfig);
  }

  /**
   * Delete a profile
   */
  async deleteProfile(name: string): Promise<void> {
    const currentConfig = await this.getConfig();

    // Prevent deleting active profile
    if (currentConfig.activeProfile === name) {
      throw new Error('Cannot delete active profile. Switch to another profile first.');
    }

    const profilePath = join(this.profilesDir, `${name}.json`);

    if (!existsSync(profilePath)) {
      throw new Error(`Profile '${name}' does not exist`);
    }

    const { unlink } = await import('fs/promises');
    await unlink(profilePath);
  }

  /**
   * Add account to configuration
   */
  async addAccount(account: KiroAccountConfig): Promise<void> {
    const config = await this.getConfig();

    // Check if account ID already exists
    if (config.accounts.some((a) => a.id === account.id)) {
      throw new Error(`Account with ID '${account.id}' already exists`);
    }

    config.accounts.push(account);
    await this.save(config);
  }

  /**
   * Remove account from configuration
   */
  async removeAccount(accountId: string): Promise<void> {
    const config = await this.getConfig();

    const accountIndex = config.accounts.findIndex((a) => a.id === accountId);
    if (accountIndex === -1) {
      throw new Error(`Account '${accountId}' not found`);
    }

    config.accounts.splice(accountIndex, 1);

    // Remove account from combos
    config.combos.forEach((combo) => {
      combo.accounts = combo.accounts.filter((id) => id !== accountId);
    });

    await this.save(config);
  }

  /**
   * Update account in configuration
   */
  async updateAccount(accountId: string, updates: Partial<KiroAccountConfig>): Promise<void> {
    const config = await this.getConfig();

    const account = config.accounts.find((a) => a.id === accountId);
    if (!account) {
      throw new Error(`Account '${accountId}' not found`);
    }

    Object.assign(account, updates);
    await this.save(config);
  }

  /**
   * Get account by ID
   */
  async getAccount(accountId: string): Promise<KiroAccountConfig | undefined> {
    const config = await this.getConfig();
    return config.accounts.find((a) => a.id === accountId);
  }

  /**
   * Add combo to configuration
   */
  async addCombo(combo: KiroComboConfig): Promise<void> {
    const config = await this.getConfig();

    // Check if combo name already exists
    if (config.combos.some((c) => c.name === combo.name)) {
      throw new Error(`Combo with name '${combo.name}' already exists`);
    }

    // Verify all accounts exist
    for (const accountId of combo.accounts) {
      if (!config.accounts.some((a) => a.id === accountId)) {
        throw new Error(`Account '${accountId}' not found`);
      }
    }

    config.combos.push(combo);
    await this.save(config);
  }

  /**
   * Remove combo from configuration
   */
  async removeCombo(comboName: string): Promise<void> {
    const config = await this.getConfig();

    const comboIndex = config.combos.findIndex((c) => c.name === comboName);
    if (comboIndex === -1) {
      throw new Error(`Combo '${comboName}' not found`);
    }

    config.combos.splice(comboIndex, 1);
    await this.save(config);
  }

  /**
   * Update combo in configuration
   */
  async updateCombo(comboName: string, updates: Partial<KiroComboConfig>): Promise<void> {
    const config = await this.getConfig();

    const combo = config.combos.find((c) => c.name === comboName);
    if (!combo) {
      throw new Error(`Combo '${comboName}' not found`);
    }

    // If updating accounts, verify they exist
    if (updates.accounts) {
      for (const accountId of updates.accounts) {
        if (!config.accounts.some((a) => a.id === accountId)) {
          throw new Error(`Account '${accountId}' not found`);
        }
      }
    }

    Object.assign(combo, updates);
    await this.save(config);
  }

  /**
   * Get combo by name
   */
  async getCombo(comboName: string): Promise<KiroComboConfig | undefined> {
    const config = await this.getConfig();
    return config.combos.find((c) => c.name === comboName);
  }

  /**
   * Validate configuration
   */
  private validate(config: unknown): ValidationResult {
    try {
      CLIConfigSchema.parse(config);
      return { valid: true, errors: [] };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          valid: false,
          errors: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
        };
      }
      return {
        valid: false,
        errors: ['Unknown validation error'],
      };
    }
  }

  /**
   * Merge configuration objects
   */
  private mergeConfig(base: CLIConfig, updates: Partial<CLIConfig>): CLIConfig {
    return {
      version: updates.version ?? base.version,
      activeProfile: updates.activeProfile ?? base.activeProfile,
      accounts: updates.accounts ?? base.accounts,
      combos: updates.combos ?? base.combos,
      infrastructure: {
        ...base.infrastructure,
        ...(updates.infrastructure ?? {}),
      },
      daemon: {
        ...base.daemon,
        ...(updates.daemon ?? {}),
      },
      preferences: {
        ...base.preferences,
        ...(updates.preferences ?? {}),
      },
    };
  }

  /**
   * Get configuration directory path
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * Get configuration file path
   */
  getConfigPath(): string {
    return this.configPath;
  }
}
