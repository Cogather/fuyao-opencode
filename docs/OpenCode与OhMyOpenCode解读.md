# OpenCode 插件系统深度解读

本文详细解读 OpenCode 的插件机制，包含核心代码片段，帮助你理解如何开发自己的插件。

---

## 一、核心概念

| 概念 | 说明 |
|------|------|
| **Plugin** | 一个异步函数，接收 `PluginInput`，返回 `Hooks` 对象 |
| **Hooks** | 插件能力的集合：config、tool、event、chat.message 等 |
| **Tool** | 插件提供的工具，LLM 可以调用 |
| **PluginInput** | OpenCode 传给插件的上下文（client、directory 等） |

---

## 二、插件类型定义

### 2.1 Plugin 类型

**文件位置**: `opencode-dev/packages/plugin/src/index.ts`

```typescript
// 插件输入：OpenCode 传给插件的上下文
export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>  // OpenCode 客户端 API
  project: Project                                  // 项目信息
  directory: string                                 // 当前工作目录
  worktree: string                                  // Git worktree 根目录
  serverUrl: URL                                    // OpenCode 服务 URL
  $: BunShell                                       // Bun shell 工具
}

// 插件类型：一个返回 Hooks 的异步函数
export type Plugin = (input: PluginInput) => Promise<Hooks>
```

### 2.2 Hooks 完整定义

```typescript
export interface Hooks {
  // ==================== 配置相关 ====================
  // 在 OpenCode 加载配置后调用，可以修改 config
  config?: (input: Config) => Promise<void>
  
  // ==================== 事件相关 ====================
  // 接收所有 OpenCode 事件（session.created, message.updated 等）
  event?: (input: { event: Event }) => Promise<void>
  
  // ==================== 工具相关 ====================
  // 插件提供的工具集合
  tool?: {
    [key: string]: ToolDefinition
  }
  
  // ==================== 认证相关 ====================
  auth?: AuthHook
  
  // ==================== 聊天相关 ====================
  // 用户发送消息时触发
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
    output: {
      title: string
      output: string
      metadata: any
    },
  ) => Promise<void>
  
  // ==================== 实验性功能 ====================
  // 转换消息列表
  "experimental.chat.messages.transform"?: (
    input: {},
    output: {
      messages: {
        info: Message
        parts: Part[]
      }[]
    },
  ) => Promise<void>
  
  // 转换 system prompt
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: {
      system: string[]
    },
  ) => Promise<void>
  
  // 会话压缩
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
}
```

### 2.3 Tool 定义

**文件位置**: `opencode-dev/packages/plugin/src/tool.ts`

```typescript
import { z } from "zod"

// 工具执行时的上下文
export type ToolContext = {
  sessionID: string          // 当前会话 ID
  messageID: string          // 当前消息 ID
  agent: string              // 当前 Agent
  directory: string          // 当前工作目录
  worktree: string           // Git worktree
  abort: AbortSignal         // 中止信号
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void  // 设置元数据
  ask(input: AskInput): Promise<void>  // 请求权限
}

// 定义工具的辅助函数
export function tool<Args extends z.ZodRawShape>(input: {
  description: string                                           // 工具描述（给 LLM 看）
  args: Args                                                    // 参数定义（使用 zod）
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<string>  // 执行函数
}) {
  return input
}
tool.schema = z  // 暴露 zod 给插件使用

export type ToolDefinition = ReturnType<typeof tool>
```

---

## 三、OpenCode 如何加载插件

**文件位置**: `opencode-dev/packages/opencode/src/plugin/index.ts`

```typescript
export namespace Plugin {
  // 内置插件
  const BUILTIN = ["opencode-anthropic-auth@0.0.13", "@gitlab/opencode-gitlab-auth@1.3.2"]
  const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin]

  const state = Instance.state(async () => {
    const client = createOpencodeClient({ /* ... */ })
    const config = await Config.get()
    const hooks: Hooks[] = []
    
    // 传给插件的输入
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      serverUrl: Server.url(),
      $: Bun.$,
    }

    // 1. 加载内置插件
    for (const plugin of INTERNAL_PLUGINS) {
      log.info("loading internal plugin", { name: plugin.name })
      const init = await plugin(input)
      hooks.push(init)
    }

    // 2. 加载配置中的插件
    const plugins = [...(config.plugin ?? [])]
    if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
      plugins.push(...BUILTIN)
    }

    for (let plugin of plugins) {
      log.info("loading plugin", { path: plugin })
      
      // 如果是 npm 包，先安装
      if (!plugin.startsWith("file://")) {
        const lastAtIndex = plugin.lastIndexOf("@")
        const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
        const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
        plugin = await BunProc.install(pkg, version)
      }
      
      // 动态导入插件
      const mod = await import(plugin)
      
      // 调用所有导出的函数
      const seen = new Set<PluginInstance>()
      for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
        if (seen.has(fn)) continue
        seen.add(fn)
        const init = await fn(input)  // 调用插件，获取 Hooks
        hooks.push(init)              // 收集所有 Hooks
      }
    }

    return { hooks, input }
  })

  // Hooks 触发机制：按顺序调用所有插件的同名 hook
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

  // 插件初始化
  export async function init() {
    const hooks = await state().then((x) => x.hooks)
    const config = await Config.get()
    
    // 调用所有插件的 config hook
    for (const hook of hooks) {
      await hook.config?.(config)
    }
    
    // 订阅所有事件，转发给插件
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const hook of hooks) {
        hook["event"]?.({ event: input })
      }
    })
  }
}
```

---

## 四、编写一个最简单的插件

```typescript
import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

// 插件入口
const MyPlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
  console.log("插件加载中...", { directory: ctx.directory });

  return {
    // ========== 1. 注册工具 ==========
    tool: {
      my_hello_tool: tool({
        description: "向用户打招呼",
        args: {
          name: tool.schema.string().describe("用户名"),
        },
        async execute(args, context) {
          return `你好，${args.name}！当前目录是 ${context.directory}`;
        },
      }),
    },

    // ========== 2. 修改配置（注入 Agent） ==========
    config: async (config) => {
      // 注入自定义 Agent
      config.agent = {
        ...config.agent,
        "my-agent": {
          name: "my-agent",
          description: "我的自定义 Agent",
          mode: "all",
          prompt: "你是一个友好的助手。可以使用 my_hello_tool 向用户打招呼。",
          permission: { "*": "allow" },
        },
      };
      
      // 注入 MCP 配置
      config.mcp = {
        ...config.mcp,
        "my-mcp": {
          type: "sse",
          url: "http://localhost:8000/mcp/sse",
        },
      };
    },

    // ========== 3. 监听事件 ==========
    event: async ({ event }) => {
      if (event.type === "session.created") {
        console.log("新会话创建:", event.properties);
      }
    },

    // ========== 4. 处理用户消息 ==========
    "chat.message": async (input, output) => {
      console.log("用户消息:", output.parts);
      
      // 可以在这里检测关键词、修改消息等
    },

    // ========== 5. 工具执行前后 ==========
    "tool.execute.before": async (input, output) => {
      console.log(`工具 ${input.tool} 即将执行，参数:`, output.args);
      
      // 可以修改参数
      // output.args.xxx = "modified";
    },

    "tool.execute.after": async (input, output) => {
      console.log(`工具 ${input.tool} 执行完成，输出:`, output.output);
      
      // 可以修改输出
      // output.output = "modified output";
    },
  };
};

export default MyPlugin;
```

