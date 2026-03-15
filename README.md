# OpenClaw Guard

<p align="center">
  <strong>OpenClaw 安全监控、运维管理 CLI 工具</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#安装">安装</a> •
  <a href="#使用指南">使用指南</a> •
  <a href="#知识库系统">知识库系统</a> •
  <a href="#安全检测">安全检测</a>
</p>

---

## 功能特性

### 🔍 诊断与修复
- **智能诊断** - 自动检测 OpenClaw 运行环境、配置、服务状态
- **自动修复** - 一键修复常见问题，支持 AI 辅助诊断
- **知识库驱动** - 基于经验库的智能问题匹配与修复

### 🛡️ 安全监控
- **实时监控** - 危险命令检测、文件变更监控
- **网络监控** - Gateway 连接监控、异常访问告警
- **设备监控** - 设备配对监控、授权管理
- **多渠道告警** - 支持 Webhook、钉钉、企业微信、飞书

### 📚 知识库系统
- **云端同步** - 与远程知识库双向同步
- **自动学习** - 修复成功后自动学习到本地库
- **智能合并** - 相同问题模式累加验证次数
- **安全检测** - 30+ 危险命令模式检测

### 📊 运维管理
- **配置管理** - 查看、修改、验证配置
- **Agent 管理** - 创建、删除、切换 Agent
- **备份恢复** - 配置备份与一键恢复
- **性能监控** - 实时性能指标展示

---

## 安装

```bash
# 克隆仓库
git clone https://github.com/SylvanXiao/openclaw-guard.git
cd openclaw-guard

# 安装依赖
npm install

# 编译
npm run build

# 全局安装（可选）
npm link
```

### 系统要求

- Node.js >= 18.0.0（推荐 >= 22.16.0）
- npm >= 9.0.0

---

## 使用指南

### 常用命令

```bash
# 安装 OpenClaw（引导式安装）
openclaw-guard install

# 运行诊断
openclaw-guard diagnose

# 诊断并自动修复
openclaw-guard diagnose --fix

# 启动安全监控
openclaw-guard monitor start

# 后台守护进程模式
openclaw-guard monitor daemon

# 启动 TUI 仪表盘
openclaw-guard tui
```

### 配置管理

```bash
# 查看配置
openclaw-guard config show

# 设置配置项
openclaw-guard config set <path> <value>

# 验证配置
openclaw-guard config validate
```

### 安全审计

```bash
# 运行安全审计
openclaw-guard security audit

# 加固安全配置
openclaw-guard security harden
```

---

## 知识库系统

### 基本操作

```bash
# 查看知识库统计
openclaw-guard knowledge stats

# 列出所有解决方案
openclaw-guard knowledge list

# 搜索解决方案
openclaw-guard knowledge search <query>

# 查看解决方案详情
openclaw-guard knowledge show <id>

# 手动添加解决方案
openclaw-guard knowledge add
```

### 远程同步

```bash
# 设置远程知识库地址
openclaw-guard knowledge remote <url> --interval 24

# 从远程拉取（只拉取验证 3+ 次的方案）
openclaw-guard knowledge sync --url <url>

# 推送到远程（推送验证 1+ 次且安全的方案）
openclaw-guard knowledge sync --push --url <url>

# 双向同步
openclaw-guard knowledge sync --bidirectional --url <url>
```

### 导入导出

```bash
# 导出知识库
openclaw-guard knowledge export output.json

# 只导出已验证的方案
openclaw-guard knowledge export --verified output.json

# 导入知识库
openclaw-guard knowledge import input.json
```

### 同步规则

| 方向 | 条件 | 说明 |
|------|------|------|
| 推送 → 云端 | `verified ≥ 1` + 安全检测通过 | 智能合并：相同累加次数，不同新建 |
| 云端 → 拉取 | `verified ≥ 3` + 安全检测通过 | 高质量方案保障 |

---

## 安全检测

### 检测范围

知识库安全检测覆盖 30+ 种危险命令模式：

| 类别 | 示例 |
|------|------|
| 文件破坏 | `rm -rf /`, `rm -rf ~`, `dd of=/dev/` |
| 权限风险 | `chmod 777`, `chown` |
| 网络风险 | `curl \| bash`, 反向 shell |
| 系统配置 | `> /etc/passwd`, `> ~/.ssh/` |
| 特权提升 | `sudo su`, `pkexec` |
| 环境篡改 | `export LD_PRELOAD` |

### 使用方式

```bash
# 验证本地知识库
openclaw-guard knowledge validate

# 验证文件
openclaw-guard knowledge validate <file>

# 验证远程知识库
openclaw-guard knowledge validate --remote
```

### AI 二次检测

当 AI 配置可用时，修复建议入库前会进行 AI 二次检测：
- 安全风险分析
- 副作用评估
- 可逆性检查

---

## 监控功能

### 实时监控

```bash
# 启动终端监控
openclaw-guard monitor start

# 后台守护进程
openclaw-guard monitor daemon \
  --webhook <url> \
  --network \
  --devices

# 查看监控状态
openclaw-guard monitor status

# 查看告警历史
openclaw-guard monitor history
```

### 授权管理

```bash
# 授权危险操作
openclaw-guard monitor authorize <ruleId> <pattern>

# 撤销授权
openclaw-guard monitor revoke <authId>

# 查看授权列表
openclaw-guard monitor authorizations
```

---

## TUI 仪表盘

启动交互式终端仪表盘：

```bash
openclaw-guard tui
```

功能包括：
- 系统状态概览
- 实时日志监控
- 性能指标展示
- 快捷操作面板

---

## 项目结构

```
openclaw-guard/
├── src/
│   ├── index.ts          # 入口文件
│   ├── commands/         # CLI 命令
│   │   ├── diagnose.ts   # 诊断命令
│   │   ├── monitor.ts    # 监控命令
│   │   ├── knowledge.ts  # 知识库命令
│   │   └── ...
│   ├── lib/              # 核心库
│   │   ├── config.ts     # 配置管理
│   │   ├── daemon.ts     # 守护进程
│   │   ├── fixer.ts      # 自动修复
│   │   └── knowledge.ts  # 知识库管理
│   ├── monitor/          # 监控模块
│   │   ├── detector.ts   # 危险检测
│   │   ├── alert.ts      # 告警系统
│   │   └── ...
│   └── types/            # 类型定义
├── dist/                 # 编译输出
└── package.json
```

---

## 开发

```bash
# 开发模式
npm run dev

# 编译
npm run build

# 运行
npm start
```

---

## 许可证

MIT License

---

## 相关链接

- [OpenClaw](https://github.com/openclaw/openclaw) - AI Agent 平台
- [问题反馈](https://github.com/SylvanXiao/openclaw-guard/issues)
