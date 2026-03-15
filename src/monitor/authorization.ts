import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export interface Authorization {
  id: string;
  ruleId: string;
  pattern: string;
  description: string;
  authorizedAt: Date;
  authorizedBy: string; // userId 或 'admin'
  expiresAt?: Date; // 可选的过期时间
  reason?: string;
}

export interface AuthorizationStore {
  version: number;
  authorizations: Authorization[];
}

export class AuthorizationManager {
  private storePath: string;
  private store: AuthorizationStore;

  constructor() {
    const openclawDir = path.join(os.homedir(), '.openclaw');
    this.storePath = path.join(openclawDir, 'security-authorizations.json');
    this.store = { version: 1, authorizations: [] };
  }

  async load(): Promise<void> {
    try {
      if (await fs.pathExists(this.storePath)) {
        const data = await fs.readJson(this.storePath);
        this.store = {
          version: data.version || 1,
          authorizations: (data.authorizations || []).map((a: any) => ({
            ...a,
            authorizedAt: new Date(a.authorizedAt),
            expiresAt: a.expiresAt ? new Date(a.expiresAt) : undefined,
          })),
        };
      }
    } catch (error) {
      console.error('Failed to load authorizations:', error);
    }
  }

  async save(): Promise<void> {
    await fs.ensureDir(path.dirname(this.storePath));
    await fs.writeJson(this.storePath, this.store, { spaces: 2 });
  }

  async authorize(params: {
    ruleId: string;
    pattern: string;
    description: string;
    authorizedBy: string;
    expiresAt?: Date;
    reason?: string;
  }): Promise<Authorization> {
    await this.load();

    // 检查是否已存在相同的授权
    const existing = this.store.authorizations.find(
      a => a.ruleId === params.ruleId && a.pattern === params.pattern && !this.isExpired(a)
    );

    if (existing) {
      return existing;
    }

    const auth: Authorization = {
      id: `auth-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      ruleId: params.ruleId,
      pattern: params.pattern,
      description: params.description,
      authorizedAt: new Date(),
      authorizedBy: params.authorizedBy,
      expiresAt: params.expiresAt,
      reason: params.reason,
    };

    this.store.authorizations.push(auth);
    await this.save();

    return auth;
  }

  async revoke(authId: string): Promise<boolean> {
    await this.load();

    const index = this.store.authorizations.findIndex(a => a.id === authId);
    if (index === -1) return false;

    this.store.authorizations.splice(index, 1);
    await this.save();

    return true;
  }

  isAuthorized(ruleId: string, matchedContent: string): Authorization | null {
    for (const auth of this.store.authorizations) {
      if (auth.ruleId !== ruleId) continue;
      if (this.isExpired(auth)) continue;

      // 检查匹配
      try {
        const pattern = new RegExp(auth.pattern, 'i');
        if (pattern.test(matchedContent)) {
          return auth;
        }
      } catch {
        // 正则表达式无效，尝试直接匹配
        if (matchedContent.includes(auth.pattern)) {
          return auth;
        }
      }
    }

    return null;
  }

  private isExpired(auth: Authorization): boolean {
    if (!auth.expiresAt) return false;
    return new Date() > auth.expiresAt;
  }

  listActive(): Authorization[] {
    return this.store.authorizations.filter(a => !this.isExpired(a));
  }

  listExpired(): Authorization[] {
    return this.store.authorizations.filter(a => this.isExpired(a));
  }

  async cleanup(): Promise<number> {
    const before = this.store.authorizations.length;
    this.store.authorizations = this.store.authorizations.filter(a => !this.isExpired(a));
    await this.save();
    return before - this.store.authorizations.length;
  }
}
