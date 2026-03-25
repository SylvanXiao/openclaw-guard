import { Command } from 'commander';
import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import os from 'os';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { isOpenClawInstalled, getOpenClawVersion, isGatewayRunning, checkNodeVersion } from '../lib/system';
import { configExists, loadConfig, getOpenClawDir } from '../lib/config';
import { cveDatabase } from '../lib/cve-database';
import { complianceChecker } from '../lib/compliance';

// 国际化支持
const isEnglish = () => {
  const lang = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '';
  const langLower = lang.toLowerCase();
  
  if (langLower.startsWith('en') || langLower.includes('english')) {
    return true;
  }
  
  if (langLower.includes('zh') || langLower.includes('cn') || langLower.includes('chinese')) {
    return false;
  }
  
  return false;
};

const i18n = {
  dashboard: { en: 'OpenClaw Guard', zh: 'OpenClaw Guard' },
  gateway: { en: 'Gateway', zh: '网关' },
  systemResources: { en: 'Resources', zh: '资源' },
  agents: { en: 'Agents', zh: '智能体' },
  diagnostics: { en: 'Diagnostics', zh: '系统诊断' },
  alerts: { en: 'Alerts', zh: '安全警报' },
  commands: { en: 'Commands', zh: '快捷命令' },
  activityLog: { en: 'Activity Log', zh: '活动日志' },
  security: { en: 'Security', zh: '安全状态' },
  
  loading: { en: 'Loading...', zh: '加载中...' },
  online: { en: 'ONLINE', zh: '在线' },
  offline: { en: 'OFFLINE', zh: '离线' },
  running: { en: 'Running', zh: '运行中' },
  stopped: { en: 'Stopped', zh: '已停止' },
  ok: { en: 'OK', zh: '正常' },
  missing: { en: 'Missing', zh: '缺失' },
  
  notInstalled: { en: 'Not Installed', zh: '未安装' },
  configNotFound: { en: 'Config not found', zh: '配置未找到' },
  noAgentsConfigured: { en: 'No agents configured', zh: '暂无智能体配置' },
  noRecentAlerts: { en: '✓ No alerts - System secure', zh: '✓ 系统安全 - 暂无警报' },
  
  pressEnter: { en: 'Press ENTER to return to dashboard...', zh: '按回车键返回仪表盘...' },
  terminalTooSmall: { en: 'Error: Terminal too small', zh: '错误: 终端窗口太小' },
  currentSize: { en: 'Current', zh: '当前' },
  minimumRequired: { en: 'Minimum required: 120x30', zh: '最小要求: 120x30' },
  pleaseResize: { en: 'Please resize your terminal window', zh: '请调整终端窗口大小' },
  
  cmdDiagnose: { en: '🔍 Diagnose', zh: '🔍 系统诊断' },
  cmdCveScan: { en: '🛡️ CVE Scan', zh: '🛡️ CVE扫描' },
  cmdSecurity: { en: '🔒 Security Audit', zh: '🔒 安全审计' },
  cmdCompliance: { en: '📋 Compliance', zh: '📋 合规检查' },
  cmdInjection: { en: '💉 Injection Test', zh: '💉 注入检测' },
  cmdShowConfig: { en: '⚙️ Config', zh: '⚙️ 查看配置' },
  cmdInstall: { en: '📦 Install', zh: '📦 安装' },
  cmdUpgrade: { en: '⬆️ Upgrade', zh: '⬆️ 升级' },
  cmdBackup: { en: '💾 Backup', zh: '💾 备份' },
  cmdAgents: { en: '🤖 Agents', zh: '🤖 智能体' },
  cmdPerf: { en: '📈 Performance', zh: '📈 性能' },
  cmdKnowledge: { en: '📚 Knowledge', zh: '📚 知识库' },
  cmdExit: { en: '🚪 Exit', zh: '🚪 退出' },
  
  defaultAgent: { en: '[DEFAULT]', zh: '[默认]' },
  ws: { en: 'WS', zh: '工作区' },
  model: { en: 'Model', zh: '模型' },
  bindings: { en: 'Bindings', zh: '绑定' },
  
  cve: { en: 'CVE', zh: 'CVE漏洞' },
  compliance: { en: 'Compliance', zh: '合规得分' },
  score: { en: '', zh: '分' },
  vulnerabilities: { en: 'vulnerabilities', zh: '个漏洞' },
  critical: { en: 'Critical', zh: '严重' },
  high: { en: 'High', zh: '高危' },
  exploited: { en: 'Exploited', zh: '已利用' },
  noVulns: { en: '✓ No vulnerabilities', zh: '✓ 无已知漏洞' },
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

// 颜色主题
const THEME = {
  primary: 'cyan',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  info: 'blue',
  muted: 'gray',
  accent: 'magenta',
};

class Dashboard {
  private screen!: blessed.Widgets.Screen;
  private grid!: any;
  private logBox!: blessed.Widgets.Log;
  private statusBox!: blessed.Widgets.BoxElement;
  private resourceBox!: blessed.Widgets.BoxElement;
  private securityBox!: blessed.Widgets.BoxElement;
  private agentsBox!: blessed.Widgets.ListElement;
  private alertsBox!: blessed.Widgets.ListElement;
  private commandBox!: blessed.Widgets.ListElement;
  private table!: any;
  private running: boolean = true;
  private refreshInterval: NodeJS.Timeout | null = null;
  private lastCpuInfo: { idle: number; total: number } | null = null;
  private commands: CommandItem[] = [];
  private paused: boolean = false;
  private lastCveResult: any = null;
  private lastComplianceScore: number | null = null;
  private cpuHistory: number[] = [];
  private memHistory: number[] = [];

  async start(): Promise<void> {
    const width = process.stdout.columns || 80;
    const height = process.stdout.rows || 24;
    
    if (width < 120 || height < 30) {
      console.log(chalk.red(t('terminalTooSmall')));
      console.log(`${t('currentSize')}: ${width}x${height}, ${t('minimumRequired')}`);
      console.log(t('pleaseResize'));
      process.exit(1);
    }

    this.screen = blessed.screen({
      smartCSR: true,
      title: `OpenClaw Guard Dashboard`,
      fullUnicode: true,
    });

    this.grid = new contrib.grid({ rows: 14, cols: 14, screen: this.screen });

    // ═══════════════════════════════════════════════════════════
    // 顶部标题栏 - 全宽
    // ═══════════════════════════════════════════════════════════
    this.statusBox = this.grid.set(0, 0, 2, 14, blessed.box, {
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: THEME.primary },
        bg: 'black',
      },
    });

    // ═══════════════════════════════════════════════════════════
    // 第二行：资源监控 | 安全状态
    // ═══════════════════════════════════════════════════════════
    this.resourceBox = this.grid.set(2, 0, 3, 7, blessed.box, {
      label: ` 📊 ${t('systemResources')} `,
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: THEME.primary },
        label: { fg: 'white', bold: true },
        bg: 'black',
      },
    });

    this.securityBox = this.grid.set(2, 7, 3, 7, blessed.box, {
      label: ` 🛡️ ${t('security')} `,
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: THEME.warning },
        label: { fg: THEME.warning, bold: true },
        bg: 'black',
      },
    });

    // ═══════════════════════════════════════════════════════════
    // 第三行：智能体 | 诊断表格
    // ═══════════════════════════════════════════════════════════
    this.agentsBox = this.grid.set(5, 0, 4, 4, blessed.list, {
      label: ` 🤖 ${t('agents')} `,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: THEME.accent },
        label: { fg: THEME.accent, bold: true },
        selected: { bg: THEME.accent, fg: 'white', bold: true },
        item: { fg: 'white' },
        bg: 'black',
      },
    });

    this.table = this.grid.set(5, 4, 4, 10, contrib.table, {
      label: ` 🔧 ${t('diagnostics')} `,
      keys: true,
      fg: 'white',
      selectedFg: 'white',
      selectedBg: THEME.info,
      interactive: true,
      columnSpacing: 4,
      columnWidth: [20, 14, 50],
      border: { type: 'line' },
      style: {
        border: { fg: THEME.primary },
        label: { fg: 'white', bold: true },
        bg: 'black',
      },
    });

    // ═══════════════════════════════════════════════════════════
    // 第四行：警报 | 命令 | 日志
    // ═══════════════════════════════════════════════════════════
    this.alertsBox = this.grid.set(9, 0, 3, 5, blessed.list, {
      label: ` 🚨 ${t('alerts')} `,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: THEME.danger },
        label: { fg: THEME.danger, bold: true },
        selected: { bg: THEME.danger, fg: 'white', bold: true },
        item: { fg: 'white' },
        bg: 'black',
      },
    });

    this.commandBox = this.grid.set(9, 5, 3, 4, blessed.list, {
      label: ` ⌨️ ${t('commands')} `,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: THEME.accent },
        label: { fg: THEME.accent, bold: true },
        selected: { bg: THEME.accent, fg: 'white', bold: true },
        item: { fg: 'white' },
        bg: 'black',
      },
    });

    this.logBox = this.grid.set(9, 9, 3, 5, blessed.log, {
      label: ` 📝 ${t('activityLog')} `,
      fg: 'white',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: THEME.success },
        label: { fg: THEME.success, bold: true },
        bg: 'black',
      },
    });

    // ═══════════════════════════════════════════════════════════
    // 底部快捷键提示栏
    // ═══════════════════════════════════════════════════════════
    const helpBox = this.grid.set(12, 0, 2, 14, blessed.box, {
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: THEME.muted },
        bg: 'black',
      },
    });

    // 初始化命令列表
    this.initCommands();

    // 命令选择事件
    this.commandBox.on('select', async (item: any, index: number) => {
      if (index >= 0 && index < this.commands.length) {
        const cmd = this.commands[index];
        this.logBox.log(`{${THEME.accent}-fg}▶ ${isEnglish() ? 'Executing' : '执行'}: ${cmd.name}{/${THEME.accent}-fg}`);
        try {
          await cmd.action();
        } catch (error) {
          this.logBox.log(`{${THEME.danger}-fg}✗ ${isEnglish() ? 'Error' : '错误'}: ${error}{/${THEME.danger}-fg}`);
        }
      }
    });

    // 键盘事件
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.stop();
    });

    this.screen.key(['r'], () => {
      this.logBox.log(`{${THEME.success}-fg}⟳ ${isEnglish() ? 'Refreshing...' : '刷新中...'}{/${THEME.success}-fg}`);
      this.refresh();
    });

    this.screen.key(['c'], () => {
      this.commandBox.focus();
      this.logBox.log(`{${THEME.info}-fg}→ ${isEnglish() ? 'Focus on Commands' : '切换到命令面板'}{/${THEME.info}-fg}`);
    });

    this.screen.key(['s'], async () => {
      await this.executeCommand('security', ['audit', '--cve', '--compliance']);
    });

    this.screen.key(['v'], async () => {
      await this.executeCommand('security', ['cve', '--detail']);
    });

    this.screen.key(['d'], async () => {
      await this.executeCommand('diagnose');
    });

    this.screen.key(['tab'], () => {
      const panels = [this.agentsBox, this.alertsBox, this.commandBox];
      const currentFocus = this.screen.focused;
      const currentIndex = panels.findIndex(p => p === currentFocus);
      const nextIndex = (currentIndex + 1) % panels.length;
      panels[nextIndex].focus();
    });

    // 鼠标事件
    this.screen.on('element click', (el: any) => {
      if (el === this.statusBox || el === this.resourceBox || el === this.securityBox) {
        this.refresh();
      }
    });

    this.screen.render();

    // 初始加载
    await this.refresh();

    // 更新快捷键提示
    this.updateHelpBar(helpBox);

    // 定时刷新
    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, 2000);
  }

  private updateHelpBar(helpBox: blessed.Widgets.BoxElement): void {
    const keyStyle = `{white-fg}{black-bg}`;
    const resetStyle = `{/}`;
    
    const helpContent = [
      `  ${keyStyle} R ${resetStyle} 刷新  ${keyStyle} S ${resetStyle} 安全审计  ${keyStyle} V ${resetStyle} CVE扫描  ${keyStyle} D ${resetStyle} 诊断  ${keyStyle} C ${resetStyle} 命令  ${keyStyle} Tab ${resetStyle} 切换面板  ${keyStyle} Q ${resetStyle} 退出`,
      `  ${'{cyan-fg}'}版本: 1.0.0 │ OpenClaw 安全监控运维工具 │ {yellow-fg}https://github.com/SylvanXiao/openclaw-guard{/}`,
    ].join('\n');
    
    helpBox.setContent(helpContent);
  }

  private initCommands(): void {
    this.commands = [
      { name: t('cmdDiagnose'), description: 'Run diagnostics', action: async () => { await this.executeCommand('diagnose'); } },
      { name: t('cmdCveScan'), description: 'Scan CVE', action: async () => { await this.executeCommand('security', ['cve', '--detail']); } },
      { name: t('cmdSecurity'), description: 'Security audit', action: async () => { await this.executeCommand('security', ['audit', '--cve', '--compliance']); } },
      { name: t('cmdCompliance'), description: 'Compliance check', action: async () => { await this.executeCommand('security', ['compliance']); } },
      { name: t('cmdInjection'), description: 'Injection test', action: async () => { await this.executeCommand('security', ['injection']); } },
      { name: t('cmdShowConfig'), description: 'Show config', action: async () => { await this.executeCommand('config', ['show']); } },
      { name: t('cmdBackup'), description: 'Backup', action: async () => { await this.executeCommand('backup', ['list']); } },
      { name: t('cmdAgents'), description: 'Agents', action: async () => { await this.executeCommand('agent', ['list']); } },
      { name: t('cmdKnowledge'), description: 'Knowledge', action: async () => { await this.executeCommand('knowledge', ['list']); } },
      { name: t('cmdPerf'), description: 'Performance', action: async () => { await this.executeCommand('perf', ['status']); } },
      { name: t('cmdInstall'), description: 'Install', action: async () => { await this.executeCommand('install'); } },
      { name: t('cmdUpgrade'), description: 'Upgrade', action: async () => { await this.executeCommand('upgrade'); } },
      { name: t('cmdExit'), description: 'Exit', action: async () => { this.stop(); } },
    ];
    this.commandBox.setItems(this.commands.map(c => c.name));
  }

  private async executeCommand(cmd: string, args: string[] = []): Promise<void> {
    this.paused = true;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    
    this.screen.destroy();
    
    console.log('\x1b[2J\x1b[H');
    console.log(chalk.cyan(`\n▶ ${isEnglish() ? 'Executing' : '执行'}: openclaw-guard ${cmd} ${args.join(' ')}\n`));
    
    try {
      const execa = (await import('execa')).default;
      await execa('node', ['dist/index.js', cmd, ...args], { 
        stdio: 'inherit',
        cwd: process.cwd()
      });
    } catch (error: any) {
      console.log(chalk.red(`\n✗ ${isEnglish() ? 'Error' : '错误'}: ${error.message}`));
    }
    
    console.log(chalk.gray('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.cyan(t('pressEnter')));
    
    await this.waitForEnter();
    
    this.paused = false;
    await this.start();
  }

  private waitForEnter(): Promise<void> {
    return new Promise((resolve) => {
      const stdin = process.stdin;
      if (stdin.isTTY) stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      
      const handler = (key: string) => {
        if (key === '\r' || key === '\n' || key === '\u0003') {
          if (stdin.isTTY) stdin.setRawMode(false);
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
      await Promise.allSettled([
        this.refreshStatus(),
        this.refreshResources(),
        this.refreshSecurity(),
        this.refreshAgents(),
        this.refreshDiagnostics(),
        this.refreshAlerts(),
      ]);
    } catch (error) {
      // 静默处理
    }
    this.screen.render();
  }

  private async refreshStatus(): Promise<void> {
    const installed = await isOpenClawInstalled();
    const version = await getOpenClawVersion();
    const nodeCheck = await checkNodeVersion();
    const gatewayRunning = await isGatewayRunning();

    const ocIcon = installed ? `{${THEME.success}-fg}●{/${THEME.success}-fg}` : `{${THEME.danger}-fg}○{/${THEME.danger}-fg}`;
    const nodeIcon = nodeCheck.satisfied ? `{${THEME.success}-fg}●{/${THEME.success}-fg}` : `{${THEME.warning}-fg}○{/${THEME.warning}-fg}`;
    const gwIcon = gatewayRunning ? `{${THEME.success}-fg}●{/${THEME.success}-fg}` : `{${THEME.danger}-fg}○{/${THEME.danger}-fg}`;

    const uptime = os.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);

    const content = [
      `  ${ocIcon} OpenClaw: {bold}${installed ? `v${version}` : t('notInstalled')}{/bold}    ${nodeIcon} Node.js: ${nodeCheck.satisfied ? `{${THEME.success}-fg}${nodeCheck.installed}{/${THEME.success}-fg}` : `{${THEME.warning}-fg}${nodeCheck.installed}{/${THEME.warning}-fg}`}    ${gwIcon} Gateway: ${gatewayRunning ? `{${THEME.success}-fg}${t('online')}{/${THEME.success}-fg}` : `{${THEME.danger}-fg}${t('offline')}{/${THEME.danger}-fg}`}`,
      `  {${THEME.info}-fg}⌘{/} Host: {bold}${os.hostname()}{/bold}    {${THEME.info}-fg}⏱{/} Uptime: ${h}h ${m}m    {${THEME.info}-fg}📦{/} Platform: ${os.type()} ${os.release()}`,
    ].join('\n');

    this.statusBox.setContent(content);
  }

  private createSparkline(values: number[], width: number, color: string): string {
    const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const max = Math.max(...values, 1);
    
    const result: string[] = [];
    for (let i = Math.max(0, values.length - width); i < values.length; i++) {
      const idx = Math.min(Math.floor((values[i] / max) * (chars.length - 1)), chars.length - 1);
      result.push(`{${color}-fg}${chars[idx]}{/${color}-fg}`);
    }
    while (result.length < width) {
      result.unshift(`{${THEME.muted}-fg}▁{/${THEME.muted}-fg}`);
    }
    return result.join('');
  }

  private createProgressBar(percent: number, width: number, color: string): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return `{${color}-fg}${'█'.repeat(filled)}{/${color}-fg}{${THEME.muted}-fg}${'░'.repeat(empty)}{/${THEME.muted}-fg}`;
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

    // 记录历史
    this.cpuHistory.push(cpuPercent);
    this.memHistory.push(memPercent);
    if (this.cpuHistory.length > 30) {
      this.cpuHistory.shift();
      this.memHistory.shift();
    }

    const cpuColor = cpuPercent > 80 ? THEME.danger : cpuPercent > 50 ? THEME.warning : THEME.success;
    const memColor = memPercent > 80 ? THEME.danger : memPercent > 50 ? THEME.warning : THEME.success;

    const content = [
      '',
      `  {${THEME.info}-fg}CPU{/}  ${this.createProgressBar(cpuPercent, 20, cpuColor)} {bold}${cpuPercent}%{/bold}`,
      `       ${this.createSparkline(this.cpuHistory, 30, cpuColor)}`,
      '',
      `  {${THEME.info}-fg}MEM{/}  ${this.createProgressBar(memPercent, 20, memColor)} {bold}${memPercent}%{/bold}`,
      `       ${this.createSparkline(this.memHistory, 30, memColor)}`,
      '',
      `  {${THEME.muted}-fg} cores: ${cpus.length} │ total: ${(totalMem / 1024 / 1024 / 1024).toFixed(1)}GB │ used: ${(usedMem / 1024 / 1024 / 1024).toFixed(1)}GB{/${THEME.muted}-fg}`,
    ].join('\n');

    this.resourceBox.setContent(content);
  }

  private async refreshSecurity(): Promise<void> {
    const lines: string[] = [''];

    // CVE 扫描
    if (!this.lastCveResult || Date.now() - new Date(this.lastCveResult.lastChecked).getTime() > 60000) {
      this.lastCveResult = await cveDatabase.scan();
    }

    const cveResult = this.lastCveResult;
    
    if (cveResult.openclawInstalled && cveResult.openclawVersion) {
      if (cveResult.totalCVEs > 0) {
        lines.push(`  {${THEME.danger}-fg}⚠ ${t('cve')}: ${cveResult.totalCVEs} ${t('vulnerabilities')}{/${THEME.danger}-fg}`);
        
        if (cveResult.criticalCount > 0) {
          lines.push(`    {${THEME.danger}-fg}🚨 ${t('critical')}: ${cveResult.criticalCount}{/${THEME.danger}-fg}`);
        }
        if (cveResult.highCount > 0) {
          lines.push(`    {${THEME.warning}-fg}▲ ${t('high')}: ${cveResult.highCount}{/${THEME.warning}-fg}`);
        }
        if (cveResult.exploitedCount > 0) {
          lines.push(`    {${THEME.danger}-fg}⚡ ${t('exploited')}: ${cveResult.exploitedCount}{/${THEME.danger}-fg}`);
        }
      } else {
        lines.push(`  {${THEME.success}-fg}${t('noVulns')}{/${THEME.success}-fg}`);
      }
    } else {
      lines.push(`  {${THEME.muted}-fg}OpenClaw ${t('notInstalled')}{/${THEME.muted}-fg}`);
    }

    lines.push('');

    // 合规性得分
    if (this.lastComplianceScore === null) {
      try {
        const report = await complianceChecker.check({ minLevel: 'high' });
        this.lastComplianceScore = report.score;
      } catch {
        this.lastComplianceScore = 0;
      }
    }

    const score = this.lastComplianceScore;
    const scoreColor = score >= 90 ? THEME.success : score >= 70 ? THEME.warning : THEME.danger;
    const scoreIcon = score >= 90 ? '✓' : score >= 70 ? '!' : '✗';
    
    lines.push(`  {${THEME.info}-fg}${t('compliance')}{/${THEME.info}-fg}: {${scoreColor}-fg}{bold}${score}${t('score')}{/bold}{/${scoreColor}-fg} {${scoreColor}-fg}${scoreIcon}{/${scoreColor}-fg}`);
    lines.push(`  ${this.createProgressBar(score, 24, scoreColor)}`);
    lines.push('');

    this.securityBox.setContent(lines.join('\n'));
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
        items.push(`  {${THEME.muted}-fg}${t('noAgentsConfigured')}{/${THEME.muted}-fg}`);
        items.push('');
        items.push(`  {${THEME.info}-fg}→ openclaw-guard agent create{/${THEME.info}-fg}`);
      } else {
        for (const agent of agents) {
          const isDefault = agent.default ? ` {${THEME.success}-fg}${t('defaultAgent')}{/${THEME.success}-fg}` : '';
          const icon = agent.default ? `{${THEME.success}-fg}●{/${THEME.success}-fg}` : `○`;
          items.push(`  ${icon} {bold}${agent.id}{/bold}${isDefault}`);
          
          const primaryModel = defaults?.model?.primary;
          if (primaryModel) {
            const m = primaryModel.length > 16 ? primaryModel.slice(0, 13) + '...' : primaryModel;
            items.push(`    {${THEME.muted}-fg}${t('model')}: {${THEME.info}-fg}${m}{/${THEME.info}-fg}{/${THEME.muted}-fg}`);
          }
          
          const agentBindings = bindings.filter(b => b.agentId === agent.id);
          if (agentBindings.length > 0) {
            const channels = [...new Set(agentBindings.map(b => b.match.channel))];
            items.push(`    {${THEME.muted}-fg}${t('bindings')}: {${THEME.warning}-fg}${agentBindings.length}{/${THEME.warning}-fg} ({${THEME.muted}-fg}${channels.slice(0, 2).join(', ')}{/${THEME.muted}-fg}){/${THEME.muted}-fg}`);
          }
          
          items.push('');
        }
      }
    } else {
      items.push(`  {${THEME.danger}-fg}✗ ${t('configNotFound')}{/${THEME.danger}-fg}`);
      items.push('');
      items.push(`  {${THEME.info}-fg}→ openclaw-guard config init{/${THEME.info}-fg}`);
    }

    this.agentsBox.setItems(items);
  }

  private async refreshDiagnostics(): Promise<void> {
    const data: string[][] = [];
    const hasConfig = await configExists();

    const cfgIcon = hasConfig ? `{${THEME.success}-fg}✓{/${THEME.success}-fg}` : `{${THEME.danger}-fg}✗{/${THEME.danger}-fg}`;
    const cfgStatus = hasConfig ? `{${THEME.success}-fg}${t('ok')}{/${THEME.success}-fg}` : `{${THEME.danger}-fg}${t('missing')}{/${THEME.danger}-fg}`;
    data.push([`${cfgIcon} Config`, cfgStatus, hasConfig ? `~/.openclaw/openclaw.json` : 'Run: config init']);

    const gatewayRunning = await isGatewayRunning();
    const gwIcon = gatewayRunning ? `{${THEME.success}-fg}✓{/${THEME.success}-fg}` : `{${THEME.warning}-fg}○{/${THEME.warning}-fg}`;
    const gwStatus = gatewayRunning ? `{${THEME.success}-fg}${t('running')}{/${THEME.success}-fg}` : `{${THEME.warning}-fg}${t('stopped')}{/${THEME.warning}-fg}`;
    data.push([`${gwIcon} ${t('gateway')}`, gwStatus, gatewayRunning ? `Port 18789` : 'Run: openclaw gateway']);

    const openclawDir = getOpenClawDir();
    const dirs = ['logs', 'workspace', 'plugins', 'devices'];
    for (const dir of dirs) {
      const exists = await fs.pathExists(path.join(openclawDir, dir));
      const icon = exists ? `{${THEME.success}-fg}✓{/${THEME.success}-fg}` : `{${THEME.danger}-fg}✗{/${THEME.danger}-fg}`;
      const status = exists ? `{${THEME.success}-fg}${t('ok')}{/${THEME.success}-fg}` : `{${THEME.danger}-fg}${t('missing')}{/${THEME.danger}-fg}`;
      data.push([`${icon} ${dir}`, status, '']);
    }

    this.table.setData({
      headers: [isEnglish() ? 'Check' : '检查项', isEnglish() ? 'Status' : '状态', isEnglish() ? 'Details' : '详情'],
      data,
    });
  }

  private async refreshAlerts(): Promise<void> {
    const alertLogPath = path.join(getOpenClawDir(), 'logs', 'security-alerts.log');
    const items: string[] = [];

    if (await fs.pathExists(alertLogPath)) {
      try {
        const content = await fs.readFile(alertLogPath, 'utf-8');
        const lines = content.trim().split('\n').slice(-8).reverse();
        
        for (const line of lines) {
          try {
            const alert = JSON.parse(line);
            const time = new Date(alert.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const icon = alert.level === 'critical' ? `{${THEME.danger}-fg}[!]{/${THEME.danger}-fg}` 
                       : alert.level === 'high' ? `{${THEME.warning}-fg}[*]{/${THEME.warning}-fg}` 
                       : `{${THEME.info}-fg}[-]{/${THEME.info}-fg}`;
            const name = alert.rule?.name || (isEnglish() ? 'Unknown' : '未知');
            items.push(`  ${icon} {${THEME.muted}-fg}${time}{/${THEME.muted}-fg} ${name}`);
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    if (items.length === 0) {
      items.push(`  {${THEME.success}-fg}${t('noRecentAlerts')}{/${THEME.success}-fg}`);
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