---

## 五、oh-my-opencode 插件入口解析

**文件位置**: `oh-my-opencode/src/index.ts`

```typescript
import type { Plugin } from "@opencode-ai/plugin";
import { createConfigHandler } from "./plugin-handlers";
import {
  builtinTools,
  createCallOmoAgent,
  createBackgroundTools,
  createDelegateTask,
  createSkillTool,
  interactive_bash,
  // ... 更多工具
} from "./tools";

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  log("[OhMyOpenCodePlugin] ENTRY - plugin loading", { directory: ctx.directory });

  // 加载插件配置
  const pluginConfig = loadPluginConfig(ctx.directory, ctx);
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? []);

  // 创建各种功能模块
  const backgroundManager = new BackgroundManager(ctx, pluginConfig.background_task, { /* ... */ });
  const callOmoAgent = createCallOmoAgent(ctx, backgroundManager);
  const delegateTask = createDelegateTask({ manager: backgroundManager, client: ctx.client, /* ... */ });
  const skillTool = createSkillTool({ skills: mergedSkills, /* ... */ });

  // 创建 config handler
  const configHandler = createConfigHandler({
    ctx: { directory: ctx.directory, client: ctx.client },
    pluginConfig,
    modelCacheState,
  });

  // 返回 Hooks
  return {
    // ========== 工具 ==========
    tool: {
      ...builtinTools,                    // 内置工具
      ...backgroundTools,                 // 后台任务工具
      call_omo_agent: callOmoAgent,       // 调用 Agent
      delegate_task: delegateTask,        // 委派任务
      skill: skillTool,                   // Skill 工具
      skill_mcp: skillMcpTool,            // Skill MCP
      slashcommand: slashcommandTool,     // 斜杠命令
      interactive_bash,                   // 交互式 bash
      // ...
    },

    // ========== 配置（注入 Agent 等） ==========
    config: configHandler,

    // ========== 事件处理 ==========
    event: async (input) => {
      await autoUpdateChecker?.event(input);
      await claudeCodeHooks.event(input);
      await backgroundNotificationHook?.event(input);
      await sessionNotification?.(input);
      // ... 更多事件处理
      
      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

      if (event.type === "session.created") {
        const sessionInfo = props?.info as { id?: string; title?: string; parentID?: string } | undefined;
        log("[event] session.created", { sessionInfo, props });
        if (!sessionInfo?.parentID) {
          setMainSession(sessionInfo?.id);
        }
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id === getMainSessionID()) {
          setMainSession(undefined);
        }
      }
    },

    // ========== 用户消息处理 ==========
    "chat.message": async (input, output) => {
      if (input.agent) {
        setSessionAgent(input.sessionID, input.agent);
      }

      // 应用 Agent variant
      const message = (output as { message: { variant?: string } }).message;
      applyAgentVariant(pluginConfig, input.agent, message);

      // 调用各种 hook
      await stopContinuationGuard?.["chat.message"]?.(input);
      await keywordDetector?.["chat.message"]?.(input, output);
      await claudeCodeHooks["chat.message"]?.(input, output);
      await autoSlashCommand?.["chat.message"]?.(input, output);
    },

    // ========== 工具执行前 ==========
    "tool.execute.before": async (input, output) => {
      await subagentQuestionBlocker["tool.execute.before"]?.(input, output);
      await questionLabelTruncator["tool.execute.before"]?.(input, output);
      await claudeCodeHooks["tool.execute.before"](input, output);
      await commentChecker?.["tool.execute.before"](input, output);
      await directoryAgentsInjector?.["tool.execute.before"]?.(input, output);
      await rulesInjector?.["tool.execute.before"]?.(input, output);
      // ... 更多 hook
    },

    // ========== 工具执行后 ==========
    "tool.execute.after": async (input, output) => {
      if (!output) return;  // 防止 undefined
      
      await claudeCodeHooks["tool.execute.after"](input, output);
      await toolOutputTruncator?.["tool.execute.after"](input, output);
      await contextWindowMonitor?.["tool.execute.after"](input, output);
      await commentChecker?.["tool.execute.after"](input, output);
      // ... 更多 hook
    },

    // ========== 消息转换 ==========
    "experimental.chat.messages.transform": async (input, output) => {
      await contextInjectorMessagesTransform?.["experimental.chat.messages.transform"]?.(input, output);
      await thinkingBlockValidator?.["experimental.chat.messages.transform"]?.(input, output);
    },
  };
};

export default OhMyOpenCodePlugin;
```

---

## 六、oh-my-opencode 如何注入 Agent

**文件位置**: `oh-my-opencode/src/plugin-handlers/config-handler.ts`

```typescript
export function createConfigHandler(deps: ConfigHandlerDeps) {
  const { ctx, pluginConfig, modelCacheState } = deps;

  return async (config: Record<string, unknown>) => {
    // 1. 创建内置 Agent
    const builtinAgents = await createBuiltinAgents(
      migratedDisabledAgents,
      pluginConfig.agents,
      ctx.directory,
      undefined,
      pluginConfig.categories,
      pluginConfig.git_master,
      allDiscoveredSkills,
      ctx.client,
      browserProvider,
      currentModel
    );

    // 2. 加载用户和项目的 Agent
    const userAgents = (pluginConfig.claude_code?.agents ?? true)
      ? loadUserAgents()
      : {};
    const projectAgents = (pluginConfig.claude_code?.agents ?? true)
      ? loadProjectAgents()
      : {};
    const pluginAgents = pluginComponents.agents;

    // 3. 特殊处理 Sisyphus Agent
    const isSisyphusEnabled = pluginConfig.sisyphus_agent?.disabled !== true;
    if (isSisyphusEnabled && builtinAgents.sisyphus) {
      // 设置默认 Agent 为 Sisyphus
      (config as { default_agent?: string }).default_agent = "sisyphus";

      const agentConfig: Record<string, unknown> = {
        sisyphus: builtinAgents.sisyphus,
        "sisyphus-junior": createSisyphusJuniorAgentWithOverrides(/*...*/),
      };

      // 创建 Prometheus (规划 Agent)
      if (plannerEnabled) {
        agentConfig["prometheus"] = {
          name: "prometheus",
          model: resolvedModel,
          mode: "all" as const,
          prompt: PROMETHEUS_SYSTEM_PROMPT,
          permission: PROMETHEUS_PERMISSION,
          description: "Plan agent (Prometheus - OhMyOpenCode)",
          color: "#9D4EDD",
        };
      }

      // 4. 合并所有 Agent 到 config.agent
      config.agent = {
        ...agentConfig,                                    // oh-my-opencode 的 Agent
        ...Object.fromEntries(                             // 其他内置 Agent
          Object.entries(builtinAgents).filter(([k]) => k !== "sisyphus")
        ),
        ...userAgents,                                     // 用户定义的 Agent
        ...projectAgents,                                  // 项目定义的 Agent
        ...pluginAgents,                                   // 插件定义的 Agent
        ...filteredConfigAgents,                           // OpenCode 原有的 Agent
        build: { ...migratedBuild, mode: "subagent", hidden: true },
      };
    } else {
      // Sisyphus 禁用时的合并方式
      config.agent = {
        ...builtinAgents,
        ...userAgents,
        ...projectAgents,
        ...pluginAgents,
        ...configAgent,
      };
    }

    // 5. 重新排序 Agent
    if (config.agent) {
      config.agent = reorderAgentsByPriority(config.agent as Record<string, unknown>);
    }

    // 6. 配置工具权限
    config.tools = {
      ...(config.tools as Record<string, unknown>),
      "grep_app_*": false,
      LspHover: false,
      // ...
    };

    // 7. 为特定 Agent 设置权限
    const agentResult = config.agent as AgentConfig;
    if (agentResult.sisyphus) {
      const agent = agentResult.sisyphus as AgentWithPermission;
      agent.permission = { 
        ...agent.permission, 
        call_omo_agent: "deny", 
        delegate_task: "allow", 
        question: "allow" 
      };
    }

    // 8. 加载 MCP 配置
    const mcpResult = (pluginConfig.claude_code?.mcp ?? true)
      ? await loadMcpConfigs()
      : { servers: {} };

    config.mcp = {
      ...createBuiltinMcps(pluginConfig.disabled_mcps),
      ...(config.mcp as Record<string, unknown>),
      ...mcpResult.servers,
      ...pluginComponents.mcpServers,
    };

    // 9. 加载命令
    config.command = {
      ...builtinCommands,
      ...userCommands,
      ...userSkills,
      ...systemCommands,
      ...projectCommands,
      ...projectSkills,
      ...pluginComponents.commands,
      ...pluginComponents.skills,
    };
  };
}
```

