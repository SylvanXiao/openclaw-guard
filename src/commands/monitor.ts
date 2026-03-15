import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { DangerDetector, AlertSystem, LogMonitor, DANGER_RULES, RiskLevel, NetworkMonitor, DeviceMonitor } from '../monitor';
import { AuthorizationManager } from '../monitor/authorization';
import { DaemonManager } from '../lib/daemon';
import { KnowledgeManager } from '../lib/knowledge';

export function registerMonitorCommand(program: Command) {
  const monitorCmd = program.command('monitor').description('Real-time security monitoring');

  // start 子命令
  monitorCmd
    .command('start')
    .description('Start real-time security monitoring')
    .option('--webhook <url>', 'Webhook URL for alerts')
    .option('--dingtalk <webhook>', 'DingTalk webhook URL')
    .option('--wecom <webhook>', 'WeCom (企业微信) webhook URL')
    .option('--feishu <webhook>', 'Feishu (飞书) webhook URL')
    .option('--no-terminal', 'Disable terminal output')
    .option('--rules <rules...>', 'Specific rules to enable')
    .option('--level <level>', 'Minimum alert level (critical/high/medium/low)', 'medium')
    .option('--include-authorized', 'Also alert on authorized actions')
    .option('--network', 'Enable network connection monitoring')
    .option('--ports <ports...>', 'Gateway ports to monitor', ['18789'])
    .option('--devices', 'Enable device pairing monitoring')
    .action(async (options) => {
      console.log(chalk.blue('🛡️  Starting OpenClaw Security Monitor'));
      console.log();

      const logDir = path.join(os.homedir(), '.openclaw', 'logs');
      if (!(await fs.pathExists(logDir))) {
        console.log(chalk.yellow('Creating log directory...'));
        await fs.ensureDir(logDir);
      }

      const detector = new DangerDetector();
      await detector.initialize(); // 加载授权数据

      const levelOrder: Record<RiskLevel, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      const minLevel = levelOrder[options.level as RiskLevel] ?? 2;

      DANGER_RULES.forEach(rule => {
        if (levelOrder[rule.level] > minLevel) {
          detector.disableRule(rule.id);
        }
      });

      if (options.rules && options.rules.length > 0) {
        DANGER_RULES.forEach(rule => {
          if (!options.rules.includes(rule.id)) {
            detector.disableRule(rule.id);
          }
        });
      }

      const enabledRules = detector.getEnabledRules();
      console.log(`Enabled ${enabledRules.length} detection rules:`);
      console.log(`  Critical: ${enabledRules.filter(r => r.level === 'critical').length}`);
      console.log(`  High: ${enabledRules.filter(r => r.level === 'high').length}`);
      console.log(`  Medium: ${enabledRules.filter(r => r.level === 'medium').length}`);
      console.log(`  Low: ${enabledRules.filter(r => r.level === 'low').length}`);
      console.log();

      // 显示启用的通知渠道
      const alertChannels: string[] = ['terminal', 'log'];
      if (options.webhook) alertChannels.push('webhook');
      if (options.dingtalk) alertChannels.push('dingtalk');
      if (options.wecom) alertChannels.push('wecom');
      if (options.feishu) alertChannels.push('feishu');
      console.log(`Alert channels: ${alertChannels.join(', ')}`);
      console.log();

      const alertSystem = new AlertSystem({
        terminal: options.terminal !== false,
        logFile: true,
        webhook: options.webhook,
        dingtalk: options.dingtalk ? { webhook: options.dingtalk } : undefined,
        wecom: options.wecom ? { webhook: options.wecom } : undefined,
        feishu: options.feishu ? { webhook: options.feishu } : undefined,
        skipAuthorized: !options.includeAuthorized,
      });

      const logMonitor = new LogMonitor(detector, alertSystem);

      // 网络监控
      let networkMonitor: NetworkMonitor | null = null;
      if (options.network) {
        const ports = options.ports.map((p: string) => parseInt(p, 10)).filter((n: number) => !isNaN(n));
        networkMonitor = new NetworkMonitor(alertSystem, ports);
      }

      // 设备监控
      let deviceMonitor: DeviceMonitor | null = null;
      if (options.devices) {
        deviceMonitor = new DeviceMonitor(detector, alertSystem);
      }

      process.on('SIGINT', async () => {
        console.log();
        console.log('Stopping monitor...');
        await logMonitor.stop();
        if (networkMonitor) await networkMonitor.stop();
        if (deviceMonitor) await deviceMonitor.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await logMonitor.stop();
        if (networkMonitor) await networkMonitor.stop();
        if (deviceMonitor) await deviceMonitor.stop();
        process.exit(0);
      });

      // 检查知识库自动同步
      const knowledgeManager = new KnowledgeManager();
      await knowledgeManager.initialize();
      await knowledgeManager.checkAutoSync();

      await logMonitor.start();
      if (networkMonitor) await networkMonitor.start();
      if (deviceMonitor) await deviceMonitor.start();

      console.log();
      console.log(chalk.green('✓ Monitor started'));
      console.log('Authorized actions will be logged but not alerted.');
      if (options.network) console.log('Network monitoring enabled.');
      if (options.devices) console.log('Device monitoring enabled.');
      console.log('Press Ctrl+C to stop');
      console.log();

      process.stdin.resume();
    });

  // daemon 子命令 - 后台守护进程
  monitorCmd
    .command('daemon')
    .description('Start monitor as daemon (background process)')
    .option('--webhook <url>', 'Webhook URL for alerts')
    .option('--dingtalk <webhook>', 'DingTalk webhook URL')
    .option('--wecom <webhook>', 'WeCom (企业微信) webhook URL')
    .option('--feishu <webhook>', 'Feishu (飞书) webhook URL')
    .option('--rules <rules...>', 'Specific rules to enable')
    .option('--level <level>', 'Minimum alert level (critical/high/medium/low)', 'medium')
    .option('--include-authorized', 'Also alert on authorized actions')
    .option('--network', 'Enable network connection monitoring')
    .option('--ports <ports...>', 'Gateway ports to monitor', ['18789'])
    .option('--devices', 'Enable device pairing monitoring')
    .option('--knowledge-sync-url <url>', 'Remote knowledge base URL for auto-sync')
    .option('--knowledge-sync-interval <hours>', 'Auto-sync interval in hours', parseFloat)
    .action(async (options) => {
      console.log(chalk.blue('🛡️  Starting OpenClaw Security Monitor (Daemon)'));
      console.log();

      const daemon = new DaemonManager();

      const config = {
        level: options.level,
        network: options.network || false,
        devices: options.devices || false,
        ports: options.ports,
        webhook: options.webhook,
        dingtalk: options.dingtalk,
        wecom: options.wecom,
        feishu: options.feishu,
        includeAuthorized: options.includeAuthorized || false,
        rules: options.rules,
        knowledgeSyncUrl: options.knowledgeSyncUrl,
        knowledgeSyncInterval: options.knowledgeSyncInterval,
      };

      const result = await daemon.start(config);

      if (result.success) {
        console.log(chalk.green(`✓ Monitor started in background (PID: ${result.pid})`));
        console.log();
        console.log('Options:');
        console.log(`  Level: ${config.level}`);
        if (config.network) console.log('  Network monitoring: enabled');
        if (config.devices) console.log('  Device monitoring: enabled');
        if (config.knowledgeSyncUrl) {
          console.log(`  Knowledge sync: ${config.knowledgeSyncInterval || 24}h interval from ${config.knowledgeSyncUrl}`);
        }
        console.log();
        console.log('Commands:');
        console.log(`  ${chalk.gray('openclaw-guard monitor stop')}     - Stop daemon`);
        console.log(`  ${chalk.gray('openclaw-guard monitor restart')}  - Restart daemon`);
        console.log(`  ${chalk.gray('openclaw-guard monitor status')}   - Check status`);
        console.log(`  ${chalk.gray('openclaw-guard monitor logs')}     - View logs`);
      } else {
        console.log(chalk.red(`✗ ${result.error}`));
      }
    });

  // stop 子命令
  monitorCmd
    .command('stop')
    .description('Stop daemon monitor')
    .action(async () => {
      console.log(chalk.blue('🛑 Stopping Monitor Daemon'));
      console.log();

      const daemon = new DaemonManager();
      const result = await daemon.stop();

      if (result.success) {
        console.log(chalk.green(`✓ ${result.message}`));
      } else {
        console.log(chalk.red(`✗ ${result.message}`));
      }
    });

  // restart 子命令
  monitorCmd
    .command('restart')
    .description('Restart daemon monitor')
    .action(async () => {
      console.log(chalk.blue('🔄 Restarting Monitor Daemon'));
      console.log();

      const daemon = new DaemonManager();
      const result = await daemon.restart();

      if (result.success) {
        console.log(chalk.green(`✓ ${result.message}`));
      } else {
        console.log(chalk.red(`✗ ${result.message}`));
      }
    });

  // logs 子命令
  monitorCmd
    .command('logs')
    .description('View daemon logs')
    .option('-n, --lines <number>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow log output')
    .action(async (options) => {
      const daemon = new DaemonManager();
      const logPath = daemon.getLogPath();

      if (!(await fs.pathExists(logPath))) {
        console.log(chalk.yellow('No logs yet. Start daemon first.'));
        return;
      }

      if (options.follow) {
        const { spawn } = await import('child_process');
        const tail = spawn('tail', ['-f', logPath], { stdio: 'inherit' });
        process.on('SIGINT', () => {
          tail.kill();
          process.exit(0);
        });
      } else {
        const lines = parseInt(options.lines) || 50;
        const content = await fs.readFile(logPath, 'utf-8');
        const allLines = content.trim().split('\n');
        const recent = allLines.slice(-lines);
        console.log(recent.join('\n'));
        console.log();
        console.log(chalk.gray(`Showing last ${Math.min(lines, allLines.length)} lines of ${logPath}`));
      }
    });

  // authorize 子命令
  monitorCmd
    .command('authorize <ruleId> [pattern]')
    .description('Authorize a dangerous action pattern')
    .option('-d, --description <text>', 'Description of the authorization')
    .option('-r, --reason <text>', 'Reason for authorization')
    .option('-e, --expires <duration>', 'Expiration time (e.g., 1h, 24h, 7d)')
    .action(async (ruleId, pattern, options) => {
      console.log(chalk.blue('🔑 Authorize Action'));
      console.log();

      // 查找规则
      const rule = DANGER_RULES.find(r => r.id === ruleId);
      if (!rule) {
        console.log(chalk.red(`Rule "${ruleId}" not found`));
        console.log('Use: openclaw-guard monitor rules');
        return;
      }

      // 如果没有提供 pattern，提示输入
      if (!pattern) {
        const { inputPattern } = await inquirer.prompt([
          {
            type: 'input',
            name: 'inputPattern',
            message: 'Pattern to authorize (regex or literal):',
          },
        ]);
        pattern = inputPattern;
      }

      // 解析过期时间
      let expiresAt: Date | undefined;
      if (options.expires) {
        const match = options.expires.match(/^(\d+)(h|d|w|m)$/i);
        if (match) {
          const value = parseInt(match[1]);
          const unit = match[2].toLowerCase();
          const now = new Date();
          
          switch (unit) {
            case 'h': now.setHours(now.getHours() + value); break;
            case 'd': now.setDate(now.getDate() + value); break;
            case 'w': now.setDate(now.getDate() + value * 7); break;
            case 'm': now.setMonth(now.getMonth() + value); break;
          }
          
          expiresAt = now;
        }
      }

      const authManager = new AuthorizationManager();
      await authManager.load();

      const auth = await authManager.authorize({
        ruleId,
        pattern,
        description: options.description || `Authorized ${rule.name}`,
        authorizedBy: 'admin', // TODO: 从上下文获取用户
        expiresAt,
        reason: options.reason,
      });

      console.log(chalk.green('✓ Authorization created'));
      console.log();
      console.log(`  Rule: ${rule.name} (${rule.level})`);
      console.log(`  Pattern: ${pattern}`);
      console.log(`  ID: ${auth.id}`);
      if (expiresAt) {
        console.log(`  Expires: ${expiresAt.toLocaleString('zh-CN')}`);
      }
      console.log();
      console.log('This action will no longer trigger alerts.');
    });

  // revoke 子命令
  monitorCmd
    .command('revoke [authId]')
    .description('Revoke an authorization')
    .action(async (authId) => {
      const authManager = new AuthorizationManager();
      await authManager.load();

      const authorizations = authManager.listActive();

      if (authorizations.length === 0) {
        console.log(chalk.yellow('No active authorizations'));
        return;
      }

      if (!authId) {
        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Select authorization to revoke:',
            choices: authorizations.map(a => ({
              name: `${a.ruleId}: ${a.pattern} (${a.description})`,
              value: a.id,
            })),
          },
        ]);
        authId = selected;
      }

      const revoked = await authManager.revoke(authId);
      if (revoked) {
        console.log(chalk.green('✓ Authorization revoked'));
      } else {
        console.log(chalk.red('Authorization not found'));
      }
    });

  // authorizations 子命令
  monitorCmd
    .command('authorizations')
    .description('List all active authorizations')
    .option('--all', 'Include expired authorizations')
    .action(async (options) => {
      console.log(chalk.blue('📋 Active Authorizations'));
      console.log();

      const authManager = new AuthorizationManager();
      await authManager.load();

      const active = authManager.listActive();
      const expired = options.all ? authManager.listExpired() : [];

      if (active.length === 0 && expired.length === 0) {
        console.log('No authorizations');
        return;
      }

      if (active.length > 0) {
        console.log(chalk.bold('Active:'));
        for (const auth of active) {
          const rule = DANGER_RULES.find(r => r.id === auth.ruleId);
          const levelIcon = rule ? getLevelIcon(rule.level) : '❓';
          
          console.log(`  ${levelIcon} ${chalk.bold(auth.id)}`);
          console.log(chalk.gray(`    Rule: ${auth.ruleId}`));
          console.log(chalk.gray(`    Pattern: ${auth.pattern}`));
          console.log(chalk.gray(`    Description: ${auth.description}`));
          console.log(chalk.gray(`    Authorized: ${auth.authorizedAt.toLocaleString('zh-CN')} by ${auth.authorizedBy}`));
          if (auth.expiresAt) {
            const expired = new Date() > auth.expiresAt;
            console.log(chalk.gray(`    Expires: ${auth.expiresAt.toLocaleString('zh-CN')}` + (expired ? ' (EXPIRED)' : '')));
          }
          console.log();
        }
      }

      if (expired.length > 0) {
        console.log(chalk.bold('Expired:'));
        for (const auth of expired) {
          console.log(chalk.gray(`  ${auth.id}: ${auth.ruleId} - ${auth.pattern}`));
        }
      }
    });

  // status 子命令
  monitorCmd
    .command('status')
    .description('Check monitor status')
    .action(async () => {
      console.log(chalk.blue('📊 Monitor Status'));
      console.log();

      const alertLogPath = path.join(os.homedir(), '.openclaw', 'logs', 'security-alerts.log');
      const authLogPath = path.join(os.homedir(), '.openclaw', 'logs', 'authorized-actions.log');

      // 警报统计
      if (await fs.pathExists(alertLogPath)) {
        const content = await fs.readFile(alertLogPath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        console.log(`Total alerts: ${lines.length}`);

        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const recentAlerts = lines
          .map(line => { try { return JSON.parse(line); } catch { return null; } })
          .filter(alert => alert && new Date(alert.timestamp).getTime() > oneDayAgo);
        console.log(`Alerts in last 24h: ${recentAlerts.length}`);
      }

      // 授权统计
      const authManager = new AuthorizationManager();
      await authManager.load();
      console.log(`Active authorizations: ${authManager.listActive().length}`);

      // 授权操作统计
      if (await fs.pathExists(authLogPath)) {
        const content = await fs.readFile(authLogPath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        console.log(`Authorized actions logged: ${lines.length}`);
      }
    });

  // rules 子命令
  monitorCmd
    .command('rules')
    .description('List all detection rules')
    .option('--level <level>', 'Filter by level')
    .option('--category <category>', 'Filter by category')
    .action(async (options) => {
      console.log(chalk.blue('📋 Detection Rules'));
      console.log();

      let rules = DANGER_RULES;

      if (options.level) {
        rules = rules.filter(r => r.level === options.level);
      }

      if (options.category) {
        rules = rules.filter(r => r.categories.includes(options.category));
      }

      const grouped: Record<RiskLevel, typeof rules> = {
        critical: [],
        high: [],
        medium: [],
        low: [],
      };

      rules.forEach(rule => {
        grouped[rule.level].push(rule);
      });

      for (const level of ['critical', 'high', 'medium', 'low'] as RiskLevel[]) {
        const levelRules = grouped[level];
        if (levelRules.length === 0) continue;

        console.log(`${getLevelIcon(level)} ${level.toUpperCase()} (${levelRules.length})`);

        for (const rule of levelRules) {
          console.log(`  ${chalk.bold(rule.id)}`);
          console.log(chalk.gray(`    ${rule.description}`));
        }

        console.log();
      }

      console.log(`Total: ${rules.length} rules`);
    });

  // test 子命令
  monitorCmd
    .command('test [command]')
    .description('Test detection rules against a command')
    .action(async (testCommand) => {
      console.log(chalk.blue('🧪 Test Detection'));
      console.log();

      if (!testCommand) {
        const { input } = await inquirer.prompt([
          {
            type: 'input',
            name: 'input',
            message: 'Enter command to test:',
          },
        ]);
        testCommand = input;
      }

      const detector = new DangerDetector();
      await detector.initialize();
      const results = await detector.detect(testCommand);

      if (results.length === 0) {
        console.log(chalk.green('✓ No dangerous patterns detected'));
        return;
      }

      console.log(chalk.red(`✗ ${results.length} dangerous pattern(s) detected:`));
      console.log();

      for (const result of results) {
        const icon = getLevelIcon(result.rule.level);
        const authStatus = result.authorized 
          ? chalk.green(' [AUTHORIZED]') 
          : chalk.yellow(' [NOT AUTHORIZED]');
        
        console.log(`${icon} ${chalk.bold(result.rule.name)} (${result.rule.level})${authStatus}`);
        console.log(chalk.gray(`  Matched: ${result.matched}`));
        console.log(chalk.gray(`  Rule: ${result.rule.id}`));
        console.log(chalk.gray(`  Action: ${result.rule.action || 'warn'}`));
        
        if (result.authorization) {
          console.log(chalk.gray(`  Authorized by: ${result.authorization.authorizedBy} at ${result.authorization.authorizedAt.toLocaleString('zh-CN')}`));
        }
        console.log();
      }
    });

  // history 子命令
  monitorCmd
    .command('history')
    .description('Show alert history')
    .option('-n, --limit <number>', 'Number of alerts to show', '20')
    .action(async (options) => {
      console.log(chalk.blue('📜 Alert History'));
      console.log();

      const alertLogPath = path.join(os.homedir(), '.openclaw', 'logs', 'security-alerts.log');

      if (!(await fs.pathExists(alertLogPath))) {
        console.log('No alerts recorded yet');
        return;
      }

      const content = await fs.readFile(alertLogPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const limit = parseInt(options.limit) || 20;
      const recent = lines.slice(-limit);

      for (const line of recent.reverse()) {
        try {
          const alert = JSON.parse(line);
          const icon = getLevelIcon(alert.level);
          const time = new Date(alert.timestamp).toLocaleString('zh-CN');
          const authStatus = alert.authorized ? ' [AUTHORIZED]' : '';

          console.log(`${icon} ${chalk.bold(alert.rule.name)} - ${alert.level}${authStatus}`);
          console.log(chalk.gray(`  Time: ${time}`));
          console.log(chalk.gray(`  Matched: ${alert.matched}`));
          console.log();
        } catch {
          // 忽略解析错误
        }
      }

      console.log(`Showing last ${Math.min(limit, lines.length)} of ${lines.length} alerts`);
    });

  // devices 子命令
  monitorCmd
    .command('devices')
    .description('List paired devices')
    .option('-w, --watch', 'Watch for new device pairings')
    .action(async (options) => {
      console.log(chalk.blue('📱 Paired Devices'));
      console.log();

      const devicesPath = path.join(os.homedir(), '.openclaw', 'devices', 'paired.json');

      if (!(await fs.pathExists(devicesPath))) {
        console.log('No devices paired yet');
        return;
      }

      const data = await fs.readJson(devicesPath);
      const devices = Object.entries(data);

      if (devices.length === 0) {
        console.log('No devices paired yet');
        return;
      }

      console.log(`Found ${devices.length} paired device(s):\n`);

      for (const [deviceId, info] of devices) {
        const device = info as any;
        console.log(chalk.bold(`📱 ${device.displayName || 'Unknown Device'}`));
        console.log(chalk.gray(`  Device ID: ${deviceId.substring(0, 24)}...`));
        if (device.platform) console.log(chalk.gray(`  Platform: ${device.platform}`));
        if (device.role) console.log(chalk.gray(`  Role: ${device.role}`));
        if (device.approvedAtMs) {
          console.log(chalk.gray(`  Approved: ${new Date(device.approvedAtMs).toLocaleString('zh-CN')}`));
        }
        if (device.createdAtMs) {
          console.log(chalk.gray(`  Created: ${new Date(device.createdAtMs).toLocaleString('zh-CN')}`));
        }
        console.log();
      }

      if (options.watch) {
        console.log(chalk.blue('Watching for new device pairings...'));
        console.log('Press Ctrl+C to stop\n');

        const detector = new DangerDetector();
        const alertSystem = new AlertSystem({ terminal: true, logFile: true });
        const deviceMonitor = new DeviceMonitor(detector, alertSystem);

        process.on('SIGINT', async () => {
          await deviceMonitor.stop();
          process.exit(0);
        });

        await deviceMonitor.start();
        process.stdin.resume();
      }
    });

  // connections 子命令
  monitorCmd
    .command('connections')
    .description('List active Gateway connections')
    .option('-w, --watch', 'Watch for new connections')
    .option('--ports <ports...>', 'Gateway ports to monitor', ['18789'])
    .action(async (options) => {
      console.log(chalk.blue('🌐 Gateway Connections'));
      console.log();

      const alertSystem = new AlertSystem({ terminal: true, logFile: false });
      const ports = options.ports.map((p: string) => parseInt(p, 10)).filter((n: number) => !isNaN(n));
      const networkMonitor = new NetworkMonitor(alertSystem, ports);

      const connections = await networkMonitor.getCurrentConnections();

      if (connections.length === 0) {
        console.log('No active remote connections to Gateway');
      } else {
        console.log(`Found ${connections.length} active connection(s):\n`);

        for (const conn of connections) {
          const isLocal = conn.remoteAddress === '127.0.0.1' || 
                         conn.remoteAddress === '::1' || 
                         conn.remoteAddress === '[::1]';
          const icon = isLocal ? '💻' : '🌐';

          console.log(`${icon} ${chalk.bold(conn.remoteAddress)}:${conn.remotePort}`);
          console.log(chalk.gray(`  Local: ${conn.localAddress}:${conn.localPort}`));
          console.log(chalk.gray(`  State: ${conn.state}`));
          console.log();
        }
      }

      if (options.watch) {
        console.log(chalk.blue('Watching for new connections...'));
        console.log('Press Ctrl+C to stop\n');

        process.on('SIGINT', async () => {
          await networkMonitor.stop();
          process.exit(0);
        });

        await networkMonitor.start();
        process.stdin.resume();
      }
    });
}

function getLevelIcon(level: RiskLevel): string {
  switch (level) {
    case 'critical': return '🚨';
    case 'high': return '🔴';
    case 'medium': return '🟡';
    case 'low': return '🔵';
  }
}