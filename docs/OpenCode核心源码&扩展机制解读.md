# OpenCode 源码深度解读

本文档基于 OpenCode 真实源码，全面解读其架构设计、核心机制和扩展方式。

---

## 目录

### 第一部分：OpenCode 核心架构
1. [项目概述](#1-项目概述)
2. [核心数据模型](#2-核心数据模型) - Session、Message、Part、Event
3. [配置系统](#3-配置系统) - 加载优先级、Schema
4. [Agent 系统](#4-agent-系统) - 定义、内置 Agent、模式
5. [工具系统](#5-工具系统) - 定义、内置工具
6. [Provider 系统](#6-provider-系统) - LLM 集成架构
7. [MCP 系统](#7-mcp-系统) - 配置类型、示例
8. [HTTP Server](#8-http-server) - API 端点

### 第二部分：插件系统详解
9. [插件类型定义](#9-插件类型定义) - PluginInput、Hooks
10. [插件加载机制](#10-插件加载机制) - 加载流程、trigger
11. [编写插件](#11-编写插件) - 示例、Hooks 触发时机
12. [oh-my-opencode 案例分析](#12-oh-my-opencode-案例分析)

### 第三部分：扩展机制指南
13. [认证扩展](#13-认证扩展) - 用户账号、本地服务、Provider 认证
14. [Provider 扩展](#14-provider-扩展) - 配置、自定义推理服务
15. [Agent 扩展](#15-agent-扩展) - 配置文件、插件方式
16. [工具扩展](#16-工具扩展) - 插件、.opencode/tool
17. [MCP 扩展](#17-mcp-扩展) - 配置、插件方式
18. [Codebase 对接](#18-codebase-对接) - 本地代码搜索、语义搜索
19. [Agent 市场对接](#19-agent-市场对接) - 直接配置、插件扩展
20. [源码修改位置汇总](#20-源码修改位置汇总)
21. [关键源码文件索引](#21-关键源码文件索引)

---

# 第一部分：OpenCode 核心架构

## 1. 项目概述

OpenCode 是一个基于 AI 的代码助手，采用 TypeScript 开发，支持多种 LLM Provider，提供丰富的工具集和插件扩展能力。

### 1.1 代码仓库结构

```
opencode-dev/
├── packages/
│   ├── opencode/           # 核心实现
│   │   ├── src/
│   │   │   ├── agent/      # Agent 系统
│   │   │   ├── auth/       # 本地认证存储
│   │   │   ├── config/     # 配置系统
│   │   │   ├── mcp/        # MCP 协议支持
│   │   │   ├── plugin/     # 插件加载机制
│   │   │   ├── provider/   # LLM Provider 集成
│   │   │   ├── server/     # HTTP Server (Hono)
│   │   │   ├── session/    # 会话管理
│   │   │   ├── tool/       # 工具系统
│   │   │   ├── bus/        # 事件总线
│   │   │   ├── permission/ # 权限系统
│   │   │   ├── skill/      # 技能系统
│   │   │   ├── lsp/        # LSP 语言服务
│   │   │   ├── format/     # 代码格式化
│   │   │   ├── file/       # 文件操作
│   │   │   ├── snapshot/   # 快照系统
│   │   │   ├── share/      # 分享功能
│   │   │   └── util/       # 工具函数
│   │   └── package.json
│   ├── plugin/             # 插件 SDK（类型定义）
│   │   ├── src/
│   │   │   ├── index.ts    # Plugin、Hooks 类型
│   │   │   ├── tool.ts     # Tool 定义辅助函数
│   │   │   └── shell.ts    # BunShell 类型
│   │   └── package.json
│   ├── sdk/                # JavaScript SDK
│   │   └── js/
│   └── console/            # 云端控制台（opencode.ai）
│       ├── app/            # 前端应用
│       ├── core/           # 核心模型、数据库 Schema
│       └── function/       # Serverless 函数（认证等）
├── scripts/                # 构建脚本
├── docs/                   # 文档
└── .github/                # GitHub 配置
```

### 1.2 技术栈

| 层级 | 技术选型 |
|------|---------|
| 运行时 | Bun |
| 语言 | TypeScript |
| HTTP Server | Hono |
| Schema 验证 | Zod |
| AI SDK | Vercel AI SDK |
| 数据库 | Drizzle ORM + MySQL（云端） |
| 认证 | OpenAuth（云端） |

---

## 2. 核心数据模型

OpenCode 的数据模型采用 **Zod Schema** 定义，确保类型安全和运行时验证。理解这些核心模型是扩展 OpenCode 的基础。

### 2.1 Session（会话）

**源码位置**: `packages/opencode/src/session/`

**设计理念**：Session 是 OpenCode 的顶级容器，代表一次完整的对话交互。每个 Session 可以：
- 包含多条 Message（用户输入和 AI 回复）
- 关联特定的 Agent、Model 和 Provider
- 支持分支（parentID）实现对话树
- 支持分享功能

```typescript
// packages/opencode/src/session/session.ts
export namespace Session {
  export const Info = z.object({
    id: z.string(),                         // 唯一标识符，格式: session_xxx
    title: z.string().optional(),           // 会话标题（自动生成或用户自定义）
    parentID: z.string().optional(),        // 父会话 ID（用于分支/fork 功能）
    share: z.string().optional(),           // 分享链接 URL
    version: z.number().int(),              // 版本号（用于乐观锁更新）
    updated: z.string().datetime(),         // 最后更新时间
    created: z.string().datetime(),         // 创建时间
    agentID: z.string().optional(),         // 当前使用的 Agent ID
    modelID: z.string().optional(),         // 当前使用的模型 ID
    providerID: z.string().optional(),      // 当前使用的 Provider ID
  })
  
  // 会话持久化：存储在 ~/.local/share/opencode/session/
}
```

**关键点解读**：
- `parentID` 实现了对话分支功能，用户可以从任意消息点创建新分支
- `version` 字段用于并发控制，防止多客户端同时修改
- 会话数据以 JSON 文件形式存储在本地，支持离线访问

### 2.2 Message（消息）

**源码位置**: `packages/sdk/js/src/gen/core/`

**设计理念**：Message 是对话的基本单元。OpenCode 采用 **流式处理** 架构，消息内容通过 Part 分块传输，支持实时显示 AI 的思考过程和工具调用。

**消息角色说明**：
- `user`: 用户输入的消息
- `assistant`: AI 生成的回复
- `system`: 系统消息（通常是 System Prompt）

```typescript
// 消息类型
export const Message = z.object({
  id: z.string(),                           // 消息唯一 ID
  sessionID: z.string(),                    // 所属会话 ID
  role: z.enum(["user", "assistant", "system"]),
  variant: z.string().optional(),           // 消息变体（重试时保留原消息，创建新变体）
  time: z.object({
    created: z.string().datetime(),         // 消息创建时间
    completed: z.string().datetime().optional(), // 消息完成时间（流式结束）
  }),
  tokens: z.object({                        // Token 使用统计
    input: z.number().optional(),           // 输入 token 数
    output: z.number().optional(),          // 输出 token 数
    cache: z.object({                       // 缓存命中统计
      read: z.number().optional(),          // 缓存读取 token 数
      write: z.number().optional(),         // 缓存写入 token 数
    }).optional(),
  }).optional(),
  model: z.object({                         // 使用的模型信息
    providerID: z.string(),
    modelID: z.string(),
  }).optional(),
  agent: z.string().optional(),             // 使用的 Agent ID
})

// 用户消息（继承基础 Message）
export const UserMessage = Message.extend({
  role: z.literal("user"),
})

// 助手消息
export const AssistantMessage = Message.extend({
  role: z.literal("assistant"),
  system: z.string().optional(),           // System prompt
  error: z.string().optional(),
})
```

### 2.3 Part（消息内容块）

**源码位置**: `packages/sdk/js/src/gen/core/part.gen.ts`

**设计理念**：Part 是 OpenCode **流式架构** 的核心。一条 Message 由多个 Part 组成，每个 Part 代表一个独立的内容块。这种设计支持：
- **实时流式显示**：AI 回复可以边生成边显示
- **混合内容类型**：文本、代码、工具调用可以交错出现
- **状态追踪**：工具调用有完整的状态机（pending → streaming → result/error）

**Part 类型说明**：

| 类型 | 用途 | 典型场景 |
|------|------|---------|
| `text` | 普通文本内容 | AI 的文字回复 |
| `reasoning` | 思考过程 | Claude 的 thinking 模式 |
| `tool-invocation` | 工具调用 | 执行 Edit、Bash 等工具 |
| `step-start` | 步骤标记 | 多步推理的分隔 |
| `file` | 文件附件 | 图片、文档上传 |

```typescript
// Part 使用 discriminatedUnion 实现类型安全的多态
export const Part = z.discriminatedUnion("type", [
  // 文本内容 - 最常见的 Part 类型
  z.object({
    type: z.literal("text"),
    id: z.string(),
    text: z.string(),
  }),
  
  // 思考过程（Reasoning）- 用于展示 AI 的推理过程
  z.object({
    type: z.literal("reasoning"),
    id: z.string(),
    reasoning: z.string(),
  }),
  
  // 工具调用 - OpenCode 的核心能力
  z.object({
    type: z.literal("tool-invocation"),
    id: z.string(),
    toolInvocation: z.object({
      state: z.enum(["pending", "streaming", "result", "error"]),
      step: z.number().optional(),        // 多步工具调用的步骤号
      toolCallId: z.string(),             // LLM 生成的调用 ID
      toolName: z.string(),               // 工具名称（如 edit、bash）
      args: z.any(),                      // 工具参数
      result: z.any().optional(),         // 执行结果
    }),
  }),
  
  // 步骤开始 - 标记新的推理步骤
  z.object({
    type: z.literal("step-start"),
    id: z.string(),
    step: z.number(),
    time: z.string().datetime(),
  }),
  
  // 文件附件 - 支持多模态输入
  z.object({
    type: z.literal("file"),
    id: z.string(),
    file: z.object({
      name: z.string(),
      mediaType: z.string(),              // MIME 类型
      url: z.string().optional(),         // 文件 URL 或 base64
    }),
  }),
])
```

**工具调用状态流转**：
```
pending → streaming → result (成功)
                   ↘ error (失败)
```

### 2.4 Event（事件）

**源码位置**: `packages/opencode/src/bus/`

**设计理念**：OpenCode 采用 **事件驱动架构**，通过 Bus 实现组件间的解耦通信。插件可以订阅这些事件来响应系统状态变化。

**事件系统特点**：
- **发布-订阅模式**：组件之间不直接依赖，通过事件解耦
- **类型安全**：每个事件都有 Zod Schema 定义的 payload
- **支持通配符**：可以订阅 `*` 接收所有事件

**核心事件分类**：

| 事件类型 | 触发时机 | 插件应用场景 |
|---------|---------|-------------|
| `session.*` | 会话创建/更新/删除 | 会话统计、自动保存 |
| `message.*` | 消息变化 | 日志记录、消息过滤 |
| `message.part.*` | Part 流式更新 | 实时 UI 渲染 |
| `tool.*` | 工具执行前后 | 审计日志、性能监控 |
| `permission.*` | 权限请求/响应 | 自动审批、安全策略 |

```typescript
// OpenCode 事件系统
export namespace Bus {
  // ==================== Session 生命周期事件 ====================
  export const SessionCreated = event("session.created", Session.Info)
  export const SessionUpdated = event("session.updated", Session.Info)
  export const SessionDeleted = event("session.deleted", z.object({ id: z.string() }))
  
  // ==================== Message 事件 ====================
  export const MessageCreated = event("message.created", Message)
  export const MessageUpdated = event("message.updated", Message)
  export const MessagePartCreated = event("message.part.created", Part)  // 流式新 Part
  export const MessagePartUpdated = event("message.part.updated", Part)  // Part 内容更新
  
  // ==================== Tool 执行事件 ====================
  // 工具开始执行时触发，可用于日志、监控
  export const ToolExecuting = event("tool.executing", z.object({
    sessionID: z.string(),
    messageID: z.string(),
    toolName: z.string(),       // 如 "edit", "bash", "read"
    toolCallId: z.string(),
    args: z.any(),              // 工具参数
  }))
  
  // 工具执行完成时触发，包含结果
  export const ToolCompleted = event("tool.completed", z.object({
    sessionID: z.string(),
    messageID: z.string(),
    toolName: z.string(),
    toolCallId: z.string(),
    result: z.any(),            // 执行结果或错误信息
  }))
  
  // ==================== Permission 事件 ====================
  export const PermissionRequested = event("permission.requested", Permission)
  export const PermissionResponded = event("permission.responded", Permission)
}
```

**插件中订阅事件示例**：
```typescript
event: async ({ event }) => {
  if (event.type === "session.created") {
    console.log("新会话创建:", event.properties.id);
  }
  if (event.type === "tool.completed") {
    console.log(`工具 ${event.properties.toolName} 执行完成`);
  }
}
```

---

## 3. 配置系统

OpenCode 采用 **分层配置** 架构，支持从多个来源加载配置并智能合并。这种设计既支持企业统一管理，又允许用户和项目级别的定制。

### 3.1 配置加载优先级

**源码位置**: `packages/opencode/src/config/config.ts`

**设计理念**：配置采用 **层叠覆盖** 策略，高优先级的配置会覆盖低优先级的同名字段。对于数组类型（如 `plugin`、`instructions`），则采用 **合并去重** 策略。

```
配置加载顺序（从低到高优先级）：

┌─────────────────────────────────────────────────────────────┐
│  7. 托管配置 (/etc/opencode/) - 企业管理员控制，最高优先级    │
├─────────────────────────────────────────────────────────────┤
│  6. 插件 config hook 修改 - 插件动态修改配置                 │
├─────────────────────────────────────────────────────────────┤
│  5. OPENCODE_CONFIG_CONTENT - 内联 JSON 配置                │
├─────────────────────────────────────────────────────────────┤
│  4. 项目配置 (./opencode.jsonc) - 项目级别定制              │
├─────────────────────────────────────────────────────────────┤
│  3. OPENCODE_CONFIG 环境变量 - 指定配置文件路径              │
├─────────────────────────────────────────────────────────────┤
│  2. 全局用户配置 (~/.opencode/opencode.jsonc)               │
├─────────────────────────────────────────────────────────────┤
│  1. 远程配置 (well-known) - 组织默认配置，最低优先级         │
└─────────────────────────────────────────────────────────────┘
```

**典型使用场景**：
- **个人开发者**：使用全局配置 + 项目配置
- **团队协作**：项目配置 committed 到 Git，确保团队一致
- **企业部署**：托管配置强制安全策略，用户无法覆盖

### 3.2 配置 Schema

```typescript
// packages/opencode/src/config/config.ts
export const Info = z.object({
  $schema: z.string().optional(),
  
  // ==================== 模型配置 ====================
  model: z.string().optional(),               // 默认模型，格式: provider/model
  small_model: z.string().optional(),         // 小模型（标题生成等）
  default_agent: z.string().optional(),       // 默认 Agent
  
  // ==================== Provider 配置 ====================
  provider: z.record(z.string(), Provider).optional(),
  disabled_providers: z.array(z.string()).optional(),
  enabled_providers: z.array(z.string()).optional(),
  
  // ==================== Agent 配置 ====================
  agent: z.record(z.string(), Agent).optional(),
  
  // ==================== 插件配置 ====================
  plugin: z.string().array().optional(),
  
  // ==================== MCP 配置 ====================
  mcp: z.record(z.string(), Mcp).optional(),
  
  // ==================== 权限配置 ====================
  permission: Permission.optional(),
  
  // ==================== 命令配置 ====================
  command: z.record(z.string(), Command).optional(),
  
  // ==================== 其他配置 ====================
  theme: z.string().optional(),
  keybinds: Keybinds.optional(),
  logLevel: Log.Level.optional(),
  share: z.enum(["manual", "auto", "disabled"]).optional(),
  autoupdate: z.union([z.boolean(), z.literal("notify")]).optional(),
})
```

### 3.3 配置文件示例

```jsonc
// opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  
  // 模型设置
  "model": "anthropic/claude-sonnet-4-20250514",
  "small_model": "openai/gpt-4o-mini",
  "default_agent": "build",
  
  // Provider 配置
  "provider": {
    "openai": {
      "options": {
        "apiKey": "sk-xxx",
        "baseURL": "https://api.openai.com/v1"
      }
    }
  },
  
  // Agent 配置
  "agent": {
    "my-agent": {
      "description": "我的自定义 Agent",
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "你是一个专业的代码助手，擅长编写高质量的代码。请始终遵循最佳实践，注重代码可读性和可维护性。",
      "permission": {
        "*": "allow",
        "bash": "ask"
      }
    }
  },
  
  // 插件
  "plugin": [
    "oh-my-opencode",
    "my-plugin@1.0.0"
  ],
  
  // MCP
  "mcp": {
    "my-mcp": {
      "type": "local",
      "command": ["python", "-m", "my_mcp_server"]
    }
  },
  
  // 权限
  "permission": {
    "bash": "ask",
    "edit": "allow"
  }
}
```

---

## 4. Agent 系统

OpenCode 的 Agent 系统是其核心特性之一，允许定义具有不同能力、权限和行为的 AI 角色。

### 4.1 Agent 定义

**源码位置**: `packages/opencode/src/agent/agent.ts`

**设计理念**：Agent 是一组配置的集合，定义了 AI 的行为边界。通过 Agent，可以：
- **限制能力**：通过 permission 控制可用工具
- **定制行为**：通过 prompt 设置专属系统提示
- **指定模型**：不同 Agent 可以使用不同的 LLM
- **控制参数**：独立的 temperature、topP 等生成参数

**Agent 字段详解**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | Agent 唯一标识符 |
| `description` | string | 描述文本，用于帮助用户选择 |
| `mode` | enum | 运行模式：primary/subagent/all |
| `permission` | Ruleset | 权限规则集，控制工具访问 |
| `model` | object | 指定使用的 Provider/Model |
| `prompt` | string | System Prompt，定义 AI 角色 |
| `temperature` | number | 生成温度（0-2） |
| `steps` | number | 最大推理步数 |
| `hidden` | boolean | 是否在 UI 中隐藏 |

```typescript
export namespace Agent {
  export const Info = z.object({
    name: z.string(),
    description: z.string().optional(),
    mode: z.enum(["subagent", "primary", "all"]),
    native: z.boolean().optional(),           // 是否内置 Agent（不可删除）
    hidden: z.boolean().optional(),           // 是否在菜单中隐藏
    topP: z.number().optional(),              // 采样参数
    temperature: z.number().optional(),       // 生成温度
    color: z.string().optional(),             // 主题色（Hex 格式）
    permission: PermissionNext.Ruleset,       // 权限规则（核心！）
    model: z.object({
      modelID: z.string(),
      providerID: z.string(),
    }).optional(),
    variant: z.string().optional(),           // 模型变体（如 thinking）
    prompt: z.string().optional(),            // System prompt
    options: z.record(z.string(), z.any()),   // Provider 特定选项
    steps: z.number().int().positive().optional(),  // 最大推理步数
  })
}
```

### 4.2 内置 Agent

OpenCode 预置了多个 Agent，各有专门用途。理解它们的设计有助于创建自定义 Agent。

**内置 Agent 一览**：

| Agent | 模式 | 用途 | 关键权限 |
|-------|------|------|---------|
| `build` | primary | 默认开发 Agent，完整能力 | 几乎所有工具 |
| `plan` | primary | 规划模式，只读不写 | 禁止 edit |
| `general` | subagent | 通用子任务执行 | 禁止 todo |
| `explore` | subagent | 快速代码探索 | 只有读取类工具 |
| `title` | hidden | 生成会话标题 | 无工具权限 |
| `summary` | hidden | 生成摘要 | 无工具权限 |
| `compaction` | hidden | 压缩历史上下文 | 无工具权限 |

```typescript
// packages/opencode/src/agent/agent.ts
const result: Record<string, Info> = {
  // ==================== 主 Agent ====================
  // build: 默认 Agent，拥有完整的开发能力
  build: {
    name: "build",
    description: "The default agent. Executes tools based on configured permissions.",
    mode: "primary",
    native: true,
    permission: PermissionNext.merge(defaults, {
      question: "allow",      // 允许向用户提问
      plan_enter: "allow",    // 允许进入 plan 模式
    }, user),
  },
  
  // plan: 规划模式，用于讨论方案而不实际修改代码
  plan: {
    name: "plan",
    description: "Plan mode. Disallows all edit tools.",
    mode: "primary",
    native: true,
    permission: PermissionNext.merge(defaults, {
      question: "allow",
      plan_exit: "allow",     // 允许退出 plan 模式
      edit: { "*": "deny" },  // 关键：禁止所有编辑操作
    }, user),
  },
  
  // ==================== 子 Agent ====================
  // general: 处理复杂的多步骤任务
  general: {
    name: "general",
    description: "General-purpose agent for researching complex questions and executing multi-step tasks.",
    mode: "subagent",
    native: true,
    permission: PermissionNext.merge(defaults, {
      todoread: "deny",       // 子 Agent 不管理 TODO
      todowrite: "deny",
    }, user),
  },
  
  // explore: 专门用于代码探索，只有读取权限
  explore: {
    name: "explore",
    description: "Fast agent specialized for exploring codebases.",
    mode: "subagent",
    native: true,
    permission: PermissionNext.merge(defaults, {
      "*": "deny",            // 默认拒绝所有
      grep: "allow",          // 允许搜索
      glob: "allow",          // 允许文件匹配
      list: "allow",          // 允许列目录
      read: "allow",          // 允许读文件
      bash: "allow",          // 允许执行命令（受限）
      webfetch: "allow",      // 允许网络请求
      websearch: "allow",     // 允许网络搜索
      codesearch: "allow",    // 允许代码搜索
    }, user),
  },
  
  // ==================== 隐藏 Agent（内部使用）====================
  title: { name: "title", mode: "primary", hidden: true, /* 生成标题 */ },
  summary: { name: "summary", mode: "primary", hidden: true, /* 生成摘要 */ },
  compaction: { name: "compaction", mode: "primary", hidden: true, /* 压缩上下文 */ },
}
```

**权限合并机制**：Agent 的权限通过 `PermissionNext.merge()` 合并，顺序为：
1. `defaults` - 系统默认权限
2. Agent 特定权限 - 覆盖默认
3. `user` - 用户配置的权限，最高优先级

### 4.3 Agent 模式

| 模式 | 说明 | 使用场景 |
|------|------|---------|
| `primary` | 主 Agent | 用户可直接选择使用 |
| `subagent` | 子 Agent | 只能被其他 Agent 调用（Task 工具） |
| `all` | 全模式 | 两种场景都支持 |

### 4.4 统一运行时架构

**核心设计**：OpenCode 使用**统一的运行时**执行所有 Agent，Agent 本身只是一组配置参数，而非独立的执行引擎。

```
┌────────────────────────────────────────────────────────────────┐
│                    统一运行时 (SessionPrompt.loop)              │
├────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐                                          │
│  │  Agent 配置加载   │  ← 动态加载 name, prompt, permission     │
│  └────────┬─────────┘                                          │
│           ↓                                                    │
│  ┌──────────────────┐                                          │
│  │  工具列表过滤     │  ← 根据 permission 过滤可用工具          │
│  └────────┬─────────┘                                          │
│           ↓                                                    │
│  ┌──────────────────┐                                          │
│  │  提示词组装       │  ← 模型提示词 + Agent.prompt + 环境信息   │
│  └────────┬─────────┘                                          │
│           ↓                                                    │
│  ┌──────────────────┐                                          │
│  │  LLM 调用        │  ← 使用 Agent.model 或默认模型            │
│  └────────┬─────────┘                                          │
│           ↓                                                    │
│  ┌──────────────────┐                                          │
│  │  工具执行        │  ← 统一的工具执行框架                     │
│  └──────────────────┘                                          │
└────────────────────────────────────────────────────────────────┘
```

**运行时核心代码**：

```typescript
// packages/opencode/src/session/prompt.ts
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  while (true) {
    // 1. 获取当前 Agent 配置（只是配置，不是运行时）
    const agent = await Agent.get(lastUser.agent)
    
    // 2. 根据 Agent 配置解析可用工具列表
    const tools = await resolveTools({
      agent,        // Agent 配置决定哪些工具可用
      session,
      model,
      processor,
      messages: msgs,
    })
    
    // 3. 组装系统提示（统一逻辑 + Agent 专用 prompt）
    const result = await processor.process({
      system: [
        ...await SystemPrompt.environment(model),  // 环境信息
        ...await InstructionPrompt.system(),       // 指令文件
      ],
      tools,    // 根据权限过滤后的工具
      model,    // Agent.model 或默认模型
      agent,    // Agent 配置
    })
  }
})
```

**关键理解**：

| 概念 | 说明 |
|------|------|
| **统一运行时** | `SessionPrompt.loop` 是唯一的执行引擎，所有 Agent 共用 |
| **Agent 是配置** | Agent 只定义：prompt、model、permission、temperature 等参数 |
| **动态加载** | 运行时根据 Agent 配置动态决定工具列表、模型、提示词 |
| **权限驱动** | Agent 之间的主要差异在于工具权限，而非执行逻辑 |

**这意味着**：
- 创建新 Agent 只需定义配置，无需编写执行逻辑
- 插件可以通过 `config` hook 动态注入 Agent 配置
- 所有 Agent 共享相同的工具执行框架和消息处理流程

---

## 5. 工具系统

工具（Tool）是 OpenCode 的核心能力载体，让 AI 能够与外部世界交互。每个工具都是一个独立的功能单元，由 LLM 决定何时调用。

### 5.1 工具定义

**源码位置**: `packages/opencode/src/tool/tool.ts`

**设计理念**：工具采用 **声明式定义**，包含三个核心部分：
1. **description**：LLM 根据描述决定何时使用此工具
2. **parameters**：Zod Schema 定义参数，自动生成 JSON Schema 给 LLM
3. **execute**：实际执行逻辑，返回结果给 LLM

**工具执行流程**：
```
LLM 决定调用工具 → 生成参数 → 权限检查(ask) → 执行(execute) → 返回结果 → LLM 继续推理
```

```typescript
export namespace Tool {
  export function define<T extends z.ZodRawShape>(
    id: string,
    config: {
      description: string                     // 工具描述（关键！LLM 依赖这个决定是否调用）
      parameters: z.ZodObject<T>              // 参数 Schema
      execute: (
        params: z.infer<z.ZodObject<T>>,      // 类型安全的参数
        context: ToolContext                   // 执行上下文
      ) => Promise<{ output: string; title: string; metadata: any }>
    }
  ) {
    return { id, ...config }
  }
}

// 工具执行上下文 - 提供工具运行时需要的所有信息
export type ToolContext = {
  sessionID: string           // 当前会话 ID
  messageID: string           // 当前消息 ID
  agent: string               // 当前 Agent ID
  directory: string           // 当前工作目录
  worktree: string            // Git worktree 根目录
  abort: AbortSignal          // 取消信号（用户中断时触发）
  metadata(input: { title?: string; metadata?: any }): void  // 更新工具显示信息
  ask(input: AskInput): Promise<void>  // 请求用户权限（核心！）
}
```

**`ctx.ask()` 权限请求机制**：
- 工具执行敏感操作前必须调用 `ask()` 请求权限
- 权限可以配置为 `allow`（自动通过）、`ask`（弹窗询问）、`deny`（自动拒绝）
- 这是 OpenCode 安全模型的核心

### 5.2 内置工具列表

**源码位置**: `packages/opencode/src/tool/registry.ts`

OpenCode 提供了丰富的内置工具，覆盖代码开发的各个环节。

**工具分类说明**：

| 分类 | 工具 | 用途 | 危险等级 |
|------|------|------|---------|
| **读取类** | grep, glob, list, read | 搜索和读取代码 | 低 |
| **修改类** | edit, patch, write | 修改文件内容 | 高 |
| **执行类** | bash | 执行 Shell 命令 | 高 |
| **协作类** | task | 委派子任务给 subagent | 中 |
| **交互类** | question, todo* | 与用户交互 | 低 |
| **网络类** | webfetch, websearch, codesearch | 网络请求 | 中 |
| **辅助类** | lsp_hover | IDE 集成 | 低 |

```typescript
// 核心工具 - 每个工具都是独立的功能单元
const CORE_TOOLS = [
  GrepTool,        // 基于正则的代码搜索（类似 ripgrep）
  GlobTool,        // 文件路径匹配（支持通配符）
  ListTool,        // 列出目录内容
  ReadTool,        // 读取文件内容（支持行范围）
  EditTool,        // 编辑文件（字符串替换）
  PatchTool,       // 应用 unified diff 格式的补丁
  BashTool,        // 执行 Shell 命令（最危险的工具！）
  TaskTool,        // 创建子任务，委派给 subagent 执行
  TodoWriteTool,   // 写入/更新 TODO 列表
  TodoReadTool,    // 读取当前 TODO 状态
  QuestionTool,    // 向用户提问（阻塞等待回答）
  LspHoverTool,    // 获取 LSP hover 信息（类型定义等）
]

// 网络工具 - 需要网络访问权限
const NETWORK_TOOLS = [
  WebFetchTool,    // 获取网页内容（HTML → Markdown）
  WebSearchTool,   // 网络搜索（返回摘要结果）
  CodeSearchTool,  // 代码搜索（通过 Exa API 搜索文档/示例）
]
```

**工具来源优先级**：
1. **内置工具**（CORE_TOOLS + NETWORK_TOOLS）- 始终可用
2. **目录工具**（`.opencode/tool/*.ts`）- 项目/用户级自定义
3. **插件工具**（plugin.tool）- 插件动态注册

工具名称冲突时，后加载的覆盖先加载的。

### 5.3 工具示例（Edit 工具）

```typescript
// packages/opencode/src/tool/edit.ts
export const EditTool = Tool.define("edit", {
  description: DESCRIPTION,  // 从 edit.txt 加载详细描述
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().describe("The text to replace"),
    new_string: z.string().describe("The replacement text"),
    replace_all: z.boolean().optional().describe("Replace all occurrences"),
  }),
  async execute(params, ctx) {
    // 请求权限
    await ctx.ask({
      permission: "edit",
      patterns: [params.path],
    })
    
    // 读取文件
    const content = await Bun.file(params.path).text()
    
    // 替换内容
    let newContent: string
    if (params.replace_all) {
      newContent = content.replaceAll(params.old_string, params.new_string)
    } else {
      newContent = content.replace(params.old_string, params.new_string)
    }
    
    // 写入文件
    await Bun.write(params.path, newContent)
    
    return {
      output: `File edited: ${params.path}`,
      title: `Edit ${params.path}`,
      metadata: { path: params.path },
    }
  },
})
```

---

## 6. Provider 系统

Provider 是 OpenCode 与 LLM 服务之间的桥梁。OpenCode 基于 **Vercel AI SDK**，支持市面上几乎所有主流 LLM 服务。

### 6.1 Provider 架构

**源码位置**: `packages/opencode/src/provider/provider.ts`

**设计理念**：
- **统一接口**：所有 Provider 都实现相同的 AI SDK 接口
- **自动发现**：根据环境变量自动启用可用的 Provider
- **可扩展**：支持通过配置或插件添加新 Provider

**Provider 加载流程**：
```
1. 从 models.dev 获取 Provider/Model 元数据
2. 检查环境变量（如 OPENAI_API_KEY）确定可用 Provider
3. 加载对应的 AI SDK（如 @ai-sdk/openai）
4. 应用用户配置（options、whitelist、blacklist）
```

**内置 Provider 列表**：

| Provider | AI SDK | 典型模型 |
|----------|--------|---------|
| Anthropic | @ai-sdk/anthropic | Claude 系列 |
| OpenAI | @ai-sdk/openai | GPT-4o, o1 |
| Google | @ai-sdk/google | Gemini 系列 |
| Azure | @ai-sdk/azure | Azure OpenAI |
| AWS Bedrock | @ai-sdk/amazon-bedrock | Claude, Titan |
| Groq | @ai-sdk/groq | Llama, Mixtral |
| xAI | @ai-sdk/xai | Grok |
| OpenRouter | @openrouter/ai-sdk-provider | 聚合多家模型 |

```typescript
// 内置 AI SDK Provider - 直接打包，无需运行时安装
const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
  "@ai-sdk/amazon-bedrock": createAmazonBedrock,    // AWS Bedrock
  "@ai-sdk/anthropic": createAnthropic,              // Anthropic (Claude)
  "@ai-sdk/azure": createAzure,                      // Azure OpenAI
  "@ai-sdk/google": createGoogleGenerativeAI,        // Google AI (Gemini)
  "@ai-sdk/google-vertex": createVertex,             // Google Vertex AI
  "@ai-sdk/google-vertex/anthropic": createVertexAnthropic,  // Vertex Claude
  "@ai-sdk/openai": createOpenAI,                    // OpenAI 官方
  "@ai-sdk/openai-compatible": createOpenAICompatible, // 兼容接口（vLLM/TGI）
  "@openrouter/ai-sdk-provider": createOpenRouter,   // OpenRouter 聚合
  "@ai-sdk/xai": createXai,                          // xAI (Grok)
  "@ai-sdk/mistral": createMistral,                  // Mistral AI
  "@ai-sdk/groq": createGroq,                        // Groq (超快推理)
  "@ai-sdk/deepinfra": createDeepInfra,              // DeepInfra
  "@ai-sdk/cerebras": createCerebras,                // Cerebras
  "@ai-sdk/cohere": createCohere,                    // Cohere
  "@ai-sdk/gateway": createGateway,                  // AI Gateway
  "@ai-sdk/togetherai": createTogetherAI,            // Together AI
  "@ai-sdk/perplexity": createPerplexity,            // Perplexity
  "@ai-sdk/vercel": createVercel,                    // Vercel AI
  "@gitlab/gitlab-ai-provider": createGitLab,        // GitLab AI
  "@ai-sdk/github-copilot": createGitHubCopilotOpenAICompatible, // GitHub Copilot
}
```

**关键设计**：`@ai-sdk/openai-compatible` 是万能适配器，任何兼容 OpenAI API 的服务（vLLM、TGI、Ollama、LocalAI）都可以通过它接入。

### 6.2 模型数据来源

```typescript
// packages/opencode/src/provider/models.ts
export namespace ModelsDev {
  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),  // 环境变量名，如 ["OPENAI_API_KEY"]
    id: z.string(),
    npm: z.string().optional(), // AI SDK 包名
    models: z.record(z.string(), Model),
  })
  
  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    attachment: z.boolean(),      // 是否支持附件
    reasoning: z.boolean(),       // 是否支持推理
    tool_call: z.boolean(),       // 是否支持工具调用
    cost: z.object({
      input: z.number(),
      output: z.number(),
    }).optional(),
    limit: z.object({
      context: z.number(),
      output: z.number(),
    }),
  })
  
  // 从 https://models.dev/api.json 获取模型数据
  // 本地缓存在 ~/.cache/opencode/models.json
}
```

---

## 7. MCP 系统

### 7.1 MCP 配置类型

**源码位置**: `packages/opencode/src/config/config.ts`

```typescript
// 本地 MCP Server（stdio）
export const McpLocal = z.object({
  type: z.literal("local"),
  command: z.string().array(),       // 启动命令
  environment: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  timeout: z.number().optional(),    // 超时时间（毫秒）
})

// 远程 MCP Server（SSE）
export const McpRemote = z.object({
  type: z.literal("remote"),
  url: z.string(),                   // SSE URL
  enabled: z.boolean().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  oauth: z.union([McpOAuth, z.literal(false)]).optional(),
  timeout: z.number().optional(),
})
```

### 7.2 MCP 配置示例

```jsonc
{
  "mcp": {
    // 本地 MCP Server
    "my-local-mcp": {
      "type": "local",
      "command": ["python", "-m", "my_mcp_server"],
      "environment": {
        "API_KEY": "xxx"
      },
      "timeout": 30000
    },
    
    // 远程 MCP Server
    "my-remote-mcp": {
      "type": "remote",
      "url": "https://my-mcp-server.com/sse",
      "headers": {
        "Authorization": "Bearer xxx"
      }
    }
  }
}
```

---

## 8. HTTP Server

### 8.1 Server 架构

**源码位置**: `packages/opencode/src/server/server.ts`

```typescript
// 使用 Hono 框架
const app = new Hono()
  // 错误处理
  .onError((err, c) => {
    if (err instanceof NamedError) {
      let status: ContentfulStatusCode
      if (err instanceof Storage.NotFoundError) status = 404
      else if (err instanceof Provider.ModelNotFoundError) status = 400
      else status = 500
      return c.json(err.toObject(), { status })
    }
    return c.json(new NamedError.Unknown({ message: err.toString() }).toObject(), { status: 500 })
  })
  // Basic Auth 中间件（可选）
  .use((c, next) => {
    const password = Flag.OPENCODE_SERVER_PASSWORD
    if (!password) return next()
    const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
    return basicAuth({ username, password })(c, next)
  })
  // 请求日志
  .use(async (c, next) => {
    log.info("request", { method: c.req.method, path: c.req.path })
    await next()
  })
  // CORS 中间件
  .use(cors({
    origin(input) {
      if (!input) return
      if (input.startsWith("http://localhost:")) return input
      if (input.startsWith("http://127.0.0.1:")) return input
      if (input === "tauri://localhost") return input
      if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) return input
      return
    },
  }))
  // 路由
  .route("/global", GlobalRoutes())
  .route("/project", ProjectRoutes())
  .route("/session", SessionRoutes())
  .route("/provider", ProviderRoutes())
  .route("/mcp", McpRoutes())
  .route("/config", ConfigRoutes())
  .route("/file", FileRoutes())
  .route("/pty", PtyRoutes())
  .route("/question", QuestionRoutes())
  .route("/permission", PermissionRoutes())
  .route("/experimental", ExperimentalRoutes())
```

### 8.2 主要 API 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/session` | GET | 列出所有会话 |
| `/session/:id` | GET | 获取会话详情 |
| `/session/:id/message` | POST | 发送消息 |
| `/provider` | GET | 列出所有 Provider |
| `/provider/:id/models` | GET | 获取 Provider 的模型列表 |
| `/agent` | GET | 列出所有 Agent |
| `/mcp` | GET | 列出所有 MCP Server |
| `/event` | GET | SSE 事件订阅 |
| `/config` | GET | 获取配置 |

---

# 第二部分：插件系统详解

OpenCode 的插件系统是其可扩展性的核心。通过插件，开发者可以：
- 添加新工具（tool）
- 修改配置（config hook）
- 响应事件（event hook）
- 拦截/修改行为（各种 hook）
- 提供自定义认证（auth hook）

## 9. 插件类型定义

### 9.1 Plugin 类型

**源码位置**: `packages/plugin/src/index.ts`

**设计理念**：插件采用 **工厂模式**，是一个接收上下文、返回 Hooks 的异步函数。这种设计允许：
- 插件初始化时访问 OpenCode 环境信息
- 插件之间相互独立，互不干扰
- 支持异步初始化（如网络请求、数据库连接）

**PluginInput 字段详解**：

| 字段 | 类型 | 用途 |
|------|------|------|
| `client` | OpencodeClient | 调用 OpenCode API（创建会话、发送消息等） |
| `project` | Project | 项目元信息（名称、路径） |
| `directory` | string | 用户当前工作目录 |
| `worktree` | string | Git 仓库根目录 |
| `serverUrl` | URL | OpenCode HTTP 服务地址 |
| `$` | BunShell | 执行 Shell 命令的便捷工具 |

```typescript
// 插件输入：OpenCode 传给插件的上下文
export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>  // OpenCode 客户端 API
  project: Project                                  // 项目信息
  directory: string                                 // 当前工作目录
  worktree: string                                  // Git worktree 根目录
  serverUrl: URL                                    // OpenCode 服务 URL
  $: BunShell                                       // Bun shell 工具（Bun.$ 的类型）
}

// 插件类型：一个返回 Hooks 的异步函数
export type Plugin = (input: PluginInput) => Promise<Hooks>
```

**插件生命周期**：
```
1. OpenCode 启动
2. 加载配置，发现插件列表
3. 依次初始化每个插件（调用 Plugin 函数）
4. 收集所有 Hooks
5. 运行时触发相应 Hook
```

### 9.2 Hooks 完整定义

Hooks 是插件与 OpenCode 交互的主要方式。每个 Hook 都是可选的，插件只需实现需要的 Hook。

**Hook 分类与用途**：

| Hook 类型 | 触发时机 | 典型用途 |
|----------|---------|---------|
| `config` | 配置加载后 | 动态注入 Agent、MCP、命令 |
| `event` | 任何事件发生 | 日志、统计、通知 |
| `tool` | 注册时（非触发） | 提供自定义工具 |
| `auth` | 认证时 | 自定义 Provider 认证流程 |
| `chat.message` | 用户发消息 | 消息预处理、关键词检测 |
| `chat.params` | LLM 调用前 | 修改 temperature 等参数 |
| `tool.execute.*` | 工具执行前后 | 审计、日志、结果修改 |
| `permission.ask` | 权限请求时 | 自动审批策略 |

**Hook 执行顺序**：多个插件的同名 Hook 按插件加载顺序依次执行，前一个插件的修改会传递给下一个。

```typescript
export interface Hooks {
  // ==================== 配置相关 ====================
  // 配置加载完成后调用，可以直接修改 config 对象
  // 用途：动态添加 Agent、MCP Server、Commands 等
  config?: (input: Config) => Promise<void>
  
  // ==================== 事件相关 ====================
  // 接收所有 OpenCode 事件（session.created、tool.completed 等）
  // 用途：日志记录、状态同步、通知推送
  event?: (input: { event: Event }) => Promise<void>
  
  // ==================== 工具相关 ====================
  // 插件提供的工具集合（不是 Hook，而是静态定义）
  // 用途：扩展 AI 的能力（如搜索、API 调用等）
  tool?: {
    [key: string]: ToolDefinition
  }
  
  // ==================== 认证相关 ====================
  // 为自定义 Provider 提供认证方式
  // 用途：支持 OAuth、API Key 等认证流程
  auth?: AuthHook
  
  // ==================== 聊天相关 ====================
  // 用户发送消息时触发（消息到达 LLM 前）
  "chat.message"?: (
    input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
      messageID?: string
      variant?: string
    },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>
  
  // 修改发送给 LLM 的参数
  "chat.params"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
  ) => Promise<void>
  
  // 修改请求头
  "chat.headers"?: (
    input: { sessionID: string; agent: string; model: Model; provider: ProviderContext; message: UserMessage },
    output: { headers: Record<string, string> },
  ) => Promise<void>
  
  // ==================== 权限相关 ====================
  "permission.ask"?: (input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>
  
  // ==================== 命令相关 ====================
  "command.execute.before"?: (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Part[] },
  ) => Promise<void>
  
  // ==================== 工具执行相关 ====================
  // 工具执行前，可以修改参数
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  
  // 工具执行后，可以修改输出
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: any },
  ) => Promise<void>
  
  // ==================== 实验性功能 ====================
  "experimental.chat.messages.transform"?: (
    input: {},
    output: { messages: { info: Message; parts: Part[] }[] },
  ) => Promise<void>
  
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: { system: string[] },
  ) => Promise<void>
  
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
}
```

### 9.3 Tool 定义辅助函数

**源码位置**: `packages/plugin/src/tool.ts`

```typescript
import { z } from "zod"

// 工具执行上下文
export type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string
  worktree: string
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: any }): void
  ask(input: AskInput): Promise<void>
}

// 定义工具的辅助函数
export function tool<Args extends z.ZodRawShape>(input: {
  description: string
  args: Args
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string>
}) {
  return input
}
tool.schema = z  // 暴露 zod 给插件使用

export type ToolDefinition = ReturnType<typeof tool>
```

---

## 10. 插件加载机制

### 10.1 加载流程

**源码位置**: `packages/opencode/src/plugin/index.ts`

```typescript
export namespace Plugin {
  // 内置插件
  const BUILTIN = ["opencode-anthropic-auth@0.0.13", "@gitlab/opencode-gitlab-auth@1.3.2"]
  const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin]

  const state = Instance.state(async () => {
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      fetch: async (...args) => Server.App().fetch(...args),
    })
    const config = await Config.get()
    const hooks: Hooks[] = []
    
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      serverUrl: Server.url(),
      $: Bun.$,
    }

    // 1. 加载内部插件
    for (const plugin of INTERNAL_PLUGINS) {
      const init = await plugin(input)
      hooks.push(init)
    }

    // 2. 加载配置中的插件
    const plugins = [...(config.plugin ?? [])]
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins.push(...BUILTIN)
    }

    for (let plugin of plugins) {
      // npm 包需要先安装
      if (!plugin.startsWith("file://")) {
        const lastAtIndex = plugin.lastIndexOf("@")
        const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
        const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
        plugin = await BunProc.install(pkg, version)
      }
      
      // 动态导入插件
      const mod = await import(plugin)
      
      // 调用所有导出的函数
      for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
        const init = await fn(input)
        hooks.push(init)
      }
    }

    return { hooks, input }
  })
}
```

### 10.2 Hooks 触发机制

```typescript
// packages/opencode/src/plugin/index.ts
export async function trigger<Name, Input, Output>(
  name: Name, 
  input: Input, 
  output: Output
): Promise<Output> {
  if (!name) return output
  for (const hook of await state().then((x) => x.hooks)) {
    const fn = hook[name]
    if (!fn) continue
    await fn(input, output)  // 前一个插件的修改会传给下一个
  }
  return output
}
```

### 10.3 加载流程图

```
OpenCode 启动
    │
    ▼
Config.get() 读取配置
    │
    ▼
Plugin.state() 初始化
    │
    ├─▶ 加载内部插件 (CodexAuthPlugin, CopilotAuthPlugin)
    │
    ├─▶ 遍历 config.plugin 数组
    │       │
    │       ├─▶ npm 包 → BunProc.install() 安装
    │       │
    │       └─▶ import(plugin) 动态导入
    │               │
    │               └─▶ 调用导出函数，传入 PluginInput
    │                       │
    │                       └─▶ 收集返回的 Hooks
    │
    ▼
Plugin.init() 初始化
    │
    ├─▶ 调用所有 hook.config?.(config)
    │
    └─▶ 订阅事件 → 转发给 hook.event
```

---

## 11. 编写插件

### 11.1 最简单的插件

```typescript
import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

const MyPlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
  console.log("插件加载中...", { directory: ctx.directory });

  return {
    // 注册工具
    tool: {
      my_hello: tool({
        description: "向用户打招呼",
        args: {
          name: tool.schema.string().describe("用户名"),
        },
        async execute(args, context) {
          return `你好，${args.name}！当前目录: ${context.directory}`;
        },
      }),
    },

    // 修改配置
    config: async (config) => {
      config.agent = {
        ...config.agent,
        "my-agent": {
          description: "我的自定义 Agent",
          mode: "primary",
          prompt: "你是一个友好的助手。",
          permission: { "*": "allow" },
        },
      };
    },

    // 监听事件
    event: async ({ event }) => {
      if (event.type === "session.created") {
        console.log("新会话:", event.properties);
      }
    },
  };
};

export default MyPlugin;
```

### 11.2 Hooks 触发时机

| Hook | 触发时机 | 用途 |
|------|----------|------|
| `config` | 插件初始化时 | 修改全局配置（Agent、MCP、权限等） |
| `event` | 任何 OpenCode 事件 | 响应 session、message 等事件 |
| `tool` | 注册时（非回调） | 提供自定义工具 |
| `auth` | 认证时 | 提供自定义 Provider 认证 |
| `chat.message` | 用户发送消息时 | 检测关键词、修改消息 |
| `chat.params` | 请求 LLM 前 | 修改 temperature、topP 等参数 |
| `chat.headers` | 请求 LLM 前 | 修改请求头 |
| `tool.execute.before` | 工具执行前 | 修改工具参数 |
| `tool.execute.after` | 工具执行后 | 修改工具输出 |
| `permission.ask` | 请求权限时 | 自动批准/拒绝权限 |

---

## 12. oh-my-opencode 案例分析

### 12.1 项目结构

```
oh-my-opencode/
├── src/
│   ├── index.ts              # 插件入口
│   ├── plugin-handlers/
│   │   └── config-handler.ts # 配置处理（注入 Agent）
│   ├── tools/                # 自定义工具
│   │   ├── index.ts          # 工具导出
│   │   ├── delegate-task/    # 任务委派
│   │   ├── interactive-bash/ # 交互式 Bash
│   │   ├── call-omo-agent/   # Agent 调用
│   │   ├── background-task/  # 后台任务
│   │   ├── session-manager/  # 会话管理
│   │   ├── skill/            # 技能工具
│   │   ├── skill-mcp/        # MCP 技能
│   │   ├── grep/             # 搜索工具
│   │   ├── glob/             # 文件匹配
│   │   ├── lsp/              # LSP 工具
│   │   ├── look-at/          # 文件查看
│   │   └── ast-grep/         # AST 搜索
│   ├── agents/               # Agent 定义
│   ├── features/             # 功能模块
│   ├── hooks/                # Hook 实现
│   └── shared/               # 共享工具
└── package.json
```

### 12.2 入口文件分析

```typescript
// oh-my-opencode/src/index.ts
const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  // 加载配置
  const pluginConfig = loadPluginConfig(ctx.directory, ctx);
  
  // 创建功能模块
  const backgroundManager = new BackgroundManager(ctx, pluginConfig.background_task);
  const callOmoAgent = createCallOmoAgent(ctx, backgroundManager);
  const delegateTask = createDelegateTask({ manager: backgroundManager, client: ctx.client });
  const configHandler = createConfigHandler({ ctx, pluginConfig });

  return {
    // 工具
    tool: {
      ...builtinTools,
      call_omo_agent: callOmoAgent,
      delegate_task: delegateTask,
      interactive_bash,
      look_at: createLookAt(ctx),
      skill: createSkillTool(ctx),
      skill_mcp: createSkillMcpTool(ctx),
      slashcommand: createSlashcommandTool(ctx),
      task: createTask(ctx),
      ...createBackgroundTools(backgroundManager),
    },

    // 配置
    config: configHandler,

    // 事件
    event: async (input) => {
      await autoUpdateChecker?.event(input);
      await claudeCodeHooks.event(input);
      await sessionNotification?.event(input);
      await sessionRecovery?.event(input);
      await contextWindowMonitor?.event(input);
    },

    // 消息处理
    "chat.message": async (input, output) => {
      await keywordDetector?.["chat.message"]?.(input, output);
      await autoSlashCommand?.["chat.message"]?.(input, output);
      await agentUsageReminder?.["chat.message"]?.(input, output);
      await firstMessageVariantGate?.["chat.message"]?.(input, output);
    },

    // 工具执行
    "tool.execute.before": async (input, output) => {
      await rulesInjector?.["tool.execute.before"]?.(input, output);
      await directoryAgentsInjector?.["tool.execute.before"]?.(input, output);
      await directoryReadmeInjector?.["tool.execute.before"]?.(input, output);
    },

    "tool.execute.after": async (input, output) => {
      await toolOutputTruncator?.["tool.execute.after"](input, output);
      await commentChecker?.["tool.execute.after"]?.(input, output);
      await emptyTaskResponseDetector?.["tool.execute.after"]?.(input, output);
    },
  };
};
```

### 12.3 Agent 注入逻辑

```typescript
// oh-my-opencode/src/plugin-handlers/config-handler.ts
export function createConfigHandler(deps: ConfigHandlerDeps) {
  return async (config: Record<string, unknown>) => {
    // 1. 创建内置 Agent
    const builtinAgents = await createBuiltinAgents({
      ctx: deps.ctx,
      pluginConfig: deps.pluginConfig,
      skills: deps.skills,
    });

    // 2. 加载用户/项目 Agent
    const userAgents = loadUserAgents(deps.ctx.directory);
    const projectAgents = loadProjectAgents(deps.ctx.directory);

    // 3. 处理 Sisyphus Agent（oh-my-opencode 的主 Agent）
    if (isSisyphusEnabled && builtinAgents.sisyphus) {
      config.default_agent = "sisyphus";
      
      config.agent = {
        sisyphus: builtinAgents.sisyphus,
        "sisyphus-junior": createSisyphusJuniorAgent(),
        prometheus: createPrometheusAgent(),  // 规划 Agent
        ...userAgents,
        ...projectAgents,
        // 将原 build 改为 subagent
        build: { ...migratedBuild, mode: "subagent", hidden: true },
      };
    }

    // 4. 配置 MCP
    config.mcp = {
      ...createBuiltinMcps(),
      ...config.mcp,
    };

    // 5. 配置命令
    config.command = {
      ...builtinCommands,
      ...userCommands,
      ...projectCommands,
    };
  };
}
```

### 12.4 插件集成与生效机制

**oh-my-opencode 是如何被 OpenCode 加载并生效的？**

#### 12.4.1 安装与加载流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        oh-my-opencode 集成流程                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 用户配置 opencode.jsonc                                              │
│     ┌────────────────────────────────────────────┐                      │
│     │ {                                          │                      │
│     │   "plugin": ["oh-my-opencode@latest"]      │  ← 声明插件依赖       │
│     │ }                                          │                      │
│     └────────────────────────────────────────────┘                      │
│                         │                                               │
│                         ▼                                               │
│  2. OpenCode 启动时加载插件                                               │
│     ┌────────────────────────────────────────────┐                      │
│     │ // packages/opencode/src/plugin/index.ts   │                      │
│     │ for (let plugin of plugins) {              │                      │
│     │   // npm 包自动安装                         │                      │
│     │   plugin = await BunProc.install(pkg, ver) │  ← 自动 npm install  │
│     │   const mod = await import(plugin)         │  ← 动态导入          │
│     │   const init = await fn(input)             │  ← 调用插件函数       │
│     │   hooks.push(init)                         │  ← 收集 Hooks        │
│     │ }                                          │                      │
│     └────────────────────────────────────────────┘                      │
│                         │                                               │
│                         ▼                                               │
│  3. 插件返回 Hooks 对象                                                   │
│     ┌────────────────────────────────────────────┐                      │
│     │ return {                                   │                      │
│     │   tool: { ... },      // 注册工具          │                      │
│     │   config: fn,         // 修改配置          │                      │
│     │   event: fn,          // 监听事件          │                      │
│     │   "chat.message": fn, // 处理消息          │                      │
│     │   "tool.execute.before": fn,              │                      │
│     │   "tool.execute.after": fn,               │                      │
│     │ }                                          │                      │
│     └────────────────────────────────────────────┘                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 12.4.2 各 Hook 生效时机

oh-my-opencode 通过多个 Hook 介入 OpenCode 的运行：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Hook 触发时机图                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  用户发送消息                                                            │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────┐                                                    │
│  │ chat.message    │  ← oh-my-opencode 检测 @关键词、自动斜杠命令        │
│  │ Hook            │     keywordDetector, autoSlashCommand              │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │ config Hook     │  ← oh-my-opencode 注入 Agent、MCP、Command          │
│  │ (初始化时触发)   │     configHandler: 注入 sisyphus 等 Agent          │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │ Agent.get()     │  ← 获取 sisyphus Agent 配置                         │
│  │ 加载 Agent 配置  │     (由 config hook 注入)                          │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │ resolveTools()  │  ← 合并内置工具 + oh-my-opencode 注册的工具         │
│  │ 解析可用工具     │     call_omo_agent, delegate_task, skill 等        │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │ LLM 推理        │  ← 使用 sisyphus Agent 的 prompt 和 model          │
│  │ (SessionPrompt) │                                                    │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼  LLM 决定调用工具                                            │
│  ┌─────────────────┐                                                    │
│  │ tool.execute    │  ← oh-my-opencode 注入规则、目录 Agent              │
│  │ .before Hook    │     rulesInjector, directoryAgentsInjector         │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │ 工具执行        │  ← 可能是 oh-my-opencode 的工具                     │
│  │ (内置或插件)    │     如 call_omo_agent, delegate_task               │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │ tool.execute    │  ← oh-my-opencode 截断输出、检查注释               │
│  │ .after Hook     │     toolOutputTruncator, commentChecker            │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐                                                    │
│  │ event Hook      │  ← oh-my-opencode 监听会话事件                      │
│  │ (事件总线)      │     sessionNotification, sessionRecovery           │
│  └─────────────────┘                                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 12.4.3 关键集成点详解

**1. config Hook - Agent 注入**

这是 oh-my-opencode 最核心的集成点，通过修改配置对象注入自定义 Agent：

```typescript
// oh-my-opencode 的 config hook 做了什么
config: async (config) => {
  // 注入 Agent（这些 Agent 会出现在 Agent.list() 中）
  config.agent = {
    sisyphus: { name: "sisyphus", prompt: "...", mode: "primary" },
    prometheus: { name: "prometheus", prompt: "...", mode: "primary" },
    // ...
  };
  
  // 设置默认 Agent（用户启动时默认使用 sisyphus）
  config.default_agent = "sisyphus";
  
  // 注入 MCP 服务器
  config.mcp = { /* ... */ };
  
  // 注入斜杠命令
  config.command = { /* ... */ };
}
```

#### 12.4.4 Agent 调用的实际原理（重要）

> **核心理解**：oh-my-opencode 注入的 Agent（sisyphus、prometheus 等）**只是配置对象**，
> **不是独立的执行体**。Agent 的实际执行由 OpenCode 的统一运行时完成。

**Agent 调用流程解析**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│              oh-my-opencode Agent 调用原理                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  用户选择 Agent: "sisyphus"                                              │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Agent.get("sisyphus")                                          │   │
│  │  返回的是一个配置对象：                                           │   │
│  │  {                                                              │   │
│  │    name: "sisyphus",                                            │   │
│  │    prompt: "你是 Sisyphus，一个高级编程助手...",                  │   │
│  │    model: { providerID: "anthropic", modelID: "claude-..." },   │   │
│  │    permission: { edit: "allow", bash: "allow", ... },           │   │
│  │    mode: "primary",                                             │   │
│  │  }                                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       │  这只是配置！不是可执行代码！                                     │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  OpenCode 统一运行时 (SessionPrompt.loop)                        │   │
│  │                                                                 │   │
│  │  // packages/opencode/src/session/prompt.ts                     │   │
│  │  export const loop = fn(Identifier.schema("session"), async (sessionID) => {
│  │    while (true) {                                               │   │
│  │      const agent = await Agent.get(lastUser.agent)  // 获取配置  │   │
│  │                                                                 │   │
│  │      // 根据 Agent 配置组装系统提示词                             │   │
│  │      const system = [                                           │   │
│  │        ...await SystemPrompt.environment(model),                │   │
│  │        ...await InstructionPrompt.system(),                     │   │
│  │        agent.prompt,  // ← sisyphus 的 prompt 被插入这里          │   │
│  │      ]                                                          │   │
│  │                                                                 │   │
│  │      // 根据 Agent 权限过滤可用工具                               │   │
│  │      const tools = await resolveTools({                         │   │
│  │        agent,  // ← sisyphus 的 permission 用于过滤工具           │   │
│  │        session, model, processor, messages                      │   │
│  │      })                                                         │   │
│  │                                                                 │   │
│  │      // 调用 LLM（使用 Agent 指定的 model）                       │   │
│  │      const result = await processor.process({                   │   │
│  │        system,                                                  │   │
│  │        messages,                                                │   │
│  │        tools,                                                   │   │
│  │        model: agent.model ?? defaultModel,  // ← 使用配置的模型  │   │
│  │        agent,                                                   │   │
│  │      })                                                         │   │
│  │                                                                 │   │
│  │      // 执行工具（由 OpenCode 执行，不是 sisyphus 执行）           │   │
│  │      for (const toolCall of result.toolCalls) {                 │   │
│  │        await Tool.execute(toolCall)  // OpenCode 的工具执行      │   │
│  │      }                                                          │   │
│  │    }                                                            │   │
│  │  })                                                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键结论**：

| 方面 | 说明 |
|------|------|
| **Agent 本质** | 配置对象（prompt + model + permission），不是执行代码 |
| **执行主体** | OpenCode 的 `SessionPrompt.loop`，不是 Agent 本身 |
| **prompt 作用** | 被插入到系统提示词中，影响 LLM 的行为风格 |
| **permission 作用** | 用于过滤可用工具列表，控制 Agent 能做什么 |
| **model 作用** | 指定使用的 LLM 模型，可选 |
| **工具执行** | 由 OpenCode 统一执行，Agent 只是决定哪些工具可用 |

**sisyphus 与 build 的区别**：

```typescript
// 内置 Agent: build
{
  name: "build",
  prompt: "You are an expert software engineer...",
  permission: { edit: "allow", bash: "allow" },
  mode: "primary",
}

// oh-my-opencode Agent: sisyphus  
{
  name: "sisyphus",
  prompt: "你是 Sisyphus，一个永不放弃的编程助手...", // 不同的提示词
  permission: { edit: "allow", bash: "allow", mcp: "allow" }, // 可能有更多权限
  mode: "primary",
  // 可能指定不同的 model
}

// 它们的区别只在配置，执行逻辑完全一样：
// 都是 SessionPrompt.loop 读取配置 → 组装 prompt → 调用 LLM → 执行工具
```

**为什么不是独立运行态？**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  oh-my-opencode 的 sisyphus 不是独立运行态                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ sisyphus 没有自己的执行循环                                          │
│  ❌ sisyphus 没有自己的工具调用逻辑                                       │
│  ❌ sisyphus 没有自己的上下文管理                                         │
│  ❌ sisyphus 没有自己的子 Agent 调度                                      │
│                                                                         │
│  ✅ sisyphus 只是告诉 OpenCode：                                         │
│     - 用这个 prompt 去引导 LLM                                          │
│     - 允许 LLM 使用这些工具                                              │
│     - （可选）用这个特定的模型                                           │
│                                                                         │
│  ✅ 所有实际工作由 OpenCode 完成：                                        │
│     - SessionPrompt.loop 执行对话循环                                   │
│     - Tool.execute() 执行工具                                           │
│     - ContextManager 管理上下文                                         │
│     - Task 工具处理子任务                                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

这种设计的**优点**是插件开发简单，只需定义配置即可获得功能强大的 Agent。**缺点**是无法
完全自定义执行逻辑。如果需要自定义运行态，需要开发带有独立后端服务的插件。

#### 12.4.5 工具注册机制

插件返回的 `tool` 对象会被合并到工具注册表：

```typescript
// OpenCode 如何合并插件工具
// packages/opencode/src/tool/registry.ts
export async function tools(model, agent) {
  const result = [...BUILTIN_TOOLS]  // 内置工具
  
  // 合并插件注册的工具
  const pluginTools = await Plugin.trigger("tool", {}, {})
  for (const [id, definition] of Object.entries(pluginTools)) {
    result.push({ id, ...definition })
  }
  
  // 根据 Agent 权限过滤
  return result.filter(tool => hasPermission(agent, tool.id))
}
```

#### 12.4.6 事件监听机制

oh-my-opencode 监听 OpenCode 事件总线，实现会话恢复、通知等功能：

```typescript
event: async (input) => {
  // input.type 可能是：
  // - "session.created"
  // - "session.updated"
  // - "message.created"
  // - "message.updated"
  // - "tool.executing"
  // - "tool.completed"
  
  await sessionRecovery?.event(input);    // 会话恢复
  await sessionNotification?.event(input); // 会话通知
}
```

#### 12.4.7 生效验证

安装 oh-my-opencode 后，可以通过以下方式验证是否生效：

| 验证项 | 方法 |
|--------|------|
| Agent 注入成功 | 启动 OpenCode，检查 Agent 列表是否包含 `sisyphus` |
| 工具注册成功 | 在对话中让 AI 列出可用工具，检查是否包含 `call_omo_agent` |
| 默认 Agent | 检查新会话是否默认使用 `sisyphus` 而非 `build` |
| Hook 生效 | 在消息中输入 `@omo` 等关键词，检查是否触发特殊行为 |

#### 12.4.8 完整数据流

```
opencode.jsonc                    OpenCode 核心                   oh-my-opencode
     │                                 │                               │
     │  "plugin": ["oh-my-opencode"]   │                               │
     └─────────────────────────────────▶                               │
                                       │  BunProc.install()            │
                                       │  import("oh-my-opencode")     │
                                       ├──────────────────────────────▶│
                                       │                               │
                                       │         PluginInput           │
                                       │  { client, directory, ... }   │
                                       ├──────────────────────────────▶│
                                       │                               │
                                       │         返回 Hooks            │
                                       │  { tool, config, event, ... } │
                                       │◀──────────────────────────────┤
                                       │                               │
                                       │  触发 config hook             │
                                       ├──────────────────────────────▶│
                                       │                               │
                                       │  修改 config 对象             │
                                       │  注入 Agent、MCP、Command      │
                                       │◀──────────────────────────────┤
                                       │                               │
                                       │  运行时触发各种 Hook           │
                                       │  chat.message                 │
                                       │  tool.execute.before/after    │
                                       │  event                        │
                                       ├─────────────────────────────▶│
                                       │                               │
                                       │  调用插件注册的工具            │
                                       │  call_omo_agent               │
                                       │  delegate_task                │
                                       ├──────────────────────────────▶│
                                       │                               │
```

---

# 第三部分：扩展机制指南

## 13. 认证扩展

### 13.1 认证架构概述

OpenCode 的认证分为三个层面：

| 层面 | 说明 | 实现位置 |
|------|------|---------|
| 用户账号（云端） | opencode.ai 网站登录 | `packages/console/function/src/auth.ts` |
| 本地服务认证 | CLI 本地 Server 的访问控制 | `packages/opencode/src/server/server.ts` |
| Provider 认证 | LLM API Key/OAuth | `packages/opencode/src/auth/index.ts` |

### 13.2 用户账号认证（云端）

**源码位置**: `packages/console/function/src/auth.ts`

使用 OpenAuth 框架，支持 GitHub、Google OAuth：

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const result = await issuer({
      providers: {
        github: GithubProvider({
          clientID: Resource.GITHUB_CLIENT_ID_CONSOLE.value,
          clientSecret: Resource.GITHUB_CLIENT_SECRET_CONSOLE.value,
          scopes: ["read:user", "user:email"],
        }),
        google: GoogleOidcProvider({
          clientID: Resource.GOOGLE_CLIENT_ID.value,
          scopes: ["openid", "email"],
        }),
      },
      storage: D1Adapter(env.DB),
      subject: async (type, properties) => {
        // 查找或创建用户账号
        const existing = await db.query.AuthTable.findFirst({
          where: and(
            eq(AuthTable.provider, type),
            eq(AuthTable.subject, properties.subject)
          ),
        });
        if (existing) return existing.accountID;
        // 创建新账号
        const accountID = createId();
        await db.insert(AuthTable).values({
          provider: type,
          subject: properties.subject,
          accountID,
        });
        return accountID;
      },
      success: async (ctx, value) => {
        // 设置 cookie 并重定向
        return ctx.redirect(value.redirectURI);
      },
    }).fetch(request, env, ctx)
    return result
  },
}
```

**数据库 Schema**:

```typescript
// packages/console/core/src/schema/auth.sql.ts
export const AuthProvider = ["email", "github", "google"] as const

export const AuthTable = mysqlTable("auth", {
  id: id(),
  provider: mysqlEnum("provider", AuthProvider).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  accountID: ulid("account_id").notNull(),
})
```

**扩展方式**: 需修改源码

| 修改文件 | 修改内容 |
|---------|---------|
| `packages/console/function/src/auth.ts` | 添加新的 Provider（如 LDAP、企业 SSO） |
| `packages/console/core/src/schema/auth.sql.ts` | 扩展 `AuthProvider` 枚举 |

### 13.3 本地服务认证

**源码位置**: `packages/opencode/src/server/server.ts` 第 80-85 行

```typescript
.use((c, next) => {
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return next()
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return basicAuth({ username, password })(c, next)
})
```

**扩展方式**: 环境变量（无需修改源码）

```bash
export OPENCODE_SERVER_PASSWORD="your-password"
export OPENCODE_SERVER_USERNAME="admin"
```

如需更复杂的认证（如 JWT），需修改 `packages/opencode/src/server/server.ts`。

### 13.4 Provider 认证

**源码位置**: `packages/opencode/src/auth/index.ts`

```typescript
export namespace Auth {
  export const Oauth = z.object({
    type: z.literal("oauth"),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
  })

  export const Api = z.object({
    type: z.literal("api"),
    key: z.string(),
  })

  // 存储路径: ~/.local/share/opencode/auth.json
  const filepath = path.join(Global.Path.data, "auth.json")
}
```

**扩展方式**: 插件 `auth` hook（无需修改源码）

```typescript
const MyAuthPlugin: Plugin = async (ctx): Promise<Hooks> => {
  return {
    auth: {
      provider: "my-provider",
      methods: [
        {
          type: "oauth",
          label: "Login with My Service",
          async authorize() {
            return {
              url: "https://my-auth.com/authorize",
              method: "auto",
              async callback() {
                return { type: "success", access: "xxx", refresh: "xxx", expires: Date.now() + 3600000 };
              },
            };
          },
        },
        {
          type: "api",
          label: "Enter API Key",
          prompts: [{ type: "text", key: "apiKey", message: "Enter API key:" }],
          async authorize(inputs) {
            return { type: "success", key: inputs?.apiKey || "" };
          },
        },
      ],
    },
  };
};
```

---

## 14. Provider 扩展

### 14.1 配置已有 Provider

**方式 1: 配置文件**

```jsonc
{
  "provider": {
    "openai": {
      "options": {
        "apiKey": "sk-xxx",
        "baseURL": "https://api.openai.com/v1",
        "timeout": 60000
      },
      "whitelist": ["gpt-4o", "gpt-4o-mini"],
      "blacklist": ["gpt-3.5-turbo"]
    }
  }
}
```

**方式 2: 环境变量**

```bash
export OPENAI_API_KEY="sk-xxx"
export OPENAI_BASE_URL="https://api.openai.com/v1"
```

**方式 3: 插件 config hook**

```typescript
config: async (config) => {
  config.provider = {
    ...config.provider,
    "openai": {
      ...config.provider?.["openai"],
      options: {
        apiKey: process.env.MY_API_KEY,
        baseURL: "https://my-proxy.com/v1",
      },
    },
  };
}
```

### 14.2 添加新的 Provider SDK

**需修改源码**: `packages/opencode/src/provider/provider.ts`

```typescript
// 在 BUNDLED_PROVIDERS 中添加
const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
  "@ai-sdk/amazon-bedrock": createAmazonBedrock,
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/azure": createAzure,
  "@ai-sdk/google": createGoogleGenerativeAI,
  "@ai-sdk/google-vertex": createVertex,
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/openai-compatible": createOpenAICompatible,
  "@openrouter/ai-sdk-provider": createOpenRouter,
  "@ai-sdk/xai": createXai,
  "@ai-sdk/mistral": createMistral,
  "@ai-sdk/groq": createGroq,
  "@ai-sdk/deepinfra": createDeepInfra,
  "@ai-sdk/cerebras": createCerebras,
  "@ai-sdk/cohere": createCohere,
  "@ai-sdk/togetherai": createTogetherAI,
  "@ai-sdk/perplexity": createPerplexity,
  "@ai-sdk/vercel": createVercel,
  "@gitlab/gitlab-ai-provider": createGitLab,
  "@my-ai-sdk/my-provider": createMyProvider,  // 新增自定义 Provider
}
```

同时需要在 `packages/opencode/package.json` 中添加依赖。

### 14.3 自定义推理服务（详细）

OpenCode 支持接入自定义的 LLM 推理服务，常见场景包括私有部署的 vLLM、TGI、Ollama 等。

#### 方式 1: 环境变量（OpenAI 兼容接口）

对于兼容 OpenAI API 的服务（如 vLLM、TGI、LocalAI、Ollama）：

```bash
# 指向自定义服务
export OPENAI_API_KEY="EMPTY"          # 如果不需要认证可设为任意值
export OPENAI_BASE_URL="http://localhost:8000/v1"
```

#### 方式 2: 配置文件

**源码位置**: `packages/opencode/src/config/config.ts` 第 868-919 行

```jsonc
// opencode.jsonc
{
  "provider": {
    "openai": {
      "options": {
        "apiKey": "EMPTY",
        "baseURL": "http://localhost:8000/v1",
        "timeout": 60000
      },
      // 自定义模型列表
      "models": {
        "my-local-model": {
          "name": "My Local Model",
          "release_date": "2024-01-01",
          "attachment": false,
          "reasoning": false,
          "temperature": true,
          "tool_call": true,
          "limit": {
            "context": 32000,
            "output": 4096
          }
        }
      }
    }
  },
  "model": "openai/my-local-model"
}
```

#### 方式 3: 使用 openai-compatible Provider

**源码位置**: `packages/opencode/src/provider/provider.ts` 第 64 行

```jsonc
{
  "provider": {
    "my-custom-llm": {
      "npm": "@ai-sdk/openai-compatible",
      "api": "http://localhost:8000/v1",
      "env": ["MY_CUSTOM_API_KEY"],
      "models": {
        "llama3-70b": {
          "name": "Llama 3 70B",
          "release_date": "2024-01-01",
          "tool_call": true,
          "limit": { "context": 8192, "output": 2048 }
        }
      }
    }
  }
}
```

#### 方式 4: 插件动态配置

```typescript
const CustomProviderPlugin: Plugin = async (ctx): Promise<Hooks> => {
  return {
    config: async (config) => {
      // 动态获取可用模型
      const models = await fetchAvailableModels("http://localhost:8000");
      
      config.provider = {
        ...config.provider,
        "my-llm": {
          npm: "@ai-sdk/openai-compatible",
          api: "http://localhost:8000/v1",
          models: models,
          options: {
            apiKey: process.env.MY_LLM_KEY || "EMPTY",
          },
        },
      };
    },
  };
};
```

#### 模型数据来源

**源码位置**: `packages/opencode/src/provider/models.ts`

OpenCode 默认从 `https://models.dev/api.json` 获取模型列表，缓存在 `~/.local/share/opencode/models.json`。

```typescript
// packages/opencode/src/provider/models.ts 第 83-99 行
export const Data = lazy(async () => {
  const file = Bun.file(Flag.OPENCODE_MODELS_PATH ?? filepath)
  const result = await file.json().catch(() => {})
  if (result) return result
  // 尝试使用打包的快照
  const snapshot = await import("./models-snapshot")
    .then((m) => m.snapshot as Record<string, unknown>)
    .catch(() => undefined)
  if (snapshot) return snapshot
  // 从 models.dev 获取
  if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {}
  const json = await fetch(`${url()}/api.json`).then((x) => x.text())
  return JSON.parse(json)
})
```

可通过以下方式自定义：

```bash
# 禁用自动获取
export OPENCODE_DISABLE_MODELS_FETCH=true

# 自定义模型数据路径
export OPENCODE_MODELS_PATH="/path/to/my/models.json"

# 自定义模型数据源 URL
export OPENCODE_MODELS_URL="https://my-company.com/models"
```

#### 添加新的 AI SDK

**需修改源码**: 如果要添加不兼容 OpenAI 的新 Provider SDK

修改位置: `packages/opencode/src/provider/provider.ts` 第 56-79 行

```typescript
// 添加新的 SDK 到 BUNDLED_PROVIDERS
const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
  "@ai-sdk/amazon-bedrock": createAmazonBedrock,
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/azure": createAzure,
  "@ai-sdk/google": createGoogleGenerativeAI,
  "@ai-sdk/google-vertex": createVertex,
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/openai-compatible": createOpenAICompatible,
  "@my-ai-sdk/my-provider": createMyProvider,  // 新增
}
```

同时在 `packages/opencode/package.json` 中添加依赖。

---

## 15. Agent 扩展

### 15.1 配置文件方式

```jsonc
{
  "agent": {
    "my-reviewer": {
      "description": "代码审查专家",
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "你是一个专业的代码审查专家，擅长发现代码中的问题、安全漏洞和性能隐患。请仔细审查代码，提供建设性的反馈。",
      "temperature": 0.3,
      "permission": {
        "read": "allow",
        "edit": "deny",
        "bash": "deny"
      },
      "color": "#FF6B6B"
    }
  },
  "default_agent": "my-reviewer"
}
```

### 15.2 插件方式（动态加载）

```typescript
const MyAgentPlugin: Plugin = async (ctx): Promise<Hooks> => {
  // 可以从远程获取 Agent 列表
  const agents = await fetch("https://api.example.com/agents").then(r => r.json());
  
  return {
    config: async (config) => {
      config.agent = {
        ...config.agent,
        ...agents.reduce((acc, a) => ({
          ...acc,
          [a.id]: {
            description: a.description,
            mode: a.mode,
            model: a.model,
            prompt: a.systemPrompt,
            permission: a.permissions,
          },
        }), {}),
      };
    },
  };
};
```

### 15.3 修改内置 Agent

**需修改源码**: `packages/opencode/src/agent/agent.ts`

---

## 16. 工具扩展

### 16.1 插件方式（推荐）

```typescript
tool: {
  my_search: tool({
    description: "搜索代码库",
    args: {
      query: tool.schema.string().describe("搜索查询"),
      limit: tool.schema.number().optional().describe("结果数量"),
    },
    async execute(args, ctx) {
      const results = await searchCodebase(args.query, ctx.directory);
      return JSON.stringify(results);
    },
  }),
}
```

### 16.2 .opencode/tool 目录

在项目或用户目录的 `.opencode/tool/` 下创建工具文件。

### 16.3 修改内置工具

**需修改源码**: `packages/opencode/src/tool/`

| 文件 | 说明 |
|------|------|
| `registry.ts` | 工具注册列表 |
| `edit.ts` | Edit 工具 |
| `bash.ts` | Bash 工具 |
| `codesearch.ts` | CodeSearch 工具 |

---

## 17. MCP 扩展

### 17.1 配置 MCP Server

```jsonc
{
  "mcp": {
    "my-mcp": {
      "type": "local",
      "command": ["python", "-m", "my_mcp_server"],
      "environment": { "API_KEY": "xxx" }
    },
    "remote-mcp": {
      "type": "remote",
      "url": "https://mcp.example.com/sse"
    }
  }
}
```

### 17.2 插件方式

```typescript
config: async (config) => {
  config.mcp = {
    ...config.mcp,
    "my-mcp": {
      type: "local",
      command: ["node", "my-mcp-server.js"],
    },
  };
}
```

---

## 18. Codebase 对接

### 18.1 内置代码搜索工具

**源码位置**: `packages/opencode/src/tool/codesearch.ts`

OpenCode 内置的 `codesearch` 工具用于搜索**外部代码库和文档**（通过 Exa API），而非本地项目代码：

```typescript
// packages/opencode/src/tool/codesearch.ts 第 35-51 行
export const CodeSearchTool = Tool.define("codesearch", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z
      .string()
      .describe(
        "Search query to find relevant context for APIs, Libraries, and SDKs. " +
        "For example, 'React useState hook examples', 'Python pandas dataframe filtering'",
      ),
    tokensNum: z
      .number()
      .min(1000)
      .max(50000)
      .default(5000)
      .describe("Number of tokens to return (1000-50000)."),
  }),
  async execute(params, ctx) {
    // 调用 Exa MCP 服务
    const codeRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_code_context_exa",
        arguments: {
          query: params.query,
          tokensNum: params.tokensNum || 5000,
        },
      },
    }
    // 发送到 https://mcp.exa.ai/mcp
    const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`, {
      method: "POST",
      body: JSON.stringify(codeRequest),
    })

    if (!response.ok) {
      throw new Error(`Code search error (${response.status}): ${await response.text()}`)
    }

    // 解析 SSE 响应
    const responseText = await response.text()
    const lines = responseText.split("\n")
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.substring(6))
        if (data.result?.content?.[0]?.text) {
          return {
            output: data.result.content[0].text,
            title: `Code search: ${params.query}`,
            metadata: {},
          }
        }
      }
    }

    return {
      output: "No code snippets or documentation found.",
      title: `Code search: ${params.query}`,
      metadata: {},
    }
  },
})
```

**关键点**：`codesearch` 是外部搜索工具，用于查询 API 文档、库用法等。

### 18.2 本地 Codebase 搜索

本地代码库搜索依赖以下内置工具：

| 工具 | 说明 | 源码位置 |
|------|------|---------|
| `grep` | 基于正则的代码搜索 | `packages/opencode/src/tool/grep.ts` |
| `glob` | 文件模式匹配 | `packages/opencode/src/tool/glob.ts` |
| `read` | 读取文件内容 | `packages/opencode/src/tool/read.ts` |
| `list` | 列出目录 | `packages/opencode/src/tool/list.ts` |

### 18.3 扩展本地代码库搜索

#### 方式 1: 插件自定义工具

```typescript
const CodebasePlugin: Plugin = async (ctx): Promise<Hooks> => {
  return {
    tool: {
      // 语义搜索
      semantic_search: tool({
        description: "基于语义的代码搜索，找到相关代码片段",
        args: {
          query: tool.schema.string().describe("搜索查询"),
          limit: tool.schema.number().optional().default(10),
        },
        async execute(args, ctx) {
          // 连接到本地向量数据库或搜索服务
          const results = await fetch("http://localhost:6333/search", {
            method: "POST",
            body: JSON.stringify({
              query: args.query,
              cwd: ctx.directory,
              limit: args.limit,
            }),
          }).then(r => r.json());
          return JSON.stringify(results);
        },
      }),

      // 代码索引
      index_codebase: tool({
        description: "索引当前代码库用于语义搜索",
        args: {},
        async execute(args, ctx) {
          // 触发索引任务
          await fetch("http://localhost:6333/index", {
            method: "POST",
            body: JSON.stringify({ path: ctx.directory }),
          });
          return "索引任务已启动";
        },
      }),
    },
  };
};
```

#### 方式 2: MCP 集成代码索引服务

```jsonc
// opencode.jsonc
{
  "mcp": {
    "codebase-mcp": {
      "type": "local",
      "command": ["python", "-m", "codebase_mcp_server"],
      "environment": {
        "CODEBASE_PATH": ".",
        "VECTOR_DB_URL": "http://localhost:6333"
      }
    }
  }
}
```

#### 方式 3: 修改内置 codesearch 工具

**需修改源码**: `packages/opencode/src/tool/codesearch.ts`

将外部搜索改为本地搜索：

```typescript
// 修改 execute 函数
async execute(params, ctx) {
  // 改为调用本地搜索服务
  const response = await fetch("http://localhost:8080/search", {
    method: "POST",
    body: JSON.stringify({
      query: params.query,
      cwd: ctx.directory,
    }),
  });

  if (!response.ok) {
    throw new Error(`Search error: ${await response.text()}`);
  }

  const results = await response.json();
  return JSON.stringify(results);
}
```

---

## 19. Agent 市场对接

### 19.1 概述

OpenCode 支持两种方式对接自定义 Agent 市场：

| 方式 | 修改源码 | 动态加载 | 适用场景 |
|------|---------|---------|---------|
| 直接配置 | 否 | 否 | 固定的 Agent 列表 |
| 插件扩展 | 否 | 是 | 动态 Agent 市场 |

> **重要说明**：无论是直接配置还是插件扩展方式，**Agent 的运行态始终在 OpenCode 内部**。
> 
> 这两种方式的本质都是**向 OpenCode 注入 Agent 配置**（prompt、model、permission 等），
> 实际的执行循环、工具调用、上下文管理都由 OpenCode 的统一运行时 `SessionPrompt.loop` 处理。
> 
> Agent 在这里只是**配置对象**，不是独立的执行体。**oh-my-opencode 也是如此**——它提供了
> 丰富的 Agent（如 Prometheus、Atlas）和工具，但这些 Agent 的执行仍然由 OpenCode 控制。
> 
> 如果需要**完全自定义运行态**（如使用 Python SDK、自己的子 Agent 调度、自己的 MCP 对接），
> 需要开发**带有独立后端服务的插件**，通过工具调用将执行转发到自己的服务。

```
┌────────────────────────────────────────────────────────────────────────┐
│                  Agent 市场对接的本质                                   │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌──────────────────┐                ┌──────────────────────────────┐│
│   │  Agent 市场       │   config hook  │     OpenCode 统一运行时       ││
│   │  (配置文件/插件)   │───────────────▶│    (SessionPrompt.loop)      ││
│   └──────────────────┘                │                              ││
│          │                            │  执行循环：                   ││
│          │ 提供：                      │  1. 接收用户消息              ││
│          │ • prompt (提示词)          │  2. 根据 Agent 配置组装 prompt ││
│          │ • model (模型)             │  3. 调用 LLM                  ││
│          │ • permission (权限)        │  4. 执行工具                  ││
│          │ • color, hidden, ...       │  5. 管理上下文                ││
│          ▼                            └──────────────────────────────┘│
│   Agent = 配置，不是执行体                                              │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 19.2 直接对接（配置文件方式）

**无需修改源码**，通过 `opencode.jsonc` 静态配置 Agent 列表：

```jsonc
// opencode.jsonc
{
  "agent": {
    // Agent 1: 代码审查专家
    "code-reviewer": {
      "name": "Code Reviewer",
      "description": "专业的代码审查和安全分析专家",
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-20250514",
      "prompt": "你是一个专业的代码审查专家，擅长发现代码中的问题、安全漏洞和性能隐患。",
      "permission": {
        "read": "allow",
        "edit": "deny",
        "bash": "deny"
      },
      "color": "#E74C3C"
    },
    
    // Agent 2: 文档生成器
    "doc-generator": {
      "name": "Doc Generator",
      "description": "自动生成代码文档和 API 说明",
      "mode": "primary",
      "model": "openai/gpt-4o",
      "prompt": "你是一个文档生成专家，能够根据代码生成清晰、准确的技术文档。",
      "permission": {
        "read": "allow",
        "edit": { "*.md": "allow", "*": "deny" }
      },
      "color": "#3498DB"
    },
    
    // Agent 3: 测试助手（subagent）
    "test-helper": {
      "name": "Test Helper",
      "description": "生成单元测试和集成测试",
      "mode": "subagent",
      "prompt": "你是测试专家，擅长编写全面的单元测试和集成测试。",
      "hidden": false
    }
  },
  
  // 设置默认 Agent
  "default_agent": "code-reviewer"
}
```

**Config.Agent Schema**（源码位置: `packages/opencode/src/config/config.ts` 第 593-623 行）：

```typescript
export const Agent = z
  .object({
    model: z.string().optional(),
    variant: z.string().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    prompt: z.string().optional(),
    disable: z.boolean().optional(),
    description: z.string().optional(),
    mode: z.enum(["subagent", "primary", "all"]).optional(),
    hidden: z.boolean().optional(),
    options: z.record(z.string(), z.any()).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    steps: z.number().int().positive().optional(),
    permission: Permission.optional(),
  })
```

### 19.3 插件扩展方式（动态 Agent 市场）

通过插件从远程 API 动态加载 Agent 列表，实现真正的"Agent 市场"：

```typescript
// agent-marketplace-plugin.ts
import { Plugin, Hooks, tool } from "@opencode-ai/plugin";

interface MarketplaceAgent {
  id: string;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  category: string;
  author: string;
  downloads: number;
  rating: number;
  permissions: Record<string, string>;
}

const AgentMarketplacePlugin: Plugin = async (ctx): Promise<Hooks> => {
  const MARKETPLACE_API = process.env.AGENT_MARKETPLACE_URL || "https://api.my-marketplace.com";
  
  // 缓存已安装的 Agent
  let installedAgents: MarketplaceAgent[] = [];
  
  // 从远程获取 Agent 列表
  async function fetchAgents(): Promise<MarketplaceAgent[]> {
    try {
      const response = await fetch(`${MARKETPLACE_API}/agents`, {
        headers: {
          "Authorization": `Bearer ${process.env.MARKETPLACE_TOKEN}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch agents");
      return response.json();
    } catch (error) {
      console.error("Failed to fetch marketplace agents:", error);
      return [];
    }
  }
  
  // 获取用户已安装的 Agent
  async function getInstalledAgents(): Promise<MarketplaceAgent[]> {
    try {
      const response = await fetch(`${MARKETPLACE_API}/user/installed`, {
        headers: {
          "Authorization": `Bearer ${process.env.MARKETPLACE_TOKEN}`,
        },
      });
      return response.json();
    } catch {
      return [];
    }
  }
  
  // 初始化时加载已安装的 Agent
  installedAgents = await getInstalledAgents();
  
  return {
    // 动态注入 Agent 配置
    config: async (config) => {
      // 将市场 Agent 转换为 OpenCode Agent 配置
      const marketAgents = installedAgents.reduce((acc, agent) => ({
        ...acc,
        [`market-${agent.id}`]: {
          name: agent.name,
          description: `[${agent.category}] ${agent.description} (by ${agent.author})`,
          mode: "primary" as const,
          model: agent.model,
          prompt: agent.systemPrompt,
          permission: agent.permissions,
        },
      }), {});
      
      config.agent = {
        ...config.agent,
        ...marketAgents,
      };
    },
    
    // 提供市场管理工具
    tool: {
      // 浏览市场
      marketplace_browse: tool({
        description: "浏览 Agent 市场，查看可用的 Agent",
        args: {
          category: tool.schema.string().optional().describe("分类过滤"),
          search: tool.schema.string().optional().describe("搜索关键词"),
        },
        async execute(args, ctx) {
          const agents = await fetchAgents();
          let filtered = agents;
          
          if (args.category) {
            filtered = filtered.filter(a => a.category === args.category);
          }
          if (args.search) {
            const search = args.search.toLowerCase();
            filtered = filtered.filter(a => 
              a.name.toLowerCase().includes(search) ||
              a.description.toLowerCase().includes(search)
            );
          }
          
          return JSON.stringify({
            total: filtered.length,
            agents: filtered.map(a => ({
              id: a.id,
              name: a.name,
              description: a.description,
              category: a.category,
              author: a.author,
              rating: a.rating,
              downloads: a.downloads,
            })),
          }, null, 2);
        },
      }),
      
      // 安装 Agent
      marketplace_install: tool({
        description: "从市场安装 Agent",
        args: {
          agentId: tool.schema.string().describe("要安装的 Agent ID"),
        },
        async execute(args, ctx) {
          const response = await fetch(`${MARKETPLACE_API}/agents/${args.agentId}/install`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.MARKETPLACE_TOKEN}`,
            },
          });
          
          if (!response.ok) {
            return `安装失败: ${await response.text()}`;
          }
          
          const agent = await response.json();
          installedAgents.push(agent);
          
          return `Agent "${agent.name}" 安装成功！使用 @market-${agent.id} 来调用。`;
        },
      }),
      
      // 卸载 Agent
      marketplace_uninstall: tool({
        description: "卸载已安装的 Agent",
        args: {
          agentId: tool.schema.string().describe("要卸载的 Agent ID"),
        },
        async execute(args, ctx) {
          const response = await fetch(`${MARKETPLACE_API}/agents/${args.agentId}/uninstall`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.MARKETPLACE_TOKEN}`,
            },
          });
          
          if (!response.ok) {
            return `卸载失败: ${await response.text()}`;
          }
          
          installedAgents = installedAgents.filter(a => a.id !== args.agentId);
          return `Agent 已卸载。重启 OpenCode 后生效。`;
        },
      }),
      
      // 列出已安装
      marketplace_list: tool({
        description: "列出已安装的市场 Agent",
        args: {},
        async execute(args, ctx) {
          return JSON.stringify({
            installed: installedAgents.map(a => ({
              id: `market-${a.id}`,
              name: a.name,
              category: a.category,
            })),
          }, null, 2);
        },
      }),
    },
    
    // 消息处理：检测市场相关命令
    "chat.message": async (input, output) => {
      const content = input.content.toLowerCase();
      
      if (content.includes("@marketplace") || content.includes("@市场")) {
        output.metadata = {
          ...output.metadata,
          hint: "使用 marketplace_browse 工具浏览市场，marketplace_install 安装 Agent",
        };
      }
    },
  };
};

export default AgentMarketplacePlugin;
```

### 19.4 两种方式对比

| 特性 | 直接配置 | 插件扩展 |
|------|---------|---------|
| **动态更新** | 需重启 | 运行时更新 |
| **远程加载** | 不支持 | 支持 |
| **用户交互** | 无 | 可提供安装/卸载工具 |
| **配置复杂度** | 低 | 中等 |
| **适用场景** | 企业预设 Agent | 公开 Agent 市场 |

### 19.5 混合方案

结合两种方式，实现基础 Agent + 市场扩展：

```jsonc
// opencode.jsonc - 基础 Agent
{
  "agent": {
    "build": { /* 默认保留 */ },
    "plan": { /* 默认保留 */ },
    "company-agent": {
      "description": "公司内部专用 Agent",
      "prompt": "你是公司内部的代码助手，熟悉公司的代码规范和技术栈。请遵循公司的编码标准进行开发。",
      "mode": "primary"
    }
  },
  "plugin": [
    "agent-marketplace-plugin"  // 插件动态加载市场 Agent
  ]
}
```

---

## 20. 源码修改位置汇总

| 扩展点 | 无需修改源码 | 需修改源码 |
|--------|------------|----------|
| **用户账号认证** | - | `packages/console/function/src/auth.ts` |
| **本地服务认证** | 环境变量 | `packages/opencode/src/server/server.ts` |
| **Provider 认证** | 插件 `auth` hook | - |
| **新增 Provider SDK** | - | `packages/opencode/src/provider/provider.ts` |
| **Provider 配置** | 配置文件 / 插件 `config` hook | - |
| **自定义推理服务** | 环境变量 / 配置文件 / 插件 `config` hook | `packages/opencode/src/provider/provider.ts`（新 SDK） |
| **模型数据源** | 环境变量 `OPENCODE_MODELS_URL` | `packages/opencode/src/provider/models.ts` |
| **自定义工具** | 插件 `tool` hook | - |
| **修改内置工具** | - | `packages/opencode/src/tool/` |
| **Codebase 搜索** | 插件 `tool` hook / MCP | `packages/opencode/src/tool/codesearch.ts` |
| **Agent 配置** | 配置文件 / 插件 `config` hook | - |
| **Agent 市场** | 配置文件 / 插件 `config` hook | - |
| **修改内置 Agent** | - | `packages/opencode/src/agent/agent.ts` |
| **MCP 接入** | 配置文件 / 插件 `config` hook | - |
| **事件监听** | 插件 `event` hook | - |
| **拦截工具执行** | 插件 `tool.execute.before/after` hook | - |

---

## 21. 关键源码文件索引

| 功能 | 源码文件 | 说明 |
|------|---------|------|
| **插件类型定义** | `packages/plugin/src/index.ts` | Plugin、Hooks、AuthHook 类型 |
| **插件加载机制** | `packages/opencode/src/plugin/index.ts` | 加载和触发插件 |
| **配置 Schema** | `packages/opencode/src/config/config.ts` | Agent、Provider、MCP 等配置定义 |
| **Session 管理** | `packages/opencode/src/session/` | 会话、消息持久化 |
| **Agent 定义** | `packages/opencode/src/agent/agent.ts` | 内置 Agent 和配置合并逻辑 |
| **Provider 实现** | `packages/opencode/src/provider/provider.ts` | LLM SDK 加载和模型获取 |
| **模型数据** | `packages/opencode/src/provider/models.ts` | models.dev 数据获取和缓存 |
| **代码搜索** | `packages/opencode/src/tool/codesearch.ts` | 外部代码/文档搜索（Exa API） |
| **工具注册** | `packages/opencode/src/tool/registry.ts` | 内置工具列表 |
| **Tool 定义** | `packages/opencode/src/tool/tool.ts` | Tool.define 函数 |
| **HTTP Server** | `packages/opencode/src/server/server.ts` | Hono 服务器和认证中间件 |
| **事件系统** | `packages/opencode/src/bus/` | 事件发布订阅 |
| **本地认证存储** | `packages/opencode/src/auth/index.ts` | auth.json 管理 |
| **云端认证服务** | `packages/console/function/src/auth.ts` | OpenAuth GitHub/Google OAuth |
| **数据库 Schema** | `packages/console/core/src/schema/` | MySQL 表定义（Drizzle ORM） |
| **MCP 配置类型** | `packages/opencode/src/config/config.ts` 第 755-830 行 | Mcp Schema 定义 |
