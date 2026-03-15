import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { KnowledgeManager, Solution, KnowledgeBase } from '../lib/knowledge';

export function registerKnowledgeCommand(program: Command) {
  const knowledgeCmd = program.command('knowledge').description('Manage fix knowledge base');

  // list 子命令
  knowledgeCmd
    .command('list')
    .description('List all solutions in knowledge base')
    .option('--verified', 'Show only verified solutions')
    .option('--learned', 'Show only learned solutions')
    .option('-c, --category <category>', 'Filter by category')
    .action(async (options) => {
      console.log(chalk.blue('📚 Knowledge Base\n'));

      const manager = new KnowledgeManager();
      await manager.initialize();

      let solutions = manager.getAllSolutions();

      if (options.verified) {
        solutions = solutions.filter(s => s.verified);
      }

      if (options.learned) {
        solutions = solutions.filter(s => s.source === 'learned' || s.source === 'ai');
      }

      if (options.category) {
        solutions = solutions.filter(s => s.category === options.category);
      }

      if (solutions.length === 0) {
        console.log('No solutions found');
        return;
      }

      // 按类别分组
      const grouped = solutions.reduce((acc, s) => {
        if (!acc[s.category]) acc[s.category] = [];
        acc[s.category].push(s);
        return acc;
      }, {} as Record<string, Solution[]>);

      for (const [category, categorySolutions] of Object.entries(grouped)) {
        console.log(chalk.bold(category.toUpperCase()));
        
        for (const solution of categorySolutions) {
          const verifiedIcon = solution.verified ? '✓' : '?';
          const sourceIcon = solution.source === 'builtin' ? 'builtin' : solution.source;
          const stats = `${solution.successCount}/${solution.successCount + solution.failCount}`;
          
          console.log(`  ${verifiedIcon} ${solution.name} (${sourceIcon}, ${stats})`);
          console.log(chalk.gray(`    ${solution.description}`));
          if (solution.fixCommand) {
            console.log(chalk.gray(`    Fix: ${solution.fixCommand}`));
          }
        }
        console.log();
      }

      console.log(`Total: ${solutions.length} solutions`);
      manager.printStats();
    });

  // show 子命令
  knowledgeCmd
    .command('show <id>')
    .description('Show solution details')
    .action(async (id) => {
      const manager = new KnowledgeManager();
      await manager.initialize();

      const solutions = manager.getAllSolutions();
      const solution = solutions.find(s => s.id === id || s.name.toLowerCase().includes(id.toLowerCase()));

      if (!solution) {
        console.log(chalk.red('Solution not found'));
        return;
      }

      console.log(chalk.blue(`📚 Solution: ${solution.name}\n`));
      console.log(`ID: ${solution.id}`);
      console.log(`Category: ${solution.category}`);
      console.log(`Source: ${solution.source}`);
      console.log(`Verified: ${solution.verified ? 'Yes' : 'No'}`);
      console.log(`Risk Level: ${solution.riskLevel}`);
      console.log();
      console.log(`Description:`);
      console.log(`  ${solution.description}`);
      console.log();
      
      if (solution.symptoms.length > 0) {
        console.log(`Symptoms:`);
        for (const symptom of solution.symptoms) {
          console.log(`  - ${symptom}`);
        }
        console.log();
      }

      if (solution.fixCommand) {
        console.log(`Fix Command:`);
        console.log(chalk.green(`  ${solution.fixCommand}`));
        console.log();
      }

      if (solution.fixScript) {
        console.log(`Fix Script:`);
        console.log(chalk.green(solution.fixScript));
        console.log();
      }

      console.log(`Tags: ${solution.tags.join(', ')}`);
      console.log();
      console.log(`Statistics:`);
      console.log(`  Success: ${solution.successCount}`);
      console.log(`  Failed: ${solution.failCount}`);
      console.log(`  Created: ${new Date(solution.createdAt).toLocaleString('zh-CN')}`);
      console.log(`  Updated: ${new Date(solution.updatedAt).toLocaleString('zh-CN')}`);
    });

  // add 子命令
  knowledgeCmd
    .command('add')
    .description('Add a new solution to knowledge base')
    .action(async () => {
      console.log(chalk.blue('📚 Add New Solution\n'));

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Solution name:',
          validate: (input) => input.length > 0 || 'Name is required',
        },
        {
          type: 'input',
          name: 'description',
          message: 'Description:',
        },
        {
          type: 'input',
          name: 'symptoms',
          message: 'Symptoms (comma separated):',
          filter: (input) => input.split(',').map((s: string) => s.trim()).filter(Boolean),
        },
        {
          type: 'input',
          name: 'problemPatterns',
          message: 'Problem patterns (regex, comma separated):',
          filter: (input) => input.split(',').map((s: string) => s.trim()).filter(Boolean),
        },
        {
          type: 'list',
          name: 'category',
          message: 'Category:',
          choices: ['environment', 'config', 'service', 'network', 'security', 'filesystem', 'performance', 'plugin', 'other'],
        },
        {
          type: 'input',
          name: 'fixCommand',
          message: 'Fix command (leave empty for script):',
        },
        {
          type: 'editor',
          name: 'fixScript',
          message: 'Fix script (multi-line):',
          when: (answers) => !answers.fixCommand,
        },
        {
          type: 'list',
          name: 'riskLevel',
          message: 'Risk level:',
          choices: ['low', 'medium', 'high'],
          default: 'low',
        },
        {
          type: 'input',
          name: 'tags',
          message: 'Tags (comma separated):',
          filter: (input) => input.split(',').map((s: string) => s.trim()).filter(Boolean),
        },
      ]);

      const manager = new KnowledgeManager();
      await manager.initialize();

      await manager.learn({
        name: answers.name,
        description: answers.description,
        problemPatterns: answers.problemPatterns,
        symptoms: answers.symptoms,
        diagnosis: '',
        fixCommand: answers.fixCommand || undefined,
        fixScript: answers.fixScript || undefined,
        riskLevel: answers.riskLevel,
        category: answers.category,
        tags: answers.tags,
        source: 'learned',
        verified: false,
      });
    });

  // update 子命令
  knowledgeCmd
    .command('update <id>')
    .description('Update a solution')
    .option('--fix-command <command>', 'Update fix command')
    .option('--risk-level <level>', 'Update risk level')
    .option('--verified <boolean>', 'Update verified status')
    .action(async (id, options) => {
      const manager = new KnowledgeManager();
      await manager.initialize();

      const updates: Partial<Solution> = {};

      if (options.fixCommand) updates.fixCommand = options.fixCommand;
      if (options.riskLevel) updates.riskLevel = options.riskLevel;
      if (options.verified !== undefined) updates.verified = options.verified === 'true';

      const success = await manager.updateSolution(id, updates);

      if (success) {
        console.log(chalk.green('✓ Solution updated'));
      } else {
        console.log(chalk.red('Solution not found'));
      }
    });

  // export 子命令
  knowledgeCmd
    .command('export [output]')
    .description('Export knowledge base to file')
    .option('--verified', 'Export only verified solutions (success ≥ 3)')
    .action(async (output, options) => {
      const manager = new KnowledgeManager();
      await manager.initialize();

      const outputPath = output || path.join(process.cwd(), `openclaw-knowledge-${Date.now()}.json`);

      if (options.verified) {
        const count = await manager.exportVerified(outputPath);
        console.log(chalk.gray(`Only verified solutions exported (quality assured)`));
      } else {
        await manager.export(outputPath);
      }
    });

  // import 子命令
  knowledgeCmd
    .command('import <file>')
    .description('Import knowledge base from file')
    .option('--skip-security', 'Skip security validation (not recommended)')
    .action(async (file, options) => {
      if (!(await fs.pathExists(file))) {
        console.log(chalk.red('File not found'));
        return;
      }

      const manager = new KnowledgeManager();
      await manager.initialize();
      
      const result = await manager.import(file, options.skipSecurity);
      
      if (result.warnings.length > 0) {
        console.log();
        manager.printSecurityWarnings(result.warnings);
      }
    });

  // stats 子命令
  knowledgeCmd
    .command('stats')
    .description('Show knowledge base statistics')
    .action(async () => {
      const manager = new KnowledgeManager();
      await manager.initialize();
      manager.printStats();
    });

  // validate 子命令 - 安全检测
  knowledgeCmd
    .command('validate [file]')
    .description('Validate knowledge base security')
    .option('--remote', 'Validate remote knowledge base before sync')
    .action(async (file, options) => {
      console.log(chalk.blue('🔒 Knowledge Base Security Validation\n'));

      const manager = new KnowledgeManager();
      await manager.initialize();

      if (options.remote) {
        // 验证远程知识库
        const remoteUrl = manager.getRemoteUrl();
        if (!remoteUrl) {
          console.log(chalk.yellow('No remote URL configured.'));
          return;
        }

        console.log(chalk.gray(`Validating remote: ${remoteUrl}\n`));

        try {
          const response = await fetch(remoteUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'openclaw-guard/1.0',
            },
            signal: AbortSignal.timeout(30000),
          });

          if (!response.ok) {
            console.log(chalk.red(`Failed to fetch: HTTP ${response.status}`));
            return;
          }

          const remoteData = await response.json() as KnowledgeBase;
          const validation = manager.validateKnowledgeBase(remoteData);
          
          if (validation.valid) {
            console.log(chalk.green(`✓ Remote knowledge base is safe`));
          } else {
            console.log(chalk.red(`✗ Remote knowledge base has security issues`));
          }
          
          manager.printSecurityWarnings(validation.warnings);
        } catch (error) {
          console.log(chalk.red(`Failed to validate remote: ${error}`));
        }
        return;
      }

      if (file) {
        // 验证指定文件
        if (!(await fs.pathExists(file))) {
          console.log(chalk.red('File not found'));
          return;
        }

        console.log(chalk.gray(`Validating file: ${file}\n`));

        const data = await fs.readJson(file);
        const validation = manager.validateKnowledgeBase(data);
        
        if (validation.valid) {
          console.log(chalk.green(`✓ File is safe to import`));
        } else {
          console.log(chalk.red(`✗ File has security issues - do not import`));
        }
        
        manager.printSecurityWarnings(validation.warnings);
        return;
      }

      // 验证本地知识库
      console.log(chalk.gray('Validating local knowledge base\n'));

      const solutions = manager.getAllSolutions();
      const allWarnings: any[] = [];

      for (const solution of solutions) {
        const warnings = manager.validateSolution(solution);
        allWarnings.push(...warnings);
      }

      const criticalCount = allWarnings.filter((w: any) => w.severity === 'critical').length;
      const highCount = allWarnings.filter((w: any) => w.severity === 'high').length;

      if (criticalCount === 0 && highCount === 0) {
        console.log(chalk.green(`✓ Local knowledge base is safe`));
      } else {
        console.log(chalk.yellow(`⚠️  Local knowledge base has ${criticalCount + highCount} issues`));
      }

      manager.printSecurityWarnings(allWarnings);
    });

  // sync 子命令 - 从远程同步知识库
  knowledgeCmd
    .command('sync')
    .description('Sync knowledge base from remote URL')
    .option('-u, --url <url>', 'Remote knowledge base URL (overrides saved config)')
    .option('--push', 'Push verified solutions to remote (verified ≥ 1)')
    .option('--bidirectional', 'Both pull from and push to remote')
    .action(async (options) => {
      const manager = new KnowledgeManager();
      await manager.initialize();

      // 如果命令行指定了 URL，临时使用
      if (options.url) {
        manager.setRemoteUrl(options.url);
      }

      const remoteUrl = manager.getRemoteUrl();
      if (!remoteUrl && !options.url) {
        console.log(chalk.yellow('No remote URL configured.'));
        console.log(chalk.gray('Set one with: openclaw-guard knowledge remote <url>'));
        console.log(chalk.gray('Or use: openclaw-guard knowledge sync --url <url>'));
        return;
      }

      const url = options.url || remoteUrl;

      // 推送模式
      if (options.push) {
        console.log(chalk.blue('📤 Pushing Verified Solutions to Remote\n'));
        console.log(chalk.gray(`Remote: ${url}\n`));
        console.log(chalk.gray('Push verified solutions (success ≥ 1) with security check:\n'));
        console.log(chalk.gray('  - Security validation: critical issues blocked'));
        console.log(chalk.gray('  - Matched by ID or pattern: accumulate counts'));
        console.log(chalk.gray('  - Not matched: create new entry\n'));

        const result = await manager.syncToRemote(url);

        if (result.success) {
          console.log(chalk.green(`✓ ${result.message}`));
          console.log(chalk.gray(`  Safe: ${result.count} solutions passed security check`));
          console.log(chalk.gray(`  Merged: ${result.merged} (counts accumulated)`));
          console.log(chalk.gray(`  Created: ${result.created} (new entries)`));
          if (result.skipped > 0) {
            console.log(chalk.yellow(`  Skipped: ${result.skipped} (security issues)`));
          }
        } else {
          console.log(chalk.red(`✗ ${result.message}`));
          if (result.skipped > 0) {
            console.log(chalk.yellow(`  Skipped: ${result.skipped} (security issues)`));
          }
        }
        return;
      }

      // 双向同步
      if (options.bidirectional) {
        console.log(chalk.blue('🔄 Bidirectional Sync\n'));
        console.log(chalk.gray(`Remote: ${url}\n`));

        // 先推送
        console.log(chalk.cyan('Step 1: Pushing verified solutions (with security check)...'));
        const pushResult = await manager.syncToRemote(url);
        if (pushResult.success) {
          console.log(chalk.green(`  ✓ ${pushResult.count} safe solutions (${pushResult.merged} merged, ${pushResult.created} created)`));
          if (pushResult.skipped > 0) {
            console.log(chalk.yellow(`  ⚠ ${pushResult.skipped} skipped (security issues)`));
          }
        } else {
          console.log(chalk.yellow(`  ⚠ Push: ${pushResult.message}`));
          if (pushResult.skipped > 0) {
            console.log(chalk.yellow(`  ⚠ ${pushResult.skipped} skipped (security issues)`));
          }
        }

        // 再拉取
        console.log(chalk.cyan('\nStep 2: Pulling from remote (success ≥ 3 only, with security check)...'));
        const pullResult = await manager.syncFromRemote();
        if (pullResult.success) {
          console.log(chalk.green(`  ✓ Added: ${pullResult.added}, Updated: ${pullResult.updated}`));
          if (pullResult.skipped > 0) {
            console.log(chalk.gray(`  Skipped: ${pullResult.skipped} (unverified)`));
          }
        } else {
          console.log(chalk.yellow(`  ⚠ Pull: ${pullResult.message}`));
        }
        return;
      }

      // 默认拉取模式
      console.log(chalk.blue('🔄 Syncing Knowledge Base from Remote\n'));
      console.log(chalk.gray(`Remote: ${url}\n`));
      console.log(chalk.gray('Only pulling solutions with success ≥ 3 (verified).\n'));

      const result = await manager.syncFromRemote();

      if (result.success) {
        console.log(chalk.green(`✓ ${result.message}`));
        console.log(chalk.gray(`  Added: ${result.added}`));
        console.log(chalk.gray(`  Updated: ${result.updated}`));
        console.log(chalk.gray(`  Skipped: ${result.skipped} (unverified or low count)`));
      } else {
        console.log(chalk.red(`✗ ${result.message}`));
      }
    });

  // remote 子命令 - 设置远程知识库地址
  knowledgeCmd
    .command('remote <url>')
    .description('Set remote knowledge base URL')
    .option('-i, --interval <hours>', 'Auto-sync interval in hours (0 to disable)', parseFloat)
    .action(async (url, options) => {
      console.log(chalk.blue('🌐 Configure Remote Knowledge Base\n'));

      const manager = new KnowledgeManager();
      await manager.initialize();

      manager.setRemoteUrl(url);
      console.log(chalk.green(`✓ Remote URL set: ${url}`));

      if (options.interval !== undefined) {
        manager.setAutoSyncInterval(options.interval);
        if (options.interval > 0) {
          console.log(chalk.green(`✓ Auto-sync enabled: every ${options.interval} hour(s)`));
        } else {
          console.log(chalk.gray('Auto-sync disabled'));
        }
      }

      console.log(chalk.gray('\nRun "openclaw-guard knowledge sync" to sync now'));
    });

  // auto-sync 子命令 - 配置自动同步
  knowledgeCmd
    .command('auto-sync [hours]')
    .description('Set auto-sync interval (0 to disable)')
    .action(async (hours) => {
      const manager = new KnowledgeManager();
      await manager.initialize();

      const interval = hours !== undefined ? parseFloat(hours) : 24;

      if (interval <= 0) {
        manager.setAutoSyncInterval(0);
        console.log(chalk.gray('Auto-sync disabled'));
      } else {
        manager.setAutoSyncInterval(interval);
        console.log(chalk.green(`✓ Auto-sync set to every ${interval} hour(s)`));
        
        const remoteUrl = manager.getRemoteUrl();
        if (!remoteUrl) {
          console.log(chalk.yellow('\n⚠️  No remote URL configured.'));
          console.log(chalk.gray('Set one with: openclaw-guard knowledge remote <url>'));
        }
      }
    });

  // search 子命令
  knowledgeCmd
    .command('search <query>')
    .description('Search solutions by query')
    .action(async (query) => {
      console.log(chalk.blue(`🔍 Searching: "${query}"\n`));

      const manager = new KnowledgeManager();
      await manager.initialize();

      const solutions = manager.getAllSolutions();
      const lowerQuery = query.toLowerCase();

      const matches = solutions.filter(s => 
        s.name.toLowerCase().includes(lowerQuery) ||
        s.description.toLowerCase().includes(lowerQuery) ||
        s.tags.some(t => t.toLowerCase().includes(lowerQuery)) ||
        s.symptoms.some(sy => sy.toLowerCase().includes(lowerQuery))
      );

      if (matches.length === 0) {
        console.log('No matches found');
        return;
      }

      for (const solution of matches) {
        const verifiedIcon = solution.verified ? '✓' : '?';
        console.log(`${verifiedIcon} ${solution.name} (${solution.category})`);
        console.log(chalk.gray(`  ${solution.description}`));
        if (solution.fixCommand) {
          console.log(chalk.gray(`  Fix: ${solution.fixCommand}`));
        }
        console.log();
      }

      console.log(`Found ${matches.length} solution(s)`);
    });
}
