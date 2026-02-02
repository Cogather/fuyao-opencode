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
