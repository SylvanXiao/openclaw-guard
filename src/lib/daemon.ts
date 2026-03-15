import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';

const DAEMON_DIR = path.join(os.homedir(), '.openclaw-guard');
const PID_FILE = path.join(DAEMON_DIR, 'monitor.pid');
const CONFIG_FILE = path.join(DAEMON_DIR, 'daemon-config.json');
const LOG_FILE = path.join(DAEMON_DIR, 'daemon.log');

export interface DaemonConfig {
  level: string;
  network: boolean;
  devices: boolean;
  ports: string[];
  webhook?: string;
  dingtalk?: string;
  wecom?: string;
  feishu?: string;
  includeAuthorized: boolean;
  rules?: string[];
}

export class DaemonManager {
  async ensureDir(): Promise<void> {
    await fs.ensureDir(DAEMON_DIR);
  }

  async isRunning(): Promise<boolean> {
    if (!(await fs.pathExists(PID_FILE))) {
      return false;
    }

    try {
      const pid = parseInt(await fs.readFile(PID_FILE, 'utf-8'), 10);
      // 检查进程是否存在
      process.kill(pid, 0);
      
      // 检查是否是我们的监控进程
      const config = await this.loadConfig();
      if (!config) {
        return false;
      }
      
      return true;
    } catch {
      // 进程不存在，清理 PID 文件
      await fs.remove(PID_FILE);
      return false;
    }
  }

  async getPid(): Promise<number | null> {
    if (!(await fs.pathExists(PID_FILE))) {
      return null;
    }

    try {
      const pid = parseInt(await fs.readFile(PID_FILE, 'utf-8'), 10);
      process.kill(pid, 0);
      return pid;
    } catch {
      await fs.remove(PID_FILE);
      return null;
    }
  }

  async saveConfig(config: DaemonConfig): Promise<void> {
    await this.ensureDir();
    await fs.writeJson(CONFIG_FILE, config, { spaces: 2 });
  }

  async loadConfig(): Promise<DaemonConfig | null> {
    if (!(await fs.pathExists(CONFIG_FILE))) {
      return null;
    }
    return await fs.readJson(CONFIG_FILE);
  }

  async start(config: DaemonConfig): Promise<{ success: boolean; pid?: number; error?: string }> {
    if (await this.isRunning()) {
      const pid = await this.getPid();
      return { success: false, error: `Monitor already running (PID: ${pid})` };
    }

    await this.ensureDir();

    // 保存配置
    await this.saveConfig(config);

    // 启动后台进程
    const args = [
      'dist/index.js',
      'monitor',
      'start',
      '--no-terminal',
      '--level', config.level,
    ];

    if (config.network) {
      args.push('--network');
    }

    if (config.devices) {
      args.push('--devices');
    }

    if (config.ports && config.ports.length > 0) {
      args.push('--ports', ...config.ports);
    }

    if (config.webhook) {
      args.push('--webhook', config.webhook);
    }

    if (config.dingtalk) {
      args.push('--dingtalk', config.dingtalk);
    }

    if (config.wecom) {
      args.push('--wecom', config.wecom);
    }

    if (config.feishu) {
      args.push('--feishu', config.feishu);
    }

    if (config.includeAuthorized) {
      args.push('--include-authorized');
    }

    if (config.rules && config.rules.length > 0) {
      args.push('--rules', ...config.rules);
    }

    // 使用 nohup 启动后台进程
    const logStream = await fs.open(LOG_FILE, 'a');
    
    // __dirname 在编译后是 dist/lib，所以需要往上两级到项目根目录
    const projectRoot = path.join(__dirname, '..', '..');
    
    const child = spawn('node', args, {
      cwd: projectRoot,
      detached: true,
      stdio: ['ignore', logStream, logStream],
    });

    child.unref();

    // 等待一下确保进程启动
    await new Promise(resolve => setTimeout(resolve, 500));

    // 检查进程是否真的启动了
    try {
      process.kill(child.pid!, 0);
      await fs.writeFile(PID_FILE, child.pid!.toString());
      return { success: true, pid: child.pid };
    } catch {
      return { success: false, error: 'Failed to start daemon' };
    }
  }

  async stop(): Promise<{ success: boolean; message: string }> {
    const pid = await this.getPid();

    if (!pid) {
      return { success: true, message: 'Monitor is not running' };
    }

    try {
      // 发送 SIGTERM
      process.kill(pid, 'SIGTERM');

      // 等待进程退出
      let attempts = 0;
      while (attempts < 10) {
        try {
          process.kill(pid, 0);
          await new Promise(resolve => setTimeout(resolve, 200));
          attempts++;
        } catch {
          break;
        }
      }

      // 如果进程还在，强制 kill
      try {
        process.kill(pid, 0);
        process.kill(pid, 'SIGKILL');
      } catch {
        // 进程已退出
      }

      await fs.remove(PID_FILE);
      return { success: true, message: `Monitor stopped (PID: ${pid})` };
    } catch (error) {
      await fs.remove(PID_FILE);
      return { success: false, message: `Failed to stop monitor: ${error}` };
    }
  }

  async restart(config?: DaemonConfig): Promise<{ success: boolean; pid?: number; message: string }> {
    const currentConfig = config || await this.loadConfig() || undefined;
    
    if (!currentConfig) {
      return { success: false, message: 'No saved config found. Please start with options.' };
    }

    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 500));

    const result = await this.start(currentConfig);
    
    if (result.success) {
      return { success: true, pid: result.pid, message: `Monitor restarted (PID: ${result.pid})` };
    } else {
      return { success: false, message: result.error || 'Failed to restart' };
    }
  }

  async status(): Promise<{
    running: boolean;
    pid?: number;
    config?: DaemonConfig;
    uptime?: string;
  }> {
    const pid = await this.getPid();
    const config = await this.loadConfig() || undefined;

    if (!pid) {
      return { running: false, config };
    }

    // 获取进程运行时间
    let uptime: string | undefined;
    try {
      const { default: execa } = await import('execa');
      const result = await execa('ps', ['-p', pid.toString(), '-o', 'etime=']);
      uptime = result.stdout.trim();
    } catch {
      // 无法获取运行时间
    }

    return { running: true, pid, config, uptime };
  }

  getLogPath(): string {
    return LOG_FILE;
  }

  getPidPath(): string {
    return PID_FILE;
  }

  getConfigPath(): string {
    return CONFIG_FILE;
  }
}