---

## 七、如何集成自定义插件到 OpenCode

### 7.1 用户配置

在项目根目录创建 `.opencode/opencode.jsonc`:

```jsonc
{
  // 加载插件（npm 包名或本地路径）
  "plugin": [
    "oh-my-opencode",                           // npm 包
    "my-custom-plugin@1.0.0",                   // 带版本
    "file:///path/to/local/plugin",             // 本地路径
    "git+https://github.com/xxx/plugin.git"    // Git 仓库
  ],
  
  // 设置默认 Agent
  "agent": "sisyphus",
  
  // 配置 MCP
  "mcp": {
    "my-server": {
      "type": "sse",
      "url": "http://localhost:8000/mcp/sse"
    }
  }
}
```

### 7.2 插件加载流程

```
OpenCode 启动
    │
    ▼
Config.get() 读取配置
    │
    ▼
Plugin.state() 初始化
    │
    ├─▶ 加载内置插件 (CodexAuthPlugin, CopilotAuthPlugin)
    │
    ├─▶ 遍历 config.plugin 数组
    │       │
    │       ├─▶ 如果是 npm 包，执行 BunProc.install() 安装
    │       │
    │       └─▶ import(plugin) 动态导入
    │               │
    │               └─▶ 调用导出的函数，传入 PluginInput
    │                       │
    │                       └─▶ 收集返回的 Hooks
    │
    ▼
Plugin.init() 初始化
    │
    ├─▶ 对每个 Hooks 调用 hook.config?.(config)
    │       │
    │       └─▶ 插件可以修改 config.agent, config.mcp, config.tools 等
    │
    └─▶ 订阅所有事件，转发给 hook.event
            │
            └─▶ 插件可以响应 session.created, message.updated 等事件
```

### 7.3 Hooks 触发时机

| Hook | 触发时机 |
|------|----------|
| `config` | 插件初始化时，用于修改全局配置 |
| `event` | 任何 OpenCode 事件（session、message 等） |
| `chat.message` | 用户发送消息时 |
| `chat.params` | 请求 LLM 前，修改参数 |
| `chat.headers` | 请求 LLM 前，修改请求头 |
| `tool.execute.before` | 工具执行前，可修改参数 |
| `tool.execute.after` | 工具执行后，可修改输出 |
| `permission.ask` | 请求权限时 |
| `command.execute.before` | 执行命令前 |

---

## 八、关键代码文件索引

| 文件 | 说明 |
|------|------|
| `opencode-dev/packages/plugin/src/index.ts` | Plugin、Hooks、PluginInput 类型定义 |
| `opencode-dev/packages/plugin/src/tool.ts` | ToolDefinition、ToolContext 类型定义 |
| `opencode-dev/packages/opencode/src/plugin/index.ts` | 插件加载、初始化、trigger 机制 |
| `opencode-dev/packages/opencode/src/config/config.ts` | 配置加载与合并 |
| `opencode-dev/packages/opencode/src/agent/agent.ts` | Agent 定义与合并 |
| `opencode-dev/packages/opencode/src/tool/registry.ts` | 工具注册（内置 + 目录 + 插件） |
| `oh-my-opencode/src/index.ts` | oh-my-opencode 插件入口 |
| `oh-my-opencode/src/plugin-handlers/config-handler.ts` | Agent 注入逻辑 |

---

## 九、总结

### 开发插件的核心步骤

1. **创建插件入口函数**
   ```typescript
   const MyPlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
     return { /* hooks */ };
   };
   export default MyPlugin;
   ```

2. **注册工具**（`tool`）
   ```typescript
   tool: {
     my_tool: tool({
       description: "...",
       args: { /* zod schema */ },
       execute: async (args, ctx) => { return "result"; },
     }),
   }
   ```

3. **注入 Agent**（`config` hook）
   ```typescript
   config: async (config) => {
     config.agent = { ...config.agent, "my-agent": { /* ... */ } };
   }
   ```

4. **监听事件**（`event` hook）
   ```typescript
   event: async ({ event }) => {
     if (event.type === "session.created") { /* ... */ }
   }
   ```

5. **拦截工具执行**（`tool.execute.before/after`）
   ```typescript
   "tool.execute.before": async (input, output) => {
     // 修改 output.args
   }
   ```

### 集成方式

1. **npm 发布**: `npm publish` 后配置 `"plugin": ["my-plugin"]`
2. **Git 仓库**: `"plugin": ["git+https://github.com/xxx/plugin.git"]`
3. **本地路径**: `"plugin": ["file:///path/to/plugin"]`
4. **压缩包 URL**: `npm install https://xxx/plugin-1.0.0.tgz`

---

## 十、账号认证接入

OpenCode 的认证分为两个层面：
1. **用户账号认证**：用户使用 OpenCode 前的身份验证
2. **Provider 认证**：访问 LLM Provider API 的认证

### 10.1 用户账号认证架构

#### 10.1.1 Console 云端服务（opencode.ai）

**源码位置**：
- `packages/console/function/src/auth.ts` - OpenAuth 认证服务
- `packages/console/core/src/schema/auth.sql.ts` - 数据库 Schema
- `packages/console/app/src/context/auth.ts` - 前端认证 Context

**数据库 Schema（真实源码）**：

