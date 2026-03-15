import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

interface GuardConfig {
  ai?: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
    model: string;
  };
  alerts?: {
    dingtalk?: string;
    wecom?: string;
    feishu?: string;
    webhook?: string;
  };
}

export function registerGuardConfigCommand(program: Command) {
  const configCmd = program.command('guard-config').description('Configure openclaw-guard settings');

  // init 子命令
  configCmd
    .command('init')
    .description('Initialize openclaw-guard configuration')
    .action(async () => {
      console.log(chalk.blue('🛡️  OpenClaw Guard Configuration\n'));

      const configDir = path.join(os.homedir(), '.openclaw-guard');
      const configPath = path.join(configDir, 'config.json');

      // 检查现有配置
      let existingConfig: GuardConfig = {};
      if (await fs.pathExists(configPath)) {
        existingConfig = await fs.readJson(configPath);
        console.log(chalk.gray('Existing configuration found. Updating...\n'));
      }

      // AI 配置
      console.log(chalk.bold('AI Configuration'));
      console.log(chalk.gray('Used for intelligent diagnostics when OpenClaw\'s model is unavailable\n'));

      const aiAnswers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'configureAI',
          message: 'Configure backup AI provider?',
          default: true,
        },
      ]);

      if (aiAnswers.configureAI) {
        const aiConfig = await inquirer.prompt([
          {
            type: 'list',
            name: 'provider',
            message: 'AI provider:',
            choices: ['openai', 'anthropic', 'iflow', 'openrouter', 'custom'],
            default: existingConfig.ai?.provider || 'openai',
          },
          {
            type: 'input',
            name: 'apiKey',
            message: 'API key:',
            default: existingConfig.ai?.apiKey || '',
          },
          {
            type: 'input',
            name: 'baseUrl',
            message: 'API base URL (leave empty for default):',
            default: existingConfig.ai?.baseUrl || '',
          },
          {
            type: 'input',
            name: 'model',
            message: 'Model name:',
            default: existingConfig.ai?.model || 'gpt-4o-mini',
          },
        ]);

        existingConfig.ai = aiConfig;
      }

      // 告警配置
      console.log();
      console.log(chalk.bold('Alert Configuration'));
      console.log(chalk.gray('Configure notification channels for security alerts\n'));

      const alertAnswers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'configureAlerts',
          message: 'Configure alert channels?',
          default: false,
        },
      ]);

      if (alertAnswers.configureAlerts) {
        const alertConfig = await inquirer.prompt([
          {
            type: 'input',
            name: 'dingtalk',
            message: 'DingTalk webhook URL (leave empty to skip):',
            default: existingConfig.alerts?.dingtalk || '',
          },
          {
            type: 'input',
            name: 'wecom',
            message: 'WeCom webhook URL (leave empty to skip):',
            default: existingConfig.alerts?.wecom || '',
          },
          {
            type: 'input',
            name: 'feishu',
            message: 'Feishu webhook URL (leave empty to skip):',
            default: existingConfig.alerts?.feishu || '',
          },
          {
            type: 'input',
            name: 'webhook',
            message: 'Custom webhook URL (leave empty to skip):',
            default: existingConfig.alerts?.webhook || '',
          },
        ]);

        existingConfig.alerts = alertConfig;
      }

      // 保存配置
      await fs.ensureDir(configDir);
      await fs.writeJson(configPath, existingConfig, { spaces: 2 });

      console.log();
      console.log(chalk.green('✓ Configuration saved'));
      console.log(chalk.gray(`  Path: ${configPath}`));
    });

  // show 子命令
  configCmd
    .command('show')
    .description('Show current configuration')
    .action(async () => {
      const configPath = path.join(os.homedir(), '.openclaw-guard', 'config.json');

      if (!(await fs.pathExists(configPath))) {
        console.log(chalk.yellow('No configuration found'));
        console.log('Run: openclaw-guard guard-config init');
        return;
      }

      const config: GuardConfig = await fs.readJson(configPath);

      console.log(chalk.blue('🛡️  OpenClaw Guard Configuration\n'));
      console.log(`Config path: ${configPath}\n`);

      if (config.ai) {
        console.log(chalk.bold('AI Configuration:'));
        console.log(`  Provider: ${config.ai.provider}`);
        console.log(`  Model: ${config.ai.model}`);
        console.log(`  API Key: ${config.ai.apiKey ? config.ai.apiKey.substring(0, 8) + '...' : 'not set'}`);
        console.log(`  Base URL: ${config.ai.baseUrl || 'default'}`);
        console.log();
      }

      if (config.alerts) {
        console.log(chalk.bold('Alert Channels:'));
        if (config.alerts.dingtalk) console.log(`  DingTalk: ✓`);
        if (config.alerts.wecom) console.log(`  WeCom: ✓`);
        if (config.alerts.feishu) console.log(`  Feishu: ✓`);
        if (config.alerts.webhook) console.log(`  Webhook: ✓`);
        console.log();
      }
    });

  // set-ai 子命令
  configCmd
    .command('set-ai <provider> <apiKey> [model]')
    .description('Quick set AI configuration')
    .action(async (provider, apiKey, model) => {
      const configDir = path.join(os.homedir(), '.openclaw-guard');
      const configPath = path.join(configDir, 'config.json');

      let config: GuardConfig = {};
      if (await fs.pathExists(configPath)) {
        config = await fs.readJson(configPath);
      }

      config.ai = {
        provider,
        apiKey,
        model: model || getDefaultModel(provider),
      };

      await fs.ensureDir(configDir);
      await fs.writeJson(configPath, config, { spaces: 2 });

      console.log(chalk.green('✓ AI configuration saved'));
      console.log(`  Provider: ${provider}`);
      console.log(`  Model: ${config.ai.model}`);
    });

  // test 子命令
  configCmd
    .command('test')
    .description('Test AI configuration')
    .action(async () => {
      console.log(chalk.blue('🧪 Testing AI Configuration\n'));

      const configPath = path.join(os.homedir(), '.openclaw-guard', 'config.json');

      if (!(await fs.pathExists(configPath))) {
        console.log(chalk.yellow('No guard configuration found'));
        console.log('Testing OpenClaw configuration...\n');
      }

      // 测试连接
      const { AutoFixer } = await import('../lib/fixer');
      const fixer = new AutoFixer();

      // 触发配置加载
      await (fixer as any).loadAIConfig();

      if ((fixer as any).aiEnabled) {
        console.log(chalk.green('✓ AI connection successful'));
        console.log(`  Source: ${(fixer as any).aiConfigSource}`);
        console.log(`  Model: ${(fixer as any).aiModel}`);
      } else {
        console.log(chalk.red('✗ AI configuration not available'));
        console.log('Run: openclaw-guard guard-config init');
      }
    });

  // reset 子命令
  configCmd
    .command('reset')
    .description('Reset configuration')
    .action(async () => {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'This will delete all openclaw-guard settings. Continue?',
          default: false,
        },
      ]);

      if (!confirm) {
        console.log('Cancelled');
        return;
      }

      const configDir = path.join(os.homedir(), '.openclaw-guard');
      await fs.remove(configDir);
      console.log(chalk.green('✓ Configuration reset'));
    });
}

function getDefaultModel(provider: string): string {
  const models: Record<string, string> = {
    'openai': 'gpt-4o-mini',
    'anthropic': 'claude-3-haiku-20240307',
    'iflow': 'iflow/glm-4.6',
    'openrouter': 'openai/gpt-4o-mini',
  };
  return models[provider] || 'gpt-4o-mini';
}
