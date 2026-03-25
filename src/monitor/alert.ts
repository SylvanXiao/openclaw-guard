import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { DetectionResult, DetectionContext } from './detector';
import { RiskLevel } from './rules';

export interface AlertConfig {
  terminal: boolean;
  logFile: boolean;
  webhook?: string;
  dingtalk?: {
    webhook: string;
    secret?: string;
  };
  wecom?: {
    webhook: string;
  };
  feishu?: {
    webhook: string;
    secret?: string;
  };
  slack?: {
    webhook: string;
    channel?: string;
    username?: string;
  };
  discord?: {
    webhook: string;
    username?: string;
    avatarUrl?: string;
  };
  telegram?: {
    botToken: string;
    chatId: string;
  };
  email?: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    to: string[];
  };
  skipAuthorized: boolean; // 跳过已授权的警报
}

export interface AlertRecord {
  id: string;
  timestamp: Date;
  level: RiskLevel;
  ruleName: string;
  ruleId: string;
  matched: string;
  context?: string;
  detectionContext?: DetectionContext;
  authorized: boolean;
  handled: boolean;
}

export class AlertSystem {
  private config: AlertConfig;
  private alertLog: AlertRecord[] = [];
  private logFilePath: string;

  constructor(config: Partial<AlertConfig> = {}) {
    this.config = {
      terminal: config.terminal ?? true,
      logFile: config.logFile ?? true,
      webhook: config.webhook,
      dingtalk: config.dingtalk,
      wecom: config.wecom,
      feishu: config.feishu,
      slack: config.slack,
      discord: config.discord,
      telegram: config.telegram,
      email: config.email,
      skipAuthorized: config.skipAuthorized ?? true,
    };

    const openclawDir = path.join(os.homedir(), '.openclaw');
    this.logFilePath = path.join(openclawDir, 'logs', 'security-alerts.log');
  }

  async alert(detections: DetectionResult[], context?: DetectionContext): Promise<number> {
    let alertCount = 0;

    for (const detection of detections) {
      // 跳过已授权的（如果配置了）
      if (this.config.skipAuthorized && detection.authorized) {
        // 仍然记录到日志，但不触发警报
        await this.logAuthorized(detection, context);
        continue;
      }

      const record: AlertRecord = {
        id: this.generateId(),
        timestamp: detection.timestamp,
        level: detection.rule.level,
        ruleName: detection.rule.name,
        ruleId: detection.rule.id,
        matched: detection.matched,
        context: detection.context,
        detectionContext: context,
        authorized: detection.authorized || false,
        handled: false,
      };

      this.alertLog.push(record);
      alertCount++;

      // 并行发送各种警报
      const promises: Promise<void>[] = [];

      if (this.config.terminal) {
        promises.push(this.alertTerminal(record));
      }

      if (this.config.logFile) {
        promises.push(this.alertLogFile(record));
      }

      if (this.config.webhook) {
        promises.push(this.alertWebhook(record));
      }

      if (this.config.dingtalk) {
        promises.push(this.alertDingtalk(record));
      }

      if (this.config.wecom) {
        promises.push(this.alertWecom(record));
      }

      if (this.config.feishu) {
        promises.push(this.alertFeishu(record));
      }

      if (this.config.slack) {
        promises.push(this.alertSlack(record));
      }

      if (this.config.discord) {
        promises.push(this.alertDiscord(record));
      }

      if (this.config.telegram) {
        promises.push(this.alertTelegram(record));
      }

      if (this.config.email) {
        promises.push(this.alertEmail(record));
      }

      await Promise.allSettled(promises);
    }

    return alertCount;
  }

