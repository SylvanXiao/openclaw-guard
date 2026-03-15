import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import execa = require('execa');
import chalk from 'chalk';
import { loadConfig, saveConfig, getOpenClawDir, configExists } from '../lib/config';
import { KnowledgeManager, Solution } from './knowledge';

export interface FixResult {
  issue: string;
  action: string;
  success: boolean;
  message: string;
  solutionId?: string; // 关联的解决方案ID
}

export interface AIFixSuggestion {
  diagnosis: string;
  fixCommand: string;
  fixScript?: string;
  riskLevel: 'low' | 'medium' | 'high';
  explanation: string;
}

// openclaw-guard 自己的 AI 配置
interface GuardAIConfig {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export class AutoFixer {
  private results: FixResult[] = [];
  private openclawDir: string;
  private guardConfigDir: string;
  private aiEnabled: boolean = false;
  private apiEndpoint: string = '';
  private apiKey: string = '';
  private aiModel: string = '';
  private aiConfigSource: string = ''; // 配置来源
  private knowledgeManager: KnowledgeManager;

  constructor() {
    this.openclawDir = getOpenClawDir();
    this.guardConfigDir = path.join(os.homedir(), '.openclaw-guard');
    this.knowledgeManager = new KnowledgeManager();
  }

  private async loadAIConfig(): Promise<void> {
    // 1. 先尝试 OpenClaw 的配置
    const openclawConfig = await this.loadOpenClawAIConfig();
    
    if (openclawConfig && await this.testAIConnection(openclawConfig)) {
      this.applyAIConfig(openclawConfig, 'OpenClaw');
      return;
    }

    // 2. OpenClaw 配置不可用，使用 guard 自己的配置
    const guardConfig = await this.loadGuardAIConfig();
    
    if (guardConfig && await this.testAIConnection(guardConfig)) {
      this.applyAIConfig(guardConfig, 'openclaw-guard');
      return;
    }

    console.log(chalk.gray('[AI] No valid AI configuration found'));
    this.aiEnabled = false;
  }

  private async loadOpenClawAIConfig(): Promise<GuardAIConfig | null> {
    try {
      const configPath = path.join(this.openclawDir, 'openclaw.json');
      if (!(await fs.pathExists(configPath))) return null;

      const config = await fs.readJson(configPath);
      const defaultModel = config?.agents?.defaults?.model?.primary || '';
      if (!defaultModel) return null;

      const [providerName] = defaultModel.split('/');
      const providers = config?.models?.providers || {};
      const provider = providers[providerName] as any;

      if (!provider?.apiKey) {
        // 尝试其他 provider
        for (const [name, p] of Object.entries(providers)) {
          const pc = p as any;
          if (pc?.apiKey) {
            return {
              provider: name,
              apiKey: pc.apiKey,
              baseUrl: pc.baseUrl || this.getDefaultEndpoint(name),
              model: defaultModel,
            };
          }
        }
        return null;
      }

      return {
        provider: providerName,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl || this.getDefaultEndpoint(providerName),
        model: defaultModel,
      };
    } catch {
      return null;
    }
  }

  private async loadGuardAIConfig(): Promise<GuardAIConfig | null> {
    try {
      const configPath = path.join(this.guardConfigDir, 'config.json');
      if (!(await fs.pathExists(configPath))) return null;

      const config = await fs.readJson(configPath);
      const ai = config?.ai;

      if (!ai?.apiKey || !ai?.model) return null;

      return {
        provider: ai.provider || 'custom',
        apiKey: ai.apiKey,
        baseUrl: ai.baseUrl || this.getDefaultEndpoint(ai.provider || 'custom'),
        model: ai.model,
      };
    } catch {
      return null;
    }
  }

  private async testAIConnection(config: GuardAIConfig): Promise<boolean> {
    try {
      // 简单测试：发送一个最小请求验证 API 是否可用
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(10000),
      });

