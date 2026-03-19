import { Command } from 'commander';
import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import os from 'os';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { isOpenClawInstalled, getOpenClawVersion, isGatewayRunning, checkNodeVersion } from '../lib/system';
import { configExists, loadConfig, getOpenClawDir } from '../lib/config';

// 国际化支持
const isEnglish = () => {
  const lang = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '';
  return lang.toLowerCase().startsWith('en') || lang.toLowerCase().includes('english');
};

const i18n = {
  // 面板标签
  dashboard: { en: 'OpenClaw Guard Dashboard', zh: 'OpenClaw Guard 仪表盘' },
  gateway: { en: 'Gateway', zh: '网关' },
  systemResources: { en: 'System Resources', zh: '系统资源' },
  agents: { en: 'Agents', zh: '智能体' },
  diagnostics: { en: 'Diagnostics', zh: '诊断' },
  alerts: { en: 'Alerts', zh: '警报' },
  commands: { en: 'Commands', zh: '命令' },
  activityLog: { en: 'Activity Log', zh: '活动日志' },
  
  // 状态文本
  loading: { en: 'Loading...', zh: '加载中...' },
  checking: { en: 'Checking...', zh: '检测中...' },
  online: { en: 'ONLINE', zh: '在线' },
  offline: { en: 'OFFLINE', zh: '离线' },
  unknown: { en: 'UNKNOWN', zh: '未知' },
  running: { en: 'Running', zh: '运行中' },
  stopped: { en: 'Stopped', zh: '已停止' },
  ok: { en: 'OK', zh: '正常' },
  missing: { en: 'Missing', zh: '缺失' },
  
  // OpenClaw 状态
  notInstalled: { en: 'Not Installed', zh: '未安装' },
  configNotFound: { en: 'Config not found', zh: '配置未找到' },
  noAgentsConfigured: { en: 'No agents configured', zh: '未配置智能体' },
  noRecentAlerts: { en: 'No recent alerts - System secure', zh: '暂无警报 - 系统安全' },
  
  // 提示信息
  runCommand: { en: 'Run:', zh: '运行:' },
  pressEnter: { en: 'Press ENTER to return to dashboard...', zh: '按回车键返回仪表盘...' },
  terminalTooSmall: { en: 'Error: Terminal too small', zh: '错误: 终端窗口太小' },
  currentSize: { en: 'Current', zh: '当前' },
  minimumRequired: { en: 'Minimum required: 100x28', zh: '最小要求: 100x28' },
  pleaseResize: { en: 'Please resize your terminal window', zh: '请调整终端窗口大小' },
  
  // 命令名称
  cmdDiagnose: { en: '📊 Diagnose System', zh: '📊 系统诊断' },
  cmdSecurity: { en: '🔒 Security Audit', zh: '🔒 安全审计' },
  cmdShowConfig: { en: '📋 Show Config', zh: '📋 查看配置' },
  cmdInitConfig: { en: '🔧 Init Config', zh: '🔧 初始化配置' },
  cmdInstall: { en: '📦 Install OpenClaw', zh: '📦 安装 OpenClaw' },
  cmdUpgrade: { en: '🔄 Upgrade OpenClaw', zh: '🔄 升级 OpenClaw' },
  cmdBackup: { en: '💾 List Backups', zh: '💾 备份列表' },
  cmdAgents: { en: '🤖 List Agents', zh: '🤖 智能体列表' },
  cmdPerf: { en: '📈 Performance Monitor', zh: '📈 性能监控' },
  cmdKnowledge: { en: '📚 Knowledge Base', zh: '📚 知识库' },
  cmdChannels: { en: '📡 List Channels', zh: '📡 渠道列表' },
  cmdExit: { en: '🚪 Exit', zh: '🚪 退出' },
  
  // 智能体信息
  defaultAgent: { en: '[DEFAULT]', zh: '[默认]' },
  ws: { en: 'WS', zh: '工作区' },
  model: { en: 'Model', zh: '模型' },
  bindings: { en: 'Bindings', zh: '绑定' },
  mentions: { en: 'Mentions', zh: '提及' },
  
  // 快捷键提示
  keyRefresh: { en: '[R] Refresh', zh: '[R] 刷新' },
  keyCommands: { en: '[C] Commands', zh: '[C] 命令' },
  keySwitch: { en: '[Tab] Switch Panel', zh: '[Tab] 切换面板' },
  keyQuit: { en: '[Q] Quit', zh: '[Q] 退出' },
  
  // 其他
  host: { en: 'Host', zh: '主机' },
  platform: { en: 'Platform', zh: '平台' },
  uptime: { en: 'Uptime', zh: '运行时间' },
  config: { en: 'Config', zh: '配置' },
  file: { en: 'File', zh: '文件' },
  port: { en: 'Port', zh: '端口' },
};

