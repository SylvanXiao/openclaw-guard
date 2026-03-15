import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { loadConfig, saveConfig, backupConfig, getOpenClawDir } from '../lib/config';

export function registerAgentCommand(program: Command) {
  const agentCmd = program.command('agent').description('Manage OpenClaw agents');

  // create 子命令
  agentCmd
    .command('create [name]')
    .description('Create a new agent')
    .action(async (name) => {
      console.log(chalk.blue('🤖 Create New Agent'));
      console.log();

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'agentId',
          message: 'Agent ID:',
          default: name || 'new-agent',
          validate: (input) => /^[a-z0-9-]+$/.test(input) || 'Use lowercase letters, numbers, and hyphens only',
        },
        {
          type: 'input',
          name: 'agentName',
          message: 'Display name:',
          default: name || 'New Agent',
        },
        {
          type: 'input',
          name: 'workspace',
          message: 'Workspace path:',
          default: (ans: any) => `~/.openclaw/workspace-${ans.agentId}`,
        },
        {
          type: 'list',
          name: 'model',
          message: 'Primary model:',
          choices: [
            'iflow/qwen3-max',
            'iflow/glm-4.6',
            'iflow/deepseek-v3',
            'anthropic/claude-3-haiku',
            'custom',
          ],
          default: 'iflow/qwen3-max',
        },
      ]);

      let model = answers.model;
      if (model === 'custom') {
        const { customModel } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customModel',
            message: 'Enter model (provider/model):',
          },
        ]);
        model = customModel;
      }

      // 加载现有配置
      const config = await loadConfig();
      if (!config) {
        console.log(chalk.red('Configuration not found. Run: openclaw-guard config init'));
        return;
      }

      await backupConfig();

      // 创建工作区
      const workspacePath = answers.workspace.replace('~', os.homedir());
      await fs.ensureDir(workspacePath);

      // 创建 agentDir
      const agentDir = path.join(getOpenClawDir(), 'agents', answers.agentId, 'agent');
      await fs.ensureDir(agentDir);

      // 创建基础工作区文件
      await fs.writeFile(
        path.join(workspacePath, 'IDENTITY.md'),
        `# ${answers.agentName}\n\nThis is ${answers.agentName}.\n`
      );

      // 添加到配置
      config.agents = config.agents || {};
      config.agents.list = config.agents.list || [];
      
      config.agents.list.push({
        id: answers.agentId,
        agentDir: agentDir,
        workspace: answers.workspace,
        groupChat: {
          mentionPatterns: [answers.agentName, answers.agentId],
        },
      });

      // 保存配置
      await saveConfig(config);

      console.log();
      console.log(chalk.green(`✓ Agent "${answers.agentId}" created`));
      console.log(`  Workspace: ${workspacePath}`);
      console.log(`  Agent dir: ${agentDir}`);
      console.log();
      console.log('Next steps:');
      console.log('  1. Customize IDENTITY.md and SOUL.md in the workspace');
      console.log('  2. Add bindings: openclaw-guard agent bind');
    });

  // bind 子命令
  agentCmd
    .command('bind [agentId]')
    .description('Configure routing bindings for an agent')
    .action(async (agentId) => {
      console.log(chalk.blue('🔗 Configure Agent Bindings'));
      console.log();

      const config = await loadConfig();
      if (!config) {
        console.log(chalk.red('Configuration not found'));
        return;
      }

      // 选择智能体
      if (!agentId) {
        const agents = config.agents?.list?.map(a => a.id) || [];
        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Select agent:',
            choices: agents,
          },
        ]);
        agentId = selected;
      }

      // 选择绑定类型
      const { bindType } = await inquirer.prompt([
        {
          type: 'list',
          name: 'bindType',
          message: 'Binding type:',
          choices: [
            { name: 'Channel (all messages)', value: 'channel' },
            { name: 'Direct message (specific user)', value: 'dm' },
            { name: 'Group (specific group)', value: 'group' },
          ],
        },
      ]);

      // 获取可用渠道
      const channels = Object.keys(config.channels || {});
      if (channels.length === 0) {
        console.log(chalk.yellow('No channels configured'));
        return;
      }

      const { channel } = await inquirer.prompt([
        {
          type: 'list',
          name: 'channel',
          message: 'Select channel:',
          choices: channels,
        },
      ]);

      let binding: any = {
        agentId,
        match: { channel },
      };

      if (bindType === 'dm') {
        const { peerId } = await inquirer.prompt([
          {
            type: 'input',
            name: 'peerId',
            message: 'User ID (phone number format, e.g., +8613812345678):',
          },
        ]);
        binding.match.peer = { kind: 'dm', id: peerId };
      } else if (bindType === 'group') {
        const { peerId } = await inquirer.prompt([
          {
            type: 'input',
            name: 'peerId',
            message: 'Group ID:',
          },
        ]);
        binding.match.peer = { kind: 'group', id: peerId };
      }

      await backupConfig();
      config.bindings = config.bindings || [];
      config.bindings.push(binding);
      await saveConfig(config);

      console.log(chalk.green('✓ Binding added'));
    });

  // remove 子命令
  agentCmd
    .command('remove [agentId]')
    .description('Remove an agent')
    .option('--purge', 'Also remove workspace and data')
    .action(async (agentId, options) => {
      const config = await loadConfig();
      if (!config) {
        console.log(chalk.red('Configuration not found'));
        return;
      }

      // 选择智能体
      if (!agentId) {
        const agents = config.agents?.list?.map(a => ({ name: a.id, value: a.id })) || [];
        if (agents.length === 0) {
          console.log(chalk.yellow('No agents configured'));
          return;
        }

        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Select agent to remove:',
            choices: agents,
          },
        ]);
        agentId = selected;
      }

      // 不能删除默认智能体
      const agent = config.agents?.list?.find(a => a.id === agentId);
      if (agent?.default) {
        console.log(chalk.red('Cannot remove the default agent'));
        return;
      }

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: options.purge 
            ? `Remove agent "${agentId}" and all its data?`
            : `Remove agent "${agentId}" from configuration?`,
          default: false,
        },
      ]);

      if (!confirm) {
        console.log('Cancelled');
        return;
      }

      await backupConfig();

      // 从配置中移除
      config.agents!.list = config.agents!.list!.filter(a => a.id !== agentId);
      config.bindings = config.bindings?.filter(b => b.agentId !== agentId);

      await saveConfig(config);

      if (options.purge && agent) {
        // 删除工作区
        if (agent.workspace) {
          const wsPath = agent.workspace.replace('~', os.homedir());
          await fs.remove(wsPath);
          console.log(chalk.gray(`  Removed workspace: ${wsPath}`));
        }

        // 删除 agentDir
        if (agent.agentDir) {
          const agentDirPath = agent.agentDir.replace('~', os.homedir());
          await fs.remove(path.dirname(agentDirPath)); // 删除 agents/<id> 目录
          console.log(chalk.gray(`  Removed agent dir: ${agentDirPath}`));
        }
      }

      console.log(chalk.green(`✓ Agent "${agentId}" removed`));
    });

  // list 子命令
  agentCmd
    .command('list')
    .description('List all configured agents')
    .action(async () => {
      const config = await loadConfig();
      if (!config || !config.agents?.list?.length) {
        console.log(chalk.yellow('No agents configured'));
        return;
      }

      console.log(chalk.blue('Configured Agents:'));
      console.log();

      for (const agent of config.agents.list) {
        const isDefault = agent.default ? chalk.green(' (default)') : '';
        console.log(chalk.bold(`  ${agent.id}${isDefault}`));
        if (agent.workspace) {
          console.log(chalk.gray(`    Workspace: ${agent.workspace}`));
        }
        if (agent.agentDir) {
          console.log(chalk.gray(`    Agent dir: ${agent.agentDir}`));
        }
        if (agent.groupChat?.mentionPatterns?.length) {
          console.log(chalk.gray(`    Mentions: ${agent.groupChat.mentionPatterns.join(', ')}`));
        }

        // 显示绑定
        const bindings = config.bindings?.filter(b => b.agentId === agent.id) || [];
        if (bindings.length > 0) {
          console.log(chalk.gray(`    Bindings:`));
          for (const b of bindings) {
            let desc = `      - ${b.match.channel}`;
            if (b.match.peer) {
              desc += ` peer=${b.match.peer.kind}:${b.match.peer.id}`;
            }
            console.log(chalk.gray(desc));
          }
        }
        console.log();
      }
    });
}
