import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import os from 'os';
import execa = require('execa');
import { checkNodeVersion, isOpenClawInstalled, getOpenClawVersion, isGatewayRunning } from '../lib/system';
import { loadConfig, configExists, getOpenClawDir } from '../lib/config';
import { DiagnosisResult } from '../types';
import { AutoFixer } from '../lib/fixer';
import fs from 'fs-extra';

interface ReportData {
  timestamp: string;
  hostname: string;
  platform: string;
  nodeVersion: string;
  openclawVersion: string;
  results: DiagnosisResult[];
  summary: {
    ok: number;
    warning: number;
    error: number;
  };
}

export function registerDiagnoseCommand(program: Command) {
  program
    .command('diagnose')
    .description('Run comprehensive diagnostics')
    .option('--fix', 'Attempt to fix issues automatically')
    .option('--report <format>', 'Export report (markdown/html/json)', '')
    .option('--output <path>', 'Output file path for report')
    .action(async (options) => {
      console.log(chalk.blue('🔍 OpenClaw Diagnostics'));
      console.log();

      const results: DiagnosisResult[] = [];

      // 1. Node.js 检查
      const nodeCheck = await checkNodeVersion();
      results.push({
        category: 'Environment',
        check: 'Node.js version',
        status: nodeCheck.satisfied ? 'ok' : 'error',
        message: nodeCheck.installed 
          ? `v${nodeCheck.installed} ${nodeCheck.satisfied ? '' : `(requires >= ${nodeCheck.required})`}`
          : 'Not installed',
        fix: !nodeCheck.satisfied ? 'Install Node.js >= 22.16.0' : undefined,
      });

      // 2. OpenClaw 安装检查
      const openclawInstalled = await isOpenClawInstalled();
      const openclawVersion = await getOpenClawVersion();
      results.push({
        category: 'Installation',
        check: 'OpenClaw',
        status: openclawInstalled ? 'ok' : 'error',
        message: openclawInstalled ? `v${openclawVersion}` : 'Not installed',
        fix: !openclawInstalled ? 'Run: npm install -g openclaw' : undefined,
      });

      // 3. 配置检查
      const hasConfig = await configExists();
      results.push({
        category: 'Configuration',
        check: 'Config file',
        status: hasConfig ? 'ok' : 'warning',
        message: hasConfig ? 'Found at ~/.openclaw/openclaw.json' : 'Not found',
        fix: !hasConfig ? 'Run: openclaw-guard config init' : undefined,
      });

      // 4. Gateway 检查
      const gatewayRunning = await isGatewayRunning();
      results.push({
        category: 'Gateway',
        check: 'Gateway status',
        status: gatewayRunning ? 'ok' : 'warning',
        message: gatewayRunning ? 'Running' : 'Not running',
        fix: !gatewayRunning ? 'Run: openclaw gateway start' : undefined,
      });

      // 5. 配置内容检查
      if (hasConfig) {
        const config = await loadConfig();
        if (config) {
          // 检查认证
          if (config.gateway?.bind && config.gateway.bind !== '127.0.0.1' && config.gateway.bind !== 'localhost') {
            if (config.gateway.auth?.mode === 'none') {
              results.push({
                category: 'Security',
                check: 'Gateway auth',
                status: 'error',
                message: 'Gateway binds to non-localhost without authentication',
                fix: 'Set gateway.auth.mode to "token" or "password"',
              });
            }
          }

          // 检查智能体
          const agentCount = config.agents?.list?.length || 0;
          results.push({
            category: 'Agents',
            check: 'Agent count',
            status: agentCount > 0 ? 'ok' : 'warning',
            message: `${agentCount} agent(s) configured`,
          });

          // 检查绑定
          const bindingCount = config.bindings?.length || 0;
          results.push({
            category: 'Routing',
            check: 'Binding count',
            status: bindingCount > 0 ? 'ok' : 'warning',
            message: `${bindingCount} binding(s) configured`,
          });
        }
      }

      // 6. 端口检查
      if (hasConfig) {
        const config = await loadConfig();
        const port = config?.gateway?.port || 18789;
        try {
          const { stdout } = await execa('ss', ['-tlnp']);
          const portInUse = stdout.includes(`:${port}`);
          results.push({
            category: 'Network',
            check: `Port ${port}`,
            status: portInUse ? 'ok' : 'warning',
            message: portInUse ? 'In use' : 'Available (gateway not running?)',
          });
        } catch {
          // ss 命令不可用
        }
      }

      // 7. 文件权限检查
      const openclawDir = getOpenClawDir();
      if (await fs.pathExists(openclawDir)) {
        try {
          const stat = await fs.stat(openclawDir);
          const mode = (stat.mode & 0o777).toString(8);
          results.push({
            category: 'Permissions',
            check: 'Config directory',
            status: mode === '700' ? 'ok' : 'warning',
            message: `Permissions: ${mode}`,
            fix: mode !== '700' ? 'Run: chmod 700 ~/.openclaw' : undefined,
          });
        } catch {
          // 忽略错误
        }
      }

      // 8. 运行时检测
      console.log(chalk.gray('\n⏳ Running runtime checks...\n'));
      
      // 8.1 测试 openclaw 命令
      try {
        const { stdout, stderr } = await execa('openclaw', ['--version'], { timeout: 10000 });
        if (stdout.includes('OpenClaw')) {
          results.push({
            category: 'Runtime',
            check: 'CLI executable',
            status: 'ok',
            message: 'Responds to --version',
          });
        } else {
          results.push({
            category: 'Runtime',
            check: 'CLI executable',
            status: 'warning',
            message: 'Unexpected output',
          });
        }
      } catch (error: any) {
        results.push({
          category: 'Runtime',
          check: 'CLI executable',
          status: 'error',
          message: error.message || 'Failed to execute',
          fix: 'Reinstall: npm install -g openclaw',
        });
      }

      // 8.2 测试 agents 命令（检查配置加载）
      try {
        const { stdout, stderr } = await execa('openclaw', ['agents'], { timeout: 15000 });
        
        // 检查警告
        const warnings: string[] = [];
        const fullOutput = stdout + stderr;
        
        if (fullOutput.includes('Config warnings') || fullOutput.includes('duplicate plugin')) {
          const warningMatch = fullOutput.match(/Config warnings:[\s\S]*?(?=\n\n|\n\[|$)/g);
          if (warningMatch) {
            warnings.push(...warningMatch.map(w => w.trim()));
          }
        }
        
        if (fullOutput.includes('plugins.allow is empty')) {
          warnings.push('plugins.allow is empty - untrusted plugins may auto-load');
        }

        if (warnings.length > 0) {
          results.push({
            category: 'Runtime',
            check: 'Config loading',
            status: 'warning',
            message: `${warnings.length} warning(s): ${warnings[0].substring(0, 80)}...`,
            fix: 'Review and fix config warnings',
          });
        } else {
          results.push({
            category: 'Runtime',
            check: 'Config loading',
            status: 'ok',
            message: 'No warnings',
          });
        }

        // 检查 agents 是否加载
        const agentCount = (stdout.match(/- \w+ \(/g) || []).length;
        results.push({
          category: 'Runtime',
          check: 'Agents loaded',
          status: agentCount > 0 ? 'ok' : 'warning',
          message: `${agentCount} agent(s) loaded at runtime`,
        });

      } catch (error: any) {
        results.push({
          category: 'Runtime',
          check: 'Config loading',
          status: 'error',
          message: error.message || 'Failed to load config',
          fix: 'Check openclaw.json for errors',
        });
      }

      // 8.3 测试 Gateway API
      try {
        const config = await loadConfig();
        const port = config?.gateway?.port || 18789;
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        
        if (response.ok) {
          const data = await response.json() as { status?: string };
          results.push({
            category: 'Runtime',
            check: 'Gateway API',
            status: 'ok',
            message: `Health: ${data.status || 'ok'}`,
          });
        } else {
          results.push({
            category: 'Runtime',
            check: 'Gateway API',
            status: 'warning',
            message: `HTTP ${response.status}`,
            fix: 'Check gateway logs',
          });
        }
      } catch (error: any) {
        results.push({
          category: 'Runtime',
          check: 'Gateway API',
          status: 'error',
          message: 'Not responding',
          fix: 'Start gateway: openclaw gateway',
        });
      }

      // 8.4 检查插件状态
      try {
        const extensionsDir = path.join(openclawDir, 'extensions');
        if (await fs.pathExists(extensionsDir)) {
          const plugins = await fs.readdir(extensionsDir);
          
          // 检查重复插件
          const pluginIds = new Map<string, string[]>();
          for (const plugin of plugins) {
            const manifestPath = path.join(extensionsDir, plugin, 'manifest.json');
            const indexPath = path.join(extensionsDir, plugin, 'index.ts');
            
            if (await fs.pathExists(manifestPath)) {
              try {
                const manifest = await fs.readJson(manifestPath);
                const id = manifest.id || plugin;
                if (!pluginIds.has(id)) pluginIds.set(id, []);
                pluginIds.get(id)!.push(plugin);
              } catch {}
            }
          }

          const duplicates = Array.from(pluginIds.entries()).filter(([_, paths]) => paths.length > 1);
          
          if (duplicates.length > 0) {
            results.push({
              category: 'Runtime',
              check: 'Plugins',
              status: 'warning',
              message: `Duplicate plugin IDs: ${duplicates.map(([id, _]) => id).join(', ')}`,
              fix: 'Remove duplicate plugin directories',
            });
          } else {
            results.push({
              category: 'Runtime',
              check: 'Plugins',
              status: 'ok',
              message: `${plugins.length} plugin(s), no duplicates`,
            });
          }
        }
      } catch (error: any) {
        results.push({
          category: 'Runtime',
          check: 'Plugins',
          status: 'warning',
          message: 'Could not check plugins',
        });
      }

      // 打印结果
      printResults(results);

      // 导出报告
      if (options.report) {
        const reportData: ReportData = {
          timestamp: new Date().toISOString(),
          hostname: os.hostname(),
          platform: `${os.type()} ${os.release()}`,
          nodeVersion: process.version,
          openclawVersion: openclawVersion || 'unknown',
          results,
          summary: {
            ok: results.filter(r => r.status === 'ok').length,
            warning: results.filter(r => r.status === 'warning').length,
            error: results.filter(r => r.status === 'error').length,
          },
        };

        const outputPath = await exportReport(reportData, options.report, options.output);
        console.log();
        console.log(chalk.green(`✓ Report exported to: ${outputPath}`));
      }

      // 自动修复
      if (options.fix) {
        console.log();
        console.log(chalk.blue('🔧 Attempting auto-fix...\n'));
        
        const fixer = new AutoFixer();
        
        // 显示 AI 状态
        if (fixer.isAIEnabled()) {
          console.log(chalk.cyan('🤖 AI-assisted diagnosis enabled\n'));
        }
        
        await fixer.fixAll(results);
        fixer.printResults();
        
        // 修复后重新诊断
        console.log();
        console.log(chalk.blue('🔄 Re-running diagnostics...\n'));
        
        const recheckResults: DiagnosisResult[] = [];
        
        const requiredDirs = ['logs', 'workspace', 'plugins', 'devices'];
        for (const dir of requiredDirs) {
          const dirPath = path.join(getOpenClawDir(), dir);
          recheckResults.push({
            category: 'Directories',
            check: dir,
            status: (await fs.pathExists(dirPath)) ? 'ok' : 'error',
            message: (await fs.pathExists(dirPath)) ? 'Exists' : 'Missing',
          });
        }
        
        const openclawDir = getOpenClawDir();
        if (await fs.pathExists(openclawDir)) {
          const stat = await fs.stat(openclawDir);
          const mode = (stat.mode & 0o777).toString(8);
          recheckResults.push({
            category: 'Permissions',
            check: 'Config directory',
            status: mode === '700' ? 'ok' : 'warning',
            message: `Permissions: ${mode}`,
          });
        }
        
        const gatewayRunningNow = await isGatewayRunning();
        recheckResults.push({
          category: 'Gateway',
          check: 'Gateway status',
          status: gatewayRunningNow ? 'ok' : 'warning',
          message: gatewayRunningNow ? 'Running' : 'Not running',
        });
        
        printResults(recheckResults);
      }
    });
}

function printResults(results: DiagnosisResult[]) {
  const grouped = results.reduce((acc, r) => {
    if (!acc[r.category]) acc[r.category] = [];
    acc[r.category].push(r);
    return acc;
  }, {} as Record<string, DiagnosisResult[]>);

  for (const [category, checks] of Object.entries(grouped)) {
    console.log(chalk.bold(category));
    for (const check of checks) {
      const icon = check.status === 'ok' ? '✓' : check.status === 'warning' ? '⚠' : '✗';
      const color = check.status === 'ok' ? chalk.green : check.status === 'warning' ? chalk.yellow : chalk.red;
      console.log(`  ${color(icon)} ${check.check}: ${check.message}`);
      if (check.fix) {
        console.log(chalk.gray(`    Fix: ${check.fix}`));
      }
    }
    console.log();
  }

  const ok = results.filter(r => r.status === 'ok').length;
  const warn = results.filter(r => r.status === 'warning').length;
  const error = results.filter(r => r.status === 'error').length;

  console.log(chalk.bold('Summary:'));
  console.log(`  ${chalk.green('✓')} ${ok} OK`);
  console.log(`  ${chalk.yellow('⚠')} ${warn} Warnings`);
  console.log(`  ${chalk.red('✗')} ${error} Errors`);
}

async function exportReport(data: ReportData, format: string, outputPath?: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const defaultDir = path.join(os.homedir(), '.openclaw', 'reports');
  await fs.ensureDir(defaultDir);

  let content: string;
  let extension: string;

  switch (format.toLowerCase()) {
    case 'markdown':
    case 'md':
      content = generateMarkdownReport(data);
      extension = 'md';
      break;
    case 'html':
      content = generateHtmlReport(data);
      extension = 'html';
      break;
    case 'json':
      content = JSON.stringify(data, null, 2);
      extension = 'json';
      break;
    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  const finalPath = outputPath || path.join(defaultDir, `diagnostic-report-${timestamp}.${extension}`);
  await fs.writeFile(finalPath, content, 'utf-8');
  return finalPath;
}

function generateMarkdownReport(data: ReportData): string {
  const lines: string[] = [
    `# OpenClaw Diagnostic Report`,
    ``,
    `**Generated:** ${new Date(data.timestamp).toLocaleString('zh-CN')}`,
    `**Hostname:** ${data.hostname}`,
    `**Platform:** ${data.platform}`,
    `**Node.js:** ${data.nodeVersion}`,
    `**OpenClaw:** ${data.openclawVersion}`,
    ``,
    `## Summary`,
    ``,
    `| Status | Count |`,
    `|--------|-------|`,
    `| ✅ OK | ${data.summary.ok} |`,
    `| ⚠️ Warning | ${data.summary.warning} |`,
    `| ❌ Error | ${data.summary.error} |`,
    ``,
  ];

  // 按类别分组
  const grouped = data.results.reduce((acc, r) => {
    if (!acc[r.category]) acc[r.category] = [];
    acc[r.category].push(r);
    return acc;
  }, {} as Record<string, DiagnosisResult[]>);

  for (const [category, checks] of Object.entries(grouped)) {
    lines.push(`## ${category}`);
    lines.push('');
    lines.push('| Check | Status | Message | Fix |');
    lines.push('|-------|--------|---------|-----|');
    
    for (const check of checks) {
      const icon = check.status === 'ok' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
      const fix = check.fix ? check.fix.replace(/\|/g, '\\|') : '-';
      lines.push(`| ${check.check} | ${icon} ${check.status} | ${check.message.replace(/\|/g, '\\|')} | ${fix} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Report generated by openclaw-guard*');

  return lines.join('\n');
}

function generateHtmlReport(data: ReportData): string {
  const statusColors: Record<string, string> = {
    ok: '#28a745',
    warning: '#ffc107',
    error: '#dc3545',
  };

  const statusIcons: Record<string, string> = {
    ok: '✅',
    warning: '⚠️',
    error: '❌',
  };

  // 按类别分组
  const grouped = data.results.reduce((acc, r) => {
    if (!acc[r.category]) acc[r.category] = [];
    acc[r.category].push(r);
    return acc;
  }, {} as Record<string, DiagnosisResult[]>);

  let categoriesHtml = '';
  for (const [category, checks] of Object.entries(grouped)) {
    categoriesHtml += `
      <div class="category">
        <h2>${category}</h2>
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Status</th>
              <th>Message</th>
              <th>Fix</th>
            </tr>
          </thead>
          <tbody>
            ${checks.map(check => `
              <tr>
                <td>${check.check}</td>
                <td style="color: ${statusColors[check.status]}">${statusIcons[check.status]} ${check.status}</td>
                <td>${check.message}</td>
                <td>${check.fix ? `<code>${check.fix}</code>` : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenClaw Diagnostic Report</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      max-width: 1000px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
    h2 { color: #555; margin-top: 30px; }
    .meta { background: #fff; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .meta span { margin-right: 20px; }
    .summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-bottom: 30px;
    }
    .summary-item {
      background: #fff;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    .summary-item.ok { border-left: 4px solid ${statusColors.ok}; }
    .summary-item.warning { border-left: 4px solid ${statusColors.warning}; }
    .summary-item.error { border-left: 4px solid ${statusColors.error}; }
    .summary-item .count { font-size: 2em; font-weight: bold; }
    .category { background: #fff; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; }
    code { background: #f1f1f1; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    .footer { text-align: center; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; }
  </style>
</head>
<body>
  <h1>🔍 OpenClaw Diagnostic Report</h1>
  
  <div class="meta">
    <span>📅 <strong>Generated:</strong> ${new Date(data.timestamp).toLocaleString('zh-CN')}</span>
    <span>🖥️ <strong>Hostname:</strong> ${data.hostname}</span>
    <span>💻 <strong>Platform:</strong> ${data.platform}</span>
    <span>📦 <strong>Node.js:</strong> ${data.nodeVersion}</span>
    <span>🤖 <strong>OpenClaw:</strong> ${data.openclawVersion}</span>
  </div>

  <div class="summary">
    <div class="summary-item ok">
      <div class="count">${data.summary.ok}</div>
      <div>✅ OK</div>
    </div>
    <div class="summary-item warning">
      <div class="count">${data.summary.warning}</div>
      <div>⚠️ Warnings</div>
    </div>
    <div class="summary-item error">
      <div class="count">${data.summary.error}</div>
      <div>❌ Errors</div>
    </div>
  </div>

  ${categoriesHtml}

  <div class="footer">
    Report generated by <strong>openclaw-guard</strong>
  </div>
</body>
</html>`;
}