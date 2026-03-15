import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import { loadConfig, configExists, getOpenClawDir } from '../lib/config';
import { SecurityIssue } from '../types';

export function registerSecurityCommand(program: Command) {
  const securityCmd = program.command('security').description('Security audit and hardening');

  // audit 子命令
  securityCmd
    .command('audit')
    .description('Run security audit')
    .action(async () => {
      console.log(chalk.blue('🔒 OpenClaw Security Audit'));
      console.log();

      const issues: SecurityIssue[] = [];

      // 1. 检查配置文件权限
      const openclawDir = getOpenClawDir();
      const configPath = path.join(openclawDir, 'openclaw.json');

      if (await fs.pathExists(configPath)) {
        const stat = await fs.stat(configPath);
        const mode = (stat.mode & 0o777);
        
        if (mode & 0o004) { // world readable
          issues.push({
            severity: 'medium',
            category: 'File Permissions',
            issue: 'Config file is world-readable',
            location: configPath,
            recommendation: 'Run: chmod 600 ~/.openclaw/openclaw.json',
          });
        }
      }

      // 2. 检查 API Key 存储
      const config = await loadConfig();
      if (config) {
        // 检查 models.providers 中的 apiKey
        for (const [providerName, provider] of Object.entries(config.models?.providers || {})) {
          const prov = provider as any;
          if (prov.apiKey && prov.apiKey.startsWith('sk-')) {
            issues.push({
              severity: 'medium',
              category: 'Credential Storage',
              issue: `API key for ${providerName} is stored in plain text`,
              location: 'openclaw.json → models.providers.' + providerName,
              recommendation: 'Consider using environment variables or auth profiles',
            });
          }
        }

        // 检查渠道凭证
        for (const [channelName, channel] of Object.entries(config.channels || {})) {
          const ch = channel as any;
          if (ch.clientSecret || ch.gatewayToken) {
            issues.push({
              severity: 'medium',
              category: 'Credential Storage',
              issue: `Credentials for ${channelName} stored in config`,
              location: 'openclaw.json → channels.' + channelName,
              recommendation: 'Use environment variables or secure credential storage',
            });
          }
        }
      }

      // 3. 检查 Gateway 绑定
      if (config?.gateway) {
        const bind = config.gateway.bind;
        const authMode = config.gateway.auth?.mode;

        if (bind && bind !== '127.0.0.1' && bind !== 'localhost') {
          if (authMode === 'none' || !authMode) {
            issues.push({
              severity: 'high',
              category: 'Network Security',
              issue: 'Gateway binds to non-localhost without authentication',
              recommendation: 'Set gateway.auth.mode to "token" or "password"',
            });
          }

          if (authMode === 'password' && !config.gateway.auth?.token) {
            issues.push({
              severity: 'high',
              category: 'Network Security',
              issue: 'Password authentication enabled but no password set',
              recommendation: 'Set gateway.auth.token to a secure password',
            });
          }
        }
      }

      // 4. 检查日志中的敏感信息
      const logsDir = path.join(openclawDir, 'logs');
      if (await fs.pathExists(logsDir)) {
        const logFiles = await fs.readdir(logsDir);
        for (const logFile of logFiles) {
          if (logFile.endsWith('.log')) {
            const content = await fs.readFile(path.join(logsDir, logFile), 'utf-8');
            
            // 检查 API keys
            if (content.includes('sk-') && content.match(/sk-[a-zA-Z0-9]{20,}/)) {
              issues.push({
                severity: 'high',
                category: 'Log Security',
                issue: 'API key may be exposed in logs',
                location: path.join(logsDir, logFile),
                recommendation: 'Review and clean logs, configure log redaction',
              });
            }

            // 检查 tokens
            if (content.includes('token') && content.match(/"token"\s*:\s*"[a-zA-Z0-9]{20,}"/)) {
              issues.push({
                severity: 'medium',
                category: 'Log Security',
                issue: 'Tokens may be logged',
                location: path.join(logsDir, logFile),
                recommendation: 'Review logs for sensitive data',
              });
            }
          }
        }
      }

      // 5. 检查工具权限
      if (config?.tools) {
        // 检查 exec 权限
        const toolsConfig = config.tools as any;
        if (toolsConfig.elevated || !toolsConfig.deny) {
          issues.push({
            severity: 'low',
            category: 'Tool Permissions',
            issue: 'No explicit tool restrictions configured',
            recommendation: 'Consider setting tools.deny for sensitive operations',
          });
        }
      }

      // 6. 检查沙箱模式
      if (config?.agents?.list) {
        for (const agent of config.agents.list) {
          const agentConfig = agent as any;
          if (!agentConfig.sandbox || agentConfig.sandbox?.mode === 'off') {
            issues.push({
              severity: 'low',
              category: 'Sandbox',
              issue: `Agent "${agent.id}" has no sandbox configured`,
              recommendation: 'Consider enabling sandbox for untrusted inputs',
            });
          }
        }
      }

      // 打印结果
      printSecurityReport(issues);
    });

  // harden 子命令
  securityCmd
    .command('harden')
    .description('Apply security hardening recommendations')
    .option('-y, --yes', 'Apply without confirmation')
    .action(async (options) => {
      console.log(chalk.blue('🛡️  Security Hardening'));
      console.log();

      const openclawDir = getOpenClawDir();

      // 1. 设置文件权限
      console.log('1. Setting secure file permissions...');
      const spinner = ora('chmod 700 ~/.openclaw').start();
      try {
        await fs.chmod(openclawDir, 0o700);
        
        const configPath = path.join(openclawDir, 'openclaw.json');
        if (await fs.pathExists(configPath)) {
          await fs.chmod(configPath, 0o600);
        }
        
        spinner.succeed('Permissions set');
      } catch (error: any) {
        spinner.fail(error.message);
      }

      // 2. 启用 Gateway 认证
      const config = await loadConfig();
      if (config) {
        if (config.gateway?.bind && config.gateway.bind !== '127.0.0.1') {
          if (!config.gateway.auth?.mode || config.gateway.auth.mode === 'none') {
            console.log();
            console.log('2. Gateway authentication...');
            
            if (!options.yes) {
              const inquirer = await import('inquirer');
              const { enable } = await inquirer.default.prompt([
                {
                  type: 'confirm',
                  name: 'enable',
                  message: 'Enable token authentication for Gateway?',
                  default: true,
                },
              ]);
              
              if (enable) {
                const crypto = await import('crypto');
                const token = crypto.randomBytes(32).toString('hex');
                config.gateway = config.gateway || {};
                config.gateway.auth = { mode: 'token', token };
                const { saveConfig } = await import('../lib/config');
                await saveConfig(config);
                console.log(chalk.green(`  ✓ Token generated and saved`));
              }
            }
          }
        }
      }

      console.log();
      console.log(chalk.green('✅ Hardening complete'));
    });

  // tokens 子命令
  securityCmd
    .command('tokens')
    .description('Check for exposed tokens in configuration and logs')
    .action(async () => {
      console.log(chalk.blue('🔑 Token Exposure Check'));
      console.log();

      const config = await loadConfig();
      const exposed: string[] = [];

      if (config) {
        // 检查配置中的 tokens
        const configStr = JSON.stringify(config, null, 2);
        
        const patterns = [
          { name: 'API Key (sk-*)', pattern: /sk-[a-zA-Z0-9]{20,}/g },
          { name: 'Gateway Token', pattern: /"token"\s*:\s*"[a-zA-Z0-9]{20,}"/g },
          { name: 'Client Secret', pattern: /"clientSecret"\s*:\s*"[a-zA-Z0-9]{16,}"/g },
        ];

        for (const { name, pattern } of patterns) {
          const matches = configStr.match(pattern);
          if (matches) {
            exposed.push(`${name}: ${matches.length} occurrence(s) in config`);
          }
        }
      }

      if (exposed.length > 0) {
        console.log(chalk.yellow('Potential token exposures found:'));
        exposed.forEach(e => console.log(chalk.yellow(`  • ${e}`)));
        console.log();
        console.log('Recommendations:');
        console.log('  • Use environment variables for secrets');
        console.log('  • Add ~/.openclaw to .gitignore');
        console.log('  • Restrict file permissions (chmod 600)');
      } else {
        console.log(chalk.green('✓ No obvious token exposures found'));
      }
    });
}

