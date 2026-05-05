/**
 * Certificate Manager
 *
 * Manages SSL/TLS certificates for MITM proxy
 * - Generate self-signed CA certificate
 * - Install/uninstall CA to system trust store
 * - Generate server certificates signed by CA
 * - OS-specific (macOS/Linux/Windows)
 */

import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export interface CertificateInfo {
  caKeyPath: string;
  caCertPath: string;
  serverKeyPath: string;
  serverCertPath: string;
}

export class CertificateManager {
  private readonly certDir: string;
  private readonly caKeyPath: string;
  private readonly caCertPath: string;
  private readonly serverKeyPath: string;
  private readonly serverCertPath: string;

  constructor() {
    this.certDir = path.join(os.homedir(), '.claudeflow', 'certs');
    this.caKeyPath = path.join(this.certDir, 'ca-key.pem');
    this.caCertPath = path.join(this.certDir, 'ca-cert.pem');
    this.serverKeyPath = path.join(this.certDir, 'server-key.pem');
    this.serverCertPath = path.join(this.certDir, 'server-cert.pem');
  }

  /**
   * Check if certificates exist
   */
  async certificatesExist(): Promise<boolean> {
    try {
      await fs.access(this.caKeyPath);
      await fs.access(this.caCertPath);
      await fs.access(this.serverKeyPath);
      await fs.access(this.serverCertPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if CA is installed in system trust store
   */
  async isCAInstalled(): Promise<boolean> {
    try {
      const platform = os.platform();

      if (platform === 'darwin') {
        // macOS - check Keychain
        const { stdout } = await execAsync(
          `security find-certificate -c "ClaudeFlow MITM CA" -Z /Library/Keychains/System.keychain`
        );
        return stdout.includes('ClaudeFlow MITM CA');
      } else if (platform === 'linux') {
        // Linux - check ca-certificates
        const certPath = '/usr/local/share/ca-certificates/claudeflow-mitm-ca.crt';
        try {
          await fs.access(certPath);
          return true;
        } catch {
          return false;
        }
      } else if (platform === 'win32') {
        // Windows - check certificate store
        const { stdout } = await execAsync(
          'certutil -store Root "ClaudeFlow MITM CA"'
        );
        return stdout.includes('ClaudeFlow MITM CA');
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Generate CA certificate and server certificate
   */
  async generateCertificates(): Promise<CertificateInfo> {
    // Ensure cert directory exists
    await fs.mkdir(this.certDir, { recursive: true });

    // Generate CA certificate
    await this.generateCACertificate();

    // Generate server certificate
    await this.generateServerCertificate();

    return {
      caKeyPath: this.caKeyPath,
      caCertPath: this.caCertPath,
      serverKeyPath: this.serverKeyPath,
      serverCertPath: this.serverCertPath,
    };
  }

  /**
   * Generate CA certificate using OpenSSL
   */
  private async generateCACertificate(): Promise<void> {
    // Generate CA private key
    await execAsync(
      `openssl genrsa -out "${this.caKeyPath}" 2048`
    );

    // Generate CA certificate
    const subject = '/C=US/ST=California/L=San Francisco/O=ClaudeFlow/CN=ClaudeFlow MITM CA';
    await execAsync(
      `openssl req -new -x509 -days 3650 -key "${this.caKeyPath}" -out "${this.caCertPath}" -subj "${subject}"`
    );
  }

  /**
   * Generate server certificate signed by CA
   */
  private async generateServerCertificate(): Promise<void> {
    // Generate server private key
    await execAsync(
      `openssl genrsa -out "${this.serverKeyPath}" 2048`
    );

    // Create config file for SAN (Subject Alternative Names)
    const configPath = path.join(this.certDir, 'server.cnf');
    const configContent = `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C=US
ST=California
L=San Francisco
O=ClaudeFlow
CN=*.amazonaws.com

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = q.us-east-1.amazonaws.com
DNS.2 = q.us-west-2.amazonaws.com
DNS.3 = q.eu-west-1.amazonaws.com
DNS.4 = q.ap-southeast-1.amazonaws.com
DNS.5 = *.amazonaws.com
DNS.6 = localhost
IP.1 = 127.0.0.1
`;
    await fs.writeFile(configPath, configContent, 'utf8');

    // Generate CSR (Certificate Signing Request)
    const csrPath = path.join(this.certDir, 'server.csr');
    await execAsync(
      `openssl req -new -key "${this.serverKeyPath}" -out "${csrPath}" -config "${configPath}"`
    );

    // Sign server certificate with CA
    await execAsync(
      `openssl x509 -req -days 3650 -in "${csrPath}" -CA "${this.caCertPath}" -CAkey "${this.caKeyPath}" -CAcreateserial -out "${this.serverCertPath}" -extensions v3_req -extfile "${configPath}"`
    );

    // Clean up temporary files
    await fs.unlink(csrPath);
    await fs.unlink(configPath);
  }

  /**
   * Install CA certificate to system trust store
   */
  async installCA(): Promise<void> {
    const platform = os.platform();

    if (platform === 'darwin') {
      await this.installCAMacOS();
    } else if (platform === 'linux') {
      await this.installCALinux();
    } else if (platform === 'win32') {
      await this.installCAWindows();
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Install CA on macOS
   */
  private async installCAMacOS(): Promise<void> {
    // Add to System keychain
    await execAsync(
      `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${this.caCertPath}"`
    );
  }

  /**
   * Install CA on Linux
   */
  private async installCALinux(): Promise<void> {
    // Copy to ca-certificates directory
    const destPath = '/usr/local/share/ca-certificates/claudeflow-mitm-ca.crt';
    await execAsync(`sudo cp "${this.caCertPath}" "${destPath}"`);

    // Update ca-certificates
    await execAsync('sudo update-ca-certificates');
  }

  /**
   * Install CA on Windows
   */
  private async installCAWindows(): Promise<void> {
    // Import to Root certificate store
    await execAsync(
      `certutil -addstore -f "Root" "${this.caCertPath}"`
    );
  }

  /**
   * Uninstall CA certificate from system trust store
   */
  async uninstallCA(): Promise<void> {
    const platform = os.platform();

    if (platform === 'darwin') {
      await this.uninstallCAMacOS();
    } else if (platform === 'linux') {
      await this.uninstallCALinux();
    } else if (platform === 'win32') {
      await this.uninstallCAWindows();
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Uninstall CA on macOS
   */
  private async uninstallCAMacOS(): Promise<void> {
    try {
      // Find certificate SHA-1 hash
      const { stdout } = await execAsync(
        `security find-certificate -c "ClaudeFlow MITM CA" -Z /Library/Keychains/System.keychain | grep "SHA-1" | awk '{print $3}'`
      );
      const hash = stdout.trim();

      if (hash) {
        // Delete certificate by hash
        await execAsync(
          `sudo security delete-certificate -Z ${hash} /Library/Keychains/System.keychain`
        );
      }
    } catch (error) {
      // Certificate might not be installed
      console.warn('Warning: CA certificate not found in system keychain');
    }
  }

  /**
   * Uninstall CA on Linux
   */
  private async uninstallCALinux(): Promise<void> {
    try {
      const destPath = '/usr/local/share/ca-certificates/claudeflow-mitm-ca.crt';
      await execAsync(`sudo rm -f "${destPath}"`);
      await execAsync('sudo update-ca-certificates --fresh');
    } catch (error) {
      console.warn('Warning: Failed to remove CA certificate from system');
    }
  }

  /**
   * Uninstall CA on Windows
   */
  private async uninstallCAWindows(): Promise<void> {
    try {
      await execAsync(
        `certutil -delstore "Root" "ClaudeFlow MITM CA"`
      );
    } catch (error) {
      console.warn('Warning: CA certificate not found in certificate store');
    }
  }

  /**
   * Remove all certificate files
   */
  async removeCertificates(): Promise<void> {
    try {
      await fs.rm(this.certDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Warning: Failed to remove certificate directory');
    }
  }

  /**
   * Get certificate info
   */
  getCertificateInfo(): CertificateInfo {
    return {
      caKeyPath: this.caKeyPath,
      caCertPath: this.caCertPath,
      serverKeyPath: this.serverKeyPath,
      serverCertPath: this.serverCertPath,
    };
  }

  /**
   * Verify OpenSSL is available
   */
  async verifyOpenSSL(): Promise<boolean> {
    try {
      await execAsync('openssl version');
      return true;
    } catch {
      return false;
    }
  }
}
