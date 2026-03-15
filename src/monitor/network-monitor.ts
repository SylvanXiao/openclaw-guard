import execa = require('execa');
import { AlertSystem } from './alert';
import { DangerRule, RiskLevel } from './rules';

export interface NetworkConnection {
  protocol: string;
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  state: string;
  pid?: number;
  processName?: string;
}

export class NetworkMonitor {
  private alertSystem: AlertSystem;
  private knownConnections: Map<string, NetworkConnection> = new Map();
  private isRunning: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private gatewayPorts: number[];

  constructor(alertSystem: AlertSystem, gatewayPorts: number[] = [18789]) {
    this.alertSystem = alertSystem;
    this.gatewayPorts = gatewayPorts;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    console.log('Starting network monitor...');
    console.log(`Monitoring ports: ${this.gatewayPorts.join(', ')}`);

    // 加载已知连接
    await this.loadCurrentConnections();

    // 定期检查新连接
    this.checkInterval = setInterval(async () => {
      await this.checkNewConnections();
    }, 15000); // 每15秒检查一次

    this.isRunning = true;
    console.log('Network monitor started');
  }

  async stop(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('Network monitor stopped');
  }

  private async loadCurrentConnections(): Promise<void> {
    const connections = await this.getGatewayConnections();
    for (const conn of connections) {
      const key = this.getConnectionKey(conn);
      this.knownConnections.set(key, conn);
    }
    console.log(`Loaded ${this.knownConnections.size} existing connections`);
  }

  private async checkNewConnections(): Promise<void> {
    const connections = await this.getGatewayConnections();

    for (const conn of connections) {
      const key = this.getConnectionKey(conn);
      if (!this.knownConnections.has(key)) {
        // 发现新连接
        await this.alertNewConnection(conn);
        this.knownConnections.set(key, conn);
      }
    }

    // 清理已关闭的连接
    const currentKeys = new Set(connections.map(c => this.getConnectionKey(c)));
    for (const key of this.knownConnections.keys()) {
      if (!currentKeys.has(key)) {
        this.knownConnections.delete(key);
      }
    }
  }

  private getConnectionKey(conn: NetworkConnection): string {
    return `${conn.remoteAddress}:${conn.remotePort}->${conn.localPort}`;
  }

  async getGatewayConnections(): Promise<NetworkConnection[]> {
    try {
      // 使用 ss 或 netstat 获取连接
      const { stdout } = await execa('ss', ['-tunp', '-H'], { reject: false });
      return this.parseSSOutput(stdout);
    } catch {
      try {
        const { stdout } = await execa('netstat', ['-tunp'], { reject: false });
        return this.parseNetstatOutput(stdout);
      } catch {
        return [];
      }
    }
  }

  private parseSSOutput(output: string): NetworkConnection[] {
    const connections: NetworkConnection[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      
      const parts = line.split(/\s+/);
      if (parts.length < 5) continue;

      const state = parts[0];
      const localPart = parts[3];
      const remotePart = parts[4];

      const [localAddr, localPortStr] = this.parseAddress(localPart);
      const [remoteAddr, remotePortStr] = this.parseAddress(remotePart);

      const localPort = parseInt(localPortStr, 10);
      const remotePort = parseInt(remotePortStr, 10);

      // 只关注 Gateway 端口
      if (!this.gatewayPorts.includes(localPort)) continue;

      // 只关注 ESTABLISHED 连接
      if (state !== 'ESTAB') continue;

      // 忽略本地连接（127.0.0.1 和 ::1）
      if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '[::1]') continue;

      connections.push({
        protocol: 'tcp',
        localAddress: localAddr,
        localPort,
        remoteAddress: remoteAddr,
        remotePort,
        state,
      });
    }

    return connections;
  }

  private parseNetstatOutput(output: string): NetworkConnection[] {
    const connections: NetworkConnection[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (!line.includes('ESTABLISHED')) continue;
      
      const parts = line.split(/\s+/);
      if (parts.length < 5) continue;

      const protocol = parts[0];
      const localPart = parts[3];
      const remotePart = parts[4];

      const [localAddr, localPortStr] = this.parseAddress(localPart);
      const [remoteAddr, remotePortStr] = this.parseAddress(remotePart);

      const localPort = parseInt(localPortStr, 10);
      const remotePort = parseInt(remotePortStr, 10);

      if (!this.gatewayPorts.includes(localPort)) continue;
      if (remoteAddr === '127.0.0.1' || remoteAddr === '::1') continue;

      connections.push({
        protocol,
        localAddress: localAddr,
        localPort,
        remoteAddress: remoteAddr,
        remotePort,
        state: 'ESTABLISHED',
      });
    }

    return connections;
  }

  private parseAddress(addr: string): [string, string] {
    // IPv6 格式: [addr]:port 或 addr:port
    if (addr.startsWith('[')) {
      const match = addr.match(/^\[([^\]]+)\]:(\d+)$/);
      if (match) return [match[1], match[2]];
    }
    
    // IPv4 格式: addr:port
    const lastColon = addr.lastIndexOf(':');
    if (lastColon > 0) {
      return [addr.substring(0, lastColon), addr.substring(lastColon + 1)];
    }
    
    return [addr, '0'];
  }

  private async alertNewConnection(conn: NetworkConnection): Promise<void> {
    const message = `New connection to Gateway port ${conn.localPort} from ${conn.remoteAddress}:${conn.remotePort}`;

    console.log();
    console.log('🌐 New Gateway Connection');
    console.log(`  Local: ${conn.localAddress}:${conn.localPort}`);
    console.log(`  Remote: ${conn.remoteAddress}:${conn.remotePort}`);
    console.log(`  State: ${conn.state}`);
    console.log();

    // 创建一个虚拟规则用于警报
    const rule: DangerRule = {
      id: 'gateway-remote-connection',
      name: '远程连接Gateway',
      description: '检测来自非本地的Gateway连接',
      level: 'medium' as RiskLevel,
      patterns: [],
      categories: ['gateway', 'network'],
      action: 'warn',
    };

    await this.alertSystem.alert([{
      rule,
      matched: message,
      position: { start: 0, end: message.length },
      timestamp: new Date(),
      authorized: false,
    }], {
      source: 'log',
      channel: 'network',
    });
  }

  async getCurrentConnections(): Promise<NetworkConnection[]> {
    return this.getGatewayConnections();
  }
}