```typescript
// packages/console/core/src/schema/auth.sql.ts
export const AuthProvider = ["email", "github", "google"] as const

export const AuthTable = mysqlTable("auth", {
  id: id(),
  ...timestamps,
  provider: mysqlEnum("provider", AuthProvider).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),  // 第三方用户 ID
  accountID: ulid("account_id").notNull(),                 // OpenCode 账号 ID
}, (table) => [
  primaryKey({ columns: [table.id] }),
  uniqueIndex("provider").on(table.provider, table.subject),
  index("account_id").on(table.accountID),
])
```

**OpenAuth 认证服务（真实源码）**：

```typescript
// packages/console/function/src/auth.ts
import { issuer } from "@openauthjs/openauth"
import { GithubProvider } from "@openauthjs/openauth/provider/github"
import { GoogleOidcProvider } from "@openauthjs/openauth/provider/google"

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const result = await issuer({
      theme: MY_THEME,
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
      storage: CloudflareStorage({ namespace: env.AuthStorage }),
      subjects,
      async success(ctx, response) {
        // 登录成功后处理：创建/获取账号、关联 workspace 等
        // ...
        return ctx.subject("account", accountID, { accountID, email })
      },
    }).fetch(request, env, ctx)
    return result
  },
}
```

**如果要添加自定义用户认证（需修改源码）**：

| 修改文件 | 修改内容 |
|---------|---------|
| `packages/console/function/src/auth.ts` | 添加新的 Provider（如 LDAP、企业 SSO） |
| `packages/console/core/src/schema/auth.sql.ts` | 扩展 `AuthProvider` 枚举 |
| `packages/console/app/src/routes/auth/` | 添加前端认证路由 |

#### 10.1.2 OpenCode CLI 本地服务

**源码位置**：
- `packages/opencode/src/server/server.ts` - HTTP Server（第 80-85 行）
- `packages/opencode/src/auth/index.ts` - 本地认证存储

**Server Basic Auth 中间件（真实源码）**：

```typescript
// packages/opencode/src/server/server.ts 第 80-85 行
.use((c, next) => {
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return next()  // 未设置密码则跳过认证
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return basicAuth({ username, password })(c, next)
})
```

**启用本地服务认证**：

```bash
# 方式 1：环境变量
export OPENCODE_SERVER_PASSWORD="your-password"
export OPENCODE_SERVER_USERNAME="admin"  # 可选，默认 "opencode"

# 方式 2：启动参数
opencode serve --password "your-password" --username "admin"
```

**如果要实现更复杂的本地认证（需修改源码）**：

| 修改文件 | 修改内容 |
|---------|---------|
| `packages/opencode/src/server/server.ts` | 添加新的认证中间件 |
| `packages/opencode/src/flag/flag.ts` | 添加新的 Flag 参数 |

### 10.2 Provider 认证（API Key / OAuth）

这部分是 OpenCode **本地存储** LLM Provider 的认证信息（如 OpenAI API Key）。

**源码位置**：
- `packages/opencode/src/auth/index.ts` - 认证信息存储
- `packages/opencode/src/cli/cmd/auth.ts` - CLI 认证命令
- `packages/opencode/src/provider/auth.ts` - Provider 认证处理
- `packages/plugin/src/index.ts` - 插件 AuthHook 类型定义

**本地认证存储（真实源码）**：

```typescript
// packages/opencode/src/auth/index.ts
export namespace Auth {
  // 认证信息类型
  export const Oauth = z.object({
    type: z.literal("oauth"),
    refresh: z.string(),
    access: z.string(),
    expires: z.number(),
    accountId: z.string().optional(),
  })

  export const Api = z.object({
    type: z.literal("api"),
    key: z.string(),
  })

  export const WellKnown = z.object({
    type: z.literal("wellknown"),
    key: z.string(),
    token: z.string(),
  })

  export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown])

  // 存储路径: ~/.local/share/opencode/auth.json
  const filepath = path.join(Global.Path.data, "auth.json")

  export async function get(providerID: string) { /* ... */ }
  export async function all(): Promise<Record<string, Info>> { /* ... */ }
  export async function set(key: string, info: Info) { /* ... */ }
  export async function remove(key: string) { /* ... */ }
}
```

### 10.3 AuthHook 类型定义（插件扩展 Provider 认证）

**源码位置**: `packages/plugin/src/index.ts`

```typescript
export type AuthHook = {
  provider: string  // Provider ID，如 "openai", "anthropic"
  
  // 可选的 loader，用于自定义加载认证信息
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  
  // 认证方法数组
  methods: (
    | {
        type: "oauth"
        label: string
        prompts?: Array<{ type: "text" | "select"; key: string; message: string; /* ... */ }>
        authorize(inputs?: Record<string, string>): Promise<AuthOauthResult>
      }
    | {
        type: "api"
        label: string
        prompts?: Array<{ type: "text" | "select"; key: string; message: string; /* ... */ }>
        authorize?(inputs?: Record<string, string>): Promise<
          | { type: "success"; key: string; provider?: string }
          | { type: "failed" }
        >
      }
  )[]
}
```

### 10.4 通过插件扩展 Provider 认证

**插件可以通过 `auth` hook 添加自定义 Provider 认证方式**（无需修改源码）：

```typescript
import type { Plugin, Hooks, AuthHook } from "@opencode-ai/plugin";

const MyAuthPlugin: Plugin = async (ctx): Promise<Hooks> => {
  return {
    auth: {
      provider: "my-custom-provider",  // Provider ID
      
      methods: [
        // OAuth 方式
        {
          type: "oauth",
          label: "Login with My Service",
          async authorize(inputs) {
            return {
              url: "https://my-auth.com/oauth/authorize?...",
              instructions: "Please complete authorization in browser",
              method: "auto",
              async callback() {
                const token = await waitForAuthCallback();
                return {
                  type: "success",
                  access: token.access_token,
                  refresh: token.refresh_token,
                  expires: Date.now() + token.expires_in * 1000,
                };
              },
            };
          },
        },
        // API Key 方式
        {
          type: "api",
          label: "Enter API Key",
          prompts: [{ type: "text", key: "apiKey", message: "Enter your API key:" }],
          async authorize(inputs) {
            const apiKey = inputs?.apiKey;
            if (!apiKey) return { type: "failed" };
            return { type: "success", key: apiKey };
          },
        },
      ],
    },
  };
};
```

### 10.5 认证扩展总结

| 认证类型 | 扩展方式 | 需修改源码位置 |
|---------|---------|--------------|
| **用户账号（云端）** | 修改源码 | `packages/console/function/src/auth.ts` |
| **本地服务 Basic Auth** | 环境变量 | 无需修改 |
| **本地服务自定义认证** | 修改源码 | `packages/opencode/src/server/server.ts` |
| **Provider API Key/OAuth** | **插件 `auth` hook** | **无需修改** |

### 10.3 认证配置方式

**方式 1：环境变量**

```bash
# API Key 方式
export OPENAI_API_KEY="sk-xxx"
export ANTHROPIC_API_KEY="sk-ant-xxx"
export GOOGLE_API_KEY="xxx"

# 自定义认证服务器
export MY_AUTH_SERVER_URL="https://auth.example.com"
export MY_AUTH_CLIENT_ID="xxx"
export MY_AUTH_CLIENT_SECRET="xxx"
```

