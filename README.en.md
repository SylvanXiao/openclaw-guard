# OpenClaw Guard

<p align="center">
  <strong>OpenClaw Security Monitoring, Operations, and Management CLI Tool</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#knowledge-base">Knowledge Base</a> •
  <a href="#security-validation">Security Validation</a>
</p>

---

## Features

### 🔍 Diagnostics & Repair
- **Smart Diagnostics** - Automatically detect OpenClaw environment, configuration, and service status
- **Auto-Fix** - One-click repair for common issues with AI-assisted diagnosis
- **Knowledge-Driven** - Intelligent problem matching and repair based on experience base

### 🛡️ Security Monitoring
- **Real-time Monitoring** - Dangerous command detection, file change monitoring
- **Network Monitoring** - Gateway connection monitoring, anomaly alerting
- **Device Monitoring** - Device pairing monitoring, authorization management
- **Multi-channel Alerts** - Support for Webhook, DingTalk, WeCom, Feishu

### 📚 Knowledge Base System
- **Cloud Sync** - Bidirectional sync with remote knowledge base
- **Auto Learning** - Automatically learn from successful fixes
- **Smart Merge** - Accumulate verification counts for matching patterns
- **Security Validation** - 30+ dangerous command pattern detection

### 📊 Operations Management
- **Config Management** - View, modify, and validate configuration
- **Agent Management** - Create, delete, and switch agents
- **Backup & Restore** - Configuration backup and one-click restore
- **Performance Monitoring** - Real-time performance metrics display

---

## Installation

```bash
# Clone repository
git clone https://github.com/SylvanXiao/openclaw-guard.git
cd openclaw-guard

# Install dependencies
npm install

# Build
npm run build

# Global installation (optional)
npm link
```

### Requirements

- Node.js >= 18.0.0 (recommended >= 22.16.0)
- npm >= 9.0.0

---

## Usage

### Common Commands

```bash
# Install OpenClaw (guided setup)
openclaw-guard install

# Run diagnostics
openclaw-guard diagnose

# Diagnose and auto-fix
openclaw-guard diagnose --fix

# Start security monitoring
openclaw-guard monitor start

# Background daemon mode
openclaw-guard monitor daemon

# Launch TUI dashboard
openclaw-guard tui
```

### Configuration Management

```bash
# Show configuration
openclaw-guard config show

# Set configuration value
openclaw-guard config set <path> <value>

# Validate configuration
openclaw-guard config validate
```

### Security Audit

```bash
# Run security audit
openclaw-guard security audit

# Harden security configuration
openclaw-guard security harden
```

---

## Knowledge Base

### Basic Operations

```bash
# View knowledge base statistics
openclaw-guard knowledge stats

# List all solutions
openclaw-guard knowledge list

# Search solutions
openclaw-guard knowledge search <query>

# Show solution details
openclaw-guard knowledge show <id>

# Manually add solution
openclaw-guard knowledge add
```

### Remote Sync

```bash
# Set remote knowledge base URL
openclaw-guard knowledge remote <url> --interval 24

# Pull from remote (only verified 3+ times)
openclaw-guard knowledge sync --url <url>

# Push to remote (verified 1+ times and safe)
openclaw-guard knowledge sync --push --url <url>

# Bidirectional sync
openclaw-guard knowledge sync --bidirectional --url <url>
```

### Import & Export

```bash
# Export knowledge base
openclaw-guard knowledge export output.json

# Export only verified solutions
openclaw-guard knowledge export --verified output.json

# Import knowledge base
openclaw-guard knowledge import input.json
```

### Sync Rules

| Direction | Condition | Description |
|-----------|-----------|-------------|
| Push → Cloud | `verified ≥ 1` + Security check passed | Smart merge: accumulate counts for matches, create new for differences |
| Cloud → Pull | `verified ≥ 3` + Security check passed | High-quality solutions guaranteed |

---

## Security Validation

### Detection Scope

Knowledge base security validation covers 30+ dangerous command patterns:

| Category | Examples |
|----------|----------|
| File Destruction | `rm -rf /`, `rm -rf ~`, `dd of=/dev/` |
| Permission Risks | `chmod 777`, `chown` |
| Network Risks | `curl \| bash`, reverse shell |
| System Config | `> /etc/passwd`, `> ~/.ssh/` |
| Privilege Escalation | `sudo su`, `pkexec` |
| Environment Tampering | `export LD_PRELOAD` |

### Usage

```bash
# Validate local knowledge base
openclaw-guard knowledge validate

# Validate file
openclaw-guard knowledge validate <file>

# Validate remote knowledge base
openclaw-guard knowledge validate --remote
```

### AI Secondary Validation

When AI configuration is available, fix suggestions undergo AI secondary validation before being added to the knowledge base:
- Security risk analysis
- Side effect assessment
- Reversibility check

---

## Monitoring

### Real-time Monitoring

```bash
# Start terminal monitoring
openclaw-guard monitor start

# Background daemon
openclaw-guard monitor daemon \
  --webhook <url> \
  --network \
  --devices

# Check monitoring status
openclaw-guard monitor status

# View alert history
openclaw-guard monitor history
```

### Authorization Management

```bash
# Authorize dangerous action
openclaw-guard monitor authorize <ruleId> <pattern>

# Revoke authorization
openclaw-guard monitor revoke <authId>

# List authorizations
openclaw-guard monitor authorizations
```

---

## TUI Dashboard

Launch the interactive terminal dashboard:

```bash
openclaw-guard tui
```

Features include:
- System status overview
- Real-time log monitoring
- Performance metrics display
- Quick action panel

---

## Project Structure

```
openclaw-guard/
├── src/
│   ├── index.ts          # Entry point
│   ├── commands/         # CLI commands
│   │   ├── diagnose.ts   # Diagnose command
│   │   ├── monitor.ts    # Monitor command
│   │   ├── knowledge.ts  # Knowledge command
│   │   └── ...
│   ├── lib/              # Core libraries
│   │   ├── config.ts     # Config management
│   │   ├── daemon.ts     # Daemon process
│   │   ├── fixer.ts      # Auto-fix
│   │   └── knowledge.ts  # Knowledge base
│   ├── monitor/          # Monitoring modules
│   │   ├── detector.ts   # Danger detection
│   │   ├── alert.ts      # Alert system
│   │   └── ...
│   └── types/            # Type definitions
├── dist/                 # Build output
└── package.json
```

---

## Development

```bash
# Development mode
npm run dev

# Build
npm run build

# Run
npm start
```

---

## License

MIT License

---

## Links

- [OpenClaw](https://github.com/SylvanXiao/openclaw) - AI Agent Platform
- [Issue Tracker](https://github.com/SylvanXiao/openclaw-guard/issues)
