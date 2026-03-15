import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

export interface Solution {
  id: string;
  name: string;
  description: string;
  problemPatterns: string[]; // 问题匹配模式（正则）
  symptoms: string[]; // 症状描述
  diagnosis: string; // 诊断方法
  fixCommand?: string; // 修复命令
  fixScript?: string; // 修复脚本
  riskLevel: 'low' | 'medium' | 'high';
  category: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  successCount: number;
  failCount: number;
  source: 'builtin' | 'learned' | 'ai'; // 来源
  verified: boolean; // 是否验证过
}

export interface KnowledgeBase {
  version: string;
  solutions: Solution[];
  lastUpdated: string;
}

export class KnowledgeManager {
  private knowledgePath: string;
  private knowledge: KnowledgeBase;

  constructor() {
    const openclawDir = path.join(os.homedir(), '.openclaw');
    this.knowledgePath = path.join(openclawDir, 'guard-knowledge.json');
    this.knowledge = {
      version: '1.0.0',
      solutions: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  async initialize(): Promise<void> {
    await this.load();
    
    // 合并内置知识
    await this.mergeBuiltinSolutions();
  }

  private async load(): Promise<void> {
    try {
      if (await fs.pathExists(this.knowledgePath)) {
        this.knowledge = await fs.readJson(this.knowledgePath);
      }
    } catch {
      // 加载失败，使用默认
    }
  }

  private async save(): Promise<void> {
    try {
      this.knowledge.lastUpdated = new Date().toISOString();
      await fs.ensureDir(path.dirname(this.knowledgePath));
      await fs.writeJson(this.knowledgePath, this.knowledge, { spaces: 2 });
    } catch (error) {
      console.error('Failed to save knowledge base:', error);
    }
  }

  // 内置解决方案
  private async mergeBuiltinSolutions(): Promise<void> {
    const builtin: Solution[] = [
      {
        id: 'node-version-low',
        name: 'Node.js 版本过低',
        description: 'Node.js 版本不满足 OpenClaw 要求 (>= 22.16.0)',
        problemPatterns: ['Node\\.?js version.*requires.*>=', 'node.*version.*low'],
        symptoms: ['启动报错 "Node version"', 'ExperimentalWarning 大量警告'],
        diagnosis: 'node --version 检查版本号',
        fixCommand: 'source ~/.nvm/nvm.sh && nvm install 22 && nvm alias default 22',
        riskLevel: 'low',
        category: 'environment',
        tags: ['node', 'version', 'nvm'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'config-not-found',
        name: '配置文件不存在',
        description: 'OpenClaw 配置文件 ~/.openclaw/openclaw.json 不存在',
        problemPatterns: ['Config.*not found', 'openclaw\\.json.*missing'],
        symptoms: ['openclaw 命令报错', 'Gateway 无法启动'],
        diagnosis: '检查 ~/.openclaw/openclaw.json 是否存在',
        fixCommand: 'openclaw onboard',
        riskLevel: 'low',
        category: 'config',
        tags: ['config', 'init'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'directory-missing',
        name: '必要目录缺失',
        description: 'OpenClaw 工作目录不存在',
        problemPatterns: ['directory.*missing', 'ENOENT.*openclaw'],
        symptoms: ['运行时报错 ENOENT', '插件加载失败'],
        diagnosis: '检查 logs, workspace, plugins 等目录',
        fixCommand: 'mkdir -p ~/.openclaw/{logs,workspace,plugins,devices,memory}',
        riskLevel: 'low',
        category: 'filesystem',
        tags: ['directory', 'filesystem'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'permission-insecure',
        name: '目录权限不安全',
        description: '配置目录权限过于开放',
        problemPatterns: ['permission.*700', 'insecure.*permission'],
        symptoms: ['安全检查警告', '其他用户可读取配置'],
        diagnosis: 'stat ~/.openclaw 检查权限',
        fixCommand: 'chmod 700 ~/.openclaw',
        riskLevel: 'low',
        category: 'security',
        tags: ['permission', 'security'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'gateway-not-running',
        name: 'Gateway 未运行',
        description: 'OpenClaw Gateway 服务未启动',
        problemPatterns: ['Gateway.*not running', 'gateway.*stopped'],
        symptoms: ['API 请求无响应', '端口未监听'],
        diagnosis: 'pgrep -f "openclaw gateway" 或 ss -tlnp | grep 18789',
        fixCommand: 'openclaw gateway',
        riskLevel: 'low',
        category: 'service',
        tags: ['gateway', 'service'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'port-in-use',
        name: '端口被占用',
        description: 'Gateway 端口被其他进程占用',
        problemPatterns: ['port.*in use', 'EADDRINUSE', 'address already in use'],
        symptoms: ['Gateway 启动失败', '端口绑定错误'],
        diagnosis: 'ss -tlnp | grep <port>',
        fixCommand: 'kill $(lsof -t -i:<port>)',
        riskLevel: 'medium',
        category: 'network',
        tags: ['port', 'network', 'conflict'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'config-json-invalid',
        name: '配置文件 JSON 格式错误',
        description: 'openclaw.json 存在语法错误',
        problemPatterns: ['JSON.*parse', 'Unexpected token', 'JSON.*invalid'],
        symptoms: ['配置加载失败', '解析错误'],
        diagnosis: 'node -e "JSON.parse(require(\\"fs\\").readFileSync(\\"~/.openclaw/openclaw.json\\"))"',
        fixScript: '移除注释和尾随逗号',
        riskLevel: 'medium',
        category: 'config',
        tags: ['json', 'config', 'syntax'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'api-key-missing',
        name: 'API Key 未配置',
        description: '模型提供商的 API Key 未设置',
        problemPatterns: ['API.*key.*missing', 'apiKey.*required', 'unauthorized'],
        symptoms: ['模型调用失败', '401 错误'],
        diagnosis: '检查 config.models.providers.*.apiKey',
        fixCommand: 'openclaw config set models.providers.<provider>.apiKey <key>',
        riskLevel: 'low',
        category: 'config',
        tags: ['api', 'key', 'model'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'plugin-load-failed',
        name: '插件加载失败',
        description: 'OpenClaw 插件无法加载',
        problemPatterns: ['plugin.*load.*failed', 'Cannot find module.*plugin'],
        symptoms: ['插件功能不可用', '启动时报错'],
        diagnosis: '检查 plugins 目录和 package.json',
        fixCommand: 'openclaw plugins install <plugin-name>',
        riskLevel: 'low',
        category: 'plugin',
        tags: ['plugin', 'install'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'memory-leak',
        name: '内存泄漏',
        description: 'Gateway 进程内存持续增长',
        problemPatterns: ['memory.*leak', 'out of memory', 'heap.*limit'],
        symptoms: ['进程变慢', 'OOM 被 kill'],
        diagnosis: '监控 ps aux | grep openclaw 的 RSS',
        fixCommand: 'pm2 restart openclaw-gateway 或 kill -HUP <pid>',
        riskLevel: 'medium',
        category: 'performance',
        tags: ['memory', 'performance', 'leak'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'nvm-command-not-found',
        name: 'nvm 命令不可用',
        description: '在子 shell 中执行 nvm 命令失败',
        problemPatterns: ['nvm: command not found', 'bash: nvm:.*not found'],
        symptoms: ['修复失败', 'Node.js 安装失败'],
        diagnosis: '检查 shell 是否加载了 nvm',
        fixCommand: 'source ~/.nvm/nvm.sh && nvm install 22 && nvm alias default 22',
        riskLevel: 'low',
        category: 'environment',
        tags: ['nvm', 'node', 'shell'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'learned',
        verified: true,
      },
      {
        id: 'node-version-not-applied',
        name: 'Node.js 版本未生效',
        description: '安装了新版本 Node.js 但终端仍使用旧版本',
        problemPatterns: ['requires Node.*Detected.*node', 'Detected: node.*requires'],
        symptoms: ['openclaw 报版本错误', 'node --version 显示旧版本'],
        diagnosis: '检查当前 node 版本和 nvm alias',
        fixCommand: 'echo "nvm use 22 --silent" >> ~/.bashrc && source ~/.bashrc',
        riskLevel: 'low',
        category: 'environment',
        tags: ['nvm', 'node', 'bashrc', 'terminal'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'learned',
        verified: true,
      },
      {
        id: 'duplicate-plugin-id',
        name: '重复插件 ID',
        description: '插件 ID 与内置或已安装插件冲突',
        problemPatterns: ['duplicate plugin id', 'plugin.*overridden'],
        symptoms: ['Config warnings 显示 duplicate plugin', '插件行为异常'],
        diagnosis: '检查 openclaw.plugins.entries 和 extensions 目录',
        fixCommand: '删除重复的扩展: rm -rf ~/.openclaw/extensions/<plugin-name>',
        riskLevel: 'low',
        category: 'plugin',
        tags: ['plugin', 'duplicate', 'config'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'plugins-allow-empty',
        name: '插件白名单为空',
        description: 'plugins.allow 未配置，所有插件都可能自动加载',
        problemPatterns: ['plugins.allow is empty', 'untrusted plugins may auto-load'],
        symptoms: ['安全警告', '未知插件被加载'],
        diagnosis: '检查 config.plugins.allow 数组',
        fixCommand: 'openclaw-guard diagnose --fix (自动添加信任插件)',
        riskLevel: 'medium',
        category: 'security',
        tags: ['plugin', 'security', 'whitelist'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
      {
        id: 'builtin-plugin-conflict',
        name: '内置插件冲突',
        description: '安装的扩展与 OpenClaw 内置插件同名',
        problemPatterns: ['duplicate plugin id.*voice-call', 'overridden.*extensions'],
        symptoms: ['重复插件警告', '插件可能被覆盖'],
        diagnosis: '检查是否安装了与内置同名的插件（如 voice-call）',
        fixCommand: 'openclaw plugins uninstall <plugin-name>',
        riskLevel: 'low',
        category: 'plugin',
        tags: ['plugin', 'builtin', 'conflict'],
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 0,
        failCount: 0,
        source: 'builtin',
        verified: true,
      },
    ];

    // 合并内置方案（不覆盖已学习的）
    for (const solution of builtin) {
      const existing = this.knowledge.solutions.find(s => s.id === solution.id);
      if (!existing) {
        this.knowledge.solutions.push(solution);
      }
    }

    await this.save();
  }

  // 查找匹配的解决方案
  findSolution(problem: string): Solution | null {
    const lowerProblem = problem.toLowerCase();

    for (const solution of this.knowledge.solutions) {
      // 检查问题模式
      for (const pattern of solution.problemPatterns) {
        try {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(problem)) {
            return solution;
          }
        } catch {
          // 正则无效，尝试字符串匹配
          if (lowerProblem.includes(pattern.toLowerCase())) {
            return solution;
          }
        }
      }

      // 检查症状
      for (const symptom of solution.symptoms) {
        if (lowerProblem.includes(symptom.toLowerCase())) {
          return solution;
        }
      }
    }

    return null;
  }

  // 学习新解决方案
  async learn(solution: Omit<Solution, 'id' | 'createdAt' | 'updatedAt' | 'successCount' | 'failCount'>): Promise<Solution> {
    const newSolution: Solution = {
      ...solution,
      id: `learned-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      successCount: 0,
      failCount: 0,
    };

    this.knowledge.solutions.push(newSolution);
    await this.save();

    console.log(chalk.green(`✓ Learned new solution: ${newSolution.name}`));
    return newSolution;
  }

  // 更新解决方案
  async updateSolution(id: string, updates: Partial<Solution>): Promise<boolean> {
    const solution = this.knowledge.solutions.find(s => s.id === id);
    if (!solution) return false;

    Object.assign(solution, updates, { updatedAt: new Date() });
    await this.save();
    return true;
  }

  // 记录修复结果
  async recordResult(id: string, success: boolean): Promise<void> {
    const solution = this.knowledge.solutions.find(s => s.id === id);
    if (!solution) return;

    if (success) {
      solution.successCount++;
    } else {
      solution.failCount++;
    }
    solution.updatedAt = new Date();
    
    // 如果成功次数够多，标记为已验证
    if (solution.successCount >= 3 && !solution.verified) {
      solution.verified = true;
      console.log(chalk.green(`✓ Solution verified: ${solution.name}`));
    }

    await this.save();
  }

  // 获取所有解决方案
  getAllSolutions(): Solution[] {
    return this.knowledge.solutions;
  }

  // 获取已验证的解决方案
  getVerifiedSolutions(): Solution[] {
    return this.knowledge.solutions.filter(s => s.verified);
  }

  // 获取学习到的解决方案
  getLearnedSolutions(): Solution[] {
    return this.knowledge.solutions.filter(s => s.source === 'learned' || s.source === 'ai');
  }

  // 导出知识库
  async export(outputPath: string): Promise<void> {
    await fs.writeJson(outputPath, this.knowledge, { spaces: 2 });
    console.log(chalk.green(`✓ Knowledge base exported to: ${outputPath}`));
  }

  // 导入知识库
  async import(inputPath: string): Promise<number> {
    const imported = await fs.readJson(inputPath);
    let count = 0;

    for (const solution of imported.solutions || []) {
      const existing = this.knowledge.solutions.find(s => s.id === solution.id);
      if (!existing) {
        this.knowledge.solutions.push(solution);
        count++;
      } else {
        // 更新已有方案
        Object.assign(existing, solution, { updatedAt: new Date() });
      }
    }

    await this.save();
    console.log(chalk.green(`✓ Imported ${count} new solutions`));
    return count;
  }

  // 打印知识库统计
  printStats(): void {
    console.log(chalk.blue('\n📚 Knowledge Base Statistics\n'));
    console.log(`Total solutions: ${this.knowledge.solutions.length}`);
    console.log(`  Verified: ${this.knowledge.solutions.filter(s => s.verified).length}`);
    console.log(`  Learned: ${this.knowledge.solutions.filter(s => s.source === 'learned' || s.source === 'ai').length}`);
    console.log(`  Built-in: ${this.knowledge.solutions.filter(s => s.source === 'builtin').length}`);
    
    const totalSuccess = this.knowledge.solutions.reduce((sum, s) => sum + s.successCount, 0);
    const totalFail = this.knowledge.solutions.reduce((sum, s) => sum + s.failCount, 0);
    console.log(`\nFix statistics:`);
    console.log(`  Success: ${totalSuccess}`);
    console.log(`  Failed: ${totalFail}`);
    
    if (totalSuccess + totalFail > 0) {
      console.log(`  Success rate: ${((totalSuccess / (totalSuccess + totalFail)) * 100).toFixed(1)}%`);
    }
  }
}
