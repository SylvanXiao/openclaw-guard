import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import chokidar from 'chokidar';
import { DangerDetector, DetectionContext } from './detector';
import { AlertSystem } from './alert';

export interface LogMonitorConfig {
  logDir?: string;
  filePattern?: string;
  pollInterval?: number;
}

export class LogMonitor {
  private detector: DangerDetector;
  private alertSystem: AlertSystem;
  private logDir: string;
  private filePattern: string;
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private isRunning: boolean = false;
  private filePositions: Map<string, number> = new Map();

  constructor(
    detector: DangerDetector,
    alertSystem: AlertSystem,
    config: LogMonitorConfig = {}
  ) {
    this.detector = detector;
    this.alertSystem = alertSystem;
    this.logDir = config.logDir || path.join(os.homedir(), '.openclaw', 'logs');
    this.filePattern = config.filePattern || '*.log';
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Log monitor is already running');
      return;
    }

    console.log(`Starting log monitor on: ${this.logDir}`);

    // 确保日志目录存在
    await fs.ensureDir(this.logDir);

    // 初始化现有文件的位置
    const files = await this.getLogFiles();
    for (const file of files) {
      const stat = await fs.stat(file);
      this.filePositions.set(file, stat.size);
    }

    // 创建文件监视器
    this.watcher = chokidar.watch(path.join(this.logDir, this.filePattern), {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher
      .on('add', (filePath) => this.onFileAdd(filePath))
      .on('change', (filePath) => this.onFileChange(filePath))
      .on('error', (error) => console.error('Watcher error:', error));

    this.isRunning = true;
    console.log('Log monitor started');
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.isRunning = false;
    console.log('Log monitor stopped');
  }

  private async getLogFiles(): Promise<string[]> {
    const files = await fs.readdir(this.logDir);
    return files
      .filter(f => f.endsWith('.log'))
      .map(f => path.join(this.logDir, f));
  }

  private async onFileAdd(filePath: string): Promise<void> {
    const stat = await fs.stat(filePath);
    this.filePositions.set(filePath, stat.size);
  }

  private async onFileChange(filePath: string): Promise<void> {
    const lastPosition = this.filePositions.get(filePath) || 0;
    const stat = await fs.stat(filePath);

    if (stat.size <= lastPosition) {
      // 文件可能被截断
      this.filePositions.set(filePath, 0);
      return;
    }

    // 读取新增内容
    const buffer = Buffer.alloc(stat.size - lastPosition);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, buffer.length, lastPosition);
    fs.closeSync(fd);

    const newContent = buffer.toString('utf-8');
    this.filePositions.set(filePath, stat.size);

    // 检测危险行为
    await this.processContent(newContent, filePath);
  }

  private async processContent(content: string, filePath: string): Promise<void> {
    // 提取上下文信息
    const context: DetectionContext = {
      source: 'log',
    };

    // 尝试从日志内容中提取更多信息
    const agentMatch = content.match(/agent[=:]\s*([a-zA-Z0-9-]+)/i);
    if (agentMatch) {
      context.agentId = agentMatch[1];
    }

    const sessionMatch = content.match(/session[=:]\s*([a-zA-Z0-9-]+)/i);
    if (sessionMatch) {
      context.sessionId = sessionMatch[1];
    }

    const channelMatch = content.match(/channel[=:]\s*([a-zA-Z0-9-]+)/i);
    if (channelMatch) {
      context.channel = channelMatch[1];
    }

    // 检测危险行为
    const detections = await this.detector.detect(content, context);

    if (detections.length > 0) {
      await this.alertSystem.alert(detections, context);
    }
  }

  getStatus(): { running: boolean; watchedFiles: number } {
    return {
      running: this.isRunning,
      watchedFiles: this.filePositions.size,
    };
  }
}