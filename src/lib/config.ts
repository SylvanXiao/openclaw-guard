import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { OpenClawConfig } from '../types';

const OPENCLAW_DIR = '.openclaw';
const CONFIG_FILE = 'openclaw.json';

export function getOpenClawDir(): string {
  return path.join(os.homedir(), OPENCLAW_DIR);
}

export function getConfigPath(): string {
  return path.join(getOpenClawDir(), CONFIG_FILE);
}

export async function configExists(): Promise<boolean> {
  return fs.pathExists(getConfigPath());
}

export async function loadConfig(): Promise<OpenClawConfig | null> {
  const configPath = getConfigPath();
  if (!(await fs.pathExists(configPath))) {
    return null;
  }
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    // 支持 JSON5 格式（允许注释和尾随逗号）
    const jsonContent = content
      .replace(/\/\*[\s\S]*?\*\//g, '') // 移除块注释
      .replace(/\/\/.*$/gm, '') // 移除行注释
      .replace(/,\s*([}\]])/g, '$1'); // 移除尾随逗号
    return JSON.parse(jsonContent);
  } catch (error) {
    return null;
  }
}

export async function saveConfig(config: OpenClawConfig): Promise<void> {
  const configPath = getConfigPath();
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeJson(configPath, config, { spaces: 2 });
}

export async function backupConfig(): Promise<string> {
  const configPath = getConfigPath();
  const backupPath = `${configPath}.backup.${Date.now()}`;
  if (await fs.pathExists(configPath)) {
    await fs.copy(configPath, backupPath);
  }
  return backupPath;
}

export async function getWorkspacePath(agentId: string = 'main'): Promise<string> {
  const config = await loadConfig();
  const agent = config?.agents?.list?.find(a => a.id === agentId);
  if (agent?.workspace) {
    return agent.workspace.replace('~', os.homedir());
  }
  const defaultWorkspace = config?.agents?.defaults?.workspace;
  if (defaultWorkspace) {
    return defaultWorkspace.replace('~', os.homedir());
  }
  return path.join(getOpenClawDir(), 'workspace');
}

export async function getAgentDir(agentId: string): Promise<string> {
  const config = await loadConfig();
  const agent = config?.agents?.list?.find(a => a.id === agentId);
  if (agent?.agentDir) {
    return agent.agentDir.replace('~', os.homedir());
  }
  return path.join(getOpenClawDir(), 'agents', agentId, 'agent');
}
