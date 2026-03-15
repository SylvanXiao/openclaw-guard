export interface DiagnosisResult {
  category: string;
  check: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  fix?: string;
}

export interface SecurityIssue {
  severity: 'high' | 'medium' | 'low';
  category: string;
  issue: string;
  location?: string;
  recommendation: string;
}

export interface NodeCheckResult {
  satisfied: boolean;
  installed: string;
  required: string;
}

export interface AgentConfig {
  id: string;
  default?: boolean;
  agentDir?: string;
  workspace?: string;
  groupChat?: {
    mentionPatterns?: string[];
  };
  sandbox?: {
    mode?: 'off' | 'all' | 'partial';
    scope?: 'agent' | 'shared';
  };
}

export interface BindingConfig {
  agentId: string;
  match: {
    channel: string;
    accountId?: string;
    peer?: {
      kind: 'dm' | 'group' | 'channel';
      id: string;
    };
  };
}

export interface ChannelConfig {
  clientId?: string;
  clientSecret?: string;
  gatewayToken?: string;
  botToken?: string;
  applicationId?: string;
  sessionId?: string;
  sessionTimeout?: number;
}

export interface OpenClawConfig {
  gateway?: {
    port?: number;
    mode?: 'local' | 'remote';
    bind?: string;
    auth?: {
      mode?: 'none' | 'token' | 'password';
      token?: string;
    };
  };
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
        fallbacks?: string[];
      };
      workspace?: string;
    };
    list?: AgentConfig[];
  };
  bindings?: BindingConfig[];
  channels?: Record<string, ChannelConfig>;
  models?: {
    providers?: Record<string, {
      baseUrl?: string;
      apiKey?: string;
      api?: string;
      models?: Array<{
        id: string;
        name?: string;
        contextWindow?: number;
        maxTokens?: number;
      }>;
    }>;
  };
  tools?: {
    profile?: string;
    elevated?: string[];
    deny?: string[];
  };
  plugins?: {
    entries?: Record<string, { enabled?: boolean }>;
  };
}
