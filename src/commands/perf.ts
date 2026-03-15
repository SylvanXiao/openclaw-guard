import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import execa = require('execa');

interface PerformanceMetrics {
  timestamp: Date;
  gateway: {
    running: boolean;
    pid: number | null;
    cpu: number;
    memory: number;
    memoryMB: number;
  };
  system: {
    cpuPercent: number;
    memoryPercent: number;
    loadAvg: number[];
    uptime: number;
  };
  gatewayConfig: {
    port: number;
    mode: string;
  };
}

export function registerPerfCommand(program: Command) {
  const perfCmd = program.command('perf').description('Performance monitoring');

  // status 子命令
  perfCmd
    .command('status')
    .description('Show current performance metrics')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const metrics = await collectMetrics();

      if (options.json) {
        console.log(JSON.stringify(metrics, null, 2));
        return;
      }

      console.log(chalk.blue('📊 Performance Status'));
      console.log();

      // Gateway 状态
      console.log(chalk.bold('Gateway:'));
      if (metrics.gateway.running) {
        console.log(`  Status: ${chalk.green('Running')} (PID: ${metrics.gateway.pid})`);
        console.log(`  CPU: ${formatPercent(metrics.gateway.cpu)}`);
        console.log(`  Memory: ${formatBytes(metrics.gateway.memory)} (${formatPercent(metrics.gateway.memoryMB / 1024 * 100)})`);
      } else {
        console.log(`  Status: ${chalk.yellow('Not running')}`);
      }
      console.log();

      // 系统状态
      console.log(chalk.bold('System:'));
      console.log(`  CPU: ${formatPercent(metrics.system.cpuPercent)}`);
      console.log(`  Memory: ${formatPercent(metrics.system.memoryPercent)}`);
      console.log(`  Load Avg: ${metrics.system.loadAvg.map(l => l.toFixed(2)).join(', ')}`);
      console.log(`  Uptime: ${formatUptime(metrics.system.uptime)}`);
      console.log();

      // Gateway 配置
      console.log(chalk.bold('Gateway Config:'));
      console.log(`  Port: ${metrics.gatewayConfig.port}`);
      console.log(`  Mode: ${metrics.gatewayConfig.mode}`);
    });

  // watch 子命令
  perfCmd
    .command('watch')
    .description('Continuously monitor performance')
    .option('-i, --interval <seconds>', 'Refresh interval in seconds', '5')
    .action(async (options) => {
      const interval = parseInt(options.interval) * 1000;

      console.log(chalk.blue('📊 Performance Monitor'));
      console.log('Press Ctrl+C to stop');
      console.log();

      const render = async () => {
        const metrics = await collectMetrics();
        
        // 清屏并显示
        process.stdout.write('\x1b[2J\x1b[H');
        
        console.log(chalk.blue('📊 Performance Monitor') + chalk.gray(` (${new Date().toLocaleTimeString('zh-CN')})`));
        console.log();

        // Gateway
        console.log(chalk.bold('Gateway:'));
        if (metrics.gateway.running) {
          const cpuBar = createBar(metrics.gateway.cpu, 20);
          const memBar = createBar(metrics.gateway.memoryMB / 512 * 100, 20); // 假设 512MB 为基准
          
          console.log(`  Status: ${chalk.green('●')} Running (PID: ${metrics.gateway.pid})`);
          console.log(`  CPU:    ${cpuBar} ${metrics.gateway.cpu.toFixed(1)}%`);
          console.log(`  Memory: ${memBar} ${metrics.gateway.memoryMB.toFixed(0)} MB`);
        } else {
          console.log(`  Status: ${chalk.yellow('○')} Not running`);
        }
        console.log();

        // 系统
        console.log(chalk.bold('System:'));
        const sysCpuBar = createBar(metrics.system.cpuPercent, 20);
        const sysMemBar = createBar(metrics.system.memoryPercent, 20);
        
        console.log(`  CPU:    ${sysCpuBar} ${metrics.system.cpuPercent.toFixed(1)}%`);
        console.log(`  Memory: ${sysMemBar} ${metrics.system.memoryPercent.toFixed(1)}%`);
        console.log(`  Load:   ${metrics.system.loadAvg.map(l => l.toFixed(2)).join(' | ')}`);
        console.log();

        // 图例
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.gray('Press Ctrl+C to stop'));
      };

      await render();
      const timer = setInterval(render, interval);

      process.on('SIGINT', () => {
        clearInterval(timer);
        console.log('\nMonitoring stopped');
        process.exit(0);
      });
    });

  // top 子命令 - 类似 top 命令
  perfCmd
    .command('top')
    .description('Show top processes related to OpenClaw')
    .option('-n, --number <count>', 'Number of processes to show', '10')
    .action(async (options) => {
      console.log(chalk.blue('📊 OpenClaw Top'));
      console.log();

      try {
        // 获取所有 Node 进程
        const { stdout } = await execa('ps', ['aux', '--sort=-%mem']);
        const lines = stdout.split('\n');
        
        // 过滤相关进程
        const relevant = lines.filter(line => 
          line.includes('node') || 
          line.includes('openclaw') ||
          line.includes('gateway')
        );

        console.log(chalk.bold('PID      CPU%  MEM%   COMMAND'));
        console.log(chalk.gray('─'.repeat(60)));

        for (const line of relevant.slice(0, parseInt(options.number))) {
          const parts = line.split(/\s+/);
          if (parts.length >= 11) {
            const pid = parts[1];
            const cpu = parts[2];
            const mem = parts[3];
            const cmd = parts.slice(10).join(' ').substring(0, 40);
            
            const cpuNum = parseFloat(cpu);
            const memNum = parseFloat(mem);
            const cpuColor = cpuNum > 50 ? chalk.red : cpuNum > 20 ? chalk.yellow : chalk.green;
            const memColor = memNum > 50 ? chalk.red : memNum > 20 ? chalk.yellow : chalk.green;
            
            console.log(`${pid.padEnd(8)} ${cpuColor(cpu.padEnd(5))} ${memColor(mem.padEnd(6))} ${cmd}`);
          }
        }
      } catch (error) {
        console.log(chalk.yellow('Unable to get process information'));
      }
    });

  // history 子命令
  perfCmd
    .command('history')
    .description('Show performance history')
    .option('-n, --number <count>', 'Number of records to show', '20')
    .option('--save', 'Save current metrics to history')
    .action(async (options) => {
      const historyPath = path.join(os.homedir(), '.openclaw', 'logs', 'perf-history.jsonl');

      if (options.save) {
        const metrics = await collectMetrics();
        await fs.ensureDir(path.dirname(historyPath));
        await fs.appendFile(historyPath, JSON.stringify({
          ...metrics,
          timestamp: new Date().toISOString(),
        }) + '\n');
        console.log(chalk.green('✓ Metrics saved to history'));
        return;
      }

      if (!(await fs.pathExists(historyPath))) {
        console.log('No performance history found');
        console.log('Run: openclaw-guard perf history --save');
        return;
      }

      const content = await fs.readFile(historyPath, 'utf-8');
      const lines = content.trim().split('\n').slice(-parseInt(options.number));

      console.log(chalk.blue('📊 Performance History'));
      console.log();

      console.log('Time                 | CPU    | Memory | Gateway CPU | Gateway Mem');
      console.log(chalk.gray('─'.repeat(75)));

      for (const line of lines.reverse()) {
        try {
          const m = JSON.parse(line);
          const time = new Date(m.timestamp).toLocaleString('zh-CN');
          const sysCpu = `${m.system.cpuPercent.toFixed(1)}%`.padEnd(6);
          const sysMem = `${m.system.memoryPercent.toFixed(1)}%`.padEnd(6);
          const gwCpu = m.gateway.running ? `${m.gateway.cpu.toFixed(1)}%`.padEnd(11) : 'N/A'.padEnd(11);
          const gwMem = m.gateway.running ? `${m.gateway.memoryMB.toFixed(0)} MB` : 'N/A';
          
          console.log(`${time} | ${sysCpu} | ${sysMem} | ${gwCpu} | ${gwMem}`);
        } catch {
          // 忽略解析错误
        }
      }
    });
}

