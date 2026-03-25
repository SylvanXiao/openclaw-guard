/**
 * 合规性检测模块
 * 用于检查 OpenClaw 配置是否符合安全基线和合规要求
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import { loadConfig, getOpenClawDir } from './config';
import { OpenClawConfig } from '../types';

export type ComplianceLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ComplianceStandard = 'OWASP-LLM' | 'ISO27001' | 'SOC2' | 'GDPR' | 'PCI-DSS';

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  level: ComplianceLevel;
  standard: ComplianceStandard[];
  category: 'authentication' | 'encryption' | 'access-control' | 'logging' | 'data-protection' | 'network' | 'configuration' | 'agent-security';
  check: (config: OpenClawConfig | null, openclawDir: string) => Promise<ComplianceCheckResult>;
  remediation: string;
  references: string[];
}

export interface ComplianceCheckResult {
  ruleId: string;
  passed: boolean;
  message: string;
  details?: string;
  severity: ComplianceLevel;
  remediation?: string;
}

export interface ComplianceReport {
  timestamp: Date;
  openclawVersion?: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  results: ComplianceCheckResult[];
  summary: string;
  score: number; // 0-100
}

/**
 * 合规性规则库
 */
export const COMPLIANCE_RULES: ComplianceRule[] = [
  // ==================== 认证安全 ====================
  {
    id: 'AUTH-001',
    name: 'Gateway 认证启用',
    description: 'Gateway 应启用认证机制以防止未授权访问',
    level: 'critical',
    standard: ['OWASP-LLM', 'ISO27001', 'SOC2'],
    category: 'authentication',
    check: async (config, _openclawDir) => {
      const gateway = config?.gateway;
      
      if (!gateway) {
        return {
          ruleId: 'AUTH-001',
          passed: false,
          message: 'Gateway 配置缺失',
          severity: 'high',
        };
      }

      const bind = gateway.bind || '127.0.0.1';
      const authMode = gateway.auth?.mode;

      // 只绑定本地时可以不需要认证
      if (bind === '127.0.0.1' || bind === 'localhost' || bind === '::1') {
        return {
          ruleId: 'AUTH-001',
          passed: true,
          message: 'Gateway 仅绑定本地，认证可选',
          severity: 'info',
        };
      }

      if (!authMode || authMode === 'none') {
        return {
          ruleId: 'AUTH-001',
          passed: false,
          message: `Gateway 绑定 ${bind} 但未启用认证`,
          severity: 'critical',
          remediation: '设置 gateway.auth.mode 为 "token" 或 "password"',
        };
      }

      return {
        ruleId: 'AUTH-001',
        passed: true,
        message: `Gateway 认证已启用 (${authMode})`,
        severity: 'info',
      };
    },
    remediation: '在 openclaw.json 中设置 gateway.auth.mode',
    references: ['https://owasp.org/www-project-top-10-for-large-language-model-applications/'],
  },
  {
    id: 'AUTH-002',
    name: '强密码/Token 配置',
    description: '认证密码或 Token 应具有足够强度',
    level: 'high',
    standard: ['OWASP-LLM', 'ISO27001', 'PCI-DSS'],
    category: 'authentication',
    check: async (config, _openclawDir) => {
      const auth = config?.gateway?.auth;
      
      if (!auth) {
        return {
          ruleId: 'AUTH-002',
          passed: true,
          message: '未配置认证（适用本地绑定）',
          severity: 'info',
        };
      }

      if (auth.mode === 'token' && auth.token) {
        if (auth.token.length < 16) {
          return {
            ruleId: 'AUTH-002',
            passed: false,
            message: `Token 长度过短 (${auth.token.length} 字符)`,
            severity: 'high',
            remediation: '使用至少 32 字符的随机 Token',
          };
        }
        return {
          ruleId: 'AUTH-002',
          passed: true,
          message: `Token 配置符合要求 (${auth.token.length} 字符)`,
          severity: 'info',
        };
      }

      if (auth.mode === 'password' && auth.token) {
        if (auth.token.length < 8) {
          return {
            ruleId: 'AUTH-002',
            passed: false,
            message: `密码长度过短 (${auth.token.length} 字符)`,
            severity: 'high',
            remediation: '使用至少 12 字符的强密码',
          };
        }
        return {
          ruleId: 'AUTH-002',
          passed: true,
          message: '密码配置符合要求',
          severity: 'info',
        };
      }

      return {
        ruleId: 'AUTH-002',
        passed: false,
        message: '认证已启用但未配置凭证',
        severity: 'high',
        remediation: '配置 gateway.auth.token',
      };
    },
    remediation: '配置足够强度的认证凭证',
    references: ['https://www.nist.gov/identity-protection'],
  },
  {
    id: 'AUTH-003',
    name: '设备配对验证',
    description: '新设备配对应需要验证',
    level: 'medium',
    standard: ['OWASP-LLM', 'SOC2'],
    category: 'authentication',
    check: async (config, openclawDir) => {
      const devicesDir = path.join(openclawDir, 'devices');
      
      if (!(await fs.pathExists(devicesDir))) {
        return {
          ruleId: 'AUTH-003',
          passed: true,
          message: '设备目录不存在',
          severity: 'info',
        };
      }

      const devices = await fs.readdir(devicesDir).catch(() => []);
      
      // 检查是否有未验证的设备
      let unverifiedCount = 0;
      for (const device of devices) {
        const devicePath = path.join(devicesDir, device);
        try {
          const stat = await fs.stat(devicePath);
          // 检查设备是否在最近 24 小时内添加且未被授权
          const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
          if (stat.birthtimeMs > dayAgo) {
            unverifiedCount++;
          }
        } catch {
          // 忽略
        }
      }

      if (unverifiedCount > 0) {
        return {
          ruleId: 'AUTH-003',
          passed: false,
          message: `发现 ${unverifiedCount} 个新设备待验证`,
          severity: 'medium',
          details: '运行 openclaw-guard monitor authorizations 查看详情',
        };
      }

      return {
        ruleId: 'AUTH-003',
        passed: true,
        message: `已配对 ${devices.length} 个设备`,
        severity: 'info',
      };
    },
    remediation: '验证新配对的设备',
    references: [],
  },

  // ==================== 加密安全 ====================
  {
    id: 'ENC-001',
    name: 'API Key 加密存储',
    description: 'API 密钥应避免明文存储',
    level: 'high',
    standard: ['OWASP-LLM', 'ISO27001', 'PCI-DSS'],
    category: 'encryption',
    check: async (config, _openclawDir) => {
      const providers = config?.models?.providers || {};
      const plainTextKeys: string[] = [];

      for (const [name, provider] of Object.entries(providers)) {
        const prov = provider as any;
        if (prov.apiKey && prov.apiKey.length > 0) {
          plainTextKeys.push(name);
        }
      }

      if (plainTextKeys.length > 0) {
        return {
          ruleId: 'ENC-001',
          passed: false,
          message: `${plainTextKeys.length} 个 Provider 的 API Key 以明文存储`,
          severity: 'high',
          details: `Provider: ${plainTextKeys.join(', ')}`,
          remediation: '使用环境变量或密钥管理服务存储 API Key',
        };
      }

      return {
        ruleId: 'ENC-001',
        passed: true,
        message: '未发现明文存储的 API Key',
        severity: 'info',
      };
    },
    remediation: '使用环境变量替代配置文件中的 API Key',
    references: ['https://owasp.org/www-community/vulnerabilities/Plaintext_storage_of_passwords'],
  },
  {
    id: 'ENC-002',
    name: '敏感数据传输加密',
    description: '与 LLM 服务的通信应使用 HTTPS',
    level: 'high',
    standard: ['OWASP-LLM', 'ISO27001', 'PCI-DSS'],
    category: 'encryption',
    check: async (config, _openclawDir) => {
      const providers = config?.models?.providers || {};
      const insecureEndpoints: string[] = [];

      for (const [name, provider] of Object.entries(providers)) {
        const prov = provider as any;
        if (prov.baseUrl && prov.baseUrl.startsWith('http://')) {
          insecureEndpoints.push(`${name}: ${prov.baseUrl}`);
        }
      }

      if (insecureEndpoints.length > 0) {
        return {
          ruleId: 'ENC-002',
          passed: false,
          message: `发现 ${insecureEndpoints.length} 个非 HTTPS 端点`,
          severity: 'high',
          details: insecureEndpoints.join('\n'),
          remediation: '将所有 API 端点升级为 HTTPS',
        };
      }

      return {
        ruleId: 'ENC-002',
        passed: true,
        message: '所有 API 端点均使用 HTTPS',
        severity: 'info',
      };
    },
    remediation: '使用 HTTPS 端点',
    references: ['https://owasp.org/www-community/Transport_Layer_Protection_Cheat_Sheet'],
  },

  // ==================== 访问控制 ====================
  {
    id: 'AC-001',
    name: '沙箱模式启用',
    description: 'Agent 应启用沙箱以限制权限',
    level: 'high',
    standard: ['OWASP-LLM', 'ISO27001'],
    category: 'access-control',
    check: async (config, _openclawDir) => {
      const agents = config?.agents?.list || [];
      const noSandboxAgents: string[] = [];

      for (const agent of agents) {
        const agentConfig = agent as any;
        if (!agentConfig.sandbox || agentConfig.sandbox.mode === 'off') {
          noSandboxAgents.push(agent.id);
        }
      }

      if (noSandboxAgents.length > 0) {
        return {
          ruleId: 'AC-001',
          passed: false,
          message: `${noSandboxAgents.length} 个 Agent 未启用沙箱`,
          severity: 'high',
          details: `Agent: ${noSandboxAgents.join(', ')}`,
          remediation: '为 Agent 配置 sandbox.mode',
        };
      }

      if (agents.length === 0) {
        return {
          ruleId: 'AC-001',
          passed: true,
          message: '未配置 Agent',
          severity: 'info',
        };
      }

      return {
        ruleId: 'AC-001',
        passed: true,
        message: `所有 ${agents.length} 个 Agent 已启用沙箱`,
        severity: 'info',
      };
    },
    remediation: '为每个 Agent 配置适当的沙箱模式',
    references: ['https://owasp.org/www-project-top-10-for-large-language-model-applications/'],
  },
  {
    id: 'AC-002',
    name: '工具权限限制',
    description: '应限制 Agent 可使用的工具',
    level: 'medium',
    standard: ['OWASP-LLM', 'SOC2'],
    category: 'access-control',
    check: async (config, _openclawDir) => {
      const tools = config?.tools as any;

      if (!tools) {
        return {
          ruleId: 'AC-002',
          passed: false,
          message: '未配置工具权限',
          severity: 'medium',
          remediation: '配置 tools.deny 列表限制危险操作',
        };
      }

      const hasDeny = tools.deny && tools.deny.length > 0;
      const hasProfile = tools.profile;

      if (!hasDeny && !hasProfile) {
        return {
          ruleId: 'AC-002',
          passed: false,
          message: '工具权限未受限',
          severity: 'medium',
          remediation: '配置 tools.deny 或 tools.profile 限制工具权限',
        };
      }

      return {
        ruleId: 'AC-002',
        passed: true,
        message: `工具权限已配置 (deny: ${tools.deny?.length || 0}, profile: ${tools.profile || 'none'})`,
        severity: 'info',
      };
    },
    remediation: '配置工具权限限制',
    references: [],
  },

  // ==================== 日志与监控 ====================
  {
    id: 'LOG-001',
    name: '敏感信息日志过滤',
    description: '日志应过滤敏感信息',
    level: 'medium',
    standard: ['OWASP-LLM', 'ISO27001', 'GDPR'],
    category: 'logging',
    check: async (_config, openclawDir) => {
      const logsDir = path.join(openclawDir, 'logs');
      
      if (!(await fs.pathExists(logsDir))) {
        return {
          ruleId: 'LOG-001',
          passed: true,
          message: '日志目录不存在',
          severity: 'info',
        };
      }

      const logFiles = await fs.readdir(logsDir).catch(() => []);
      const exposedSecrets: string[] = [];

      for (const logFile of logFiles.slice(0, 5)) { // 只检查最近 5 个日志
        if (!logFile.endsWith('.log')) continue;
        
        try {
          const content = await fs.readFile(path.join(logsDir, logFile), 'utf-8');
          
          // 检查常见的敏感信息模式
          const patterns = [
            { name: 'API Key', pattern: /sk-[a-zA-Z0-9]{20,}/g },
            { name: 'Token', pattern: /"token"\s*:\s*"[a-zA-Z0-9]{20,}"/g },
            { name: 'Password', pattern: /"password"\s*:\s*"\S+"/gi },
          ];

          for (const { name, pattern } of patterns) {
            if (pattern.test(content)) {
              exposedSecrets.push(`${logFile}: ${name}`);
            }
          }
        } catch {
          // 忽略读取错误
        }
      }

      if (exposedSecrets.length > 0) {
        return {
          ruleId: 'LOG-001',
          passed: false,
          message: `日志中可能包含敏感信息`,
          severity: 'medium',
          details: exposedSecrets.slice(0, 3).join('\n'),
          remediation: '配置日志脱敏规则或清理历史日志',
        };
      }

      return {
        ruleId: 'LOG-001',
        passed: true,
        message: '日志未发现敏感信息',
        severity: 'info',
      };
    },
    remediation: '配置日志脱敏',
    references: ['https://owasp.org/www-community/OWASP_Logging_Cheat_Sheet'],
  },
  {
    id: 'LOG-002',
    name: '审计日志启用',
    description: '应启用审计日志记录关键操作',
    level: 'medium',
    standard: ['ISO27001', 'SOC2', 'PCI-DSS'],
    category: 'logging',
    check: async (_config, openclawDir) => {
      const auditLogPath = path.join(openclawDir, 'logs', 'audit.log');
      
      if (await fs.pathExists(auditLogPath)) {
        const stat = await fs.stat(auditLogPath);
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        
        if (stat.mtimeMs > dayAgo) {
          return {
            ruleId: 'LOG-002',
            passed: true,
            message: '审计日志已启用且有近期记录',
            severity: 'info',
          };
        }
      }

      // 检查其他日志文件是否有审计记录
      const logsDir = path.join(openclawDir, 'logs');
      if (await fs.pathExists(logsDir)) {
        const logFiles = await fs.readdir(logsDir).catch(() => []);
        if (logFiles.length > 0) {
          return {
            ruleId: 'LOG-002',
            passed: true,
            message: '日志已启用',
            severity: 'info',
          };
        }
      }

      return {
        ruleId: 'LOG-002',
        passed: false,
        message: '未发现审计日志',
        severity: 'medium',
        remediation: '启用 openclaw-guard monitor 记录审计日志',
      };
    },
    remediation: '启用监控和日志记录',
    references: [],
  },

  // ==================== 数据保护 ====================
  {
    id: 'DP-001',
    name: '配置文件权限',
    description: '配置文件应设置适当的访问权限',
    level: 'high',
    standard: ['ISO27001', 'PCI-DSS'],
    category: 'data-protection',
    check: async (_config, openclawDir) => {
      const configPath = path.join(openclawDir, 'openclaw.json');
      
      if (!(await fs.pathExists(configPath))) {
        return {
          ruleId: 'DP-001',
          passed: true,
          message: '配置文件不存在',
          severity: 'info',
        };
      }

      const stat = await fs.stat(configPath);
      const mode = stat.mode & 0o777;

      // 检查是否有其他用户可读权限
      if (mode & 0o004) {
        return {
          ruleId: 'DP-001',
          passed: false,
          message: `配置文件权限过于开放 (${mode.toString(8)})`,
          severity: 'high',
          remediation: '运行: chmod 600 ~/.openclaw/openclaw.json',
        };
      }

      return {
        ruleId: 'DP-001',
        passed: true,
        message: `配置文件权限正确 (${mode.toString(8)})`,
        severity: 'info',
      };
    },
    remediation: '设置配置文件权限为 600',
    references: [],
  },
  {
    id: 'DP-002',
    name: '目录权限',
    description: 'OpenClaw 目录应设置适当的访问权限',
    level: 'medium',
    standard: ['ISO27001'],
    category: 'data-protection',
    check: async (_config, openclawDir) => {
      if (!(await fs.pathExists(openclawDir))) {
        return {
          ruleId: 'DP-002',
          passed: true,
          message: 'OpenClaw 目录不存在',
          severity: 'info',
        };
      }

      const stat = await fs.stat(openclawDir);
      const mode = stat.mode & 0o777;

      // 理想权限是 700
      if (mode === 0o700) {
        return {
          ruleId: 'DP-002',
          passed: true,
          message: '目录权限正确 (700)',
          severity: 'info',
        };
      }

      // 检查是否有其他用户可访问
      if (mode & 0o007) {
        return {
          ruleId: 'DP-002',
          passed: false,
          message: `目录权限过于开放 (${mode.toString(8)})`,
          severity: 'medium',
          remediation: '运行: chmod 700 ~/.openclaw',
        };
      }

      return {
        ruleId: 'DP-002',
        passed: true,
        message: `目录权限可接受 (${mode.toString(8)})`,
        severity: 'info',
      };
    },
    remediation: '设置目录权限为 700',
    references: [],
  },
  {
    id: 'DP-003',
    name: '工作区隔离',
    description: 'Agent 工作区应与其他数据隔离',
    level: 'medium',
    standard: ['OWASP-LLM', 'ISO27001'],
    category: 'data-protection',
    check: async (config, openclawDir) => {
      const agents = config?.agents?.list || [];
      const sharedWorkspaces: string[] = [];

      for (const agent of agents) {
        const workspace = (agent as any).workspace;
        if (workspace) {
          // 检查工作区是否在敏感位置
          const sensitivePaths = ['/etc', '/root', '/home', '/var', '/usr'];
          for (const sensitive of sensitivePaths) {
            if (workspace.startsWith(sensitive) && !workspace.startsWith(openclawDir)) {
              sharedWorkspaces.push(`${agent.id}: ${workspace}`);
              break;
            }
          }
        }
      }

      if (sharedWorkspaces.length > 0) {
        return {
          ruleId: 'DP-003',
          passed: false,
          message: `${sharedWorkspaces.length} 个 Agent 工作区位于敏感位置`,
          severity: 'medium',
          details: sharedWorkspaces.join('\n'),
          remediation: '将 Agent 工作区设置为 ~/.openclaw/workspace/{agent-id}',
        };
      }

      return {
        ruleId: 'DP-003',
        passed: true,
        message: 'Agent 工作区已隔离',
        severity: 'info',
      };
    },
    remediation: '将工作区设置在 OpenClaw 目录内',
    references: [],
  },

  // ==================== Agent 安全 ====================
  {
    id: 'AGENT-001',
    name: '提示注入防护',
    description: 'Agent 应配置提示注入防护',
    level: 'high',
    standard: ['OWASP-LLM'],
    category: 'agent-security',
    check: async (_config, openclawDir) => {
      // 检查是否有安全监控配置
      const guardConfigDir = path.join(os.homedir(), '.openclaw-guard');
      const monitorConfigPath = path.join(guardConfigDir, 'monitor-config.json');
      
      if (await fs.pathExists(monitorConfigPath)) {
        return {
          ruleId: 'AGENT-001',
          passed: true,
          message: 'openclaw-guard 监控已配置',
          severity: 'info',
        };
      }

      // 检查守护进程是否运行
      try {
        const execa = (await import('execa')).default;
        const { stdout } = await execa('pgrep', ['-f', 'openclaw-guard'], { reject: false });
        if (stdout.trim()) {
          return {
            ruleId: 'AGENT-001',
            passed: true,
            message: 'openclaw-guard 监控正在运行',
            severity: 'info',
          };
        }
      } catch {
        // 忽略
      }

      return {
        ruleId: 'AGENT-001',
        passed: false,
        message: '未检测到提示注入防护措施',
        severity: 'high',
        remediation: '运行 openclaw-guard monitor start 启用安全监控',
      };
    },
    remediation: '启用 openclaw-guard 安全监控',
    references: ['https://owasp.org/www-project-top-10-for-large-language-model-applications/'],
  },

  // ==================== 网络安全 ====================
  {
    id: 'NET-001',
    name: 'Gateway 端口安全',
    description: 'Gateway 不应使用特权端口',
    level: 'low',
    standard: ['ISO27001'],
    category: 'network',
    check: async (config, _openclawDir) => {
      const port = config?.gateway?.port || 18789;
      
      if (port < 1024) {
        return {
          ruleId: 'NET-001',
          passed: false,
          message: `Gateway 使用特权端口 ${port}`,
          severity: 'low',
          remediation: '将 Gateway 端口设置为 1024 以上',
        };
      }

      return {
        ruleId: 'NET-001',
        passed: true,
        message: `Gateway 端口 ${port} 符合要求`,
        severity: 'info',
      };
    },
    remediation: '使用非特权端口',
    references: [],
  },
];

