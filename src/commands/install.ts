import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import execa = require('execa');
import { checkNodeVersion, isOpenClawInstalled, getSystemInfo } from '../lib/system';

export function registerInstallCommand(program: Command) {
  program
    .command('install')
    .description('Install OpenClaw with guided setup')
    .option('--node', 'Also install/update Node.js if needed')
    .option('-y, --yes', 'Accept defaults without prompting')
    .action(async (options) => {
      console.log(chalk.blue('🦞 OpenClaw Installation'));
      console.log();

      // 1. 检查 Node.js
      console.log(chalk.bold('Step 1: Checking Node.js...'));
      const nodeCheck = await checkNodeVersion();
      
      if (nodeCheck.satisfied) {
        console.log(chalk.green(`  ✓ Node.js v${nodeCheck.installed}`));
      } else {
        console.log(chalk.yellow(`  ⚠ Node.js v${nodeCheck.installed} (requires >= ${nodeCheck.required})`));
        
        if (options.node) {
          console.log('  Installing Node.js via nvm...');
          // TODO: 实现 Node.js 安装
        } else {
          console.log(chalk.red('  ✗ Please upgrade Node.js first'));
          console.log('  Run: nvm install 22 && nvm use 22');
          return;
        }
      }

      // 2. 检查 OpenClaw 是否已安装
      console.log(chalk.bold('\nStep 2: Checking OpenClaw...'));
      const openclawInstalled = await isOpenClawInstalled();
      
      if (openclawInstalled) {
        console.log(chalk.green('  ✓ OpenClaw is already installed'));
        
        const { reinstall } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'reinstall',
            message: 'Reinstall/update OpenClaw?',
            default: false,
          },
        ]);
        
        if (!reinstall) {
          console.log('\nRun: openclaw-guard config init');
          return;
        }
      }

      // 3. 安装 OpenClaw
      console.log(chalk.bold('\nStep 3: Installing OpenClaw...'));
      const spinner = ora('Installing via npm...').start();
      
      try {
        await execa('npm', ['install', '-g', 'openclaw@latest']);
        spinner.succeed('OpenClaw installed successfully');
      } catch (error: any) {
        spinner.fail('Installation failed');
        console.error(error.message);
        return;
      }

      // 4. 验证安装
      console.log(chalk.bold('\nStep 4: Verifying installation...'));
      try {
        const { stdout } = await execa('openclaw', ['--version']);
        console.log(chalk.green(`  ✓ ${stdout.split('\n')[0]}`));
      } catch {
        console.log(chalk.yellow('  ⚠ Could not verify version'));
      }

      // 5. 下一步引导
      console.log();
      console.log(chalk.bold('✅ Installation complete!'));
      console.log();
      console.log('Next steps:');
      console.log('  1. Initialize configuration: openclaw-guard config init');
      console.log('  2. Or run the onboard wizard: openclaw onboard');
      console.log('  3. Start the gateway: openclaw gateway start');
    });
}
