import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import * as tar from 'tar';

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const BACKUP_DIR = path.join(OPENCLAW_DIR, 'backups');

interface BackupMeta {
  id: string;
  timestamp: string;
  description?: string;
  version?: string;
  files: string[];
  size: number;
}

export function registerBackupCommand(program: Command) {
  const backupCmd = program.command('backup').description('Backup and restore configuration');

  // create 子命令
  backupCmd
    .command('create [description]')
    .description('Create a configuration backup')
    .option('-a, --all', 'Include all data (workspace, logs, etc.)')
    .option('--auto', 'Auto backup (no description prompt)')
    .action(async (description, options) => {
      console.log(chalk.blue('💾 Creating Backup'));
      console.log();

      if (!description && !options.auto) {
        const { desc } = await inquirer.prompt([
          {
            type: 'input',
            name: 'desc',
            message: 'Backup description (optional):',
          },
        ]);
        description = desc;
      }

      try {
        const backupId = await createBackup({
          description,
          includeAll: options.all,
        });

        console.log(chalk.green('✓ Backup created'));
        console.log(`  ID: ${backupId}`);
        console.log(`  Path: ${path.join(BACKUP_DIR, backupId + '.tar.gz')}`);
      } catch (error) {
        console.log(chalk.red('✗ Backup failed'));
        console.log(chalk.gray(String(error)));
      }
    });

  // restore 子命令
  backupCmd
    .command('restore [backupId]')
    .description('Restore configuration from backup')
    .option('--force', 'Overwrite existing configuration')
    .option('--dry-run', 'Show what would be restored without making changes')
    .action(async (backupId, options) => {
      console.log(chalk.blue('♻️  Restore Backup'));
      console.log();

      // 列出可用备份
      const backups = await listBackups();
      if (backups.length === 0) {
        console.log(chalk.yellow('No backups found'));
        return;
      }

      // 如果没有指定 backupId，让用户选择
      if (!backupId) {
        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Select backup to restore:',
            choices: backups.map(b => ({
              name: `${b.timestamp} - ${b.description || 'No description'} (${formatSize(b.size)})`,
              value: b.id,
            })),
          },
        ]);
        backupId = selected;
      }

      const backup = backups.find(b => b.id === backupId);
      if (!backup) {
        console.log(chalk.red(`Backup not found: ${backupId}`));
        return;
      }

      console.log(`Backup: ${backup.timestamp}`);
      console.log(`Description: ${backup.description || 'None'}`);
      console.log(`Files: ${backup.files.length}`);
      console.log();

      if (options.dryRun) {
        console.log(chalk.yellow('Dry run - would restore:'));
        for (const file of backup.files) {
          console.log(chalk.gray(`  - ${file}`));
        }
        return;
      }

      if (!options.force) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'This will overwrite current configuration. Continue?',
            default: false,
          },
        ]);

        if (!confirm) {
          console.log('Restore cancelled');
          return;
        }
      }

      try {
        await restoreBackup(backupId);
        console.log(chalk.green('✓ Configuration restored'));
        console.log(chalk.yellow('Please restart Gateway for changes to take effect'));
      } catch (error) {
        console.log(chalk.red('✗ Restore failed'));
        console.log(chalk.gray(String(error)));
      }
    });

  // list 子命令
  backupCmd
    .command('list')
    .description('List all backups')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const backups = await listBackups();

      if (options.json) {
        console.log(JSON.stringify(backups, null, 2));
        return;
      }

      console.log(chalk.blue('📋 Backups'));
      console.log();

      if (backups.length === 0) {
        console.log('No backups found');
        return;
      }

      for (const backup of backups) {
        console.log(chalk.bold(`📦 ${backup.id}`));
        console.log(chalk.gray(`  Created: ${backup.timestamp}`));
        if (backup.description) {
          console.log(chalk.gray(`  Description: ${backup.description}`));
        }
        console.log(chalk.gray(`  Files: ${backup.files.length} | Size: ${formatSize(backup.size)}`));
        console.log();
      }

      console.log(`Total: ${backups.length} backup(s)`);
    });

  // delete 子命令
  backupCmd
    .command('delete [backupId]')
    .description('Delete a backup')
    .option('--all', 'Delete all backups')
    .action(async (backupId, options) => {
      if (options.all) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Delete ALL backups? This cannot be undone.',
            default: false,
          },
        ]);

        if (!confirm) {
          console.log('Cancelled');
          return;
        }

        await fs.emptyDir(BACKUP_DIR);
        console.log(chalk.green('✓ All backups deleted'));
        return;
      }

      if (!backupId) {
        const backups = await listBackups();
        if (backups.length === 0) {
          console.log('No backups to delete');
          return;
        }

        const { selected } = await inquirer.prompt([
          {
            type: 'list',
            name: 'selected',
            message: 'Select backup to delete:',
            choices: backups.map(b => ({
              name: `${b.timestamp} - ${b.description || 'No description'}`,
              value: b.id,
            })),
          },
        ]);
        backupId = selected;
      }

      const backupPath = path.join(BACKUP_DIR, backupId + '.tar.gz');
      if (await fs.pathExists(backupPath)) {
        await fs.remove(backupPath);
        console.log(chalk.green(`✓ Backup deleted: ${backupId}`));
      } else {
        console.log(chalk.red('Backup not found'));
      }
    });

  // schedule 子命令
  backupCmd
    .command('schedule')
    .description('Configure automatic backups')
    .option('--enable', 'Enable automatic backups')
    .option('--disable', 'Disable automatic backups')
    .option('--interval <hours>', 'Backup interval in hours', '24')
    .option('--keep <count>', 'Number of backups to keep', '7')
    .action(async (options) => {
      const schedulePath = path.join(OPENCLAW_DIR, 'backup-schedule.json');

      if (options.disable) {
        await fs.remove(schedulePath);
        console.log(chalk.green('✓ Automatic backups disabled'));
        return;
      }

      if (options.enable) {
        const schedule = {
          enabled: true,
          intervalHours: parseInt(options.interval) || 24,
          keepCount: parseInt(options.keep) || 7,
          nextRun: new Date(Date.now() + (parseInt(options.interval) || 24) * 60 * 60 * 1000).toISOString(),
        };

        await fs.writeJson(schedulePath, schedule, { spaces: 2 });
        console.log(chalk.green('✓ Automatic backups enabled'));
        console.log(`  Interval: every ${schedule.intervalHours} hours`);
        console.log(`  Keep: ${schedule.keepCount} backups`);
        console.log();
        console.log(chalk.yellow('Note: You need to add a cron job or systemd timer to run:'));
        console.log('  openclaw-guard backup create --auto');
        return;
      }

      // 显示当前配置
      if (await fs.pathExists(schedulePath)) {
        const schedule = await fs.readJson(schedulePath);
        console.log(chalk.blue('📅 Backup Schedule'));
        console.log();
        console.log(`  Status: ${schedule.enabled ? chalk.green('Enabled') : chalk.red('Disabled')}`);
        console.log(`  Interval: ${schedule.intervalHours} hours`);
        console.log(`  Keep: ${schedule.keepCount} backups`);
        console.log(`  Next run: ${schedule.nextRun ? new Date(schedule.nextRun).toLocaleString('zh-CN') : 'Not scheduled'}`);
      } else {
        console.log('Automatic backups not configured');
        console.log('Run with --enable to set up');
      }
    });
}

