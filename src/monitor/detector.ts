import { DangerRule, DANGER_RULES, RiskLevel } from './rules';
import { AuthorizationManager, Authorization } from './authorization';

export interface DetectionResult {
  rule: DangerRule;
  matched: string;
  position: { start: number; end: number };
  timestamp: Date;
  context?: string;
  authorized?: boolean;
  authorization?: Authorization;
}

export interface DetectionContext {
  source: 'log' | 'tool' | 'command';
  agentId?: string;
  sessionId?: string;
  channel?: string;
  userId?: string;
}

export class DangerDetector {
  private rules: DangerRule[];
  private enabledRules: Set<string>;
  private authManager: AuthorizationManager;

  constructor(enabledRuleIds?: string[]) {
    this.rules = DANGER_RULES;
    this.enabledRules = new Set(enabledRuleIds || this.rules.map(r => r.id));
    this.authManager = new AuthorizationManager();
  }

  async initialize(): Promise<void> {
    await this.authManager.load();
  }

  enableRule(ruleId: string): void {
    this.enabledRules.add(ruleId);
  }

  disableRule(ruleId: string): void {
    this.enabledRules.delete(ruleId);
  }

  getAuthManager(): AuthorizationManager {
    return this.authManager;
  }

  async detect(content: string, context?: DetectionContext): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];

    for (const rule of this.rules) {
      if (!this.enabledRules.has(rule.id)) continue;

      for (const pattern of rule.patterns) {
        // 重置正则 lastIndex
        pattern.lastIndex = 0;
        
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const matched = match[0];
          
          // 检查是否已授权
          const authorization = this.authManager.isAuthorized(rule.id, matched);

          results.push({
            rule,
            matched,
            position: {
              start: match.index,
              end: match.index + matched.length,
            },
            timestamp: new Date(),
            context: this.extractContext(content, match.index, matched.length),
            authorized: !!authorization,
            authorization: authorization || undefined,
          });
        }
      }
    }

    return results.sort((a, b) => {
      const levelOrder: Record<RiskLevel, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      // 未授权的排在前面
      if (a.authorized !== b.authorized) {
        return a.authorized ? 1 : -1;
      }
      return levelOrder[a.rule.level] - levelOrder[b.rule.level];
    });
  }

  private extractContext(content: string, index: number, length: number): string {
    const contextLength = 100;
    const start = Math.max(0, index - contextLength);
    const end = Math.min(content.length, index + length + contextLength);
    
    let context = content.substring(start, end);
    
    if (start > 0) context = '...' + context;
    if (end < content.length) context = context + '...';
    
    return context;
  }

  getRuleById(id: string): DangerRule | undefined {
    return this.rules.find(r => r.id === id);
  }

  getAllRules(): DangerRule[] {
    return [...this.rules];
  }

  getEnabledRules(): DangerRule[] {
    return this.rules.filter(r => this.enabledRules.has(r.id));
  }
}