**方式 2：配置文件** (`~/.opencode/auth.json`)

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-xxx"
    },
    "anthropic": {
      "apiKey": "sk-ant-xxx"
    },
    "my-custom-provider": {
      "accessToken": "xxx",
      "refreshToken": "xxx",
      "expiresAt": 1234567890
    }
  }
}
```

**方式 3：CLI 命令**

```bash
# 登录指定 provider
opencode auth login openai
opencode auth login github
opencode auth login my-custom-auth

# 查看认证状态
opencode auth status

# 登出
opencode auth logout openai
```

### 10.4 认证 API 路由

**文件位置**: `opencode-dev/packages/opencode/src/server/routes/provider.ts`

```typescript
// 认证相关 API
GET  /provider/auth              // 获取所有可用的认证方法
POST /provider/:id/oauth/authorize  // 发起 OAuth 授权
POST /provider/:id/oauth/callback   // OAuth 回调
POST /provider/:id/refresh          // 刷新 token
```

---

## 十一、自定义推理服务（Provider）

### 11.1 Provider 架构

**源码位置**：
- `packages/opencode/src/provider/provider.ts` - Provider 核心实现
- `packages/opencode/src/provider/models.ts` - models.dev 模型目录
- `packages/opencode/src/config/config.ts` - Provider 配置 Schema

**内置 AI SDK Provider（真实源码）**：

```typescript
// packages/opencode/src/provider/provider.ts 第 56-79 行
const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
  "@ai-sdk/amazon-bedrock": createAmazonBedrock,
  "@ai-sdk/anthropic": createAnthropic,
  "@ai-sdk/azure": createAzure,
  "@ai-sdk/google": createGoogleGenerativeAI,
  "@ai-sdk/google-vertex": createVertex,
  "@ai-sdk/google-vertex/anthropic": createVertexAnthropic,
  "@ai-sdk/openai": createOpenAI,
  "@ai-sdk/openai-compatible": createOpenAICompatible,
  "@openrouter/ai-sdk-provider": createOpenRouter,
  "@ai-sdk/xai": createXai,
  "@ai-sdk/mistral": createMistral,
  "@ai-sdk/groq": createGroq,
  "@ai-sdk/deepinfra": createDeepInfra,
  "@ai-sdk/cerebras": createCerebras,
  "@ai-sdk/cohere": createCohere,
  "@ai-sdk/gateway": createGateway,
  "@ai-sdk/togetherai": createTogetherAI,
  "@ai-sdk/perplexity": createPerplexity,
  "@ai-sdk/vercel": createVercel,
  "@gitlab/gitlab-ai-provider": createGitLab,
  "@ai-sdk/github-copilot": createGitHubCopilotOpenAICompatible,
}
```

**模型来源**（models.dev）：

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
  
  // 从 https://models.dev/api.json 获取模型数据
  export async function get() { /* ... */ }
}
```

**如果要添加全新的 Provider SDK（需修改源码）**：

| 修改文件 | 修改内容 |
|---------|---------|
| `packages/opencode/src/provider/provider.ts` | 在 `BUNDLED_PROVIDERS` 中添加新的 SDK |
| `packages/opencode/package.json` | 添加新 SDK 依赖 |

### 11.2 配置自定义 Provider

**文件位置**: `opencode-dev/packages/opencode/src/config/config.ts`

**Provider 配置 Schema（真实源码）：**

```typescript
export const Provider = ModelsDev.Provider.partial().extend({
  // 过滤模型
  whitelist: z.array(z.string()).optional(),  // 只启用这些模型
  blacklist: z.array(z.string()).optional(),  // 禁用这些模型
  
  // 自定义模型配置
  models: z.record(z.string(), /* Model 配置 */).optional(),
  
  // Provider 选项
  options: z.object({
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
    enterpriseUrl: z.string().optional(),  // GitHub Enterprise URL
    timeout: z.number().optional(),         // 请求超时（毫秒）
  }).catchall(z.any()).optional(),
})
```

**方式 1：配置文件** (`opencode.jsonc`)

```jsonc
{
  "provider": {
    // 配置内置 Provider（覆盖默认设置）
    "openai": {
      "options": {
        "apiKey": "sk-xxx",
        "baseURL": "https://api.openai.com/v1",
        "timeout": 60000
      },
      // 只启用特定模型
      "whitelist": ["gpt-4o", "gpt-4o-mini"],
      // 或禁用特定模型
      "blacklist": ["gpt-3.5-turbo"]
    },
    
    // 配置 Anthropic
    "anthropic": {
      "options": {
        "apiKey": "sk-ant-xxx",
        "baseURL": "https://api.anthropic.com"
      }
    },
    
    // 自定义模型配置
    "openai": {
      "models": {
        "gpt-4o": {
          "name": "GPT-4o (Custom)",
          "limit": {
            "context": 128000,
            "output": 16384
          }
        }
      }
    }
  },
  
  // 禁用某些 Provider（全局）
  "disabled_providers": ["azure", "bedrock"],
  
  // 只启用特定 Provider（全局）
  "enabled_providers": ["openai", "anthropic"]
}
```

**方式 2：环境变量**

```bash
# 标准 Provider
export OPENAI_API_KEY="sk-xxx"
export OPENAI_BASE_URL="https://api.openai.com/v1"

export ANTHROPIC_API_KEY="sk-ant-xxx"
export ANTHROPIC_BASE_URL="https://api.anthropic.com"

# 自定义 Provider
export MY_LLM_API_KEY="xxx"
export MY_LLM_BASE_URL="https://my-llm-service.com/v1"
```

### 11.3 通过插件配置 Provider

**注意**：OpenCode 的 Provider 基于 AI SDK，自定义 Provider 需要通过现有的 SDK 包（如 `@ai-sdk/openai`）。

```typescript
import type { Plugin, Hooks } from "@opencode-ai/plugin";

const MyProviderPlugin: Plugin = async (ctx): Promise<Hooks> => {
  return {
    config: async (config) => {
      // 配置已有 Provider 的选项
      config.provider = {
        ...config.provider,
        
        // 方式 1：配置 OpenAI 兼容服务（复用 openai provider）
        "openai": {
          ...config.provider?.["openai"],
          options: {
            ...config.provider?.["openai"]?.options,
            apiKey: process.env.MY_API_KEY || config.provider?.["openai"]?.options?.apiKey,
            baseURL: process.env.MY_BASE_URL || "https://api.my-service.com/v1",
          },
        },
        
        // 方式 2：通过 whitelist/blacklist 控制可用模型
        "anthropic": {
          ...config.provider?.["anthropic"],
          whitelist: ["claude-sonnet-4-20250514", "claude-haiku-3-5-20241022"],
        },
      };
      
      // 禁用不需要的 Provider
      config.disabled_providers = [
        ...(config.disabled_providers || []),
        "azure",
        "bedrock",
      ];
    },
  };
};
```