async function collectMetrics(): Promise<PerformanceMetrics> {
  // 获取 Gateway 进程信息
  let gatewayPid: number | null = null;
  let gatewayCpu = 0;
  let gatewayMemory = 0;
  let gatewayMemoryMB = 0;
  let gatewayRunning = false;

  try {
    const { stdout: pgrepOut } = await execa('pgrep', ['-f', 'openclaw gateway'], { reject: false });
    if (pgrepOut.trim()) {
      gatewayPid = parseInt(pgrepOut.trim().split('\n')[0]);
      gatewayRunning = true;

      // 获取进程资源使用
      if (gatewayPid) {
        try {
          const { stdout: psOut } = await execa('ps', ['-p', String(gatewayPid), '-o', '%cpu,%mem,rss', '--no-headers']);
          const parts = psOut.trim().split(/\s+/);
          gatewayCpu = parseFloat(parts[0]) || 0;
          gatewayMemory = parseFloat(parts[1]) || 0;
          gatewayMemoryMB = (parseInt(parts[2]) || 0) / 1024; // RSS in KB -> MB
        } catch {
          // 进程可能已结束
        }
      }
    }
  } catch {
    // pgrep 不可用或进程不存在
  }

  // 系统指标
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // CPU 计算
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += (cpu.times as any)[type];
    }
    totalIdle += cpu.times.idle;
  }
  const cpuPercent = 100 - (totalIdle / totalTick) * 100;

  // 读取 Gateway 配置
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  let gatewayPort = 18789;
  let gatewayMode = 'local';

  try {
    if (await fs.pathExists(configPath)) {
      const config = await fs.readJson(configPath);
      gatewayPort = config?.gateway?.port || 18789;
      gatewayMode = config?.gateway?.mode || 'local';
    }
  } catch {
    // 忽略配置读取错误
  }

  return {
    timestamp: new Date(),
    gateway: {
      running: gatewayRunning,
      pid: gatewayPid,
      cpu: gatewayCpu,
      memory: gatewayMemory,
      memoryMB: gatewayMemoryMB,
    },
    system: {
      cpuPercent,
      memoryPercent: (usedMem / totalMem) * 100,
      loadAvg: os.loadavg(),
      uptime: os.uptime(),
    },
    gatewayConfig: {
      port: gatewayPort,
      mode: gatewayMode,
    },
  };
}

function formatPercent(value: number): string {
  const formatted = value.toFixed(1) + '%';
  if (value > 80) return chalk.red(formatted);
  if (value > 50) return chalk.yellow(formatted);
  return chalk.green(formatted);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function createBar(percent: number, width: number): string {
  const filled = Math.min(width, Math.max(0, Math.round(percent / 100 * width)));
  const empty = width - filled;
  
  let bar = '█'.repeat(filled) + '░'.repeat(empty);
  
  if (percent > 80) bar = chalk.red(bar);
  else if (percent > 50) bar = chalk.yellow(bar);
  else bar = chalk.green(bar);
  
  return bar;
}
