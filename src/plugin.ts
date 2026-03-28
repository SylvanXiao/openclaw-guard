/**
 * OpenClaw Guard Plugin Entry
 * 
 * 安全监控、诊断修复、知识库管理插件
 */

// 类型定义（当 SDK 不可用时使用本地定义）
interface Tool {
  name: string;
  description: string;
  parameters: any;
  execute: (params: any, context?: any) => Promise<any>;
}

interface Service {
  id: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  pluginConfig: Record<string, any>;
  logger?: {
    debug: (...args: any[]) => void;
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
  registerTool: (factory: (ctx: any) => Tool, opts?: { names?: string[] }) => void;
  registerService: (service: Service) => void;
  registerCli: (registrar: (api: { program: any }) => void, opts?: any) => void;
  registerHook: (event: string, handler: (event: any) => Promise<any>) => void;
}

// 插件配置类型
interface GuardPluginConfig {
  monitorEnabled?: boolean;
  monitorLevel?: 'critical' | 'high' | 'medium' | 'low';
  webhookUrl?: string;
  dingtalkWebhook?: string;
  wecomWebhook?: string;
  feishuWebhook?: string;
  knowledgeRemoteUrl?: string;
  knowledgeSyncInterval?: number;
  networkMonitoring?: boolean;
  deviceMonitoring?: boolean;
  gatewayPorts?: number[];
  autoFix?: boolean;
  aiDiagnosis?: boolean;
}

// 导入核心模块（运行时动态加载）
async function loadModules() {
  const { DangerDetector, AlertSystem, NetworkMonitor, DeviceMonitor } = await import('./monitor');
  const { KnowledgeManager } = await import('./lib/knowledge');
  const { AutoFixer } = await import('./lib/fixer');
  const { cveDatabase } = await import('./lib/cve-database');
  const { complianceChecker } = await import('./lib/compliance');
  const { PromptInjectionDetector } = await import('./monitor/prompt-injection');
  const { AuthorizationManager } = await import('./monitor/authorization');
  const { DaemonManager } = await import('./lib/daemon');
  const { loadConfig, configExists, getOpenClawDir } = await import('./lib/config');
  const { isOpenClawInstalled, getOpenClawVersion, isGatewayRunning, checkNodeVersion } = await import('./lib/system');
  
  return {
    DangerDetector,
    AlertSystem,
    NetworkMonitor,
    DeviceMonitor,
    KnowledgeManager,
    AutoFixer,
    cveDatabase,
    complianceChecker,
    PromptInjectionDetector,
    AuthorizationManager,
    DaemonManager,
    loadConfig,
    configExists,
    getOpenClawDir,
    isOpenClawInstalled,
    getOpenClawVersion,
    isGatewayRunning,
    checkNodeVersion,
  };
}

// ============== 工具定义 ==============

/**
 * 安全诊断工具
 */
function createDiagnoseTool(config: GuardPluginConfig): Tool {
  return {
    name: "security_diagnose",
    description: "诊断 OpenClaw 运行环境和安全状态，检测配置问题、安全风险和性能问题",
    parameters: {
      type: "object",
      properties: {
        fix: {
          type: "boolean",
          description: "是否自动修复发现的问题",
        },
        category: {
          type: "string",
          enum: ["config", "security", "network", "runtime", "all"],
          description: "诊断类别，默认 all",
        },
        detailed: {
          type: "boolean",
          description: "是否返回详细报告",
        },
      },
    },
    execute: async (params: { fix?: boolean; category?: string; detailed?: boolean }) => {
      const modules = await loadModules();
      const results: any[] = [];

      // Node.js 版本检查
      const nodeCheck = await modules.checkNodeVersion();
      results.push({
        category: 'Environment',
        check: 'Node.js version',
        status: nodeCheck.satisfied ? 'ok' : 'error',
        message: nodeCheck.installed 
          ? `v${nodeCheck.installed}` 
          : 'Not installed',
        fix: !nodeCheck.satisfied ? 'Install Node.js >= 22.16.0' : undefined,
      });

      // OpenClaw 安装检查
      const openclawInstalled = await modules.isOpenClawInstalled();
      const openclawVersion = await modules.getOpenClawVersion();
      results.push({
        category: 'Installation',
        check: 'OpenClaw',
        status: openclawInstalled ? 'ok' : 'error',
        message: openclawInstalled ? `v${openclawVersion}` : 'Not installed',
      });

      // 配置检查
      const hasConfig = await modules.configExists();
      results.push({
        category: 'Configuration',
        check: 'Config file',
        status: hasConfig ? 'ok' : 'warning',
        message: hasConfig ? 'Found' : 'Not found',
      });

      // Gateway 状态检查
      const gatewayRunning = await modules.isGatewayRunning();
      results.push({
        category: 'Gateway',
        check: 'Status',
        status: gatewayRunning ? 'ok' : 'warning',
        message: gatewayRunning ? 'Running' : 'Not running',
      });

      // 自动修复
      if (params.fix && config.autoFix) {
        const fixer = new modules.AutoFixer();
        const fixResults = await fixer.fixAll(results);
        return {
          success: true,
          results,
          fixes: fixResults,
        };
      }

      // 统计
      const summary = {
        ok: results.filter(r => r.status === 'ok').length,
        warning: results.filter(r => r.status === 'warning').length,
        error: results.filter(r => r.status === 'error').length,
      };

      return {
        success: true,
        results: params.detailed ? results : results.filter(r => r.status !== 'ok'),
        summary,
      };
    },
  };
}

/**
 * 安全审计工具
 */
function createSecurityAuditTool(config: GuardPluginConfig): Tool {
  return {
    name: "security_audit",
    description: "运行全面的安全审计，检查配置安全、凭证存储、网络暴露等风险",
    parameters: {
      type: "object",
      properties: {
        includeCve: {
          type: "boolean",
          description: "是否包含 CVE 漏洞扫描",
        },
        includeCompliance: {
          type: "boolean",
          description: "是否包含合规检查",
        },
        standard: {
          type: "string",
          enum: ["OWASP-LLM", "ISO27001", "SOC2", "GDPR", "PCI-DSS"],
          description: "合规标准",
        },
      },
    },
    execute: async (params: { includeCve?: boolean; includeCompliance?: boolean; standard?: string }) => {
      const modules = await loadModules();
      const issues: any[] = [];
      
      const configData = await modules.loadConfig();
      
      // Gateway 绑定检查
      if (configData?.gateway?.bind && configData.gateway.bind !== '127.0.0.1') {
        const authMode = configData.gateway.auth?.mode;
        if (authMode === 'none' || !authMode) {
          issues.push({
            severity: 'high',
            category: 'Network Security',
            issue: 'Gateway binds to non-localhost without authentication',
            recommendation: 'Set gateway.auth.mode to "token" or "password"',
          });
        }
      }

      // API Key 存储检查
      if (configData?.models?.providers) {
        for (const [providerName, provider] of Object.entries(configData.models.providers)) {
          const prov = provider as any;
          if (prov.apiKey && prov.apiKey.startsWith('sk-')) {
            issues.push({
              severity: 'medium',
              category: 'Credential Storage',
              issue: `API key for ${providerName} is stored in plain text`,
              recommendation: 'Consider using environment variables',
            });
          }
        }
      }

      const result: any = {
        success: true,
        issues,
        summary: {
          high: issues.filter(i => i.severity === 'high').length,
          medium: issues.filter(i => i.severity === 'medium').length,
          low: issues.filter(i => i.severity === 'low').length,
        },
      };

      // CVE 扫描
      if (params.includeCve) {
        const cveResult = await modules.cveDatabase.scan();
        result.cve = {
          total: cveResult.totalCVEs,
          critical: cveResult.criticalCount,
          high: cveResult.highCount,
          vulnerabilities: cveResult.vulnerabilities.slice(0, 10),
        };
      }

      // 合规检查
      if (params.includeCompliance) {
        const standards = params.standard ? [params.standard as any] : undefined;
        const complianceReport = await modules.complianceChecker.check(standards ? { standards } : undefined);
        result.compliance = {
          passed: complianceReport.passedChecks,
          failed: complianceReport.failedChecks,
          total: complianceReport.totalChecks,
          results: complianceReport.results.filter((r: any) => !r.passed).slice(0, 10),
        };
      }

      return result;
    },
  };
}

/**
 * 知识库搜索工具
 */
function createKnowledgeSearchTool(config: GuardPluginConfig): Tool {
  return {
    name: "knowledge_search",
    description: "搜索 OpenClaw Guard 知识库，查找问题解决方案和修复建议",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词或问题描述",
        },
        category: {
          type: "string",
          description: "问题类别筛选",
        },
        limit: {
          type: "number",
          description: "返回结果数量限制，默认 5",
        },
      },
      required: ["query"],
    },
    execute: async (params: { query: string; category?: string; limit?: number }) => {
      const modules = await loadModules();
      const knowledgeManager = new modules.KnowledgeManager();
      await knowledgeManager.initialize();

      // 使用 findSolution 搜索
      const solution = knowledgeManager.findSolution(params.query);
      const allSolutions = knowledgeManager.getAllSolutions();
      const limit = params.limit || 5;

      // 简单的关键词匹配
      const matchedSolutions = allSolutions.filter((s: any) => {
        const query = params.query.toLowerCase();
        return s.name.toLowerCase().includes(query) ||
               s.description.toLowerCase().includes(query) ||
               s.tags.some((t: string) => t.toLowerCase().includes(query));
      });

      const results = solution ? [solution, ...matchedSolutions.filter((s: any) => s.id !== solution.id)] : matchedSolutions;

      return {
        success: true,
        query: params.query,
        total: results.length,
        results: results.slice(0, limit).map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          category: s.category,
          riskLevel: s.riskLevel,
          successCount: s.successCount,
          verified: s.verified,
          fixCommand: s.fixCommand,
          diagnosis: s.diagnosis,
        })),
      };
    },
  };
}

