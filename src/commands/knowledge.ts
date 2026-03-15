import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { KnowledgeManager, Solution } from '../lib/knowledge';

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
    .action(async (output) => {
      const manager = new KnowledgeManager();
      await manager.initialize();

      const outputPath = output || path.join(process.cwd(), `openclaw-knowledge-${Date.now()}.json`);
      await manager.export(outputPath);
    });

  // import 子命令
  knowledgeCmd
    .command('import <file>')
    .description('Import knowledge base from file')
    .action(async (file) => {
      if (!(await fs.pathExists(file))) {
        console.log(chalk.red('File not found'));
        return;
      }

      const manager = new KnowledgeManager();
      await manager.initialize();
      await manager.import(file);
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