function printSecurityReport(issues: SecurityIssue[]) {
  if (issues.length === 0) {
    console.log(chalk.green('✓ No security issues found'));
    return;
  }

  // 按严重程度分组
  const high = issues.filter(i => i.severity === 'high');
  const medium = issues.filter(i => i.severity === 'medium');
  const low = issues.filter(i => i.severity === 'low');

  if (high.length > 0) {
    console.log(chalk.red.bold('HIGH SEVERITY'));
    high.forEach(i => printIssue(i));
    console.log();
  }

  if (medium.length > 0) {
    console.log(chalk.yellow.bold('MEDIUM SEVERITY'));
    medium.forEach(i => printIssue(i));
    console.log();
  }

  if (low.length > 0) {
    console.log(chalk.blue.bold('LOW SEVERITY'));
    low.forEach(i => printIssue(i));
    console.log();
  }

  console.log(chalk.bold('Summary:'));
  console.log(`  ${chalk.red('●')} ${high.length} High`);
  console.log(`  ${chalk.yellow('●')} ${medium.length} Medium`);
  console.log(`  ${chalk.blue('●')} ${low.length} Low`);
}

function printIssue(issue: SecurityIssue) {
  const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🔵';
  console.log(`  ${icon} ${issue.category}: ${issue.issue}`);
  if (issue.location) {
    console.log(chalk.gray(`     Location: ${issue.location}`));
  }
  console.log(chalk.gray(`     Fix: ${issue.recommendation}`));
}
