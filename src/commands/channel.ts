import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import execa = require('execa');
import { loadConfig, saveConfig, backupConfig } from '../lib/config';

export function registerChannelCommand(program: Command) {
  const channelCmd = program.command('channel').description('Manage messaging channels');

  // setup 子命令
  channelCmd
    .command('setup [name]')
    .description('Configure a messaging channel')
    .action(async (name) => {
      console.log(chalk.blue('📡 Channel Setup'));
      console.log();

      const config = await loadConfig();
      if (!config) {
        console.log(chalk.red('Configuration not found. Run: openclaw-guard config init'));
        return;
      }

      // 选择渠道
      if (!name) {
        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Select channel to configure:',
            choices: [
              { name: 'DingTalk (钉钉)', value: 'dingtalk-connector' },
              { name: 'WhatsApp', value: 'whatsapp' },
              { name: 'Telegram', value: 'telegram' },
              { name: 'Discord', value: 'discord' },
            ],
          },
        ]);
        name = selected;
      }

      let channelConfig: any = {};

      if (name === 'dingtalk-connector') {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'clientId',
            message: 'DingTalk Client ID (AppKey):',
          },
          {
            type: 'input',
            name: 'clientSecret',
            message: 'DingTalk Client Secret (AppSecret):',
          },
          {
            type: 'input',
            name: 'gatewayToken',
            message: 'Gateway Token:',
          },
        ]);
        channelConfig = {
          clientId: answers.clientId,
          clientSecret: answers.clientSecret,
          gatewayToken: answers.gatewayToken,
          sessionTimeout: 1800000,
        };
      } else if (name === 'whatsapp') {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'sessionId',
            message: 'WhatsApp session ID:',
            default: 'default',
          },
        ]);
        channelConfig = {
          sessionId: answers.sessionId,
        };
      } else if (name === 'telegram') {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'botToken',
            message: 'Telegram Bot Token:',
          },
        ]);
        channelConfig = {
          botToken: answers.botToken,
        };
      } else if (name === 'discord') {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'botToken',
            message: 'Discord Bot Token:',
          },
          {
            type: 'input',
            name: 'applicationId',
            message: 'Discord Application ID:',
          },
        ]);
        channelConfig = {
          botToken: answers.botToken,
          applicationId: answers.applicationId,
        };
      }

      await backupConfig();

      config.channels = config.channels || {};
      config.channels[name] = channelConfig;

      // 启用插件
      if (name === 'dingtalk-connector') {
        config.plugins = config.plugins || {};
        config.plugins.entries = config.plugins.entries || {};
        (config.plugins.entries as any)[name] = { enabled: true };
      }

      // 添加默认绑定
      const agents = config.agents?.list || [];
      if (agents.length > 0) {
        const { addBinding } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'addBinding',
            message: 'Add default binding to main agent?',
            default: true,
          },
        ]);

        if (addBinding) {
          const defaultAgent = agents.find(a => a.default) || agents[0];
          config.bindings = config.bindings || [];
          config.bindings.push({
            agentId: defaultAgent.id,
            match: { channel: name },
          });
        }
      }

      await saveConfig(config);

      console.log();
      console.log(chalk.green(`✓ Channel "${name}" configured`));
      console.log();
      console.log('Next steps:');
      console.log('  1. Run: openclaw gateway restart');
      console.log('  2. Test: openclaw-guard channel test ' + name);
    });

  // test 子命令
  channelCmd
    .command('test [name]')
    .description('Test channel connection')
    .action(async (name) => {
      console.log(chalk.blue('🧪 Channel Test'));
      console.log();

      const config = await loadConfig();
      if (!config) {
        console.log(chalk.red('Configuration not found'));
        return;
      }

      const channels = Object.keys(config.channels || {});
      if (channels.length === 0) {
        console.log(chalk.yellow('No channels configured'));
        return;
      }

      if (!name) {
        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Select channel to test:',
            choices: channels,
          },
        ]);
        name = selected;
      }

      // 使用 openclaw 命令测试
      try {
        console.log(`Testing ${name}...`);
        const { stdout } = await execa('openclaw', ['channels', 'status', '--probe']);
        console.log(stdout);
      } catch (error: any) {
        console.log(chalk.yellow('Could not run openclaw channels status'));
        console.log('Make sure the gateway is running: openclaw gateway start');
      }
    });

  // list 子命令
  channelCmd
    .command('list')
    .description('List configured channels')
    .action(async () => {
      const config = await loadConfig();
      if (!config) {
        console.log(chalk.red('Configuration not found'));
        return;
      }

      const channels = config.channels || {};
      const entries = Object.entries(channels);

      if (entries.length === 0) {
        console.log(chalk.yellow('No channels configured'));
        return;
      }

      console.log(chalk.blue('Configured Channels:'));
      console.log();

      for (const [name, ch] of entries) {
        const channel = ch as any;
        const isEnabled = config.plugins?.entries?.[name]?.enabled;
        const status = isEnabled ? chalk.green('enabled') : chalk.gray('disabled');
        
        console.log(chalk.bold(`  ${name}`) + ` (${status})`);
        
        // 显示关键配置（隐藏敏感信息）
        if (channel.clientId) {
          console.log(chalk.gray(`    Client ID: ${channel.clientId}`));
        }
        if (channel.botToken) {
          console.log(chalk.gray(`    Bot Token: ${channel.botToken.substring(0, 10)}...`));
        }
        if (channel.sessionId) {
          console.log(chalk.gray(`    Session ID: ${channel.sessionId}`));
        }
        console.log();
      }
    });

  // remove 子命令
  channelCmd
    .command('remove [name]')
    .description('Remove a channel configuration')
    .action(async (name) => {
      const config = await loadConfig();
      if (!config) {
        console.log(chalk.red('Configuration not found'));
        return;
      }

      const channels = Object.keys(config.channels || {});
      if (channels.length === 0) {
        console.log(chalk.yellow('No channels configured'));
        return;
      }

      if (!name) {
        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Select channel to remove:',
            choices: channels,
          },
        ]);
        name = selected;
      }

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Remove channel "${name}"?`,
          default: false,
        },
      ]);

      if (!confirm) {
        console.log('Cancelled');
        return;
      }

      await backupConfig();

      delete config.channels![name];
      config.bindings = config.bindings?.filter(b => b.match.channel !== name);
      
      if (config.plugins?.entries?.[name]) {
        delete (config.plugins.entries as any)[name];
      }

      await saveConfig(config);
      console.log(chalk.green(`✓ Channel "${name}" removed`));
    });
}