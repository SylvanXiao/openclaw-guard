import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig, saveConfig, configExists, backupConfig } from '../lib/config';
import { OpenClawConfig } from '../types';

export function registerConfigCommand(program: Command) {
  const configCmd = program.command('config').description('Manage OpenClaw configuration');

  // init 子命令
  configCmd
    .command('init')
    .description('Initialize OpenClaw configuration with wizard')
    .action(async () => {
      console.log(chalk.blue('📝 OpenClaw Configuration Wizard'));
      console.log();

      const existing = await configExists();
      if (existing) {
        const { overwrite } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'overwrite',
            message: 'Configuration already exists. Overwrite?',
            default: false,
          },
        ]);
        if (!overwrite) {
          console.log('Cancelled.');
          return;
        }
        await backupConfig();
      }

      // 收集配置
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'gatewayPort',
          message: 'Gateway port:',
          default: '18789',
        },
        {
          type: 'list',
          name: 'gatewayMode',
          message: 'Gateway mode:',
          choices: ['local', 'remote'],
          default: 'local',
        },
        {
          type: 'list',
          name: 'authMode',
          message: 'Authentication mode:',
          choices: ['token', 'password', 'none'],
          default: 'token',
        },
        {
          type: 'input',
          name: 'primaryModel',
          message: 'Primary model (provider/model):',
          default: 'iflow/qwen3-max',
        },
        {
          type: 'input',
          name: 'fallbackModel',
          message: 'Fallback model (optional):',
          default: 'iflow/glm-4.6',
        },
      ]);

      // 构建配置
      const config: OpenClawConfig = {
        gateway: {
          port: parseInt(answers.gatewayPort),
          mode: answers.gatewayMode,
          auth: {
            mode: answers.authMode,
          },
        },
        agents: {
          defaults: {
            model: {
              primary: answers.primaryModel,
              fallbacks: answers.fallbackModel ? [answers.fallbackModel] : [],
            },
          },
          list: [
            {
              id: 'main',
              default: true,
            },
          ],
        },
        bindings: [],
      };

      // 询问渠道配置
      const { setupChannel } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'setupChannel',
          message: 'Configure a messaging channel now?',
          default: true,
        },
      ]);

      if (setupChannel) {
        const { channel } = await inquirer.prompt([
          {
            type: 'list',
            name: 'channel',
            message: 'Which channel?',
            choices: ['dingtalk-connector', 'whatsapp', 'telegram', 'discord'],
          },
        ]);

        if (channel === 'dingtalk-connector') {
          const dingtalkAnswers = await inquirer.prompt([
            {
              type: 'input',
              name: 'clientId',
              message: 'DingTalk Client ID:',
            },
            {
              type: 'input',
              name: 'clientSecret',
              message: 'DingTalk Client Secret:',
            },
            {
              type: 'input',
              name: 'gatewayToken',
              message: 'Gateway Token:',
            },
          ]);

          config.channels = {
            'dingtalk-connector': {
              clientId: dingtalkAnswers.clientId,
              clientSecret: dingtalkAnswers.clientSecret,
              gatewayToken: dingtalkAnswers.gatewayToken,
            },
          };

          config.bindings = [
            { agentId: 'main', match: { channel: 'dingtalk-connector' } },
          ];

          config.plugins = {
            entries: {
              'dingtalk-connector': { enabled: true },
            },
          };
        }
      }

      await saveConfig(config);
      console.log();
      console.log(chalk.green('✅ Configuration saved to ~/.openclaw/openclaw.json'));
      console.log();
      console.log('Next steps:');
      console.log('  1. Run: openclaw gateway start');
      console.log('  2. Or run: openclaw onboard');
    });

  // validate 子命令
  configCmd
    .command('validate')
    .description('Validate OpenClaw configuration')
    .action(async () => {
      console.log(chalk.blue('🔍 Validating configuration...'));
      console.log();

      const config = await loadConfig();
      if (!config) {
        console.log(chalk.red('✗ Configuration file not found'));
        console.log('Run: openclaw-guard config init');
        return;
      }

      const issues: string[] = [];

      // 检查必需字段
      if (!config.gateway?.port) {
        issues.push('Missing gateway.port');
      }
      if (!config.agents?.list || config.agents.list.length === 0) {
        issues.push('No agents configured');
      }

      // 检查智能体配置
      for (const agent of config.agents?.list || []) {
        if (!agent.id) {
          issues.push('Agent missing id');
        }
      }

      // 检查绑定
      if (!config.bindings || config.bindings.length === 0) {
        console.log(chalk.yellow('⚠ No bindings configured - messages will go to default agent'));
      }

      if (issues.length === 0) {
        console.log(chalk.green('✓ Configuration is valid'));
      } else {
        console.log(chalk.red('✗ Configuration has issues:'));
        issues.forEach(issue => console.log(chalk.red(`  • ${issue}`)));
      }
    });

  // set 子命令
  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action(async (key, value) => {
      const config = await loadConfig();
      if (!config) {
        console.log(chalk.red('Configuration not found. Run: openclaw-guard config init'));
        return;
      }

      await backupConfig();

      // 简单的键值设置
      const keys = key.split('.');
      let obj: any = config;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = obj[keys[i]] || {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;

      await saveConfig(config);
      console.log(chalk.green(`✓ Set ${key} = ${value}`));
    });
}
