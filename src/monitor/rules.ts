export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

export interface DangerRule {
  id: string;
  name: string;
  description: string;
  level: RiskLevel;
  patterns: RegExp[];
  categories: string[];
  action?: 'block' | 'warn' | 'log';
}

export const DANGER_RULES: DangerRule[] = [
  // ==================== Gateway 连接 ====================
  {
    id: 'gateway-unauthorized-access',
    name: '未授权的Gateway访问',
    description: '检测未配对设备的连接尝试',
    level: 'high',
    patterns: [
      /unauthorized.*access/i,
      /authentication failed/i,
      /invalid token/i,
      /device not paired/i,
      /permission denied/i,
      /AUTH_TOKEN_MISMATCH/i,
    ],
    categories: ['gateway', 'access'],
    action: 'warn',
  },
  {
    id: 'gateway-new-device-pairing',
    name: '新设备配对请求',
    description: '检测新的设备配对请求',
    level: 'medium',
    patterns: [
      /pairing request/i,
      /device pairing/i,
      /new device.*connecting/i,
      /pending.*pairing/i,
    ],
    categories: ['gateway', 'device'],
    action: 'log',
  },
  {
    id: 'gateway-remote-connection',
    name: '远程连接Gateway',
    description: '检测来自非本地的Gateway连接',
    level: 'medium',
    patterns: [
      /connection from.*\d+\.\d+\.\d+\.\d+/i,
      /client.*\d+\.\d+\.\d+\.\d+/i,
      /remote.*connected/i,
    ],
    categories: ['gateway', 'network'],
    action: 'warn',
  },
  {
    id: 'gateway-suspicious-activity',
    name: 'Gateway可疑活动',
    description: '检测Gateway的可疑活动模式',
    level: 'high',
    patterns: [
      /brute force/i,
      /too many.*attempts/i,
      /rate limit.*exceeded/i,
      /suspicious.*request/i,
      /blocked.*ip/i,
    ],
    categories: ['gateway', 'intrusion'],
    action: 'warn',
  },

  // ==================== 文件操作 ====================
  {
    id: 'file-delete-recursive',
    name: '递归删除',
    description: '检测 rm -rf 等递归删除命令',
    level: 'critical',
    patterns: [
      /\brm\s+(-[rf]+\s+|--recursive\s+|--force\s+).*\//gi,
      /\brm\s+-rf\s+\//gi,
      /\brm\s+-rf\s+~/gi,
      /\brm\s+-rf\s+\*/gi,
    ],
    categories: ['file', 'destructive'],
    action: 'warn',
  },
  {
    id: 'file-delete-important',
    name: '删除重要文件',
    description: '检测删除重要系统文件或配置',
    level: 'critical',
    patterns: [
      /\brm\s+.*\/etc\/passwd/i,
      /\brm\s+.*\/etc\/shadow/i,
      /\brm\s+.*\.ssh\//i,
      /\brm\s+.*\.gnupg\//i,
      /\brm\s+.*\.openclaw\/openclaw\.json/i,
    ],
    categories: ['file', 'destructive', 'system'],
    action: 'block',
  },
  {
    id: 'file-access-sensitive',
    name: '访问敏感文件',
    description: '检测读取敏感文件',
    level: 'high',
    patterns: [
      /cat\s+.*\/etc\/passwd/i,
      /cat\s+.*\/etc\/shadow/i,
      /cat\s+.*\.ssh\/id_rsa/i,
      /cat\s+.*\.pem/i,
      /cat\s+.*\.key/i,
      /less\s+.*\.ssh\//i,
      /head\s+.*\.ssh\//i,
    ],
    categories: ['file', 'sensitive'],
    action: 'warn',
  },
  {
    id: 'chmod-dangerous',
    name: '危险权限修改',
    description: '检测将文件设置为全局可写或可执行',
    level: 'high',
    patterns: [
      /chmod\s+777/i,
      /chmod\s+-R\s+777/i,
      /chmod\s+\+x.*\/etc\//i,
    ],
    categories: ['file', 'permission'],
    action: 'warn',
  },

  // ==================== 网络操作 ====================
  {
    id: 'network-download-execute',
    name: '下载并执行',
    description: '检测从网络下载并直接执行的命令',
    level: 'critical',
    patterns: [
      /curl\s+.*\|\s*(bash|sh|python|node)/i,
      /wget\s+.*\|\s*(bash|sh|python|node)/i,
      /curl\s+.*>\s*.*\.sh.*&&\s*\./i,
    ],
    categories: ['network', 'destructive'],
    action: 'block',
  },
  {
    id: 'network-upload-sensitive',
    name: '上传敏感数据',
    description: '检测可能上传敏感文件的行为',
    level: 'high',
    patterns: [
      /curl\s+.*-T\s+.*\.ssh\//i,
      /curl\s+.*-T\s+.*\.pem/i,
      /curl\s+.*-T\s+.*\.key/i,
      /scp\s+.*\.ssh\//i,
      /rsync\s+.*\.ssh\//i,
    ],
    categories: ['network', 'exfiltration'],
    action: 'warn',
  },
  {
    id: 'network-reverse-shell',
    name: '反向Shell',
    description: '检测反向Shell连接',
    level: 'critical',
    patterns: [
      /bash\s+-[ci].*>.*\/dev\/tcp/i,
      /nc\s+.*-e\s+(bash|sh)/i,
      /ncat\s+.*-e\s+(bash|sh)/i,
      /python.*-c.*socket/i,
    ],
    categories: ['network', 'intrusion'],
    action: 'block',
  },

  // ==================== 系统操作 ====================
  {
    id: 'system-shutdown',
    name: '系统关机',
    description: '检测系统关机/重启命令',
    level: 'critical',
    patterns: [
      /\bshutdown\s+/i,
      /\breboot/i,
      /\binit\s+0/i,
      /\binit\s+6/i,
      /\bsystemctl\s+(reboot|poweroff)/i,
    ],
    categories: ['system', 'destructive'],
    action: 'block',
  },
  {
    id: 'system-service-modify',
    name: '修改系统服务',
    description: '检测修改系统服务的操作',
    level: 'high',
    patterns: [
      /systemctl\s+(enable|disable)\s+/i,
      /systemctl\s+mask\s+/i,
      /update-rc\.d\s+/i,
      /chkconfig\s+/i,
    ],
    categories: ['system', 'service'],
    action: 'warn',
  },
  {
    id: 'system-user-modify',
    name: '修改用户',
    description: '检测添加/修改用户操作',
    level: 'high',
    patterns: [
      /\buseradd\s+/i,
      /\busermod\s+/i,
      /\bpasswd\s+/i,
      /\badduser\s+/i,
    ],
    categories: ['system', 'user'],
    action: 'warn',
  },

  // ==================== 包管理 ====================
  {
    id: 'package-install-unknown',
    name: '安装未知包',
    description: '检测从非官方源安装软件包',
    level: 'medium',
    patterns: [
      /npm\s+install\s+.*--force/i,
      /npm\s+install\s+-g\s+[a-z]/i,
      /pip\s+install\s+.*--no-verify/i,
      /curl.*|.*sudo\s+apt/i,
    ],
    categories: ['package', 'security'],
    action: 'warn',
  },

  // ==================== OpenClaw 特定 ====================
  {
    id: 'openclaw-config-modify',
    name: '修改OpenClaw配置',
    description: '检测修改OpenClaw配置文件',
    level: 'medium',
    patterns: [
      /\.openclaw\/openclaw\.json/i,
      /openclaw\s+config\s+set/i,
    ],
    categories: ['openclaw', 'config'],
    action: 'log',
  },
  {
    id: 'openclaw-credential-expose',
    name: '凭证暴露',
    description: '检测API密钥或凭证可能被暴露',
    level: 'high',
    patterns: [
      /sk-[a-zA-Z0-9]{20,}/i,
      /[a-f0-9]{32,}/i,
      /password\s*[=:]\s*\S+/i,
      /token\s*[=:]\s*\S+/i,
      /secret\s*[=:]\s*\S+/i,
    ],
    categories: ['openclaw', 'credential'],
    action: 'warn',
  },

  // ==================== 数据操作 ====================
  {
    id: 'data-bulk-delete',
    name: '批量删除数据',
    description: '检测批量删除数据库或文件',
    level: 'critical',
    patterns: [
      /DROP\s+DATABASE/i,
      /DROP\s+TABLE/i,
      /TRUNCATE\s+TABLE/i,
      /DELETE\s+FROM\s+\w+\s*;/i,
      /mongo.*\.drop\(\)/i,
      /redis.*FLUSHALL/i,
    ],
    categories: ['data', 'destructive'],
    action: 'block',
  },
  {
    id: 'data-bulk-export',
    name: '批量导出数据',
    description: '检测可能的数据导出行为',
    level: 'medium',
    patterns: [
      /mysqldump\s+/i,
      /pg_dump\s+/i,
      /mongoexport\s+/i,
      /redis-cli.*--rdb/i,
    ],
    categories: ['data', 'exfiltration'],
    action: 'warn',
  },
];

export function getRulesByLevel(level: RiskLevel): DangerRule[] {
  return DANGER_RULES.filter(rule => rule.level === level);
}

export function getRulesByCategory(category: string): DangerRule[] {
  return DANGER_RULES.filter(rule => rule.categories.includes(category));
}
