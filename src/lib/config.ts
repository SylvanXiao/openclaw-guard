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
    // 需要正确处理字符串中的 // 而不会误删
    
    // 1. 移除块注释 /* ... */
    let jsonContent = content.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // 2. 移除行注释 // ... （但要避免误删字符串中的 //）
    // 通过状态机来区分字符串内外的 //
    let inString = false;
    let stringChar = '';
    let result = '';
    
    for (let i = 0; i < jsonContent.length; i++) {
      const char = jsonContent[i];
      const nextChar = jsonContent[i + 1];
      
      if (!inString) {
        // 不在字符串中
        if (char === '"' || char === "'") {
          // 进入字符串
          inString = true;
          stringChar = char;
          result += char;
        } else if (char === '/' && nextChar === '/') {
          // 找到行注释，跳过直到行尾
          while (i < jsonContent.length && jsonContent[i] !== '\n') {
            i++;
          }
          // 保留换行符
          if (i < jsonContent.length) {
            result += jsonContent[i];
          }
        } else {
          result += char;
        }
      } else {
        // 在字符串中
        if (char === stringChar) {
          // 检查是否是转义的引号
          if (jsonContent[i - 1] !== '\\') {
            inString = false;
          }
        }
        result += char;
      }
    }
    
    jsonContent = result;
    
    // 3. 移除尾随逗号
    jsonContent = jsonContent.replace(/,\s*([}\]])/g, '$1');
    
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