/**
 * 提示注入检测工具
 */
function createInjectionDetectTool(config: GuardPluginConfig): Tool {
  return {
    name: "injection_detect",
    description: "检测文本中的提示注入攻击模式，识别潜在的 AI 安全风险",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "要检测的文本内容",
        },
        detailed: {
          type: "boolean",
          description: "是否返回详细分析",
        },
      },
      required: ["text"],
    },
    execute: async (params: { text: string; detailed?: boolean }) => {
      const modules = await loadModules();
      const detector = new modules.PromptInjectionDetector();
      
      const results = await detector.detect(params.text);
      const hiddenResults = await detector.detectHiddenInjection(params.text);

      return {
        success: true,
        safe: results.length === 0 && !hiddenResults.hasHiddenContent,
        detections: results.length,
        results: params.detailed ? results : results.slice(0, 5).map((r: any) => ({
          name: r.pattern.id,
          severity: r.pattern.severity,
          matched: r.matched,
        })),
        hasHiddenContent: hiddenResults.hasHiddenContent,
        hiddenFindings: hiddenResults.findings,
      };
    },
  };
}

/**
 * 危险命令检测工具
 */
function createDangerDetectTool(config: GuardPluginConfig): Tool {
  return {
    name: "danger_detect",
    description: "检测命令或脚本中的危险操作模式，评估安全风险",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "要检测的命令或脚本",
        },
      },
      required: ["command"],
    },
    execute: async (params: { command: string }) => {
      const modules = await loadModules();
      const detector = new modules.DangerDetector();
      await detector.initialize();
      
      const results = await detector.detect(params.command);

      return {
        success: true,
        safe: results.length === 0,
        detections: results.length,
        results: results.map((r: any) => ({
          ruleId: r.rule.id,
          ruleName: r.rule.name,
          level: r.rule.level,
          matched: r.matched,
          action: r.rule.action,
          authorized: r.authorized,
        })),
        summary: {
          critical: results.filter((r: any) => r.rule.level === 'critical').length,
          high: results.filter((r: any) => r.rule.level === 'high').length,
          medium: results.filter((r: any) => r.rule.level === 'medium').length,
          low: results.filter((r: any) => r.rule.level === 'low').length,
        },
      };
    },
  };
}