**重要说明**：
- OpenCode 不支持动态注册全新的 Provider SDK
- 自定义推理服务需要兼容现有 SDK 协议（OpenAI、Anthropic 等）
- 通过 `options.baseURL` 指向自定义服务端点

### 11.4 Provider API 路由

```typescript
// Provider 相关 API
GET  /provider/                    // 列出所有可用 Provider
GET  /provider/:id/models          // 获取 Provider 的模型列表
POST /provider/:id/chat            // 发送聊天请求
```

### 11.5 自定义推理服务示例

如果你有自己的推理服务（如 vLLM、TGI、Ollama 等），需要通过复用已有 Provider 来配置：

```jsonc
{
  "provider": {
    // vLLM 服务 - 使用 OpenAI 兼容协议
    // 注意：需要复用 "openai" provider，或使用环境变量
    "openai": {
      "options": {
        "apiKey": "EMPTY",  // vLLM 通常不需要 key
        "baseURL": "http://localhost:8000/v1"
      }
    }
  }
}
```

**使用环境变量配置自定义服务**（推荐）：

```bash
# OpenAI 兼容服务（vLLM、TGI 等）
export OPENAI_API_KEY="EMPTY"
export OPENAI_BASE_URL="http://localhost:8000/v1"

# 或 Anthropic 兼容服务
export ANTHROPIC_API_KEY="xxx"
export ANTHROPIC_BASE_URL="https://my-proxy.com/anthropic"
```

**Ollama 配置**（OpenCode 内置支持）：

```bash
# Ollama 已经是内置支持的 Provider
# 只需确保 Ollama 服务运行即可
ollama serve
```