  private async logAuthorized(detection: DetectionResult, context?: DetectionContext): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.logFilePath));
      
      const logEntry = {
        timestamp: detection.timestamp.toISOString(),
        level: detection.rule.level,
        rule: {
          id: detection.rule.id,
          name: detection.rule.name,
        },
        matched: detection.matched,
        authorized: true,
        authorization: detection.authorization ? {
          id: detection.authorization.id,
          authorizedAt: detection.authorization.authorizedAt,
          authorizedBy: detection.authorization.authorizedBy,
        } : null,
        source: context,
      };

      const authLogPath = path.join(path.dirname(this.logFilePath), 'authorized-actions.log');
      await fs.appendFile(authLogPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      // 静默失败
    }
  }

  private async alertTerminal(record: AlertRecord): Promise<void> {
    const icon = this.getLevelIcon(record.level);
    const color = this.getLevelColor(record.level);
    
    console.log();
    console.log(color(`${icon} [${record.level.toUpperCase()}] Security Alert`));
    console.log(chalk.gray(`  Rule: ${record.ruleName} (${record.ruleId})`));
    console.log(chalk.gray(`  Time: ${record.timestamp.toISOString()}`));
    
    if (record.matched) {
      console.log(chalk.yellow(`  Matched: ${record.matched}`));
    }
    
    if (record.context) {
      console.log(chalk.gray(`  Context: ${record.context}`));
    }

    if (record.detectionContext) {
      const ctx = record.detectionContext;
      const parts: string[] = [];
      if (ctx.agentId) parts.push(`agent=${ctx.agentId}`);
      if (ctx.channel) parts.push(`channel=${ctx.channel}`);
      if (ctx.userId) parts.push(`user=${ctx.userId}`);
      if (parts.length > 0) {
        console.log(chalk.gray(`  Source: ${parts.join(', ')}`));
      }
    }

    // 显示授权提示
    console.log(chalk.gray(`  To authorize: openclaw-guard monitor authorize ${record.ruleId} "${record.matched}"`));
    console.log();
  }

  private async alertLogFile(record: AlertRecord): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.logFilePath));
      
      const logEntry = {
        timestamp: record.timestamp.toISOString(),
        level: record.level,
        rule: {
          id: record.ruleId,
          name: record.ruleName,
        },
        matched: record.matched,
        context: record.context,
        source: record.detectionContext,
        authorized: record.authorized,
      };

      await fs.appendFile(this.logFilePath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to write alert log:', error);
    }
  }

  private async alertWebhook(record: AlertRecord): Promise<void> {
    if (!this.config.webhook) return;

    try {
      const response = await fetch(this.config.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alert: true,
          level: record.level,
          rule: record.ruleName,
          matched: record.matched,
          context: record.context,
          timestamp: record.timestamp.toISOString(),
        }),
      });

      if (!response.ok) {
        console.error('Webhook alert failed:', response.status);
      }
    } catch (error) {
      console.error('Webhook alert error:', error);
    }
  }

  private async alertDingtalk(record: AlertRecord): Promise<void> {
    if (!this.config.dingtalk) return;

    try {
      const icon = this.getLevelIcon(record.level);
      const text = `${icon} OpenClaw 安全警报\n\n` +
        `等级: ${record.level.toUpperCase()}\n` +
        `规则: ${record.ruleName}\n` +
        `匹配: ${record.matched}\n` +
        `时间: ${record.timestamp.toLocaleString('zh-CN')}`;

      const body: any = {
        msgtype: 'text',
        text: { content: text },
      };

      if (this.config.dingtalk.secret) {
        const crypto = await import('crypto');
        const timestamp = Date.now();
        const stringToSign = timestamp + '\n' + this.config.dingtalk.secret;
        const hmac = crypto.createHmac('sha256', this.config.dingtalk.secret);
        hmac.update(stringToSign);
        const sign = encodeURIComponent(hmac.digest('base64'));
        
        const url = new URL(this.config.dingtalk.webhook);
        url.searchParams.set('timestamp', String(timestamp));
        url.searchParams.set('sign', sign);
        
        await fetch(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetch(this.config.dingtalk.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
    } catch (error) {
      console.error('Dingtalk alert error:', error);
    }
  }

  private async alertWecom(record: AlertRecord): Promise<void> {
    if (!this.config.wecom) return;

    try {
      const icon = this.getLevelIcon(record.level);
      const text = `${icon} OpenClaw 安全警报\n` +
        `> 等级: **${record.level.toUpperCase()}**\n` +
        `> 规则: ${record.ruleName}\n` +
        `> 匹配: ${record.matched}\n` +
        `> 时间: ${record.timestamp.toLocaleString('zh-CN')}`;

      const body = {
        msgtype: 'markdown',
        markdown: { content: text },
      };

      await fetch(this.config.wecom.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.error('WeCom alert error:', error);
    }
  }

  private async alertFeishu(record: AlertRecord): Promise<void> {
    if (!this.config.feishu) return;

    try {
      const icon = this.getLevelIcon(record.level);
      const timestamp = Math.floor(Date.now() / 1000);

      const content = {
        post: {
          zh_cn: {
            title: 'OpenClaw 安全警报',
            content: [
              [{
                tag: 'text',
                text: `${icon} 等级: ${record.level.toUpperCase()}`,
              }],
              [{
                tag: 'text',
                text: `规则: ${record.ruleName}`,
              }],
              [{
                tag: 'text',
                text: `匹配: ${record.matched}`,
              }],
              [{
                tag: 'text',
                text: `时间: ${record.timestamp.toLocaleString('zh-CN')}`,
              }],
            ],
          },
        },
      };

      const body: any = {
        msg_type: 'post',
        content: JSON.stringify(content),
      };

      // 飞书签名
      if (this.config.feishu.secret) {
        const crypto = await import('crypto');
        const stringToSign = timestamp + '\n' + this.config.feishu.secret;
        const hmac = crypto.createHmac('sha256', '');
        hmac.update(stringToSign);
        const sign = hmac.digest('base64');
        
        body.timestamp = timestamp;
        body.sign = sign;
      }

      await fetch(this.config.feishu.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.error('Feishu alert error:', error);
    }
  }

  private async alertSlack(record: AlertRecord): Promise<void> {
    if (!this.config.slack) return;

    try {
      const icon = this.getLevelIcon(record.level);
      const color = record.level === 'critical' ? '#ff0000' :
                    record.level === 'high' ? '#ff6600' :
                    record.level === 'medium' ? '#ffcc00' : '#36a64f';

      const blocks = [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${icon} OpenClaw 安全警报`,
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*等级:*\n${record.level.toUpperCase()}`,
            },
            {
              type: 'mrkdwn',
              text: `*规则:*\n${record.ruleName}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*匹配内容:*\n\`${record.matched.substring(0, 100)}${record.matched.length > 100 ? '...' : ''}\``,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `⏰ ${record.timestamp.toLocaleString('zh-CN')}`,
            },
          ],
        },
      ];

      const body: any = {
        attachments: [{
          color,
          blocks,
          fallback: `${icon} [${record.level.toUpperCase()}] ${record.ruleName}: ${record.matched}`,
        }],
      };

      if (this.config.slack.channel) {
        body.channel = this.config.slack.channel;
      }
      if (this.config.slack.username) {
        body.username = this.config.slack.username;
      }

      await fetch(this.config.slack.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.error('Slack alert error:', error);
    }
  }

  private async alertDiscord(record: AlertRecord): Promise<void> {
    if (!this.config.discord) return;

    try {
      const icon = this.getLevelIcon(record.level);
      const color = record.level === 'critical' ? 15548997 :  // red
                    record.level === 'high' ? 15105570 :       // orange
                    record.level === 'medium' ? 16776960 : 5763719; // yellow : green

      const embed = {
        title: `${icon} OpenClaw 安全警报`,
        description: `**${record.ruleName}**`,
        color,
        fields: [
          {
            name: '等级',
            value: record.level.toUpperCase(),
            inline: true,
          },
          {
            name: '规则 ID',
            value: record.ruleId,
            inline: true,
          },
          {
            name: '匹配内容',
            value: `\`${record.matched.substring(0, 100)}${record.matched.length > 100 ? '...' : ''}\``,
            inline: false,
          },
        ],
        timestamp: record.timestamp.toISOString(),
        footer: {
          text: 'OpenClaw Guard',
        },
      };

      const body: any = {
        embeds: [embed],
      };

      if (this.config.discord.username) {
        body.username = this.config.discord.username;
      }
      if (this.config.discord.avatarUrl) {
        body.avatar_url = this.config.discord.avatarUrl;
      }

      await fetch(this.config.discord.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.error('Discord alert error:', error);
    }
  }

  private async alertTelegram(record: AlertRecord): Promise<void> {
    if (!this.config.telegram) return;

    try {
      const icon = this.getLevelIcon(record.level);
      const escapeHtml = (str: string) => 
        str.replace(/&/g, '&amp;')
           .replace(/</g, '&lt;')
           .replace(/>/g, '&gt;');

      const text = `${icon} <b>OpenClaw 安全警报</b>\n\n` +
        `<b>等级:</b> ${record.level.toUpperCase()}\n` +
        `<b>规则:</b> ${escapeHtml(record.ruleName)}\n` +
        `<b>匹配:</b> <code>${escapeHtml(record.matched.substring(0, 100))}${record.matched.length > 100 ? '...' : ''}</code>\n` +
        `<b>时间:</b> ${record.timestamp.toLocaleString('zh-CN')}`;

      const url = `https://api.telegram.org/bot${this.config.telegram.botToken}/sendMessage`;
      
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.telegram.chatId,
          text,
          parse_mode: 'HTML',
        }),
      });
    } catch (error) {
      console.error('Telegram alert error:', error);
    }
  }

  private async alertEmail(record: AlertRecord): Promise<void> {
    if (!this.config.email) return;

    try {
      const crypto = await import('crypto');
      const icon = this.getLevelIcon(record.level);
      
      const subject = `[OpenClaw] ${icon} 安全警报: ${record.ruleName}`;
      const body = `
OpenClaw 安全警报

等级: ${record.level.toUpperCase()}
规则: ${record.ruleName}
匹配: ${record.matched}
时间: ${record.timestamp.toLocaleString('zh-CN')}

---
此邮件由 openclaw-guard 自动发送
      `.trim();

      // 使用 SMTP 发送邮件
      // 注意：这里简化了实现，实际使用可能需要 nodemailer 库
      const { host, port, user, pass, from, to } = this.config.email;
      
      // 构建简单邮件
      const boundary = '----=_Part_' + crypto.randomBytes(8).toString('hex');
      const rawEmail = [
        `From: ${from}`,
        `To: ${to.join(', ')}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: text/plain; charset=UTF-8`,
        '',
        body,
      ].join('\r\n');

      // 使用 netcat 或 curl 发送（简化实现）
      // 实际项目中应该使用 nodemailer
      console.log(chalk.gray(`[Email] Would send to ${to.join(', ')}: ${subject}`));
    } catch (error) {
      console.error('Email alert error:', error);
    }
  }

  private getLevelIcon(level: RiskLevel): string {
    switch (level) {
      case 'critical': return '🚨';
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🔵';
    }
  }

  private getLevelColor(level: RiskLevel): chalk.Chalk {
    switch (level) {
      case 'critical': return chalk.red.bold;
      case 'high': return chalk.red;
      case 'medium': return chalk.yellow;
      case 'low': return chalk.blue;
    }
  }

  private generateId(): string {
    return `alert-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  getAlertHistory(limit: number = 100): AlertRecord[] {
    return this.alertLog.slice(-limit);
  }

  markHandled(alertId: string): void {
    const alert = this.alertLog.find(a => a.id === alertId);
    if (alert) {
      alert.handled = true;
    }
  }
}