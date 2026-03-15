#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import {
  registerInstallCommand,
  registerUninstallCommand,
  registerConfigCommand,
  registerDiagnoseCommand,
  registerSecurityCommand,
  registerAgentCommand,
  registerChannelCommand,
  registerUpgradeCommand,
  registerBackupCommand,
  registerMonitorCommand,
  registerTuiCommand,
  registerPerfCommand,
  registerKnowledgeCommand,
  registerGuardConfigCommand,
} from './commands';

const program = new Command();

program
  .name('openclaw-guard')
  .description('OpenClaw security monitoring, operations, and management tool')
  .version('1.0.0');

// 注册命令
registerInstallCommand(program);
registerUninstallCommand(program);
registerConfigCommand(program);
registerDiagnoseCommand(program);
registerSecurityCommand(program);
registerAgentCommand(program);
registerChannelCommand(program);
registerUpgradeCommand(program);
registerBackupCommand(program);
registerMonitorCommand(program);
registerTuiCommand(program);
registerPerfCommand(program);
registerKnowledgeCommand(program);
registerGuardConfigCommand(program);

// 错误处理
program.exitOverride((err) => {
  if (err.code === 'commander.help' || err.code === 'commander.version') {
    process.exit(0);
  }
  process.exit(err.exitCode);
});

program.parse();