async function createBackup(options: { description?: string; includeAll?: boolean }): Promise<string> {
  await fs.ensureDir(BACKUP_DIR);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupId = `backup-${timestamp}`;
  const backupPath = path.join(BACKUP_DIR, backupId + '.tar.gz');

  // 确定要备份的文件
  const filesToBackup: string[] = [];
  const essentialFiles = [
    'openclaw.json',
    'models.json',
    'mcp-config.json',
    'security-authorizations.json',
  ];

  const essentialDirs = [
    'agents',
    'devices',
    'memory',
    'plugins',
  ];

  // 添加核心文件
  for (const file of essentialFiles) {
    if (await fs.pathExists(path.join(OPENCLAW_DIR, file))) {
      filesToBackup.push(file);
    }
  }

  // 添加核心目录
  for (const dir of essentialDirs) {
    if (await fs.pathExists(path.join(OPENCLAW_DIR, dir))) {
      filesToBackup.push(dir);
    }
  }

  // 如果 includeAll，添加更多文件
  if (options.includeAll) {
    const extraDirs = ['workspace', 'logs', 'cron', 'canvas'];
    for (const dir of extraDirs) {
      if (await fs.pathExists(path.join(OPENCLAW_DIR, dir))) {
        filesToBackup.push(dir);
      }
    }
  }

  // 创建 tar.gz 备份
  await tar.create(
    {
      gzip: true,
      file: backupPath,
      cwd: OPENCLAW_DIR,
    },
    filesToBackup
  );

  // 保存元数据
  const meta: BackupMeta = {
    id: backupId,
    timestamp: new Date().toLocaleString('zh-CN'),
    description: options.description,
    files: filesToBackup,
    size: (await fs.stat(backupPath)).size,
  };

  await fs.writeJson(path.join(BACKUP_DIR, backupId + '.json'), meta, { spaces: 2 });

  return backupId;
}

async function restoreBackup(backupId: string): Promise<void> {
  const backupPath = path.join(BACKUP_DIR, backupId + '.tar.gz');
  const metaPath = path.join(BACKUP_DIR, backupId + '.json');

  if (!(await fs.pathExists(backupPath))) {
    throw new Error('Backup file not found');
  }

  // 先创建当前配置的备份
  const preRestoreBackupId = await createBackup({
    description: 'Pre-restore backup',
  });
  console.log(chalk.gray(`Created safety backup: ${preRestoreBackupId}`));

  // 解压备份
  await tar.extract({
    file: backupPath,
    cwd: OPENCLAW_DIR,
  });
}

async function listBackups(): Promise<BackupMeta[]> {
  await fs.ensureDir(BACKUP_DIR);

  const files = await fs.readdir(BACKUP_DIR);
  const metaFiles = files.filter(f => f.endsWith('.json'));

  const backups: BackupMeta[] = [];

  for (const metaFile of metaFiles) {
    try {
      const meta = await fs.readJson(path.join(BACKUP_DIR, metaFile));
      backups.push(meta);
    } catch {
      // 忽略无效的元数据文件
    }
  }

  // 按时间倒序排列
  return backups.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
