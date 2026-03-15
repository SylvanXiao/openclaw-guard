import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import execa = require('execa');
import { getOpenClawVersion, isOpenClawInstalled } from '../lib/system';
import { getOpenClawDir, backupConfig } from '../lib/config';

export function registerUpgradeCommand(program: Command) {
  program
    .command('upgrade')
    .description('Upgrade OpenClaw to the latest version')
    .option('--check', 'Check for updates without installing')
    .option('--version <version>', 'Install a specific version')
    .action(async (options) => {
      console.log(chalk.blue('⬆️  OpenClaw Upgrade'));
      console.log();

      const installed = await isOpenClawInstalled();
      if (!installed) {
        console.log(chalk.red('OpenClaw is not installed'));
        console.log('Run: openclaw-guard install');
        return;
      }

      const currentVersion = await getOpenClawVersion();
      console.log(`Current version: ${currentVersion}`);

      if (options.check) {
        const spinner = ora('Checking for updates...').start();
        try {
          const { stdout } = await execa('npm', ['view', 'openclaw', 'version']);
          const latestVersion = stdout.trim();
          spinner.stop();

          if (latestVersion === currentVersion) {
            console.log(chalk.green('✓ Already up to date'));
          } else {
            console.log(chalk.yellow(`Update available: ${latestVersion}`));
            console.log('Run: openclaw-guard upgrade');
          }
        } catch {
          spinner.fail('Failed to check for updates');
        }
        return;
      }

      // 备份
      console.log('Backing up configuration...');
      await backupConfig();

      // 升级
      const spinner = ora('Upgrading OpenClaw...').start();
      try {
        const args = options.version 
          ? ['install', '-g', `openclaw@${options.version}`]
          : ['install', '-g', 'openclaw@latest'];
        
        await execa('npm', args);
        spinner.succeed('Upgrade complete');

        const newVersion = await getOpenClawVersion();
        console.log(chalk.green(`✓ Upgraded to version ${newVersion}`));
      } catch (error: any) {
        spinner.fail('Upgrade failed');
        console.error(error.message);
      }
    });
}

export function registerBackupCommand(program: Command) {
  const backupCmd = program.command('backup').description('Backup and restore OpenClaw data');

  // backup 子命令
  backupCmd
    .command('create')
    .description('Create a backup of configuration and data')
    .option('-o, --output <path>', 'Output directory')
    .action(async (options) => {
      console.log(chalk.blue('💾 Create Backup'));
      console.log();

      const openclawDir = getOpenClawDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const backupDir = options.output || path.join(process.cwd(), `openclaw-backup-${timestamp}`);

      const spinner = ora('Creating backup...').start();

      try {
        await fs.ensureDir(backupDir);
        
        // 备份配置
        await fs.copy(
          path.join(openclawDir, 'openclaw.json'),
          path.join(backupDir, 'openclaw.json')
        );

        // 备份 agents
        const agentsDir = path.join(openclawDir, 'agents');
        if (await fs.pathExists(agentsDir)) {
          await fs.copy(agentsDir, path.join(backupDir, 'agents'));
        }

        // 备份工作区
        const workspacesDir = path.join(openclawDir, 'workspace');
        if (await fs.pathExists(workspacesDir)) {
          await fs.copy(workspacesDir, path.join(backupDir, 'workspace'));
        }

        // 写入备份信息
        await fs.writeJson(path.join(backupDir, 'backup-info.json'), {
          timestamp: new Date().toISOString(),
          version: await getOpenClawVersion(),
        }, { spaces: 2 });

        spinner.succeed('Backup created');
        console.log(chalk.green(`✓ Backup saved to: ${backupDir}`));
      } catch (error: any) {
        spinner.fail('Backup failed');
        console.error(error.message);
      }
    });

  // restore 子命令
  backupCmd
    .command('restore <backupDir>')
    .description('Restore from a backup')
    .action(async (backupDir) => {
      console.log(chalk.blue('📂 Restore Backup'));
      console.log();

      if (!(await fs.pathExists(backupDir))) {
        console.log(chalk.red('Backup directory not found'));
        return;
      }

      if (!(await fs.pathExists(path.join(backupDir, 'openclaw.json')))) {
        console.log(chalk.red('Invalid backup: missing openclaw.json'));
        return;
      }

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'This will overwrite current configuration. Continue?',
          default: false,
        },
      ]);

      if (!confirm) {
        console.log('Cancelled');
        return;
      }

      const openclawDir = getOpenClawDir();
      const spinner = ora('Restoring backup...').start();

      try {
        // 先备份当前配置
        const currentBackup = path.join(openclawDir, 'backups', `pre-restore-${Date.now()}`);
        await fs.ensureDir(currentBackup);
        
        const configFile = path.join(openclawDir, 'openclaw.json');
        if (await fs.pathExists(configFile)) {
          await fs.copy(configFile, path.join(currentBackup, 'openclaw.json'));
        }

        // 恢复配置
        await fs.copy(path.join(backupDir, 'openclaw.json'), configFile);

        // 恢复 agents
        if (await fs.pathExists(path.join(backupDir, 'agents'))) {
          const agentsDir = path.join(openclawDir, 'agents');
          await fs.remove(agentsDir);
          await fs.copy(path.join(backupDir, 'agents'), agentsDir);
        }

        // 恢复工作区
        if (await fs.pathExists(path.join(backupDir, 'workspace'))) {
          const wsDir = path.join(openclawDir, 'workspace');
          await fs.remove(wsDir);
          await fs.copy(path.join(backupDir, 'workspace'), wsDir);
        }

        spinner.succeed('Restore complete');
        console.log(chalk.green('✓ Configuration restored'));
        console.log('Restart the gateway for changes to take effect');
      } catch (error: any) {
        spinner.fail('Restore failed');
        console.error(error.message);
      }
    });

  // list 子命令
  backupCmd
    .command('list')
    .description('List available backups')
    .action(async () => {
      const openclawDir = getOpenClawDir();
      const backupsDir = path.join(openclawDir, 'backups');

      if (!(await fs.pathExists(backupsDir))) {
        console.log(chalk.yellow('No backups found'));
        return;
      }

      const backups = await fs.readdir(backupsDir);
      if (backups.length === 0) {
        console.log(chalk.yellow('No backups found'));
        return;
      }

      console.log(chalk.blue('Available Backups:'));
      console.log();

      for (const backup of backups) {
        const infoPath = path.join(backupsDir, backup, 'backup-info.json');
        let info = '';
        if (await fs.pathExists(infoPath)) {
          const data = await fs.readJson(infoPath);
          info = ` (v${data.version}, ${data.timestamp})`;
        }
        console.log(`  ${backup}${info}`);
      }
    });
}
