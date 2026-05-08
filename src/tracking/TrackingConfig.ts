/**
 * Tracking Configuration Manager
 *
 * Loads, validates, and provides access to usage tracking configuration.
 * Reads from ~/.claudeflow/config.json under the "tracking" key,
 * falls back to defaults when configuration is missing or invalid.
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  TrackingConfigSchema,
  TrackingConfig,
  DeepPartial,
  DEFAULT_TRACKING_CONFIG,
} from './TrackingConfig.types.js';

export class TrackingConfigManager {
  private config: TrackingConfig;
  private configPath: string;

  constructor(configPath?: string) {
    this.config = { ...DEFAULT_TRACKING_CONFIG };
    this.configPath = configPath || path.join(os.homedir(), '.claudeflow', 'config.json');
  }

  /**
   * Load configuration from file
   * Requirements: 20.1, 20.2
   */
  async load(): Promise<TrackingConfig> {
    try {
      // Check if config file exists
      const content = await fs.readFile(this.configPath, 'utf-8');
      const rawConfig = JSON.parse(content) as Record<string, unknown>;

      // Extract tracking section if it exists
      const trackingSection = (rawConfig.tracking as Record<string, unknown>) ?? {};

      // Validate and merge with defaults
      const validationResult = TrackingConfigSchema.safeParse(trackingSection);

      if (validationResult.success) {
        this.config = validationResult.data;
        console.log('✅ Tracking configuration loaded successfully');
      } else {
        console.warn(
          '⚠️ Invalid tracking configuration, using defaults:',
          validationResult.error.errors.map((e) => e.message).join(', ')
        );
        this.config = { ...DEFAULT_TRACKING_CONFIG };
      }
    } catch (error) {
      // Config file doesn't exist or is invalid — use defaults
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        console.log('No config file found, using default tracking configuration');
      } else {
        console.warn(
          '⚠️ Failed to load tracking configuration, using defaults:',
          error instanceof Error ? error.message : String(error)
        );
      }
      this.config = { ...DEFAULT_TRACKING_CONFIG };
    }

    // Resolve paths (expand ~ to home directory)
    this.config = this.resolvePaths(this.config);

    return this.config;
  }

  /**
   * Get current configuration
   */
  getConfig(): TrackingConfig {
    return { ...this.config };
  }

  /**
   * Resolve tilde paths to absolute paths
   * @private
   */
  private resolvePaths(config: TrackingConfig): TrackingConfig {
    const resolved = { ...config };

    resolved.usageTracking = {
      ...config.usageTracking,
      databasePath: this.resolvePath(config.usageTracking.databasePath),
    };

    resolved.auditLogging = {
      ...config.auditLogging,
      logDir: this.resolvePath(config.auditLogging.logDir),
    };

    return resolved;
  }

  /**
   * Resolve a path that may contain ~ (home directory)
   * @private
   */
  private resolvePath(filePath: string): string {
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return path.resolve(filePath);
  }

  /**
   * Update configuration with partial values
   */
  update(updates: DeepPartial<TrackingConfig>): TrackingConfig {
    const merged = {
      usageTracking: { ...this.config.usageTracking, ...(updates.usageTracking ?? {}) },
      realTimeUpdates: {
        ...this.config.realTimeUpdates,
        ...(updates.realTimeUpdates ?? {}),
      },
      quotaManagement: {
        ...this.config.quotaManagement,
        ...(updates.quotaManagement ?? {}),
      },
      auditLogging: { ...this.config.auditLogging, ...(updates.auditLogging ?? {}) },
    };

    const validationResult = TrackingConfigSchema.safeParse(merged);
    if (!validationResult.success) {
      throw new Error(
        `Invalid configuration: ${validationResult.error.errors.map((e) => e.message).join(', ')}`
      );
    }

    this.config = this.resolvePaths(validationResult.data);
    return { ...this.config };
  }

  /**
   * Save configuration to file
   */
  async save(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });

    // Read existing config to preserve non-tracking sections
    let existingConfig: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      existingConfig = JSON.parse(content) as Record<string, unknown>;
    } catch {
      // No existing config, start fresh
    }

    // Merge tracking config into existing config
    const mergedConfig = {
      ...existingConfig,
      tracking: this.config,
    };

    await fs.writeFile(this.configPath, JSON.stringify(mergedConfig, null, 2), 'utf-8');
    console.log(`✅ Tracking configuration saved to ${this.configPath}`);
  }

  /**
   * Get default configuration
   */
  static getDefaults(): TrackingConfig {
    return { ...DEFAULT_TRACKING_CONFIG };
  }
}
