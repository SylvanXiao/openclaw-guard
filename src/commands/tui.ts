import { Command } from 'commander';
import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import os from 'os';
import fs from 'fs-extra';
import path from 'path';
import execa = require('execa');
import { isOpenClawInstalled, getOpenClawVersion, isGatewayRunning, checkNodeVersion } from '../lib/system';
import { configExists, loadConfig, getOpenClawDir } from '../lib/config';

export function registerTuiCommand(program: Command) {
  program
    .command('tui')
    .description('Launch interactive terminal UI dashboard')
    .action(async () => {
      const dashboard = new Dashboard();
      await dashboard.start();
    });
}

class Dashboard {
  private screen!: blessed.Widgets.Screen;
  private grid!: any;
  private logBox!: blessed.Widgets.Log;
  private statusBox!: blessed.Widgets.BoxElement;
  private agentsBox!: blessed.Widgets.ListElement;
  private alertsBox!: blessed.Widgets.ListElement;
  private gauge!: any;
  private donut!: any;
  private table!: any;
  private running: boolean = true;
  private refreshInterval: NodeJS.Timeout | null = null;
  private lastCpuInfo: { idle: number; total: number } | null = null;

  async start(): Promise<void> {
    // 检查终端尺寸
    const width = process.stdout.columns || 80;
    const height = process.stdout.rows || 24;
    
    if (width < 80 || height < 24) {
      console.log('\x1b[31mError: Terminal too small\x1b[0m');
      console.log(`Current: ${width}x${height}, Minimum required: 80x24`);
      console.log('Please resize your terminal window');
      process.exit(1);
    }

    // 确保宽度是偶数 (blessed-contrib 要求)
    const adjustedWidth = width % 2 === 0 ? width : width - 1;

    // 创建屏幕
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'OpenClaw Guard Dashboard',
      width: adjustedWidth,
    });

    // 创建网格布局
    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    // 标题栏
    this.statusBox = this.grid.set(0, 0, 2, 12, blessed.box, {
      label: ' OpenClaw Guard ',
      content: 'Loading...',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
      },
    });

    // Gateway 状态
    this.gauge = this.grid.set(2, 0, 3, 4, blessed.box, {
      label: ' Gateway Status ',
      content: 'Checking...',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
      },
    });

    // 系统资源
    this.donut = this.grid.set(2, 4, 3, 4, blessed.box, {
      label: ' System Resources ',
      content: 'CPU: --\nMEM: --',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
      },
    });

    // 智能体列表
    this.agentsBox = this.grid.set(2, 8, 4, 4, blessed.list, {
      label: ' Agents ',
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      style: {
        selected: { bg: 'blue' },
        border: { fg: 'cyan' },
        item: { fg: 'white' },
      },
    });

    // 诊断表格
    this.table = this.grid.set(6, 0, 4, 8, contrib.table, {
      label: 'Diagnostics',
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      interactive: true,
      columnSpacing: 2,
      columnWidth: [20, 10, 40],
    });

    // 警报日志
    this.alertsBox = this.grid.set(10, 0, 2, 6, blessed.list, {
      label: ' Recent Alerts ',
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      style: {
        border: { fg: 'yellow' },
        item: { fg: 'white' },
      },
    });

    // 操作日志
    this.logBox = this.grid.set(10, 6, 2, 6, blessed.log, {
      label: ' Activity Log ',
      fg: 'green',
      selectedFg: 'green',
      tags: true,
      border: { type: 'line', fg: 'cyan' },
    });

    // 键盘事件
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.stop();
    });

    this.screen.key(['r'], () => {
      this.logBox.log('Refreshing...');
      this.refresh();
    });

    // 渲染
    this.screen.render();

    // 初始加载
    await this.refresh();

    // 定时刷新 (每 3 秒)
    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, 3000);
  }

  private async refresh(): Promise<void> {
    try {
      await Promise.all([
        this.refreshStatus(),
        this.refreshGateway(),
        this.refreshResources(),
        this.refreshAgents(),
        this.refreshDiagnostics(),
        this.refreshAlerts(),
      ]);
    } catch (error) {
      this.logBox.log(`Error: ${error}`);
    }
    this.screen.render();
  }

  private async refreshStatus(): Promise<void> {
    const installed = await isOpenClawInstalled();
    const version = await getOpenClawVersion();
    const nodeCheck = await checkNodeVersion();

    const openclawStatus = installed ? `v${version} (OK)` : 'Not Installed';
    const nodeStatus = nodeCheck.satisfied 
      ? `${nodeCheck.installed} (OK)` 
      : `${nodeCheck.installed} (need >= ${nodeCheck.required})`;

    const uptime = os.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const status = [
      `OpenClaw: ${openclawStatus}`,
      `Node.js:  ${nodeStatus}`,
      `Host:     ${os.hostname()}`,
      `Platform: ${os.type()} ${os.release()}`,
      `Uptime:   ${hours}h ${minutes}m`,
    ].join('\n');

    this.statusBox.setContent(status);
  }

  private async refreshGateway(): Promise<void> {
    const running = await isGatewayRunning();
    const statusText = running 
      ? 'Status: ONLINE\n\nGateway running on port 18789'
      : 'Status: OFFLINE\n\nGateway not running\nRun: openclaw gateway';
    this.gauge.setContent(statusText);
  }

  private async refreshResources(): Promise<void> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);

    // 计算 CPU 使用率（需要两次采样）
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += (cpu.times as any)[type];
      }
      totalIdle += cpu.times.idle;
    }

    let cpuPercent = 0;
    if (this.lastCpuInfo) {
      const idleDiff = totalIdle - this.lastCpuInfo.idle;
      const totalDiff = totalTick - this.lastCpuInfo.total;
      if (totalDiff > 0) {
        cpuPercent = Math.round(100 * (1 - idleDiff / totalDiff));
      }
    }
    this.lastCpuInfo = { idle: totalIdle, total: totalTick };

    const cpuBar = this.createBar(cpuPercent);
    const memBar = this.createBar(memPercent);

    this.donut.setContent(
      `CPU: ${cpuPercent}%\n[${cpuBar}]\n\nMEM: ${memPercent}%\n[${memBar}]`
    );
  }

  private createBar(percent: number): string {
    const filled = Math.floor(percent / 10);
    const empty = 10 - filled;
    return '#'.repeat(filled) + '-'.repeat(empty);
  }

  private async refreshAgents(): Promise<void> {
    const hasConfig = await configExists();
    const items: string[] = [];

    if (hasConfig) {
      const config = await loadConfig();
      const agents = config?.agents?.list || [];
      
      for (const agent of agents) {
        const isDefault = agent.default ? ' [default]' : '';
        items.push(`${agent.id}${isDefault}`);
      }
    }

    if (items.length === 0) {
      items.push('No agents configured');
    }

    this.agentsBox.setItems(items);
  }

  private async refreshDiagnostics(): Promise<void> {
    const data: string[][] = [];
    const hasConfig = await configExists();

    // 配置检查
    data.push(['Config File', hasConfig ? 'OK' : 'Missing', 
      hasConfig ? '~/.openclaw/openclaw.json' : 'Run: openclaw-guard config init']);

    // Gateway 检查
    const gatewayRunning = await isGatewayRunning();
    data.push(['Gateway', gatewayRunning ? 'Running' : 'Stopped',
      gatewayRunning ? 'Port 18789' : 'Run: openclaw gateway']);

    // 目录检查
    const openclawDir = getOpenClawDir();
    const dirs = ['logs', 'workspace', 'plugins', 'devices'];
    for (const dir of dirs) {
      const exists = await fs.pathExists(path.join(openclawDir, dir));
      data.push([`Dir: ${dir}`, exists ? 'OK' : 'Missing', '']);
    }

    this.table.setData({
      headers: ['Check', 'Status', 'Info'],
      data,
    });
  }

  private async refreshAlerts(): Promise<void> {
    const alertLogPath = path.join(getOpenClawDir(), 'logs', 'security-alerts.log');
    const items: string[] = [];

    if (await fs.pathExists(alertLogPath)) {
      try {
        const content = await fs.readFile(alertLogPath, 'utf-8');
        const lines = content.trim().split('\n').slice(-10).reverse();
        
        for (const line of lines) {
          try {
            const alert = JSON.parse(line);
            const time = new Date(alert.timestamp).toLocaleTimeString();
            const icon = alert.level === 'critical' ? '[!]' : alert.level === 'high' ? '[*]' : '[-]';
            items.push(`${icon} ${time} ${alert.rule?.name || 'Unknown'}`);
          } catch {
            // 忽略解析错误
          }
        }
      } catch {
        // 忽略读取错误
      }
    }

    if (items.length === 0) {
      items.push('No recent alerts');
    }

    this.alertsBox.setItems(items);
  }

  stop(): void {
    this.running = false;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.screen.destroy();
    process.exit(0);
  }
}