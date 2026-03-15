import execa = require('execa');
import { NodeCheckResult } from '../types';

const REQUIRED_NODE_VERSION = '22.16.0';

export async function checkNodeVersion(): Promise<NodeCheckResult> {
  const currentVersion = process.version.replace('v', '');
  const semver = await import('semver');
  
  return {
    satisfied: semver.gte(currentVersion, REQUIRED_NODE_VERSION),
    installed: currentVersion,
    required: REQUIRED_NODE_VERSION,
  };
}

export async function isOpenClawInstalled(): Promise<boolean> {
  try {
    await execa('which', ['openclaw']);
    return true;
  } catch {
    return false;
  }
}

export async function getOpenClawVersion(): Promise<string> {
  try {
    const { stdout } = await execa('openclaw', ['--version']);
    const match = stdout.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function isGatewayRunning(): Promise<boolean> {
  try {
    const { stdout } = await execa('pgrep', ['-f', 'openclaw-gateway']);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function getGatewayPort(): Promise<number | null> {
  try {
    const { stdout } = await execa('ss', ['-tlnp']);
    const match = stdout.match(/:(\d+).*openclaw-gateway/);
    return match ? parseInt(match[1]) : null;
  } catch {
    return null;
  }
}

export async function getSystemInfo(): Promise<{
  platform: string;
  arch: string;
  nodeVersion: string;
  npmVersion: string;
}> {
  let npmVersion = 'unknown';
  try {
    const { stdout } = await execa('npm', ['--version']);
    npmVersion = stdout.trim();
  } catch {}

  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    npmVersion,
  };
}

export async function stopGateway(): Promise<boolean> {
  try {
    await execa('pkill', ['-f', 'openclaw-gateway']);
    return true;
  } catch {
    return false;
  }
}

export async function uninstallOpenClaw(purge: boolean = false): Promise<{ success: boolean; message: string }> {
  try {
    // 停止 Gateway
    await stopGateway();
    
    // 卸载 npm 包
    await execa('npm', ['uninstall', '-g', 'openclaw']);
    
    let message = 'OpenClaw uninstalled successfully';
    
    if (purge) {
      const openclawDir = getOpenClawDir();
      const fs = await import('fs-extra');
      await fs.remove(openclawDir);
      message += ' (including configuration and data)';
    }
    
    return { success: true, message };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

function getOpenClawDir(): string {
  const os = require('os');
  return require('path').join(os.homedir(), '.openclaw');
}
