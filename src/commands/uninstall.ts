import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import execa = require('execa');
import { getOpenClawDir } from '../lib/config';

export function registerUninstallCommand(program: Command) {
  program
    .command('uninstall')
    .description('Uninstall OpenClaw')
    .option('--purge', 'Also remove configuration and data')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (options) => {
      console.log(chalk.blue('🗑️  Uninstall OpenClaw'));
      console.log();

      const openclawDir = getOpenClawDir();

      // 确认
      if (!options.yes) {
        const message = options.purge
          ? 'This will remove OpenClaw and all configuration/data. Continue?'
          : 'This will uninstall OpenClaw but keep configuration. Continue?';

        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message,
            default: false,
          },
        ]);

        if (!confirm) {
          console.log('Cancelled');
          return;
        }
      }

      const spinner = ora('Uninstalling...').start();

      try {
        // 1. 停止 Gateway
        try {
          await execa('pkill', ['-f', 'openclaw-gateway']);
        } catch {
          // 可能没有运行
        }

        // 2. 卸载 npm 包
        try {
          await execa('npm', ['uninstall', '-g', 'openclaw']);
        } catch {
          // 可能没有安装
        }

        // 3. 可选：删除配置和数据
        if (options.purge) {
          await fs.remove(openclawDir);
          spinner.succeed('OpenClaw uninstalled (including all data)');
        } else {
          spinner.succeed('OpenClaw uninstalled (configuration preserved)');
          console.log();
          console.log(`Configuration saved at: ${openclawDir}`);
          console.log('Use --purge to remove configuration as well');
        }

        console.log();
        console.log(chalk.green('✓ Uninstall complete'));

      } catch (error: any) {
        spinner.fail('Uninstall failed');
        console.error(error.message);
      }
    });
}