/**
 * 合规性检查器
 */
export class ComplianceChecker {
  private openclawDir: string;

  constructor() {
    this.openclawDir = getOpenClawDir();
  }

  /**
   * 执行合规性检查
   */
  async check(options?: { 
    standards?: ComplianceStandard[];
    categories?: ComplianceRule['category'][];
    minLevel?: ComplianceLevel;
  }): Promise<ComplianceReport> {
    const config = await loadConfig();
    const results: ComplianceCheckResult[] = [];

    // 过滤规则
    let rules = COMPLIANCE_RULES;
    
    if (options?.standards) {
      rules = rules.filter(r => 
        r.standard.some(s => options.standards!.includes(s))
      );
    }
    
    if (options?.categories) {
      rules = rules.filter(r => options.categories!.includes(r.category));
    }

    if (options?.minLevel) {
      const levelOrder: Record<ComplianceLevel, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
        info: 4,
      };
      rules = rules.filter(r => levelOrder[r.level] <= levelOrder[options.minLevel!]);
    }

    // 执行检查
    for (const rule of rules) {
      try {
        const result = await rule.check(config, this.openclawDir);
        results.push(result);
      } catch (error) {
        results.push({
          ruleId: rule.id,
          passed: false,
          message: `检查失败: ${error}`,
          severity: 'low',
        });
      }
    }