      // 只要不是 401/403 就认为可用
      return response.status !== 401 && response.status !== 403;
    } catch {
      return false;
    }
  }

  private applyAIConfig(config: GuardAIConfig, source: string): void {
    this.apiKey = config.apiKey;
    this.apiEndpoint = config.baseUrl || this.getDefaultEndpoint(config.provider);
    this.aiModel = config.model;
    this.aiEnabled = true;
    this.aiConfigSource = source;

    console.log(chalk.gray(`[AI] Config source: ${source}`));
    console.log(chalk.gray(`[AI] Provider: ${config.provider}`));
    console.log(chalk.gray(`[AI] Model: ${config.model}`));
  }

  private getDefaultEndpoint(provider: string): string {
    const endpoints: Record<string, string> = {
      'openai': 'https://api.openai.com/v1',
      'anthropic': 'https://api.anthropic.com/v1',
      'iflow': 'https://apis.iflow.cn/v1',
      'openrouter': 'https://openrouter.ai/api/v1',
    };
    return endpoints[provider] || `https://api.${provider}.com/v1`;
  }

  async fixAll(diagnosisResults?: any[]): Promise<FixResult[]> {
    this.results = [];

    // 初始化 AI 配置（使用 OpenClaw 配置）
    await this.loadAIConfig();
    
    // 初始化知识库
    await this.knowledgeManager.initialize();

    // 如果有问题，先尝试知识库匹配
    if (diagnosisResults && diagnosisResults.length > 0) {
      const issues = diagnosisResults.filter(r => r.status !== 'ok');
      
      for (const issue of issues) {
        // 1. 先尝试知识库解决方案
        const solution = await this.tryKnowledgeSolution(issue);
        
        if (!solution) {
          // 2. 知识库没有，尝试 AI
          if (this.aiEnabled) {
            await this.fixWithAI(issue);
          }
        }
      }
    }

    // 执行预定义修复（跳过已在知识库修复的问题）
    const fixedIssues = this.results
      .filter(r => r.success)
      .map(r => r.issue.toLowerCase());
    
    if (!fixedIssues.some(i => i.includes('node.js') || i.includes('node version'))) {
      await this.fixNodeVersion();
    }
    
    await this.fixMissingDirectories();
    await this.fixDirectoryPermissions();
    await this.fixConfigFormat();
    await this.fixConfigDefaults();
    
    if (!fixedIssues.some(i => i.includes('gateway'))) {
      await this.fixGatewayNotRunning();
    }
    
    // 运行时问题修复
    await this.fixRuntimeIssues();

    return this.results;
  }

  private async tryKnowledgeSolution(issue: any): Promise<boolean> {
    const problemDesc = `${issue.category}: ${issue.check} - ${issue.message}`;
    const solution = this.knowledgeManager.findSolution(problemDesc);

    if (!solution) return false;

    console.log(chalk.cyan(`[Knowledge] Found solution: ${solution.name}`));

    // 执行修复命令
    if (solution.fixCommand) {
      try {
        // 处理 nvm 命令：确保先 source nvm.sh
        let command = solution.fixCommand;
        const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
        const nvmPath = path.join(nvmDir, 'nvm.sh');
        
        if (command.includes('nvm ') && !command.includes('source') && !command.includes('.nvm/nvm.sh')) {
          if (await fs.pathExists(nvmPath)) {
            command = `source ${nvmPath} && ${command}`;
          }
        }

        console.log(chalk.gray(`  Executing: ${command}`));
        await execa('bash', ['-lc', command], { timeout: 60000 }); // 使用 -l 加载 profile
        
        this.results.push({
          issue: `${issue.category}: ${issue.check}`,
          action: `Applied knowledge: ${solution.name}`,
          success: true,
          message: solution.fixCommand,
          solutionId: solution.id,
        });

        await this.knowledgeManager.recordResult(solution.id, true);
        return true;
      } catch (error) {
        this.results.push({
          issue: `${issue.category}: ${issue.check}`,
          action: `Knowledge fix failed: ${solution.name}`,
          success: false,
          message: String(error),
          solutionId: solution.id,
        });

        await this.knowledgeManager.recordResult(solution.id, false);
        return false;
      }
    }

    return false;
  }

  private async fixWithAI(issue: any): Promise<{ suggestion: AIFixSuggestion; issue: any } | null> {
    try {
      const prompt = this.buildFixPrompt(issue);
      const suggestion = await this.callAI(prompt);

      if (suggestion && suggestion.fixCommand && suggestion.fixCommand !== 'N/A') {
        // 尝试执行 AI 建议
        const success = await this.executeAIFix(suggestion);
        
        if (success) {
          this.results.push({
            issue: `${issue.category}: ${issue.check}`,
            action: `AI fixed: ${suggestion.explanation}`,
            success: true,
            message: `Fix: ${suggestion.fixCommand}`,
          });

          // 学习到知识库
          await this.learnFromAIFix(issue, suggestion);

          return { suggestion, issue };
        } else {
          // 高风险操作，记录建议但不执行
          this.results.push({
            issue: `${issue.category}: ${issue.check}`,
            action: `AI suggested (review needed): ${suggestion.explanation}`,
            success: false,
            message: `Fix: ${suggestion.fixCommand}\nRisk: ${suggestion.riskLevel}`,
          });
        }
      }
    } catch (error) {
      // AI 修复失败，静默处理
    }

    return null;
  }

  // 从 AI 修复中学习新解决方案
  private async learnFromAIFix(issue: any, suggestion: AIFixSuggestion): Promise<void> {
    try {
      // 生成问题模式
      const problemPatterns = [
        `${issue.check}.*${issue.status}`,
        `${issue.category}.*${issue.check}`,
      ];

      // 检查是否已存在类似解决方案
      const existing = this.knowledgeManager.findSolution(`${issue.category}: ${issue.check}`);
      if (existing) {
        // 已存在，更新成功计数
        await this.knowledgeManager.recordResult(existing.id, true);
        return;
      }

      // 创建临时解决方案用于安全检测
      const tempSolution = {
        id: `temp-${Date.now()}`,
        name: `AI: ${issue.check}`,
        description: suggestion.diagnosis || suggestion.explanation,
        problemPatterns,
        symptoms: [issue.message],
        diagnosis: suggestion.explanation,
        fixCommand: suggestion.fixCommand,
        fixScript: suggestion.fixScript,
        riskLevel: suggestion.riskLevel,
        category: issue.category || 'other',
        tags: ['ai-generated', issue.category, issue.check].filter(Boolean),
        createdAt: new Date(),
        updatedAt: new Date(),
        successCount: 1,
        failCount: 0,
        source: 'ai' as const,
        verified: false,
      };

      // 安全检测
      const warnings = this.knowledgeManager.validateSolution(tempSolution);
      const criticalWarnings = warnings.filter(w => w.severity === 'critical');

      if (criticalWarnings.length > 0) {
        console.log(chalk.yellow(`[Learn] Skipped "${issue.check}": ${criticalWarnings.length} critical security issues detected`));
        for (const w of criticalWarnings) {
          console.log(chalk.gray(`  - ${w.description}`));
        }
        return;
      }

      // AI 二次检测（如果启用）
      if (this.aiEnabled && suggestion.fixCommand) {
        const aiValidation = await this.validateFixWithAI(issue, suggestion);
        if (!aiValidation.safe) {
          console.log(chalk.yellow(`[Learn] AI validation rejected: ${aiValidation.reason}`));
          return;
        }
      }

      // 创建新解决方案
      await this.knowledgeManager.learn({
        name: `AI: ${issue.check}`,
        description: suggestion.diagnosis || suggestion.explanation,
        problemPatterns,
        symptoms: [issue.message],
        diagnosis: suggestion.explanation,
        fixCommand: suggestion.fixCommand,
        fixScript: suggestion.fixScript,
        riskLevel: suggestion.riskLevel,
        category: issue.category || 'other',
        tags: ['ai-generated', issue.category, issue.check].filter(Boolean),
        source: 'ai',
        verified: false,
      });

      console.log(chalk.green(`[Learn] New solution learned from AI: ${issue.check}`));
    } catch (error) {
      // 学习失败不影响主流程
    }
  }

  // AI 二次检测修复建议
  private async validateFixWithAI(issue: any, suggestion: AIFixSuggestion): Promise<{ safe: boolean; reason: string }> {
    try {
      const prompt = `You are a security expert reviewing a fix command for safety.

Context:
- Issue: ${issue.category} - ${issue.check}
- Message: ${issue.message}
- Proposed fix command: ${suggestion.fixCommand}
- Risk level: ${suggestion.riskLevel}

Analyze this fix command for:
1. Security risks (destructive operations, privilege escalation, data loss)
2. Side effects (affects other services, modifies system config)
3. Reversibility (can it be undone easily?)

Respond in JSON format only:
{
  "safe": true or false,
  "reason": "Brief explanation",
  "risks": ["list of identified risks if any"]
}

Be conservative - if there's any doubt, mark as unsafe.`;

      const response = await fetch(`${this.apiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.aiModel,
          messages: [
            { role: 'system', content: 'You are a security expert. Respond only with valid JSON.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        // API 失败时默认通过（信任已有的规则检测）
        return { safe: true, reason: 'AI validation unavailable, passed rule-based check' };
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        return { safe: true, reason: 'AI validation unavailable' };
      }

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          safe: result.safe !== false,
          reason: result.reason || (result.safe ? 'Passed AI security check' : 'Failed AI security check'),
        };
      }

      return { safe: true, reason: 'Could not parse AI response' };
    } catch {
      // AI 检测失败时默认通过（信任已有的规则检测）
      return { safe: true, reason: 'AI validation failed, passed rule-based check' };
    }
  }

  private buildFixPrompt(issue: any): string {
    return `You are a DevOps expert diagnosing OpenClaw (an AI agent platform) issues.

Issue detected:
- Category: ${issue.category}
- Check: ${issue.check}
- Status: ${issue.status}
- Message: ${issue.message}
- Suggested fix: ${issue.fix || 'None'}

System context:
- OS: ${os.type()} ${os.release()}
- Node.js: ${process.version}
- OpenClaw config dir: ${this.openclawDir}

Respond in JSON format:
{
  "diagnosis": "Brief explanation of root cause",
  "fixCommand": "Shell command to fix (single line, or 'N/A' if no command)",
  "fixScript": "Multi-line script if needed, otherwise null",
  "riskLevel": "low|medium|high",
  "explanation": "What the fix does"
}

Only suggest safe fixes. For destructive operations, set riskLevel to "high".`;
  }

  private async callAI(prompt: string): Promise<AIFixSuggestion | null> {
    if (!this.apiKey || !this.apiEndpoint || !this.aiModel) {
      return null;
    }

    try {
      // 使用 OpenClaw 配置的模型
      const response = await fetch(`${this.apiEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.aiModel,
          messages: [
            { role: 'system', content: 'You are a DevOps expert. Respond only with valid JSON.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        return null;
      }

      // 解析 JSON 响应
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as AIFixSuggestion;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async executeAIFix(suggestion: AIFixSuggestion): Promise<boolean> {
    if (suggestion.riskLevel === 'high') {
      console.log(chalk.yellow('⚠️  High risk operation. Please review:'));
      console.log(chalk.gray(`Command: ${suggestion.fixCommand}`));
      return false;
    }

    try {
      if (suggestion.fixCommand && suggestion.fixCommand !== 'N/A') {
        await execa('bash', ['-c', suggestion.fixCommand]);
        return true;
      }

      if (suggestion.fixScript) {
        const scriptPath = path.join(os.tmpdir(), `openclaw-fix-${Date.now()}.sh`);
        await fs.writeFile(scriptPath, suggestion.fixScript, { mode: 0o755 });
        await execa(scriptPath);
        await fs.remove(scriptPath);
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  isAIEnabled(): boolean {
    return this.aiEnabled;
  }

  private async fixNodeVersion(): Promise<void> {
    const requiredVersion = '22.16.0';
    const currentVersion = process.version.replace('v', '');
    
    const satisfies = this.compareVersions(currentVersion, requiredVersion) >= 0;
    
    if (satisfies) {
      return;
    }

    const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
    const nvmPath = path.join(nvmDir, 'nvm.sh');

    if (!(await fs.pathExists(nvmPath))) {
      this.results.push({
        issue: `Node.js version ${currentVersion} < ${requiredVersion}`,
        action: 'Upgrade Node.js',
        success: false,
        message: 'nvm not found. Install nvm or upgrade Node.js manually',
      });
      return;
    }

    try {
      const { stdout: installedVersions } = await execa('bash', [
        '-c', `source ${nvmPath} && nvm ls 22 --no-alias`
      ], { reject: false });

      const hasV22 = installedVersions.includes('v22');

      if (hasV22) {
        await execa('bash', [
          '-c', `source ${nvmPath} && nvm alias default 22`
        ]);
        
        this.results.push({
          issue: `Node.js version ${currentVersion} < ${requiredVersion}`,
          action: 'Set Node.js v22 as default',
          success: true,
          message: 'Run "source ~/.nvm/nvm.sh" or restart terminal to apply',
        });
      } else {
        this.results.push({
          issue: `Node.js version ${currentVersion} < ${requiredVersion}`,
          action: 'Installing Node.js v22',
          success: false,
          message: 'Run: source ~/.nvm/nvm.sh && nvm install 22 && nvm alias default 22',
        });
      }
    } catch (error) {
      this.results.push({
        issue: `Node.js version ${currentVersion} < ${requiredVersion}`,
        action: 'Upgrade Node.js',
        success: false,
        message: `Run: nvm install 22 && nvm alias default 22`,
      });
    }
  }

  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA > numB) return 1;
      if (numA < numB) return -1;
    }
    return 0;
  }

  private async fixMissingDirectories(): Promise<void> {
    const requiredDirs = [
      this.openclawDir,
      path.join(this.openclawDir, 'logs'),
      path.join(this.openclawDir, 'workspace'),
      path.join(this.openclawDir, 'plugins'),
      path.join(this.openclawDir, 'devices'),
      path.join(this.openclawDir, 'memory'),
      path.join(this.openclawDir, 'agents'),
    ];

    for (const dir of requiredDirs) {
      if (!(await fs.pathExists(dir))) {
        try {
          await fs.ensureDir(dir);
          this.results.push({
            issue: `Missing directory: ${path.basename(dir)}`,
            action: 'Created directory',
            success: true,
            message: dir,
          });
        } catch (error) {
          this.results.push({
            issue: `Missing directory: ${path.basename(dir)}`,
            action: 'Create directory',
            success: false,
            message: String(error),
          });
        }
      }
    }
  }

  private async fixDirectoryPermissions(): Promise<void> {
    try {
      if (await fs.pathExists(this.openclawDir)) {
        const stat = await fs.stat(this.openclawDir);
        const mode = stat.mode & 0o777;
        
        if (mode !== 0o700) {
          await fs.chmod(this.openclawDir, 0o700);
          this.results.push({
            issue: 'Insecure directory permissions',
            action: 'Set permissions to 700',
            success: true,
            message: this.openclawDir,
          });
        }
      }
    } catch (error) {
      this.results.push({
        issue: 'Directory permissions',
        action: 'Fix permissions',
        success: false,
        message: String(error),
      });
    }
  }

  private async fixConfigFormat(): Promise<void> {
    const configPath = path.join(this.openclawDir, 'openclaw.json');
    
    if (!(await fs.pathExists(configPath))) {
      return;
    }

    try {
      const content = await fs.readFile(configPath, 'utf-8');
      
      try {
        JSON.parse(content);
      } catch (parseError) {
        const fixed = this.tryFixJson(content);
        if (fixed) {
          await fs.writeFile(configPath, fixed, 'utf-8');
          this.results.push({
            issue: 'Invalid JSON format',
            action: 'Repaired JSON syntax',
            success: true,
            message: 'Trailing commas and comments removed',
          });
        } else {
          this.results.push({
            issue: 'Invalid JSON format',
            action: 'Repair JSON',
            success: false,
            message: 'Unable to auto-repair, manual fix required',
          });
        }
      }
    } catch (error) {
      // 忽略读取错误
    }
  }

  private tryFixJson(content: string): string | null {
    try {
      let fixed = content.replace(/\/\/.*$/gm, '');
      fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, '');
      fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
      JSON.parse(fixed);
      return fixed;
    } catch {
      return null;
    }
  }

  private async fixConfigDefaults(): Promise<void> {
    if (!(await configExists())) {
      return;
    }

    try {
      const config = await loadConfig();
      if (!config) return;

      let modified = false;

      if (!config.gateway) {
        config.gateway = {
          mode: 'local',
          port: 18789,
          bind: '127.0.0.1',
        };
        modified = true;
        this.results.push({
          issue: 'Missing gateway config',
          action: 'Added default gateway config',
          success: true,
          message: 'port: 18789, bind: 127.0.0.1',
        });
      }

      if (!config.agents) {
        config.agents = {
          list: [{
            id: 'main',
            default: true,
            workspace: path.join(this.openclawDir, 'workspace'),
          }],
        };
        modified = true;
        this.results.push({
          issue: 'Missing agents config',
          action: 'Added default agent config',
          success: true,
          message: 'agent id: main',
        });
      }

      if (!config.models) {
        config.models = {
          providers: {},
        };
        modified = true;
        this.results.push({
          issue: 'Missing models config',
          action: 'Added default models config',
          success: true,
          message: 'providers: {}',
        });
      }

      if (!config.agents?.defaults) {
        if (!config.agents) {
          config.agents = { list: [] };
        }
        config.agents.defaults = {
          model: {
            primary: 'iflow/glm-4.6',
            fallbacks: [],
          },
        };
        modified = true;
        this.results.push({
          issue: 'Missing agents.defaults config',
          action: 'Added default model config',
          success: true,
          message: 'primary: iflow/glm-4.6',
        });
      }

      if (config.gateway?.bind && 
          config.gateway.bind !== '127.0.0.1' && 
          config.gateway.bind !== 'localhost' &&
          config.gateway.bind !== '::1') {
        if (!config.gateway.auth || config.gateway.auth.mode === 'none') {
          config.gateway.auth = {
            mode: 'token',
          };
          modified = true;
          this.results.push({
            issue: 'Gateway binds externally without auth',
            action: 'Enabled token authentication',
            success: true,
            message: 'gateway.auth.mode = token',
          });
        }
      }

      if (modified) {
        await saveConfig(config);
      }
    } catch (error) {
      this.results.push({
        issue: 'Config validation',
        action: 'Fix config defaults',
        success: false,
        message: String(error),
      });
    }
  }

  private async fixGatewayNotRunning(): Promise<void> {
    try {
      // 检查 Gateway 是否运行（进程名为 openclaw-gateway）
      const { stdout } = await execa('pgrep', ['-f', 'openclaw-gateway'], { reject: false });
      
      if (!stdout.trim()) {
        // 也检查 openclaw gateway 命令
        const { stdout: stdout2 } = await execa('pgrep', ['-f', 'openclaw gateway'], { reject: false });
        
        if (!stdout2.trim()) {
          try {
            await execa('openclaw', ['gateway'], { 
              detached: true,
              stdio: 'ignore',
            });
            
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // 重新检查
            const { stdout: check } = await execa('pgrep', ['-f', 'openclaw-gateway'], { reject: false });
            
            if (check.trim()) {
              this.results.push({
                issue: 'Gateway not running',
                action: 'Started Gateway',
                success: true,
                message: 'Gateway started in background',
              });
            } else {
              this.results.push({
                issue: 'Gateway not running',
                action: 'Start Gateway',
                success: false,
                message: 'Failed to start, run "openclaw gateway" manually',
              });
            }
          } catch (error) {
            this.results.push({
              issue: 'Gateway not running',
              action: 'Start Gateway',
              success: false,
              message: 'Run "openclaw gateway" manually',
            });
          }
        }
      }
    } catch {
      // pgrep 不可用，跳过
    }
  }

  // 修复重复插件
  private async fixDuplicatePlugins(): Promise<void> {
    try {
      const configPath = path.join(this.openclawDir, 'openclaw.json');
      if (!(await fs.pathExists(configPath))) return;

      const config = await fs.readJson(configPath);
      let modified = false;

      // 1. 检查 plugins.installs 中是否有与内置 skill 同名的插件
      const installs = config?.plugins?.installs || {};
      const builtinPlugins = ['voice-call']; // OpenClaw 内置的插件
      
      for (const [name, install] of Object.entries(installs)) {
        if (builtinPlugins.includes(name)) {
          // 删除安装记录
          delete installs[name];
          modified = true;
          
          // 删除扩展目录
          const installInfo = install as any;
          if (installInfo.installPath && await fs.pathExists(installInfo.installPath)) {
            await fs.remove(installInfo.installPath);
          }
          
          this.results.push({
            issue: `Duplicate plugin with builtin: ${name}`,
            action: 'Removed extension (builtin exists)',
            success: true,
            message: `Uninstalled ${name} to use builtin version`,
          });
        }
      }

      // 2. 检查 extensions 目录中是否有重复
      const entries = config?.plugins?.entries || {};
      const extensionsDir = path.join(this.openclawDir, 'extensions');
      
      if (await fs.pathExists(extensionsDir)) {
        const extensionDirs = await fs.readdir(extensionsDir);
        
        for (const extDir of extensionDirs) {
          if (extDir.startsWith('.')) continue;
          
          // 如果是内置插件，直接删除
          if (builtinPlugins.includes(extDir)) {
            await fs.remove(path.join(extensionsDir, extDir));
            this.results.push({
              issue: `Duplicate plugin with builtin: ${extDir}`,
              action: 'Removed extension directory',
              success: true,
              message: `Removed ${path.join(extensionsDir, extDir)}`,
            });
            continue;
          }
          
          // 检查 extension 目录中是否有 index.ts 或 manifest.json
          if (entries[extDir]) {
            const hasIndex = await fs.pathExists(path.join(extensionsDir, extDir, 'index.ts'));
            const hasManifest = await fs.pathExists(path.join(extensionsDir, extDir, 'manifest.json'));
            
            if (hasIndex || hasManifest) {
              delete entries[extDir];
              modified = true;
              
              this.results.push({
                issue: `Duplicate plugin entry: ${extDir}`,
                action: 'Removed from plugins.entries (extension exists)',
                success: true,
                message: `Extension at ${path.join(extensionsDir, extDir)}`,
              });
            }
          }
        }
      }

      if (modified) {
        config.plugins.installs = installs;
        config.plugins.entries = entries;
        await fs.writeJson(configPath, config, { spaces: 2 });
      }
    } catch (error) {
      // 忽略错误
    }
  }

  // 修复 plugins.allow 为空的问题
  private async fixPluginsAllow(): Promise<void> {
    try {
      const configPath = path.join(this.openclawDir, 'openclaw.json');
      if (!(await fs.pathExists(configPath))) return;

      const config = await fs.readJson(configPath);
      
      if (!config.plugins) config.plugins = {};
      if (!config.plugins.allow || config.plugins.allow.length === 0) {
        // 收集已安装的插件
        const allowedPlugins: string[] = [];
        const entries = config.plugins.entries || {};
        
        for (const [name, entry] of Object.entries(entries)) {
          const e = entry as any;
          if (e.enabled !== false) {
            allowedPlugins.push(name);
          }
        }

        // 添加 extensions 目录中的插件
        const extensionsDir = path.join(this.openclawDir, 'extensions');
        if (await fs.pathExists(extensionsDir)) {
          const dirs = await fs.readdir(extensionsDir);
          for (const dir of dirs) {
            if (!dir.startsWith('.') && !allowedPlugins.includes(dir)) {
              allowedPlugins.push(dir);
            }
          }
        }

        if (allowedPlugins.length > 0) {
          config.plugins.allow = allowedPlugins;
          await fs.writeJson(configPath, config, { spaces: 2 });
          
          this.results.push({
            issue: 'plugins.allow is empty (security risk)',
            action: 'Added trusted plugins to allow list',
            success: true,
            message: `Allowed: ${allowedPlugins.join(', ')}`,
          });
        }
      }
    } catch (error) {
      this.results.push({
        issue: 'plugins.allow configuration',
        action: 'Fix plugins.allow',
        success: false,
        message: String(error),
      });
    }
  }

  // 修复运行时警告
  async fixRuntimeIssues(): Promise<void> {
    await this.fixDuplicatePlugins();
    await this.fixPluginsAllow();
  }

  printResults(): void {
    if (this.results.length === 0) {
      console.log(chalk.green('✓ No issues found'));
      return;
    }

    console.log(chalk.blue('\n🔧 Auto-fix Results:\n'));

    for (const result of this.results) {
      const icon = result.success ? chalk.green('✓') : chalk.red('✗');
      console.log(`${icon} ${result.issue}`);
      console.log(chalk.gray(`  Action: ${result.action}`));
      console.log(chalk.gray(`  Result: ${result.message}`));
      console.log();
    }

    const successCount = this.results.filter(r => r.success).length;
    const failCount = this.results.filter(r => !r.success).length;

    console.log(`Fixed: ${chalk.green(successCount)} | Failed: ${chalk.red(failCount)}`);
  }
}