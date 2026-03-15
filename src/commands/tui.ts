import { Command } from 'commander';
import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import os from 'os';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
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
  private gatewayBox!: blessed.Widgets.BoxElement;
  private resourceBox!: blessed.Widgets.BoxElement;
  private table!: any;
  private running: boolean = true;
  private refreshInterval: NodeJS.Timeout | null = null;
  private lastCpuInfo: { idle: number; total: number } | null = null;

  async start(): Promise<void> {
    const width = process.stdout.columns || 80;
    const height = process.stdout.rows || 24;
    
    if (width < 100 || height < 28) {
      console.log(chalk.red('Error: Terminal too small'));
      console.log(`Current: ${width}x${height}, Minimum required: 100x28`);
      console.log('Please resize your terminal window');
      process.exit(1);
    }

    const adjustedWidth = width % 2 === 0 ? width : width - 1;

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'OpenClaw Guard Dashboard',
      width: adjustedWidth,
      fullUnicode: true,
    });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    // 顶部状态栏 - 跨越整行
    this.statusBox = this.grid.set(0, 0, 2, 12, blessed.box, {
      label: ' OpenClaw Guard Dashboard ',
      content: 'Loading...',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
        bg: 'black',
      },
    });

    // Gateway 状态 - 左侧
    this.gatewayBox = this.grid.set(2, 0, 2, 4, blessed.box, {
      label: ' Gateway ',
      content: 'Checking...',
      tags: true,
      border: { type: 'line' },
      padding: { left: 1, right: 1 },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
      },
    });

    // 系统资源 - 中间
    this.resourceBox = this.grid.set(2, 4, 2, 4, blessed.box, {
      label: ' System Resources ',
      content: 'CPU: --\nMEM: --',
      tags: true,
      border: { type: 'line' },
      padding: { left: 1, right: 1 },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
      },
    });

    // Agents - 右侧
    this.agentsBox = this.grid.set(2, 8, 2, 4, blessed.list, {
      label: ' Agents ',
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
        selected: { bg: 'blue', fg: 'white' },
        item: { fg: 'white' },
      },
    });

    // 诊断表格 - 主体区域
    this.table = this.grid.set(4, 0, 5, 8, contrib.table, {
      label: ' Diagnostics ',
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: 'blue',
      interactive: true,
      columnSpacing: 3,
      columnWidth: [18, 12, 45],
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
      },
    });

    // 知识库统计 - 右侧
    const knowledgeBox = this.grid.set(4, 8, 5, 4, blessed.box, {
      label: ' Knowledge Base ',
      content: 'Loading...',
      tags: true,
      border: { type: 'line' },
      padding: { left: 1, right: 1 },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
      },
    });

    // 警报日志 - 左下
    this.alertsBox = this.grid.set(9, 0, 3, 6, blessed.list, {
      label: ' Recent Alerts ',
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'yellow' },
        label: { fg: 'yellow', bold: true },
        selected: { bg: 'yellow', fg: 'black' },
        item: { fg: 'white' },
      },
    });

    // 操作日志 - 右下
    this.logBox = this.grid.set(9, 6, 3, 6, blessed.log, {
      label: ' Activity Log ',
      fg: 'white',
      selectedFg: 'white',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'green' },
        label: { fg: 'green', bold: true },
      },
    });

    // 底部快捷键提示
    const helpBox = this.grid.set(12, 0, 0, 12, blessed.box, {
      content: ' {cyan-fg}[R]{/cyan-fg} Refresh  {cyan-fg}[Q]{/cyan-fg} Quit',
      tags: true,
      height: 1,
      style: {
        bg: 'black',
      },
    });

    // 键盘事件
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.stop();
    });

    this.screen.key(['r'], () => {
      this.logBox.log('{green-fg}>>> Refreshing...{/green-fg}');
      this.refresh();
    });

    this.screen.render();

    // 初始加载
    await this.refresh();

    // 定时刷新
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
        this.refreshKnowledge(),
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

    const openclawIcon = installed ? '{green-fg}●{/green-fg}' : '{red-fg}○{/red-fg}';
    const nodeIcon = nodeCheck.satisfied ? '{green-fg}●{/green-fg}' : '{red-fg}○{/red-fg}';

    const uptime = os.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const status = [
      `  ${openclawIcon} OpenClaw: ${installed ? `{bold}v${version}{/bold}` : 'Not Installed'}`,
      `  ${nodeIcon} Node.js:  ${nodeCheck.satisfied ? nodeCheck.installed : `${nodeCheck.installed} (need >= ${nodeCheck.required})`}`,
      `  {cyan-fg}➜{/cyan-fg} Host: ${os.hostname()}`,
      `  {cyan-fg}➜{/cyan-fg} Platform: ${os.type()} ${os.release()}`,
      `  {cyan-fg}➜{/cyan-fg} Uptime: ${hours}h ${minutes}m`,
    ].join('\n');

    this.statusBox.setContent(status);
  }

  private async refreshGateway(): Promise<void> {
    const running = await isGatewayRunning();
    
    const content = running 
      ? '{green-fg}● ONLINE{/green-fg}\n  Port: 18789'
      : '{red-fg}○ OFFLINE{/red-fg}\n  Run: openclaw gateway';
    
    this.gatewayBox.setContent(content);
    this.gatewayBox.style.border.fg = running ? 'green' : 'red';
  }

  private async refreshResources(): Promise<void> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);

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

    const cpuBar = this.createProgressBar(cpuPercent, 20);
    const memBar = this.createProgressBar(memPercent, 20);

    const cpuColor = cpuPercent > 80 ? 'red' : cpuPercent > 50 ? 'yellow' : 'green';
    const memColor = memPercent > 80 ? 'red' : memPercent > 50 ? 'yellow' : 'green';

    const content = [
      `{${cpuColor}-fg}CPU{/} ${cpuPercent.toString().padStart(3)}%  ${cpuBar}`,
      `{${memColor}-fg}MEM{/} ${memPercent.toString().padStart(3)}%  ${memBar}`,
    ].join('\n');

    this.resourceBox.setContent(content);
  }

  private createProgressBar(percent: number, width: number): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  private async refreshAgents(): Promise<void> {
    const hasConfig = await configExists();
    const items: string[] = [];

    if (hasConfig) {
      const config = await loadConfig();
      const agents = config?.agents?.list || [];
      
      for (const agent of agents) {
        const icon = agent.default ? '{green-fg}●{/green-fg}' : '○';
        items.push(`${icon} ${agent.id}`);
      }
    }

    if (items.length === 0) {
      items.push('{gray-fg}No agents configured{/gray-fg}');
    }

    this.agentsBox.setItems(items);
  }

  private async refreshDiagnostics(): Promise<void> {
    const data: string[][] = [];
    const hasConfig = await configExists();

    const configIcon = hasConfig ? '{green-fg}✓{/green-fg}' : '{red-fg}✗{/red-fg}';
    data.push(['Config File', hasConfig ? 'OK' : 'Missing', 
      hasConfig ? '~/.openclaw/openclaw.json' : 'Run: openclaw-guard config init']);

    const gatewayRunning = await isGatewayRunning();
    const gatewayIcon = gatewayRunning ? '{green-fg}✓{/green-fg}' : '{yellow-fg}○{/yellow-fg}';
    data.push(['Gateway', gatewayRunning ? 'Running' : 'Stopped',
      gatewayRunning ? 'Port 18789' : 'Run: openclaw gateway']);

    const openclawDir = getOpenClawDir();
    const dirs = ['logs', 'workspace', 'plugins', 'devices'];
    for (const dir of dirs) {
      const exists = await fs.pathExists(path.join(openclawDir, dir));
      const icon = exists ? '{green-fg}✓{/green-fg}' : '{red-fg}✗{/red-fg}';
      data.push([`${icon} ${dir}`, exists ? 'OK' : 'Missing', '']);
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
            const icon = alert.level === 'critical' ? '{red-fg}[!]{/red-fg}' 
                       : alert.level === 'high' ? '{yellow-fg}[*]{/yellow-fg}' 
                       : '[-]';
            items.push(`${icon} ${time} ${alert.rule?.name || 'Unknown'}`);
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    if (items.length === 0) {
      items.push('{gray-fg}No recent alerts - System secure{/gray-fg}');
    }

    this.alertsBox.setItems(items);
  }

  private async refreshKnowledge(): Promise<void> {
    const knowledgePath = path.join(os.homedir(), '.openclaw', 'guard-knowledge.json');
    let total = 0;
    let verified = 0;
    let successRate = '0%';

    if (await fs.pathExists(knowledgePath)) {
      try {
        const data = await fs.readJson(knowledgePath);
        total = data.solutions?.length || 0;
        verified = data.solutions?.filter((s: any) => s.verified).length || 0;
        
        const totalSuccess = data.solutions?.reduce((sum: number, s: any) => sum + (s.successCount || 0), 0) || 0;
        const totalFail = data.solutions?.reduce((sum: number, s: any) => sum + (s.failCount || 0), 0) || 0;
        
        if (totalSuccess + totalFail > 0) {
          successRate = Math.round((totalSuccess / (totalSuccess + totalFail)) * 100) + '%';
        }
      } catch {
        // ignore
      }
    }

    const content = [
      `{cyan-fg}Solutions:{/cyan-fg}     ${total}`,
      `{green-fg}Verified:{/green-fg}      ${verified}`,
      `{yellow-fg}Success Rate:{/yellow-fg} ${successRate}`,
      '',
      '{gray-fg}Commands:{/gray-fg}',
      '  knowledge list',
      '  knowledge sync',
    ].join('\n');

    // 找到知识库面板并更新
    const knowledgeBox = this.screen.children.find((c: any) => 
      c.options?.label === ' Knowledge Base '
    ) as blessed.Widgets.BoxElement;
    
    if (knowledgeBox) {
      knowledgeBox.setContent(content);
    }
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