    // 统计
    const passedChecks = results.filter(r => r.passed).length;
    const failedChecks = results.filter(r => !r.passed).length;
    const criticalIssues = results.filter(r => !r.passed && r.severity === 'critical').length;
    const highIssues = results.filter(r => !r.passed && r.severity === 'high').length;
    const mediumIssues = results.filter(r => !r.passed && r.severity === 'medium').length;
    const lowIssues = results.filter(r => !r.passed && r.severity === 'low').length;

    // 计算得分 (0-100)
    let score = 100;
    score -= criticalIssues * 25;
    score -= highIssues * 10;
    score -= mediumIssues * 5;
    score -= lowIssues * 2;
    score = Math.max(0, Math.min(100, score));

    // 生成摘要
    let summary: string;
    if (score >= 90) {
      summary = '合规性良好，仅有少量建议改进项';
    } else if (score >= 70) {
      summary = '合规性一般，存在需要关注的安全问题';
    } else if (score >= 50) {
      summary = '合规性较差，存在多个安全问题需要修复';
    } else {
      summary = '合规性严重不足，需要立即采取行动';
    }

    return {
      timestamp: new Date(),
      totalChecks: results.length,
      passedChecks,
      failedChecks,
      criticalIssues,
      highIssues,
      mediumIssues,
      lowIssues,
      results,
      summary,
      score,
    };
  }

  /**
   * 生成合规报告
   */
  generateReport(report: ComplianceReport, format: 'text' | 'json' = 'text'): string {
    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    }

    const lines: string[] = [];
    
    lines.push(chalk.blue('📋 OpenClaw 合规性检查报告'));
    lines.push('');
    lines.push(`检查时间: ${report.timestamp.toLocaleString('zh-CN')}`);
    lines.push(`合规得分: ${this.formatScore(report.score)}`);
    lines.push(`检查项: ${report.totalChecks} 项`);
    lines.push(`通过: ${chalk.green(report.passedChecks.toString())} 项`);
    lines.push(`失败: ${chalk.red(report.failedChecks.toString())} 项`);
    lines.push('');
    lines.push(`摘要: ${report.summary}`);
    lines.push('');

    if (report.failedChecks > 0) {
      lines.push(chalk.bold('问题详情:'));
      lines.push('');

      // 按严重程度分组显示
      const failed = report.results.filter(r => !r.passed);
      
      const critical = failed.filter(r => r.severity === 'critical');
      const high = failed.filter(r => r.severity === 'high');
      const medium = failed.filter(r => r.severity === 'medium');
      const low = failed.filter(r => r.severity === 'low');

      if (critical.length > 0) {
        lines.push(chalk.red.bold('🚨 Critical'));
        critical.forEach(r => this.formatResult(lines, r));
      }

      if (high.length > 0) {
        lines.push(chalk.yellow.bold('🔴 High'));
        high.forEach(r => this.formatResult(lines, r));
      }

      if (medium.length > 0) {
        lines.push(chalk.blue.bold('🟡 Medium'));
        medium.forEach(r => this.formatResult(lines, r));
      }

      if (low.length > 0) {
        lines.push(chalk.gray.bold('🔵 Low'));
        low.forEach(r => this.formatResult(lines, r));
      }
    }

    // 显示通过的关键检查
    const criticalPassed = report.results.filter(r => r.passed && 
      COMPLIANCE_RULES.find(rule => rule.id === r.ruleId)?.level === 'critical');
    
    if (criticalPassed.length > 0) {
      lines.push('');
      lines.push(chalk.green.bold('✓ 关键检查通过:'));
      criticalPassed.forEach(r => {
        lines.push(`  ${chalk.green('●')} ${r.ruleId}: ${r.message}`);
      });
    }

    return lines.join('\n');
  }

  private formatResult(lines: string[], result: ComplianceCheckResult): void {
    const icon = result.severity === 'critical' ? '🚨' : 
                 result.severity === 'high' ? '🔴' : 
                 result.severity === 'medium' ? '🟡' : '🔵';
    
    lines.push(`  ${icon} [${result.ruleId}] ${result.message}`);
    if (result.details) {
      lines.push(chalk.gray(`     ${result.details}`));
    }
    if (result.remediation) {
      lines.push(chalk.cyan(`     修复: ${result.remediation}`));
    }
    lines.push('');
  }

  private formatScore(score: number): string {
    if (score >= 90) return chalk.green.bold(`${score} 分`);
    if (score >= 70) return chalk.yellow.bold(`${score} 分`);
    if (score >= 50) return chalk.yellow(`${score} 分`);
    return chalk.red.bold(`${score} 分`);
  }

  /**
   * 获取特定标准的规则
   */
  getRulesByStandard(standard: ComplianceStandard): ComplianceRule[] {
    return COMPLIANCE_RULES.filter(r => r.standard.includes(standard));
  }

  /**
   * 获取特定类别的规则
   */
  getRulesByCategory(category: ComplianceRule['category']): ComplianceRule[] {
    return COMPLIANCE_RULES.filter(r => r.category === category);
  }
}

// 导出单例
export const complianceChecker = new ComplianceChecker();