/**
 * 监控状态工具
 */
function createMonitorStatusTool(config: GuardPluginConfig): Tool {
  return {
    name: "monitor_status",
    description: "获取安全监控服务的运行状态和统计信息",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const modules = await loadModules();
      const daemon = new modules.DaemonManager();
      const status = await daemon.status();

      // 获取授权统计
      const authManager = new modules.AuthorizationManager();
      await authManager.load();
      const authorizations = authManager.listActive();

      return {
        success: true,
        running: status.running,
        pid: status.pid,
        uptime: status.uptime,
        config: status.config,
        authorizations: authorizations.length,
        monitorEnabled: config.monitorEnabled,
        networkMonitoring: config.networkMonitoring,
        deviceMonitoring: config.deviceMonitoring,
      };
    },
  };
}

// ============== 后台服务 ==============

/**
 * 创建监控服务
 */
function createMonitorService(config: GuardPluginConfig): Service {
  let modules: any = null;

  return {
    id: "guard-monitor",
    start: async () => {
      if (!config.monitorEnabled) {
        return;
      }

      modules = await loadModules();
      
      // 启动后台监控守护进程
      const daemon = new modules.DaemonManager();
      const daemonConfig = {
        level: config.monitorLevel || 'medium',
        network: config.networkMonitoring || false,
        devices: config.deviceMonitoring || false,
        ports: (config.gatewayPorts || [18789]).map(String), // 转为字符串
        webhook: config.webhookUrl,
        dingtalk: config.dingtalkWebhook,
        wecom: config.wecomWebhook,
        feishu: config.feishuWebhook,
        knowledgeSyncUrl: config.knowledgeRemoteUrl,
        knowledgeSyncInterval: config.knowledgeSyncInterval,
        includeAuthorized: false,
      };

      const result = await daemon.start(daemonConfig);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to start monitor daemon');
      }
    },
    stop: async () => {
      if (modules) {
        const daemon = new modules.DaemonManager();
        await daemon.stop();
      }
    },
  };
}

