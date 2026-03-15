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

  async start(): Promise<void> {
    // 创建屏幕
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'OpenClaw Doctor Dashboard',
    });

    // 创建网格布局
    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    // 标题栏
    this.statusBox = this.grid.set(0, 0, 2, 12, blessed.box, {
      label: ' OpenClaw Doctor ',
      content: 'Loading...',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
      },
    });

    // Gateway 状态仪表
    this.gauge = this.grid.set(2, 0, 3, 4, contrib.gauge, {
      label: 'Gateway Status',
      percent: [0],
      options: {
        percentH: ['{red-fg}Offline{/red-fg}', '{green-fg}Online{/green-fg}'],
      },
    });

    // 系统资源
    this.donut = this.grid.set(2, 4, 3, 4, contrib.donut, {
      label: 'System Resources',
      radius: 8,
      arcWidth: 3,
      remainColor: 'black',
      yPadding: 2,
      data: [
        { label: 'CPU', percent: 0 },
        { label: 'MEM', percent: 0 },
      ],
    });

    // 智能体列表
    this.agentsBox = this.grid.set(2, 8, 5, 4, blessed.list, {
      label: ' Agents ',
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { bg: 'blue' },
        border: { fg: 'green' },
      },
    });

    // 诊断表格
    this.table = this.grid.set(5, 0, 4, 8, contrib.table, {
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
    this.alertsBox = this.grid.set(9, 0, 3, 6, blessed.list, {
      label: ' Recent Alerts ',
      keys: true,
      vi: true,
      mouse: true,
      style: {
        border: { fg: 'yellow' },
      },
    });

    // 操作日志
    this.logBox = this.grid.set(9, 6, 3, 6, blessed.log, {
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
      this.logBox.log('{yellow-fg}Refreshing...{/yellow-fg}');
      this.refresh();
    });

    this.screen.key(['f'], () => {
      this.logBox.log('{cyan-fg}Running auto-fix...{/cyan-fg}');
      // 触发修复
    });

    // 渲染
    this.screen.render();

    // 初始加载
    await this.refresh();

    // 定时刷新
    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, 5000);

    // 开始事件循环
    this.screen.render();
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
      this.logBox.log(`{red-fg}Error: ${error}{/red-fg}`);
    }
    this.screen.render();
  }

  private async refreshStatus(): Promise<void> {
    const installed = await isOpenClawInstalled();
    const version = await getOpenClawVersion();
    const nodeCheck = await checkNodeVersion();

    const status = [
      `{bold}OpenClaw:{/bold} ${installed ? `{green-fg}v${version}{/green-fg}` : '{red-fg}Not Installed{/red-fg}'}`,
      `{bold}Node.js:{/bold} ${nodeCheck.satisfied ? `{green-fg}${nodeCheck.installed}{/green-fg}` : `{red-fg}${nodeCheck.installed} (need >= ${nodeCheck.required}){/red-fg}`}`,
      `{bold}Host:{/bold} ${os.hostname()}`,
      `{bold}Platform:{/bold} ${os.type()} ${os.release()}`,
      `{bold}Uptime:{/bold} ${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
    ].join('\n');

    this.statusBox.setContent(status);
  }

  private async refreshGateway(): Promise<void> {
    const running = await isGatewayRunning();
    this.gauge.setPercent(running ? 100 : 0);
  }

  private async refreshResources(): Promise<void> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);

    // 计算 CPU 使用率
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += (cpu.times as any)[type];
      }
      totalIdle += cpu.times.idle;
    }
    const cpuPercent = 100 - Math.round((totalIdle / totalTick) * 100);

    this.donut.setData([
      { label: `CPU ${cpuPercent}%`, percent: cpuPercent, color: cpuPercent > 80 ? 'red' : 'green' },
      { label: `MEM ${memPercent}%`, percent: memPercent, color: memPercent > 80 ? 'red' : 'yellow' },
    ]);
  }

  private async refreshAgents(): Promise<void> {
    const hasConfig = await configExists();
    const items: string[] = [];

    if (hasConfig) {
      const config = await loadConfig();
      const agents = config?.agents?.list || [];
      
      for (const agent of agents) {
        const isDefault = agent.default ? ' [default]' : '';
        const mentions = agent.groupChat?.mentionPatterns?.join(', ') || '-';
        items.push(`${agent.id}${isDefault}`);
      }
    }

    if (items.length === 0) {
      items.push('{yellow-fg}No agents configured{/yellow-fg}');
    }

    this.agentsBox.setItems(items);
  }

  private async refreshDiagnostics(): Promise<void> {
    const data: string[][] = [];
    const hasConfig = await configExists();

    // 配置检查
    data.push(['Config File', hasConfig ? '{green-fg}OK{/green-fg}' : '{yellow-fg}Missing{/yellow-fg}', 
      hasConfig ? '~/.openclaw/openclaw.json' : 'Run: openclaw-guard config init']);

    // Gateway 检查
    const gatewayRunning = await isGatewayRunning();
    data.push(['Gateway', gatewayRunning ? '{green-fg}Running{/green-fg}' : '{yellow-fg}Stopped{/yellow-fg}',
      gatewayRunning ? 'Port 18789' : 'Run: openclaw gateway']);

    // 目录检查
    const openclawDir = getOpenClawDir();
    const dirs = ['logs', 'workspace', 'plugins', 'devices'];
    for (const dir of dirs) {
      const exists = await fs.pathExists(path.join(openclawDir, dir));
      data.push([`Dir: ${dir}`, exists ? '{green-fg}OK{/green-fg}' : '{red-fg}Missing{/red-fg}', '']);
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
            const time = new Date(alert.timestamp).toLocaleTimeString('zh-CN');
            const icon = alert.level === 'critical' ? '🚨' : alert.level === 'high' ? '🔴' : '🟡';
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
      items.push('{green-fg}No recent alerts{/green-fg}');
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
