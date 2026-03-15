import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { DangerDetector, DetectionContext } from './detector';
import { AlertSystem } from './alert';

export interface DeviceInfo {
  deviceId: string;
  displayName?: string;
  platform?: string;
  role?: string;
  approvedAtMs?: number;
  createdAtMs?: number;
}

export class DeviceMonitor {
  private detector: DangerDetector;
  private alertSystem: AlertSystem;
  private devicesPath: string;
  private knownDevices: Set<string> = new Set();
  private isRunning: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    detector: DangerDetector,
    alertSystem: AlertSystem
  ) {
    this.detector = detector;
    this.alertSystem = alertSystem;
    const openclawDir = path.join(os.homedir(), '.openclaw');
    this.devicesPath = path.join(openclawDir, 'devices', 'paired.json');
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('Starting device monitor...');

    // 加载已知设备
    await this.loadKnownDevices();

    // 定期检查新设备
    this.checkInterval = setInterval(async () => {
      await this.checkForNewDevices();
    }, 30000); // 每30秒检查一次

    // 同时监控设备文件变化
    if (await fs.pathExists(this.devicesPath)) {
      const chokidar = await import('chokidar');
      chokidar.watch(this.devicesPath).on('change', async () => {
        await this.checkForNewDevices();
      });
    }

    this.isRunning = true;
    console.log('Device monitor started');
  }

  async stop(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('Device monitor stopped');
  }

  private async loadKnownDevices(): Promise<void> {
    try {
      if (await fs.pathExists(this.devicesPath)) {
        const data = await fs.readJson(this.devicesPath);
        for (const deviceId of Object.keys(data)) {
          this.knownDevices.add(deviceId);
        }
      }
    } catch (error) {
      console.error('Failed to load known devices:', error);
    }
  }

  private async checkForNewDevices(): Promise<void> {
    try {
      if (!(await fs.pathExists(this.devicesPath))) return;

      const data = await fs.readJson(this.devicesPath);
      const currentDevices = Object.keys(data);

      // 检查新设备
      for (const deviceId of currentDevices) {
        if (!this.knownDevices.has(deviceId)) {
          // 发现新设备
          const deviceInfo: DeviceInfo = data[deviceId];
          await this.alertNewDevice(deviceId, deviceInfo);
          this.knownDevices.add(deviceId);
        }
      }

      // 更新已知设备列表
      this.knownDevices = new Set(currentDevices);
    } catch (error) {
      // 忽略错误
    }
  }

  private async alertNewDevice(deviceId: string, info: DeviceInfo): Promise<void> {
    const context: DetectionContext = {
      source: 'log',
      channel: 'device-pairing',
    };

    const message = `New device paired: ${info.displayName || 'Unknown'} (${info.platform || 'unknown platform'})`;
    
    // 创建一个检测结果
    const detections = this.detector.detect(message, context);
    
    // 无论如何都发送新设备配对警报
    console.log();
    console.log('🆕 New Device Paired');
    console.log(`  Device ID: ${deviceId.substring(0, 16)}...`);
    console.log(`  Name: ${info.displayName || 'Unknown'}`);
    console.log(`  Platform: ${info.platform || 'Unknown'}`);
    console.log(`  Role: ${info.role || 'Unknown'}`);
    console.log(`  Approved: ${info.approvedAtMs ? new Date(info.approvedAtMs).toLocaleString('zh-CN') : 'Unknown'}`);
    console.log();

    // 记录到授权日志
    const openclawDir = path.join(os.homedir(), '.openclaw');
    const logPath = path.join(openclawDir, 'logs', 'device-events.log');
    await fs.ensureDir(path.dirname(logPath));
    await fs.appendFile(logPath, JSON.stringify({
      event: 'device_paired',
      deviceId,
      deviceInfo: info,
      timestamp: new Date().toISOString(),
    }) + '\n');
  }

  async getConnectedDevices(): Promise<DeviceInfo[]> {
    try {
      if (!(await fs.pathExists(this.devicesPath))) return [];

      const data = await fs.readJson(this.devicesPath);
      return Object.entries(data).map(([deviceId, info]) => ({
        deviceId,
        ...(info as any),
      }));
    } catch {
      return [];
    }
  }
}