// ============== 插件入口 ==============

const plugin = {
  id: "openclaw-guard",
  name: "OpenClaw Guard",
  description: "OpenClaw 安全监控、诊断修复、知识库管理插件",
  
  async register(api: OpenClawPluginApi) {
    // 获取插件配置
    const config: GuardPluginConfig = api.pluginConfig || {};

    // 注册工具
    api.registerTool(
      (ctx: any) => createDiagnoseTool(config),
      { names: ["security_diagnose"] }
    );

    api.registerTool(
      (ctx: any) => createSecurityAuditTool(config),
      { names: ["security_audit"] }
    );

    api.registerTool(
      (ctx: any) => createKnowledgeSearchTool(config),
      { names: ["knowledge_search"] }
    );

    api.registerTool(
      (ctx: any) => createInjectionDetectTool(config),
      { names: ["injection_detect"] }
    );

    api.registerTool(
      (ctx: any) => createDangerDetectTool(config),
      { names: ["danger_detect"] }
    );

    api.registerTool(
      (ctx: any) => createMonitorStatusTool(config),
      { names: ["monitor_status"] }
    );

    // 注册后台服务
    api.registerService(createMonitorService(config));

    // 注册 CLI 命令
    api.registerCli(
      ({ program }) => {
        const guardCmd = program
          .command('guard')
          .description('OpenClaw Guard 安全管理命令');

        // guard diagnose
        guardCmd
          .command('diagnose')
          .description('运行诊断')
          .option('--fix', '自动修复问题')
          .action(async (options: any) => {
            const tool = createDiagnoseTool(config);
            const result = await tool.execute({ fix: options.fix, detailed: true });
            console.log(JSON.stringify(result, null, 2));
          });

        // guard audit
        guardCmd
          .command('audit')
          .description('安全审计')
          .option('--cve', '包含 CVE 扫描')
          .option('--compliance', '包含合规检查')
          .action(async (options: any) => {
            const tool = createSecurityAuditTool(config);
            const result = await tool.execute({ 
              includeCve: options.cve, 
              includeCompliance: options.compliance 
            });
            console.log(JSON.stringify(result, null, 2));
          });

        // guard knowledge
        guardCmd
          .command('knowledge <action>')
          .description('知识库管理 (search/list/sync)')
          .action(async (action: string) => {
            console.log(`Knowledge action: ${action}`);
          });

        // guard monitor
        guardCmd
          .command('monitor <action>')
          .description('监控管理 (start/stop/status)')
          .action(async (action: string) => {
            const modules = await loadModules();
            const daemon = new modules.DaemonManager();
            
            switch (action) {
              case 'start': {
                const result = await daemon.start({
                  level: config.monitorLevel || 'medium',
                  network: config.networkMonitoring || false,
                  devices: config.deviceMonitoring || false,
                  ports: (config.gatewayPorts || [18789]).map(String),
                  webhook: config.webhookUrl,
                  dingtalk: config.dingtalkWebhook,
                  wecom: config.wecomWebhook,
                  feishu: config.feishuWebhook,
                  includeAuthorized: false,
                });
                console.log(result.success ? `Started (PID: ${result.pid})` : result.error);
                break;
              }
              case 'stop': {
                const result = await daemon.stop();
                console.log(result.success ? 'Stopped' : result.message);
                break;
              }
              case 'status': {
                const status = await daemon.status();
                console.log(JSON.stringify(status, null, 2));
                break;
              }
              default:
                console.log('Unknown action. Use: start, stop, status');
            }
          });
      },
      {
        descriptors: [
          {
            name: "guard",
            description: "OpenClaw Guard 安全管理",
            hasSubcommands: true,
          },
        ],
      }
    );

    // 注册 before_tool_call 钩子进行安全检查
    api.registerHook("before_tool_call", async (event) => {
      // 检查是否有危险命令
      const toolCall = event.toolCall;
      
      if (toolCall?.name === 'exec' || toolCall?.name === 'bash') {
        const command = toolCall.params?.command;
        if (command && typeof command === 'string') {
          const modules = await loadModules();
          const detector = new modules.DangerDetector();
          await detector.initialize();
          
          const results = await detector.detect(command);
          const criticalResults = results.filter((r: any) => r.rule.level === 'critical' && !r.authorized);
          
          if (criticalResults.length > 0) {
            return {
              block: true,
              reason: `检测到危险命令: ${criticalResults.map((r: any) => r.rule.name).join(', ')}`,
            };
          }
        }
      }

      return {};
    });

    api.logger?.info("OpenClaw Guard plugin registered");
  },
};

export default plugin;
export { plugin };