**重要说明**：
- OpenCode 的 Provider 体系基于 [models.dev](https://models.dev) 的模型目录
- 自定义服务需要兼容现有 Provider 的 API 协议
- 对于完全自定义的 Provider，建议通过 MCP Server 方式接入

---

## 十二、Codebase 对接

### 12.1 内置代码搜索工具

**文件位置**: `opencode-dev/packages/opencode/src/tool/codesearch.ts`

OpenCode 内置了 `codesearch` 工具，使用 Exa MCP API 进行**外部**代码/文档搜索：

```typescript
// 真实源码
const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    CONTEXT: "/mcp",
  },
}

export const CodeSearchTool = Tool.define("codesearch", {
  description: DESCRIPTION,  // 搜索 API、库和 SDK 的相关文档
  parameters: z.object({
    query: z.string().describe(
      "Search query to find relevant context for APIs, Libraries, and SDKs. " +
      "For example, 'React useState hook examples', 'Python pandas dataframe filtering'"
    ),
    tokensNum: z.number().min(1000).max(50000).default(5000).describe(
      "Number of tokens to return (1000-50000). Default is 5000 tokens."
    ),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "codesearch",
      patterns: [params.query],
      always: ["*"],
    });

    const codeRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_code_context_exa",  // Exa API 工具名
        arguments: {
          query: params.query,
          tokensNum: params.tokensNum || 5000,
        },
      },
    };

    const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(codeRequest),
    });
    // ... 解析 SSE 响应
  },
});
```

**注意**：`codesearch` 工具是用于搜索**外部**代码库和文档（如 GitHub、npm 包文档等），而不是搜索**本地**项目代码。本地代码搜索使用 `grep`、`glob`、`read` 等工具。

### 12.2 通过插件扩展 Codebase 能力（无需修改源码）

**自定义代码索引和搜索工具：**

```typescript
import type { Plugin, Hooks } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import z from "zod";

const MyCodebasePlugin: Plugin = async (ctx): Promise<Hooks> => {
  return {
    tool: {
      // 自定义代码搜索工具
      my_code_search: tool({
        description: "使用自定义代码库搜索引擎查找相关代码",
        parameters: z.object({
          query: z.string().describe("搜索查询"),
          limit: z.number().optional().describe("返回结果数量"),
        }),
        async execute(args, context) {
          const response = await fetch("http://my-codebase-service/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: args.query,
              project: context.directory,
              limit: args.limit || 10,
            }),
          });
          const results = await response.json();
          return {
            output: JSON.stringify(results, null, 2),
            title: `代码搜索: ${args.query}`,
            metadata: {},
          };
        },
      }),
      
      // 代码嵌入索引工具
      index_codebase: tool({
        description: "为当前项目创建代码嵌入索引",
        parameters: z.object({
          force: z.boolean().optional().describe("强制重新索引"),
        }),
        async execute(args, context) {
          await fetch("http://my-codebase-service/index", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              directory: context.directory,
              force: args.force || false,
            }),
          });
          return {
            output: "索引创建完成",
            title: "代码索引",
            metadata: {},
          };
        },
      }),
    },
  };
};
```

**如果要修改/替换内置 CodeSearch 工具（需修改源码）**：

| 修改文件 | 修改内容 |
|---------|---------|
| `packages/opencode/src/tool/codesearch.ts` | 修改搜索逻辑、API 地址 |
| `packages/opencode/src/tool/registry.ts` | 第 115 行，工具注册列表 |

### 12.3 通过 MCP 对接 Codebase

**配置 MCP Server：**

```jsonc
{
  "mcp": {
    // 自定义代码搜索 MCP
    "my-codebase": {
      "type": "sse",
      "url": "http://localhost:8000/mcp/sse"
    },
    
    // 或者使用 stdio 方式
    "my-codebase-stdio": {
      "type": "stdio",
      "command": "python",
      "args": ["-m", "my_codebase_mcp"]
    }
  }
}
```

**MCP Server 实现示例（Python）：**

```python
from mcp.server import Server
from mcp.types import Tool, TextContent

app = Server("my-codebase")

@app.list_tools()
async def list_tools():
    return [
        Tool(
            name="search_code",
            description="搜索代码库",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "limit": {"type": "number"},
                },
                "required": ["query"],
            },
        ),
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "search_code":
        results = await search_codebase(arguments["query"])
        return [TextContent(type="text", text=json.dumps(results))]
```

---

## 十三、自定义 Agent 市场应用列表

### 13.1 Agent 系统架构

**文件位置**: 
- 运行时定义: `opencode-dev/packages/opencode/src/agent/agent.ts`
- 配置定义: `opencode-dev/packages/opencode/src/config/config.ts`

**Agent 运行时定义（真实源码）：**

```typescript
// opencode-dev/packages/opencode/src/agent/agent.ts
export namespace Agent {
  export const Info = z.object({
    name: z.string(),
    description: z.string().optional(),
    mode: z.enum(["subagent", "primary", "all"]),
    native: z.boolean().optional(),       // 是否内置 Agent
    hidden: z.boolean().optional(),       // 是否隐藏
    topP: z.number().optional(),
    temperature: z.number().optional(),
    color: z.string().optional(),
    permission: PermissionNext.Ruleset,
    model: z.object({
      modelID: z.string(),
      providerID: z.string(),
    }).optional(),
    variant: z.string().optional(),
    prompt: z.string().optional(),
    options: z.record(z.string(), z.any()),
    steps: z.number().int().positive().optional(),  // 最大迭代步数
  });
}
```

**Agent 配置定义（用户配置）：**

```typescript
// opencode-dev/packages/opencode/src/config/config.ts
export const Agent = z.object({
  model: z.string().optional(),             // 格式: "provider/model"
  variant: z.string().optional(),           // 模型变体
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  prompt: z.string().optional(),            // System prompt
  description: z.string().optional(),       // Agent 描述
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  hidden: z.boolean().optional(),           // 是否在菜单中隐藏
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  steps: z.number().int().positive().optional(),
  permission: Permission.optional(),        // 权限配置
  options: z.record(z.string(), z.any()).optional(),
  disable: z.boolean().optional(),          // 禁用此 Agent
});
```

### 13.2 两条路径：配置文件 vs 插件扩展

#### 路径 1：配置文件方式（无需开发）

直接在 `opencode.jsonc` 中定义 Agent：

```jsonc
{
  "agent": {
    // 自定义主 Agent（可直接使用）
    "code-reviewer": {
      "description": "专业代码审查专家",
      "mode": "primary",
      "model": "anthropic/claude-sonnet-4-20250514",  // 格式: provider/model-id
      "prompt": "你是一个专业的代码审查专家，专注于代码质量、安全性和最佳实践...",
      "temperature": 0.3,
      "permission": {
        "read": "allow",
        "edit": "deny",
        "bash": "deny"
      },
      "color": "#FF6B6B"
    },
    
    // 覆盖内置 Agent 配置
    "build": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.5
    },
    
    // 自定义子 Agent（只能被其他 Agent 调用）
    "quick-fixer": {
      "description": "快速修复助手，用于简单的代码修复任务",
      "mode": "subagent",
      "model": "openai/gpt-4o-mini",
      "prompt": "你是一个快速修复问题的助手，专注于简单、快速的修复...",
      "permission": {
        "edit": "allow",
        "bash": "ask"
      },
      "hidden": false  // 在 @ 菜单中显示
    },
    
    // 禁用某个 Agent
    "plan": {
      "disable": true
    }
  },
  
  // 设置默认 Agent
  "default_agent": "code-reviewer"
}
```

**内置 Agent 列表**（可覆盖配置）：

| Agent | 模式 | 说明 |
|-------|------|------|
| `build` | primary | 默认 Agent，执行工具 |
| `plan` | primary | 计划模式，禁止编辑工具 |
| `general` | subagent | 通用子 Agent，执行多步任务 |
| `explore` | subagent | 快速探索代码库 |
| `title` | hidden | 生成会话标题 |
| `summary` | hidden | 生成摘要 |
| `compaction` | hidden | 压缩会话上下文 |

#### 路径 2：插件扩展方式（动态加载）

通过插件的 `config` hook 注入 Agent：

```typescript
import type { Plugin, Hooks } from "@opencode-ai/plugin";

const MyAgentMarketPlugin: Plugin = async (ctx): Promise<Hooks> => {
  // 插件加载时可以从远程获取 Agent 列表
  let agentsFromMarket: Record<string, any> = {};
  
  try {
    const response = await fetch("https://my-agent-market.com/api/agents");
    const agentList = await response.json();
    
    // 转换为 OpenCode Agent 配置格式
    agentsFromMarket = Object.fromEntries(
      agentList.map((agent: any) => [
        agent.id,
        {
          description: agent.description,
          mode: agent.mode || "primary",  // "primary" | "subagent" | "all"
          model: agent.model,             // 格式: "provider/model-id"
          prompt: agent.systemPrompt,
          temperature: agent.temperature,
          permission: agent.permissions || { "*": "allow" },
          color: agent.color,
        },
      ])
    );
  } catch (error) {
    console.error("Failed to fetch agents from market:", error);
  }
  
  return {
    config: async (config) => {
      // 合并 Agent 配置（注意：后面的会覆盖前面的同名 Agent）
      config.agent = {
        ...config.agent,           // 保留原有配置
        ...agentsFromMarket,       // 添加市场 Agent
      };
      
      // 可选：设置默认 Agent
      if (agentsFromMarket["recommended-agent"]) {
        (config as any).default_agent = "recommended-agent";
      }
    },
  };
};

export default MyAgentMarketPlugin;
```

**注意**：`config` hook 接收的 `config` 对象类型是 `Config`，可以直接修改。

### 13.3 对比两种方式

| 特性 | 配置文件方式 | 插件扩展方式 |
|------|-------------|-------------|
| **开发成本** | 无需开发 | 需要开发插件 |
| **灵活性** | 静态配置 | 动态加载、可远程获取 |
| **适用场景** | 个人/团队固定 Agent | Agent 市场、动态更新 |
| **分发方式** | 分享配置文件 | 分享插件包 |
| **更新机制** | 手动修改配置 | 插件自动拉取最新列表 |

### 13.4 实现 Agent 市场的完整示例

**服务端 API（提供 Agent 列表）：**

```python
# FastAPI 示例
from fastapi import FastAPI

app = FastAPI()

@app.get("/api/agents")
async def list_agents():
    return [
        {
            "id": "fuyao-coder",
            "description": "专注于代码编写和优化",
            "mode": "primary",
            "model": "anthropic/claude-sonnet-4-20250514",  # 完整的 model ID
            "systemPrompt": "你是扶摇平台的代码专家...",
            "permissions": {"*": "allow"},
            "color": "#4ECDC4",
            "temperature": 0.5,
        },
        {
            "id": "fuyao-reviewer",
            "description": "专注于代码审查和质量保障",
            "mode": "primary",
            "model": "anthropic/claude-sonnet-4-20250514",
            "systemPrompt": "你是扶摇平台的代码审查专家...",
            "permissions": {"read": "allow", "edit": "deny", "bash": "deny"},
            "color": "#FF6B6B",
            "temperature": 0.3,
        },
    ]
```

**插件实现（消费 Agent 列表）：**

```typescript
import type { Plugin, Hooks } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

const MARKET_API = process.env.AGENT_MARKET_URL || "https://api.fuyao.com";

const FuyaoAgentMarketPlugin: Plugin = async (ctx): Promise<Hooks> => {
  let cachedAgents: Record<string, any> = {};
  
  // 插件加载时获取 Agent 列表
  async function fetchAgents() {
    try {
      const response = await fetch(`${MARKET_API}/api/agents`);
      const agentList = await response.json();
      
      cachedAgents = Object.fromEntries(
        agentList.map((agent: any) => [
          agent.id,
          {
            description: agent.description,
            mode: agent.mode || "primary",
            model: agent.model,
            prompt: agent.systemPrompt,
            temperature: agent.temperature,
            permission: agent.permissions || { "*": "allow" },
            color: agent.color,
          },
        ])
      );
    } catch (error) {
      console.error("[FuyaoAgentMarket] Failed to fetch agents:", error);
    }
  }
  
  await fetchAgents();

  return {
    config: async (config) => {
      // 合并到配置中
      config.agent = {
        ...config.agent,
        ...cachedAgents,
      };
    },
    
    // 提供刷新工具（可选）
    tool: {
      refresh_fuyao_agents: tool({
        description: "刷新扶摇 Agent 市场列表",
        args: {},
        async execute(_args, _ctx) {
          await fetchAgents();
          return `已刷新 ${Object.keys(cachedAgents).length} 个 Agent`;
        },
      }),
    },
  };
};

export default FuyaoAgentMarketPlugin;
```

### 13.5 Agent 权限配置

**文件位置**: `opencode-dev/packages/opencode/src/config/config.ts`

```typescript
// 权限值类型
type PermissionAction = "ask" | "allow" | "deny"

// 权限规则可以是简单值或嵌套对象
type PermissionRule = PermissionAction | Record<string, PermissionAction>

// 完整的权限配置 Schema
const Permission = z.object({
  read: PermissionRule.optional(),        // 读取文件
  edit: PermissionRule.optional(),        // 编辑文件
  glob: PermissionRule.optional(),        // glob 搜索
  grep: PermissionRule.optional(),        // grep 搜索
  list: PermissionRule.optional(),        // 列出目录
  bash: PermissionRule.optional(),        // 执行 bash 命令
  task: PermissionRule.optional(),        // 创建子任务
  external_directory: PermissionRule.optional(),  // 访问外部目录
  todowrite: PermissionAction.optional(), // 写入 TODO
  todoread: PermissionAction.optional(),  // 读取 TODO
  question: PermissionAction.optional(),  // 提问用户
  webfetch: PermissionAction.optional(),  // 获取网页
  websearch: PermissionAction.optional(), // 网络搜索
  codesearch: PermissionAction.optional(), // 代码搜索
  lsp: PermissionRule.optional(),         // LSP 功能
  doom_loop: PermissionAction.optional(), // 防止死循环
  skill: PermissionRule.optional(),       // Skill 工具
}).catchall(PermissionRule)  // 支持自定义权限
```

**配置示例**：

```jsonc
{
  "agent": {
    "my-agent": {
      "permission": {
        // 简单配置
        "*": "allow",           // 默认允许所有
        "bash": "ask",          // bash 需要询问
        "edit": "deny",         // 禁止编辑
        
        // 嵌套配置（按文件模式）
        "read": {
          "*": "allow",
          "*.env": "ask",       // .env 文件需要询问
          "*.env.*": "ask"
        },
        
        // 外部目录访问
        "external_directory": {
          "*": "ask",
          "/tmp/*": "allow"     // /tmp 目录允许访问
        }
      }
    }
  }
}
```

**Agent 模式说明**：

| 模式 | 说明 |
|------|------|
| `primary` | 主 Agent，可以直接选择使用 |
| `subagent` | 子 Agent，只能被其他 Agent 调用 |
| `all` | 两种模式都支持 |

---

## 十四、关键代码文件索引（补充）

| 文件 | 说明 |
|------|------|
| `opencode-dev/packages/plugin/src/index.ts` | **Plugin、Hooks、AuthHook 类型定义** |
| `opencode-dev/packages/plugin/src/tool.ts` | Tool 定义和 ToolContext |
| `opencode-dev/packages/opencode/src/config/config.ts` | **配置 Schema（Agent、Provider、Permission 等）** |
| `opencode-dev/packages/opencode/src/agent/agent.ts` | **Agent 运行时定义和内置 Agent** |
| `opencode-dev/packages/opencode/src/provider/provider.ts` | Provider 核心实现和 SDK 集成 |
| `opencode-dev/packages/opencode/src/provider/models.ts` | models.dev 模型目录定义 |
| `opencode-dev/packages/opencode/src/tool/codesearch.ts` | CodeSearch 工具（Exa API） |
| `opencode-dev/packages/opencode/src/tool/registry.ts` | 工具注册表 |
| `opencode-dev/packages/opencode/src/plugin/index.ts` | 插件加载和 trigger 机制 |

---

## 十五、总结

### 扩展方式与源码修改位置

| 扩展点 | 无需修改源码 | 需修改源码 |
|--------|------------|----------|
| **用户账号认证（云端）** | - | `packages/console/function/src/auth.ts` |
| **本地服务认证** | 环境变量 `OPENCODE_SERVER_PASSWORD` | `packages/opencode/src/server/server.ts` |
| **Provider 认证** | 插件 `auth` hook | - |
| **新增 Provider SDK** | - | `packages/opencode/src/provider/provider.ts` |
| **Provider 配置** | `opencode.jsonc` / 插件 `config` hook | - |
| **自定义工具** | 插件 `tool` hook | - |
| **修改内置工具** | - | `packages/opencode/src/tool/` |
| **Agent 配置** | `opencode.jsonc` / 插件 `config` hook | - |
| **修改内置 Agent** | - | `packages/opencode/src/agent/agent.ts` |
| **MCP 接入** | `opencode.jsonc` mcp 配置 | - |
| **事件监听** | 插件 `event` hook | - |
| **拦截工具执行** | 插件 `tool.execute.before/after` hook | - |

### 关键源码文件索引

| 功能 | 源码文件 |
|------|---------|
| **插件类型定义** | `packages/plugin/src/index.ts` |
| **用户认证（云端）** | `packages/console/function/src/auth.ts` |
| **用户认证（数据库）** | `packages/console/core/src/schema/auth.sql.ts` |
| **本地服务 Server** | `packages/opencode/src/server/server.ts` |
| **Provider 认证存储** | `packages/opencode/src/auth/index.ts` |
| **Provider 核心实现** | `packages/opencode/src/provider/provider.ts` |
| **配置 Schema** | `packages/opencode/src/config/config.ts` |
| **Agent 定义** | `packages/opencode/src/agent/agent.ts` |
| **工具注册** | `packages/opencode/src/tool/registry.ts` |
| **CodeSearch 工具** | `packages/opencode/src/tool/codesearch.ts` |
| **插件加载** | `packages/opencode/src/plugin/index.ts` |

### 重要说明

1. **Provider 限制**：OpenCode 的 Provider 体系基于 AI SDK，无法通过插件动态注册全新的 Provider SDK。如需添加新 SDK，必须修改 `packages/opencode/src/provider/provider.ts` 中的 `BUNDLED_PROVIDERS`。

2. **用户账号认证**：用户登录认证由 Console 云端服务处理，使用 OpenAuth 框架。如需自定义（如企业 SSO），需修改 `packages/console/function/src/auth.ts`。

3. **本地服务认证**：OpenCode 本地服务仅支持 Basic Auth，通过环境变量配置。如需更复杂的认证（如 JWT），需修改 `packages/opencode/src/server/server.ts`。

4. **CodeSearch 说明**：内置的 `codesearch` 工具是用于搜索**外部**代码库和文档（通过 Exa API），不是搜索本地项目。

### 推荐方案

| 场景 | 推荐方式 |
|------|---------|
| 配置已有 Provider | 配置文件 + 环境变量 |
| 添加自定义 Agent | 配置文件 或 插件 `config` hook |
| 添加自定义工具 | 插件 `tool` hook |
| 接入外部服务 | MCP Server + `mcp` 配置 |
| Provider 认证流程 | 插件 `auth` hook |
| 监听系统事件 | 插件 `event` hook |
| 拦截工具执行 | 插件 `tool.execute.before/after` hook |
| 用户账号认证 | **修改源码** `packages/console/` |
| 添加新 Provider SDK | **修改源码** `packages/opencode/src/provider/` |