const t = (key: keyof typeof i18n): string => {
  return isEnglish() ? i18n[key].en : i18n[key].zh;
};

export function registerTuiCommand(program: Command) {
  program
    .command('tui')
    .description('Launch interactive terminal UI dashboard')
    .action(async () => {
      const dashboard = new Dashboard();
      await dashboard.start();
    });
}

interface CommandItem {
  name: string;
  description: string;
  action: () => Promise<void>;
}

class Dashboard {
  private screen!: blessed.Widgets.Screen;
  private grid!: any;
  private logBox!: blessed.Widgets.Log;
  private statusBox!: blessed.Widgets.BoxElement;
  private agentsBox!: blessed.Widgets.ListElement;
  private alertsBox!: blessed.Widgets.ListElement;
  private commandBox!: blessed.Widgets.ListElement;
  private table!: any;
  private running: boolean = true;
  private refreshInterval: NodeJS.Timeout | null = null;
  private lastCpuInfo: { idle: number; total: number } | null = null;
  private commands: CommandItem[] = [];
  private paused: boolean = false;

  async start(): Promise<void> {
    const width = process.stdout.columns || 80;
    const height = process.stdout.rows || 24;
    
    if (width < 100 || height < 28) {
      console.log(chalk.red(t('terminalTooSmall')));
      console.log(`${t('currentSize')}: ${width}x${height}, ${t('minimumRequired')}`);
      console.log(t('pleaseResize'));
      process.exit(1);
    }

    const adjustedWidth = width % 2 === 0 ? width : width - 1;

    this.screen = blessed.screen({
      smartCSR: true,
      title: t('dashboard'),
      width: adjustedWidth,
      fullUnicode: true,
    });

    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    // 顶部状态栏 - 跨越整行（包含 Gateway 和系统资源）
    this.statusBox = this.grid.set(0, 0, 3, 12, blessed.box, {
      label: ` ${t('dashboard')} `,
      content: t('loading'),
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'cyan' },
        label: { fg: 'white', bold: true },
        bg: 'black',
      },
    });

    // Agents 详情面板 - 右侧
    this.agentsBox = this.grid.set(2, 8, 5, 4, blessed.list, {
      label: ` ${t('agents')} `,
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
    this.table = this.grid.set(2, 0, 5, 8, contrib.table, {
      label: ` ${t('diagnostics')} `,
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

    // 警报日志 - 左下
    this.alertsBox = this.grid.set(7, 0, 3, 4, blessed.list, {
      label: ` ${t('alerts')} `,
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

    // 命令菜单 - 中下
    this.commandBox = this.grid.set(7, 4, 3, 4, blessed.list, {
      label: ` ${t('commands')} `,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: 'magenta' },
        label: { fg: 'magenta', bold: true },
        selected: { bg: 'magenta', fg: 'white' },
        item: { fg: 'white' },
      },
    });

    // 初始化命令列表
    this.initCommands();

    // 命令选择事件
    this.commandBox.on('select', async (item: any, index: number) => {
      if (index >= 0 && index < this.commands.length) {
        const cmd = this.commands[index];
        this.logBox.log(`{magenta-fg}>>> ${isEnglish() ? 'Executing' : '执行'}: ${cmd.name}{/magenta-fg}`);
        try {
          await cmd.action();
        } catch (error) {
          this.logBox.log(`{red-fg}${isEnglish() ? 'Error' : '错误'}: ${error}{/red-fg}`);
        }
      }
    });

    // 操作日志 - 右下
    this.logBox = this.grid.set(7, 8, 3, 4, blessed.log, {
      label: ` ${t('activityLog')} `,
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
    const helpBox = this.grid.set(10, 0, 2, 12, blessed.box, {
      content: ` {cyan-fg}${t('keyRefresh')}{/cyan-fg}  {cyan-fg}${t('keyCommands')}{/cyan-fg}  {cyan-fg}${t('keySwitch')}{/cyan-fg}  {cyan-fg}${t('keyQuit')}{/cyan-fg}`,
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
      this.logBox.log(`{green-fg}>>> ${isEnglish() ? 'Refreshing...' : '刷新中...'}{/green-fg}`);
      this.refresh();
    });

    this.screen.key(['c'], () => {
      this.commandBox.focus();
      this.logBox.log(`{cyan-fg}>>> ${isEnglish() ? 'Focus on Commands panel' : '切换到命令面板'}{/cyan-fg}`);
    });

    this.screen.key(['tab'], () => {
      // 在各面板间循环切换焦点
      const panels = [this.agentsBox, this.alertsBox, this.commandBox];
      const currentFocus = this.screen.focused;
      const currentIndex = panels.findIndex(p => p === currentFocus);
      const nextIndex = (currentIndex + 1) % panels.length;
      panels[nextIndex].focus();
    });

    this.screen.render();

    // 初始加载
    await this.refresh();

    // 定时刷新
    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, 3000);
  }

  private initCommands(): void {
    this.commands = [
      {
        name: t('cmdDiagnose'),
        description: 'Run comprehensive diagnostics',
        action: async () => {
          await this.executeCommand('diagnose');
        },
      },
      {
        name: t('cmdSecurity'),
        description: 'Run security audit and hardening',
        action: async () => {
          await this.executeCommand('security');
        },
      },
      {
        name: t('cmdShowConfig'),
        description: 'Validate current configuration',
        action: async () => {
          await this.executeCommand('config', ['validate']);
        },
      },
      {
        name: t('cmdInitConfig'),
        description: 'Initialize configuration wizard',
        action: async () => {
          await this.executeCommand('config', ['init']);
        },
      },
      {
        name: t('cmdInstall'),
        description: 'Install OpenClaw with guided setup',
        action: async () => {
          await this.executeCommand('install');
        },
      },
      {
        name: t('cmdUpgrade'),
        description: 'Upgrade to the latest version',
        action: async () => {
          await this.executeCommand('upgrade');
        },
      },
      {
        name: t('cmdBackup'),
        description: 'List all configuration backups',
        action: async () => {
          await this.executeCommand('backup', ['list']);
        },
      },
      {
        name: t('cmdAgents'),
        description: 'List all configured agents',
        action: async () => {
          await this.executeCommand('agent', ['list']);
        },
      },
      {
        name: t('cmdPerf'),
        description: 'View performance metrics',
        action: async () => {
          await this.executeCommand('perf');
        },
      },
      {
        name: t('cmdKnowledge'),
        description: 'List solutions in knowledge base',
        action: async () => {
          await this.executeCommand('knowledge', ['list']);
        },
      },
      {
        name: t('cmdChannels'),
        description: 'List configured channels',
        action: async () => {
          await this.executeCommand('channel', ['list']);
        },
      },
      {
        name: t('cmdExit'),
        description: 'Exit the dashboard',
        action: async () => {
          this.stop();
        },
      },
    ];

    this.commandBox.setItems(this.commands.map(c => c.name));
  }

  private async executeCommand(cmd: string, args: string[] = []): Promise<void> {
    // 暂停刷新
    this.paused = true;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    
    // 销毁 blessed screen 释放终端
    this.screen.destroy();
    
    // 清屏
    console.log('\x1b[2J\x1b[H');
    console.log(chalk.cyan(`\n▶ ${isEnglish() ? 'Executing' : '执行'}: openclaw-guard ${cmd} ${args.join(' ')}\n`));
    
    try {
      const execa = (await import('execa')).default;
      const allArgs = [cmd, ...args];
      await execa('node', ['dist/index.js', ...allArgs], { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
    } catch (error: any) {
      console.log(chalk.red(`\n${isEnglish() ? 'Error' : '错误'}: ${error.message}`));
    }
    
    // 等待用户确认
    console.log(chalk.gray('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan(t('pressEnter')));
    
    await this.waitForEnter();
    
    // 重新启动 TUI
    this.paused = false;
    await this.start();
  }

  private waitForEnter(): Promise<void> {
    return new Promise((resolve) => {
      const stdin = process.stdin;
      if (stdin.isTTY) {
        stdin.setRawMode(true);
      }
      stdin.resume();
      stdin.setEncoding('utf8');
      
      const handler = (key: string) => {
        if (key === '\r' || key === '\n' || key === '\u0003') {
          if (stdin.isTTY) {
            stdin.setRawMode(false);
          }
          stdin.pause();
          stdin.removeListener('data', handler);
          resolve();
        }
      };
      
      stdin.on('data', handler);
    });
  }

  private async refresh(): Promise<void> {
    if (this.paused) return;
    
    try {
      // 刷新所有数据
      await Promise.allSettled([
        this.refreshStatus(),
        this.refreshAgents(),
        this.refreshDiagnostics(),
        this.refreshAlerts(),
      ]);
    } catch (error) {
      // 静默处理，不阻塞刷新
    }
    this.screen.render();
  }

  private async refreshStatus(): Promise<void> {
    try {
      const installed = await isOpenClawInstalled();
      const version = await getOpenClawVersion();
      const nodeCheck = await checkNodeVersion();
      const gatewayRunning = await isGatewayRunning();

      const openclawIcon = installed ? '{green-fg}●{/green-fg}' : '{red-fg}○{/red-fg}';
      const nodeIcon = nodeCheck.satisfied ? '{green-fg}●{/green-fg}' : '{red-fg}○{/red-fg}';
      const gatewayIcon = gatewayRunning ? '{green-fg}●{/green-fg}' : '{red-fg}○{/red-fg}';

      const uptime = os.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);

      // 系统资源
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

      const cpuColor = cpuPercent > 80 ? 'red' : cpuPercent > 50 ? 'yellow' : 'green';
      const memColor = memPercent > 80 ? 'red' : memPercent > 50 ? 'yellow' : 'green';

      const status = [
        `  ${openclawIcon} OpenClaw: ${installed ? `{bold}v${version}{/bold}` : t('notInstalled')}    ${nodeIcon} Node.js: ${nodeCheck.satisfied ? nodeCheck.installed : `${nodeCheck.installed} (${isEnglish() ? 'need' : '需要'} >= ${nodeCheck.required})`}`,
        `  ${gatewayIcon} ${t('gateway')}: ${gatewayRunning ? `{green-fg}${t('online')}{/green-fg}` : `{red-fg}${t('offline')}{/red-fg}`}    {cyan-fg}Host:{/cyan-fg} ${os.hostname()}    {cyan-fg}Uptime:{/cyan-fg} ${hours}${isEnglish() ? 'h' : '小时'} ${minutes}${isEnglish() ? 'm' : '分'}`,
        `  {${cpuColor}-fg}CPU{/}: ${cpuPercent}%    {${memColor}-fg}MEM{/}: ${memPercent}%    {cyan-fg}Platform:{/cyan-fg} ${os.type()} ${os.release()}`,
      ].join('\n');

      this.statusBox.setContent(status);
    } catch (error) {
      this.statusBox.setContent(`{red-fg}${isEnglish() ? 'Error loading status' : '状态加载失败'}{/red-fg}`);
    }
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
      const bindings = config?.bindings || [];
      const defaults = config?.agents?.defaults;
      
      if (agents.length === 0) {
        items.push(`{gray-fg}${t('noAgentsConfigured')}{/gray-fg}`);
        items.push('');
        items.push('{cyan-fg}Run: openclaw-guard agent create{/cyan-fg}');
      } else {
        for (const agent of agents) {
          const isDefault = agent.default ? ` {green-fg}${t('defaultAgent')}{/green-fg}` : '';
          const icon = agent.default ? '{green-fg}●{/green-fg}' : '○';
          items.push(`${icon} {bold}${agent.id}{/bold}${isDefault}`);
          
          // 显示工作区
          if (agent.workspace) {
            const ws = agent.workspace.length > 20 
              ? '...' + agent.workspace.slice(-17) 
              : agent.workspace;
            items.push(`  {gray-fg}${t('ws')}: ${ws}{/gray-fg}`);
          }
          
          // 显示模型
          const primaryModel = defaults?.model?.primary;
          if (primaryModel) {
            const modelShort = primaryModel.length > 18 
              ? primaryModel.slice(0, 15) + '...' 
              : primaryModel;
            items.push(`  {cyan-fg}${t('model')}: ${modelShort}{/cyan-fg}`);
          }
          
          // 显示绑定数量
          const agentBindings = bindings.filter(b => b.agentId === agent.id);
          if (agentBindings.length > 0) {
            const channels = [...new Set(agentBindings.map(b => b.match.channel))];
            items.push(`  {yellow-fg}${t('bindings')}: ${agentBindings.length} (${channels.join(', ')}){/yellow-fg}`);
          }
          
          // 显示提及模式
          if (agent.groupChat?.mentionPatterns?.length) {
            const patterns = agent.groupChat.mentionPatterns.slice(0, 2).join(', ');
            const more = agent.groupChat.mentionPatterns.length > 2 ? '...' : '';
            items.push(`  {gray-fg}${t('mentions')}: ${patterns}${more}{/gray-fg}`);
          }
          
          items.push(''); // 空行分隔
        }
      }
    } else {
      items.push(`{red-fg}✗ ${t('configNotFound')}{/red-fg}`);
      items.push('');
      items.push('{cyan-fg}Run: openclaw-guard config init{/cyan-fg}');
    }

    this.agentsBox.setItems(items);
  }

  private async refreshDiagnostics(): Promise<void> {
    const data: string[][] = [];
    const hasConfig = await configExists();

    const configIcon = hasConfig ? '✓' : '✗';
    const configStatus = hasConfig ? t('ok') : t('missing');
    data.push([`${configIcon} ${t('config')}`, configStatus, 
      hasConfig ? '~/.openclaw/openclaw.json' : 'Run: openclaw-guard config init']);

    const gatewayRunning = await isGatewayRunning();
    const gatewayIcon = gatewayRunning ? '✓' : '○';
    const gatewayStatus = gatewayRunning ? t('running') : t('stopped');
    data.push([`${gatewayIcon} ${t('gateway')}`, gatewayStatus,
      gatewayRunning ? `${t('port')} 18789` : `${t('runCommand')} openclaw gateway`]);

    const openclawDir = getOpenClawDir();
    const dirs = ['logs', 'workspace', 'plugins', 'devices'];
    for (const dir of dirs) {
      const exists = await fs.pathExists(path.join(openclawDir, dir));
      const icon = exists ? '✓' : '✗';
      const status = exists ? t('ok') : t('missing');
      data.push([`${icon} ${dir}`, status, '']);
    }

    this.table.setData({
      headers: [isEnglish() ? 'Check' : '检查项', isEnglish() ? 'Status' : '状态', isEnglish() ? 'Info' : '信息'],
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
            items.push(`${icon} ${time} ${alert.rule?.name || (isEnglish() ? 'Unknown' : '未知')}`);
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    if (items.length === 0) {
      items.push(`{gray-fg}${t('noRecentAlerts')}{/gray-fg}`);
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
