import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { loadConfig, configExists, getOpenClawDir } from '../lib/config';
import { SecurityIssue } from '../types';
import { cveDatabase, CVEDatabase } from '../lib/cve-database';
import { complianceChecker, ComplianceChecker, ComplianceStandard } from '../lib/compliance';
import { PromptInjectionDetector } from '../monitor/prompt-injection';

export function registerSecurityCommand(program: Command) {
  const securityCmd = program.command('security').description('Security audit and hardening');

  // audit 子命令
  securityCmd
    .command('audit')
    .description('Run comprehensive security audit')
    .option('--cve', 'Include CVE vulnerability scan')
    .option('--compliance', 'Include compliance check')
    .option('--standard <standard>', 'Compliance standard (OWASP-LLM, ISO27001, SOC2, GDPR, PCI-DSS)')
    .action(async (options) => {
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

      // 打印基础审计结果
      printSecurityReport(issues);

      // CVE 扫描
      if (options.cve) {
        console.log();
        console.log(chalk.blue('🔍 CVE Vulnerability Scan'));
        console.log();
        
        const spinner = ora('Scanning for known vulnerabilities...').start();
        const cveResult = await cveDatabase.scan();
        spinner.stop();
        
        console.log(cveDatabase.generateReport(cveResult));
      }

      // 合规性检查
      if (options.compliance || options.standard) {
        console.log();
        console.log(chalk.blue('📋 Compliance Check'));
        console.log();
        
        const standards: ComplianceStandard[] | undefined = options.standard 
          ? [options.standard as ComplianceStandard]
          : undefined;
        
        const spinner = ora('Running compliance checks...').start();
        const complianceReport = await complianceChecker.check(standards ? { standards } : undefined);
        spinner.stop();
        
        console.log(complianceChecker.generateReport(complianceReport));
      }
    });

  // cve 子命令
  securityCmd
    .command('cve')
    .description('Scan for known OpenClaw vulnerabilities')
    .option('--detail', 'Show detailed CVE information')
    .action(async (options) => {
      console.log(chalk.blue('🔍 OpenClaw CVE Vulnerability Scan'));
      console.log();

      const spinner = ora('Scanning for known vulnerabilities...').start();
      const result = await cveDatabase.scan();
      spinner.stop();

      console.log(cveDatabase.generateReport(result));

      if (options.detail && result.vulnerabilities.length > 0) {
        console.log();
        console.log(chalk.bold('Detailed CVE Information:'));
        console.log();

        for (const cve of result.vulnerabilities) {
          console.log(chalk.bold(`${cve.cveId} - ${cve.title}`));
          console.log(chalk.gray('─'.repeat(60)));
          console.log(`CVSS Score: ${cve.cvssScore}`);
          console.log(`Severity: ${cve.severity.toUpperCase()}`);
          console.log(`Category: ${cve.category}`);
          console.log(`Published: ${cve.publishedDate}`);
          console.log(`Exploited: ${cve.exploited ? chalk.red('Yes') : 'No'}`);
          console.log();
          console.log('Description:');
          console.log(chalk.gray(cve.description));
          console.log();
          console.log(`Fixed Versions: ${cve.fixedVersions.join(', ')}`);
          
          if (cve.references.length > 0) {
            console.log();
            console.log('References:');
            cve.references.forEach(ref => console.log(chalk.blue(`  ${ref}`)));
          }
          console.log();
        }
      }
    });

  // compliance 子命令
  securityCmd
    .command('compliance')
    .description('Run compliance checks')
    .option('--standard <standard>', 'Specific compliance standard (OWASP-LLM, ISO27001, SOC2, GDPR, PCI-DSS)')
    .option('--category <category>', 'Specific category (authentication, encryption, access-control, logging, data-protection, network, configuration, agent-security)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      console.log(chalk.blue('📋 OpenClaw Compliance Check'));
      console.log();

      const checkOptions: any = {};
      
      if (options.standard) {
        checkOptions.standards = [options.standard as ComplianceStandard];
      }
      
      if (options.category) {
        checkOptions.categories = [options.category];
      }

      const spinner = ora('Running compliance checks...').start();
      const report = await complianceChecker.check(checkOptions);
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(complianceChecker.generateReport(report));
      }
    });

  // injection 子命令
  securityCmd
    .command('injection')
    .description('Test for prompt injection vulnerabilities')
    .option('--text <text>', 'Text to analyze')
    .option('--file <file>', 'File to analyze')
    .action(async (options) => {
      console.log(chalk.blue('🛡️  Prompt Injection Detection'));
      console.log();

      const detector = new PromptInjectionDetector();
      let content = '';

      if (options.text) {
        content = options.text;
      } else if (options.file) {
        try {
          content = await fs.readFile(options.file, 'utf-8');
          console.log(chalk.gray(`Analyzing file: ${options.file}`));
          console.log();
        } catch (error) {
          console.log(chalk.red(`Failed to read file: ${options.file}`));
          return;
        }
      } else {
        // 交互式输入 - 使用 input 而非 editor
        console.log(chalk.cyan('Enter text to analyze (or type a file path):'));
        console.log(chalk.gray('Tip: Use --file option for longer content'));
        console.log();
        
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'content',
            message: 'Text or file path:',
          },
        ]);
        
        // 检查是否是文件路径
        const inputPath = answers.content.trim();
        if (await fs.pathExists(inputPath)) {
          try {
            content = await fs.readFile(inputPath, 'utf-8');
            console.log(chalk.gray(`Loaded from file: ${inputPath}`));
          } catch {
            content = answers.content;
          }
        } else {
          content = answers.content;
        }
      }

      if (!content.trim()) {
        console.log(chalk.yellow('No content to analyze'));
        return;
      }

      // 执行检测
      const spinner = ora('Analyzing for prompt injection patterns...').start();
      const results = await detector.detect(content);
      spinner.stop();

      // 检测隐藏内容
      const hiddenResults = await detector.detectHiddenInjection(content);

      if (results.length === 0 && !hiddenResults.hasHiddenContent) {
        console.log(chalk.green('✓ No prompt injection risks detected'));
        return;
      }

      // 显示结果
      console.log(detector.generateReport(results));

      if (hiddenResults.hasHiddenContent) {
        console.log();
        console.log(chalk.yellow.bold('⚠️  Hidden Content Detected:'));
        hiddenResults.findings.forEach(f => console.log(chalk.yellow(`  • ${f}`)));
      }
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
              const { enable } = await inquirer.prompt([
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

      // 3. 运行合规性检查
      console.log();
      console.log('3. Running compliance check...');
      const report = await complianceChecker.check({ minLevel: 'high' });
      
      if (report.failedChecks > 0) {
        console.log(chalk.yellow(`  Found ${report.failedChecks} issues to address`));
        
        for (const result of report.results) {
          if (!result.passed && result.remediation) {
            console.log(chalk.gray(`  • ${result.ruleId}: ${result.remediation}`));
          }
        }
      } else {
        console.log(chalk.green('  ✓ All critical compliance checks passed'));
      }

      // 4. CVE 检查
      console.log();
      console.log('4. Checking for known vulnerabilities...');
      const cveResult = await cveDatabase.scan();
      
      if (cveResult.vulnerabilities.length > 0) {
        console.log(chalk.red(`  Found ${cveResult.totalCVEs} vulnerabilities!`));
        console.log(chalk.gray(`  Run: openclaw upgrade`));
      } else {
        console.log(chalk.green('  ✓ No known vulnerabilities'));
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

  // rules 子命令
  securityCmd
    .command('rules')
    .description('List and manage security detection rules')
    .option('--category <category>', 'Filter by category')
    .option('--level <level>', 'Filter by risk level (critical, high, medium, low)')
    .action(async (options) => {
      const { DANGER_RULES, getRulesByLevel, getRulesByCategory } = await import('../monitor/rules');
      
      console.log(chalk.blue('📋 Security Detection Rules'));
      console.log();

      let rules = DANGER_RULES;

      if (options.level) {
        rules = getRulesByLevel(options.level);
      }

      if (options.category) {
        rules = rules.filter(r => r.categories.includes(options.category));
      }

      console.log(`Total rules: ${rules.length}`);
      console.log();

      // 按严重程度分组
      const critical = rules.filter(r => r.level === 'critical');
      const high = rules.filter(r => r.level === 'high');
      const medium = rules.filter(r => r.level === 'medium');
      const low = rules.filter(r => r.level === 'low');

      if (critical.length > 0) {
        console.log(chalk.red.bold('🚨 Critical'));
        critical.forEach(r => console.log(`  ${r.id}: ${r.name}`));
        console.log();
      }

      if (high.length > 0) {
        console.log(chalk.yellow.bold('🔴 High'));
        high.forEach(r => console.log(`  ${r.id}: ${r.name}`));
        console.log();
      }

      if (medium.length > 0) {
        console.log(chalk.blue.bold('🟡 Medium'));
        medium.forEach(r => console.log(`  ${r.id}: ${r.name}`));
        console.log();
      }

      if (low.length > 0) {
        console.log(chalk.gray.bold('🔵 Low'));
        low.forEach(r => console.log(`  ${r.id}: ${r.name}`));
        console.log();
      }

      // 显示统计
      const categories = new Set<string>();
      rules.forEach(r => r.categories.forEach(c => categories.add(c)));
      
      console.log(chalk.bold('Categories:'));
      console.log(`  ${Array.from(categories).join(', ')}`);
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