# oh-my-opencode 架构分析与复用指南

为你的独立插件开发提供参考。

---

## 一、整体架构

```
oh-my-opencode/src/
├── index.ts                 # 🔴 插件入口（返回 Hooks 对象）
├── plugin-config.ts         # 配置加载
├── plugin-state.ts          # 插件状态管理
├── plugin-handlers/         # 🔴 config hook 实现（注入 agent/tool/mcp）
│   └── config-handler.ts
│
├── agents/                  # 🟢 Agent 定义
│   ├── sisyphus.ts          # 主 Agent
│   ├── hephaestus.ts        # 自主深度工作者
│   ├── prometheus/          # 规划器（复杂，多文件）
│   ├── oracle.ts            # 设计/调试顾问
│   ├── librarian.ts         # 文档/代码搜索
│   ├── explore.ts           # 快速代码库探索
│   ├── atlas.ts             # 任务编排
│   └── utils.ts             # Agent 创建工具函数
│
├── tools/                   # 🟢 工具实现
│   ├── delegate-task/       # ⭐ 任务委派（核心）
│   ├── lsp/                 # ⭐ LSP 集成
│   ├── session-manager/     # ⭐ 会话管理
│   ├── background-task/     # 后台任务工具
│   ├── ast-grep/            # AST 搜索
│   ├── grep/                # Grep 增强
│   ├── glob/                # Glob 增强
│   ├── look-at/             # 多模态查看
│   ├── skill/               # Skill 工具
│   ├── skill-mcp/           # Skill MCP 工具
│   ├── slashcommand/        # 斜杠命令
│   ├── call-omo-agent/      # 调用指定 Agent
│   └── interactive-bash/    # 交互式 Bash
│
├── features/                # 🟢 核心功能模块
│   ├── background-agent/    # ⭐ 后台 Agent 管理器
│   ├── context-injector/    # ⭐ 上下文注入器
│   ├── skill-mcp-manager/   # Skill MCP 管理
│   ├── opencode-skill-loader/ # Skill 加载器
│   ├── builtin-skills/      # 内置 Skill
│   ├── builtin-commands/    # 内置命令
│   ├── tmux-subagent/       # Tmux 子 Agent
│   ├── task-toast-manager/  # 任务 Toast 通知
│   ├── boulder-state/       # Boulder 状态管理
│   ├── claude-code-*/       # Claude Code 兼容层
│   └── mcp-oauth/           # MCP OAuth
│
├── hooks/                   # 🟢 Hook 实现（30+）
│   ├── todo-continuation-enforcer.ts  # ⭐ TODO 强制执行
│   ├── context-window-monitor.ts      # 上下文窗口监控
│   ├── session-recovery/              # ⭐ 会话恢复
│   ├── comment-checker/               # 注释检查
│   ├── tool-output-truncator.ts       # 工具输出截断
│   ├── directory-agents-injector/     # AGENTS.md 注入
│   ├── rules-injector/                # ⭐ 规则注入
│   ├── keyword-detector/              # ⭐ 关键词检测（ultrawork）
│   ├── ralph-loop/                    # ⭐ Ralph Loop
│   ├── think-mode/                    # 思考模式
│   ├── auto-slash-command/            # 自动斜杠命令
│   └── ...更多
│
├── mcp/                     # MCP 集成
│   ├── websearch.ts         # Exa 网络搜索
│   ├── context7.ts          # Context7 文档
│   └── grep-app.ts          # Grep.app GitHub 搜索
│
├── shared/                  # 🟢 共享工具（可直接复用）
│   ├── logger.ts            # 日志
│   ├── deep-merge.ts        # 深度合并
│   ├── frontmatter.ts       # Frontmatter 解析
│   ├── jsonc-parser.ts      # JSONC 解析
│   ├── binary-downloader.ts # 二进制下载
│   ├── dynamic-truncator.ts # 动态截断
│   ├── model-resolver.ts    # 模型解析
│   ├── session-utils.ts     # 会话工具
│   └── tmux/                # Tmux 工具
│
└── config/                  # 配置 Schema
    └── schema.ts
```

---

## 二、高价值模块分析

### ⭐⭐⭐ 最高价值（核心能力）

| 模块 | 路径 | 功能 | 复用建议 |
|------|------|------|----------|
| **BackgroundManager** | `features/background-agent/` | 后台任务管理、并发控制、任务状态 | 🔴 你有自己的 SDK，可参考架构但不直接复用 |
| **delegate-task** | `tools/delegate-task/` | 任务委派、category 路由、prompt 构建 | 🟡 参考其 prompt 构建和 category 设计 |
| **context-injector** | `features/context-injector/` | 上下文收集与注入 | 🟢 可复用，用于给你的 agent 注入上下文 |
| **rules-injector** | `hooks/rules-injector/` | RULE.md 规则注入 | 🟢 可复用，让你的 agent 遵循项目规则 |

### ⭐⭐ 高价值（增强能力）

| 模块 | 路径 | 功能 | 复用建议 |
|------|------|------|----------|
| **LSP 工具** | `tools/lsp/` | goto_definition, find_references, rename | 🟢 可直接复用 |
| **session-manager** | `tools/session-manager/` | 会话读写、搜索 | 🟡 参考设计，你有自己的会话系统 |
| **keyword-detector** | `hooks/keyword-detector/` | ultrawork/ulw 关键词检测 | 🟢 可复用，添加你的关键词 |
| **todo-continuation** | `hooks/todo-continuation-enforcer.ts` | 强制完成 TODO | 🟢 可复用 |
| **session-recovery** | `hooks/session-recovery/` | 错误恢复、自动重试 | 🟢 可复用 |

### ⭐ 有用（工具类）

| 模块 | 路径 | 功能 | 复用建议 |
|------|------|------|----------|
| **shared/logger.ts** | 日志工具 | 🟢 直接复用 |
| **shared/deep-merge.ts** | 深度合并 | 🟢 直接复用 |
| **shared/dynamic-truncator.ts** | 智能截断 | 🟢 直接复用 |
| **shared/frontmatter.ts** | Frontmatter 解析 | 🟢 直接复用 |
| **shared/jsonc-parser.ts** | JSONC 解析 | 🟢 直接复用 |
| **mcp/websearch.ts** | 网络搜索 MCP | 🟡 参考实现 |

---

## 三、复用方式

### 方式 1：直接 import（推荐简单工具）

```typescript
// 你的插件
import { log } from "oh-my-opencode/src/shared/logger";
import { deepMerge } from "oh-my-opencode/src/shared/deep-merge";
import { DynamicTruncator } from "oh-my-opencode/src/shared/dynamic-truncator";
import { parseFrontmatter } from "oh-my-opencode/src/shared/frontmatter";

// 使用
log("[MyPlugin] 初始化...");
const merged = deepMerge(config1, config2);
```

### 方式 2：复制并修改（推荐复杂模块）

对于你需要大幅修改的模块（如 BackgroundManager），建议：

```
my-plugin/src/
├── features/
│   └── background-agent/     # 复制 oh-my-opencode 的，修改为调用你的 SDK
├── hooks/
│   └── rules-injector/       # 复制并修改
└── shared/                   # 复制需要的工具
```

### 方式 3：作为 peerDependency + 选择性导入

```json
// package.json
{
  "peerDependencies": {
    "oh-my-opencode": ">=3.0.0"
  }
}
```

```typescript
// 只导入不涉及 oh-my-opencode 内部状态的模块
import { createRulesInjectorHook } from "oh-my-opencode/src/hooks/rules-injector";
import { lsp_goto_definition } from "oh-my-opencode/src/tools/lsp/tools";
```

---

## 四、针对你的场景的复用建议

你的需求：Agent 运行态用自己的 SDK，对接自己的 MCP/Skill/SubAgent

### 🟢 可以直接复用

| 模块 | 原因 |
|------|------|
| `shared/logger.ts` | 无状态，纯工具 |
| `shared/deep-merge.ts` | 无状态，纯工具 |
| `shared/dynamic-truncator.ts` | 无状态，可用于截断你的工具输出 |
| `shared/frontmatter.ts` | 无状态，可用于解析你的 Skill 文件 |
| `shared/jsonc-parser.ts` | 无状态，可用于解析配置 |
| `tools/lsp/` | LSP 工具不依赖 oh-my-opencode 状态 |
| `hooks/rules-injector/` | 可以给你的 agent 注入项目规则 |
| `hooks/keyword-detector/` | 可以检测你自己的关键词 |
| `features/context-injector/` | 可以给你的 agent 注入上下文 |

### 🟡 参考设计但不直接复用

| 模块 | 原因 |
|------|------|
| `features/background-agent/` | 你有自己的 SDK，但可以参考其并发控制、状态管理设计 |
| `tools/delegate-task/` | 你有自己的 SubAgent 系统，但可以参考其 prompt 构建、category 路由 |
| `tools/session-manager/` | 你有自己的会话系统，但可以参考其设计 |
| `agents/` | 可以参考 prompt 结构和 permission 设计 |

### 🔴 不需要复用

| 模块 | 原因 |
|------|------|
| `plugin-handlers/config-handler.ts` | 你需要自己的 config handler |
| `mcp/` | 你有自己的 MCP Server |
| `features/skill-mcp-manager/` | 你有自己的 Skill 系统 |
| `cli/` | 命令行工具，和你的插件无关 |

---

## 五、推荐的插件结构

结合 oh-my-opencode 架构和你的需求：

```
my-agent-platform-plugin/
├── package.json
├── src/
│   ├── index.ts                    # 插件入口
│   ├── plugin-config.ts            # 配置加载（参考 oh-my-opencode）
│   │
│   ├── agents/                     # Agent 定义（参考 oh-my-opencode/src/agents）
│   │   ├── index.ts
│   │   ├── my-coder.ts
│   │   ├── my-architect.ts
│   │   └── prompt-builder.ts       # 参考 oh-my-opencode 的 prompt 构建
│   │
│   ├── tools/                      # 工具（桥接到你的平台）
│   │   ├── index.ts
│   │   ├── bridge/                 # 桥接工具
│   │   │   ├── run-agent.ts        # 调用你平台的 Agent
│   │   │   ├── call-skill.ts       # 调用你平台的 Skill
│   │   │   ├── query-knowledge.ts  # 查询你平台的知识库
│   │   │   └── manage-session.ts   # 管理你平台的会话
│   │   ├── lsp/                    # 复用 oh-my-opencode 的 LSP 工具
│   │   └── local/                  # 本地工具
│   │
│   ├── hooks/                      # Hook 实现
│   │   ├── index.ts
│   │   ├── rules-injector/         # 复用 oh-my-opencode
│   │   ├── keyword-detector/       # 复用并扩展（加你的关键词）
│   │   ├── context-injector/       # 复用 oh-my-opencode
│   │   └── platform-bridge/        # 你的自定义 hook（转发到平台）
│   │
│   ├── features/                   # 核心功能
│   │   ├── platform-client/        # 你的平台 API 客户端
│   │   │   ├── index.ts
│   │   │   ├── agent-api.ts
│   │   │   ├── skill-api.ts
│   │   │   └── session-api.ts
│   │   └── context-collector/      # 复用 oh-my-opencode 的上下文收集
│   │
│   ├── mcp/                        # MCP 配置（指向你的 MCP Server）
│   │   └── index.ts
│   │
│   ├── shared/                     # 共享工具（从 oh-my-opencode 复制）
│   │   ├── logger.ts
│   │   ├── deep-merge.ts
│   │   ├── dynamic-truncator.ts
│   │   └── frontmatter.ts
│   │
│   └── config/                     # 配置 Schema
│       └── schema.ts
```

---

## 六、具体复用示例

### 示例 1：复用 Logger

```typescript
// 直接从 oh-my-opencode 导入
import { log } from "oh-my-opencode/src/shared/logger";

// 或者复制过来使用
// shared/logger.ts
import path from "path";
import os from "os";
import fs from "fs";

const logFile = path.join(os.tmpdir(), "my-platform-plugin.log");

export function log(message: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ""}\n`;
  fs.appendFileSync(logFile, logLine);
  console.log(`[MyPlatform] ${message}`, data || "");
}
```

### 示例 2：复用 Rules Injector

```typescript
// 直接使用 oh-my-opencode 的 rules-injector
import { createRulesInjectorHook } from "oh-my-opencode/src/hooks/rules-injector";

const MyPlugin: Plugin = async (ctx) => {
  // 复用 rules-injector
  const rulesInjector = createRulesInjectorHook(ctx);

  return {
    event: async (input) => {
      // 让你的 agent 也能注入规则
      await rulesInjector?.event(input);
    },
    "tool.execute.before": async (input, output) => {
      await rulesInjector?.["tool.execute.before"]?.(input, output);
    },
    "tool.execute.after": async (input, output) => {
      await rulesInjector?.["tool.execute.after"]?.(input, output);
    },
  };
};
```

### 示例 3：复用 LSP 工具

```typescript
// 直接导入 oh-my-opencode 的 LSP 工具
import {
  lsp_goto_definition,
  lsp_find_references,
  lsp_rename,
  lsp_document_symbols,
  lsp_diagnostics,
} from "oh-my-opencode/src/tools/lsp/tools";

const MyPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      // 你的桥接工具
      run_platform_agent: { ... },
      call_platform_skill: { ... },
      
      // 复用 oh-my-opencode 的 LSP 工具
      lsp_goto_definition,
      lsp_find_references,
      lsp_rename,
      lsp_document_symbols,
      lsp_diagnostics,
    },
  };
};
```

### 示例 4：复用 Keyword Detector 并扩展

```typescript
// 参考 oh-my-opencode 的 keyword-detector，扩展你的关键词
import { createKeywordDetectorHook } from "oh-my-opencode/src/hooks/keyword-detector";

// 或者自己实现一个简化版
function createMyKeywordDetector(ctx: PluginInput) {
  const keywords = {
    "@myplatform": "调用我的平台处理",
    "@mycoder": "调用我的代码专家",
    "@myreview": "调用我的代码审查",
  };

  return {
    "chat.message": async (input: any, output: any) => {
      const parts = output.parts as Array<{ type: string; text?: string }>;
      const text = parts.filter(p => p.type === "text").map(p => p.text).join("\n");

      for (const [keyword, hint] of Object.entries(keywords)) {
        if (text.includes(keyword)) {
          console.log(`[MyPlatform] 检测到关键词: ${keyword}`);
          // 可以注入额外上下文或提示
        }
      }
    },
  };
}
```

### 示例 5：参考 delegate-task 的 Prompt 构建

```typescript
// 参考 oh-my-opencode/src/tools/delegate-task/prompt-builder.ts
export function buildPromptForPlatformAgent(input: {
  task: string;
  context: {
    directory: string;
    files?: string[];
    instructions?: string;
  };
  agentId: string;
}): string {
  const sections: string[] = [];

  sections.push(`## 任务
${input.task}`);

  sections.push(`## 上下文
- 项目目录: ${input.context.directory}
- Agent: ${input.agentId}`);

  if (input.context.files?.length) {
    sections.push(`## 相关文件
${input.context.files.map(f => `- ${f}`).join("\n")}`);
  }

  if (input.context.instructions) {
    sections.push(`## 额外指令
${input.context.instructions}`);
  }

  return sections.join("\n\n");
}
```

---

## 七、fuyao-opencode 与 oh-my-opencode 的本质区别

在深入分析后，需要明确两者的本质区别，这直接决定了哪些能复用、哪些必须单独实现。

### 7.1 运行态差异

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     oh-my-opencode（配置注入方式）                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  oh-my-opencode           OpenCode 统一运行时                            │
│       │                        │                                        │
│       │  config hook           │                                        │
│       │  注入 Agent 配置       ▼                                        │
│       └──────────────────▶ SessionPrompt.loop                           │
│                                │                                        │
│  Agent 是配置对象：            │ 执行主体是 OpenCode：                    │
│  - sisyphus.prompt            │ - 消息循环                              │
│  - sisyphus.permission        │ - 工具执行                              │
│  - sisyphus.model             │ - 上下文管理                            │
│                               │ - 子任务调度（Task 工具）                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    fuyao-opencode（独立运行态方式）                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  OpenCode                        fuyao Python 运行时                    │
│       │                               │                                 │
│       │  工具调用                     │                                 │
│       │  run_platform_agent          │                                 │
│       └─────────────────────────▶    │                                 │
│                                      │ 执行主体是 Python：               │
│  OpenCode 只是入口：                 │ - 自己的消息循环                  │
│  - 接收用户输入                      │ - 自己的工具执行                  │
│  - 展示结果                          │ - 自己的上下文管理                │
│  - 注册桥接工具                      │ - 自己的子 Agent 调度             │
│                                      │ - 自己的 MCP/Skill 系统          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.2 关键差异总结

| 维度 | oh-my-opencode | fuyao-opencode |
|------|---------------|----------------|
| **Agent 本质** | 配置对象（prompt + permission） | 独立执行体（Python 类） |
| **执行主体** | OpenCode 的 `SessionPrompt.loop` | Python 后端服务 |
| **工具执行** | OpenCode 内置工具系统 | 转发到 Python 执行 |
| **子 Agent** | OpenCode 的 Task 工具 | Python 自己的调度 |
| **上下文管理** | OpenCode 的 ContextManager | Python 自己实现 |
| **MCP 对接** | OpenCode 的 MCP 机制 | Python 自己的 MCP Client |

---

## 八、fuyao-opencode 可复用的架构逻辑

基于上述分析，以下是 fuyao-opencode **可以复用**的部分：

### 8.1 ✅ 插件框架层（完全可复用）

| 模块 | 说明 | 复用方式 |
|------|------|---------|
| **插件入口结构** | `index.ts` 返回 Hooks 对象的模式 | 直接参照 |
| **config hook 模式** | 注入配置的方式 | 直接复用 |
| **tool 注册模式** | 通过 `tool` 属性注册工具 | 直接复用 |
| **event hook 模式** | 监听事件的方式 | 直接复用 |

```typescript
// fuyao-opencode 可以完全复用这个结构
const FuyaoPlugin: Plugin = async (ctx) => {
  return {
    config: async (input, output) => { /* 注入配置 */ },
    tool: { /* 注册桥接工具 */ },
    event: async (input) => { /* 监听事件 */ },
    "chat.message": async (input, output) => { /* 处理消息 */ },
  };
};
```

### 8.2 ✅ Hook 机制（可复用，但用途不同）

| Hook | oh-my-opencode 用途 | fuyao-opencode 用途 |
|------|---------------------|---------------------|
| **keyword-detector** | 检测 `@omo` 切换 Agent | 检测 `@fuyao` 转发到后端 |
| **rules-injector** | 给 sisyphus 注入规则 | 给 Python Agent 传递规则 |
| **chat.message** | 修改消息、注入提示 | 识别意图、决定是否转发 |
| **tool.execute.before** | 注入上下文 | 可用于日志、权限检查 |
| **tool.execute.after** | 截断输出、检查注释 | 可用于结果处理 |

### 8.3 ✅ 共享工具函数（完全可复用）

```typescript
// 这些无状态工具可以直接复用
import { log } from "oh-my-opencode/src/shared/logger";
import { deepMerge } from "oh-my-opencode/src/shared/deep-merge";
import { DynamicTruncator } from "oh-my-opencode/src/shared/dynamic-truncator";
import { parseFrontmatter } from "oh-my-opencode/src/shared/frontmatter";
import { parseJSONC } from "oh-my-opencode/src/shared/jsonc-parser";
```

### 8.4 ✅ 配置管理模式（可参考）

```typescript
// oh-my-opencode 的配置加载模式可以参考
// oh-my-opencode/src/plugin-config.ts
export function loadPluginConfig(directory: string, ctx: PluginInput) {
  // 1. 加载默认配置
  // 2. 加载项目配置 (.opencode/config.jsonc)
  // 3. 深度合并
  // 4. 返回配置对象
}

// fuyao-opencode 可以用类似模式
export function loadFuyaoConfig(directory: string) {
  // 加载 .opencode/fuyao.jsonc 或环境变量
}
```

---

## 九、fuyao-opencode 可复用的价值实现

### 9.1 ✅ LSP 工具（直接复用）

LSP 工具不依赖运行态，可以直接复用：

```typescript
// fuyao-opencode 可以直接注册这些工具
import {
  lsp_goto_definition,
  lsp_find_references,
  lsp_rename,
  lsp_document_symbols,
} from "oh-my-opencode/src/tools/lsp/tools";

// 这些工具在 OpenCode 中执行，Python 后端可以通过调用这些工具获取代码信息
```

### 9.2 ✅ 上下文收集（可复用思路）

```typescript
// oh-my-opencode 的上下文收集逻辑可以参考
// features/context-injector/

// fuyao-opencode 可以：
// 1. 在 TypeScript 层收集上下文（文件列表、git 状态等）
// 2. 通过 HTTP 传递给 Python 后端
// 3. Python 后端基于上下文执行任务
```

### 9.3 ✅ 工具输出截断（可复用）

```typescript
// oh-my-opencode 的动态截断器
import { DynamicTruncator } from "oh-my-opencode/src/shared/dynamic-truncator";

// fuyao-opencode 可以用于：
// 1. 截断 Python 返回的大量输出
// 2. 截断文件读取结果
const truncator = new DynamicTruncator({ maxLength: 10000 });
const truncated = truncator.truncate(pythonOutput);
```

### 9.4 ✅ 关键词检测模式（可复用并扩展）

```typescript
// 参考 oh-my-opencode 的 keyword-detector
// fuyao-opencode 可以检测自己的关键词
"chat.message": async (input, output) => {
  const text = extractText(output.parts);
  
  if (text.includes("@fuyao") || text.includes("@扶摇")) {
    // 标记这个消息需要转发到 Python 后端
    output.metadata = {
      ...output.metadata,
      fuyao_forward: true,
    };
  }
}
```

### 9.5 ✅ Agent 定义模式（可参考 prompt 结构）

```typescript
// oh-my-opencode 的 Agent prompt 结构可以参考
// 例如 agents/sisyphus.ts 的 prompt 组织方式

// fuyao-opencode 可以用类似结构定义 Agent 配置
// 然后传递给 Python 后端
const FUYAO_CODER_PROMPT = `
## 身份
你是扶摇平台的代码专家...

## 能力
- 代码生成
- 代码审查
- ...

## 约束
- ...
`;
```

---

## 十、fuyao-opencode 必须单独实现的部分

### 10.1 ❌ Agent 执行循环（必须自己实现）

**原因**：fuyao-opencode 的 Agent 在 Python 后端执行，不能使用 OpenCode 的 `SessionPrompt.loop`。

```python
# fuyao-opencode/python-server/agent/loop.py
class AgentExecutionLoop:
    """fuyao 必须自己实现的执行循环"""
    
    async def run(self, task: str, context: dict):
        while not self.is_complete:
            # 1. 组装 prompt（自己实现）
            prompt = self.build_prompt(task, context)
            
            # 2. 调用 LLM（自己实现）
            response = await self.llm.chat(prompt)
            
            # 3. 解析工具调用（自己实现）
            tool_calls = self.parse_tool_calls(response)
            
            # 4. 执行工具（自己实现）
            for call in tool_calls:
                result = await self.execute_tool(call)
            
            # 5. 管理上下文（自己实现）
            self.context_manager.update(response, results)
```

### 10.2 ❌ 工具执行引擎（必须自己实现）

**原因**：fuyao 的工具在 Python 中执行，不能使用 OpenCode 的 `Tool.execute()`。

```python
# fuyao-opencode/python-server/tools/executor.py
class ToolExecutor:
    """fuyao 必须自己实现的工具执行器"""
    
    def __init__(self):
        self.tools = {
            "read_file": ReadFileTool(),
            "write_file": WriteFileTool(),
            "run_command": RunCommandTool(),
            # ... 自己的工具实现
        }
    
    async def execute(self, tool_name: str, args: dict):
        tool = self.tools.get(tool_name)
        if not tool:
            raise ToolNotFoundError(tool_name)
        return await tool.execute(args)
```

### 10.3 ❌ 子 Agent 调度（必须自己实现）

**原因**：oh-my-opencode 使用 OpenCode 的 Task 工具，fuyao 需要自己的调度逻辑。

```python
# fuyao-opencode/python-server/agent/scheduler.py
class SubAgentScheduler:
    """fuyao 必须自己实现的子 Agent 调度"""
    
    async def delegate(self, task: str, agent_id: str):
        # 1. 获取子 Agent 配置
        agent = self.get_agent(agent_id)
        
        # 2. 创建子执行上下文
        sub_context = self.create_sub_context(task)
        
        # 3. 执行子 Agent（自己的执行循环）
        result = await agent.run(task, sub_context)
        
        # 4. 返回结果给父 Agent
        return result
```

### 10.4 ❌ MCP Client（必须自己实现）

**原因**：fuyao 可能需要对接自己的 MCP Server，不能直接使用 OpenCode 的 MCP 机制。

```python
# fuyao-opencode/python-server/mcp/client.py
class FuyaoMCPClient:
    """fuyao 必须自己实现的 MCP Client"""
    
    async def call_tool(self, server: str, tool: str, args: dict):
        # 通过 MCP 协议调用工具
        pass
    
    async def get_resource(self, server: str, uri: str):
        # 通过 MCP 协议获取资源
        pass
```

### 10.5 ❌ 上下文/会话管理（必须自己实现）

**原因**：fuyao 的会话状态在 Python 中维护。

```python
# fuyao-opencode/python-server/session/manager.py
class SessionManager:
    """fuyao 必须自己实现的会话管理"""
    
    def __init__(self):
        self.sessions = {}
    
    def create_session(self, session_id: str):
        self.sessions[session_id] = {
            "messages": [],
            "context": {},
            "state": "active",
        }
    
    def add_message(self, session_id: str, message: dict):
        self.sessions[session_id]["messages"].append(message)
    
    def get_context(self, session_id: str):
        return self.sessions[session_id]["context"]
```

### 10.6 ❌ Skill/知识库系统（必须自己实现）

**原因**：fuyao 有自己的 Skill 和知识库系统。

```python
# fuyao-opencode/python-server/skill/loader.py
class SkillLoader:
    """fuyao 必须自己实现的 Skill 系统"""
    
    def load_skill(self, skill_id: str):
        # 加载自己平台的 Skill
        pass
    
    def execute_skill(self, skill_id: str, args: dict):
        # 执行 Skill
        pass
```

---

## 十一、复用与自研对照表

| 功能领域 | 可复用（TypeScript 层） | 必须自研（Python 层） |
|----------|----------------------|---------------------|
| **插件框架** | ✅ Hook 机制、配置注入 | - |
| **工具注册** | ✅ tool 属性注册桥接工具 | ❌ 实际工具执行 |
| **Agent 定义** | ✅ prompt 结构参考 | ❌ Agent 执行循环 |
| **上下文收集** | ✅ 文件列表、git 状态 | ❌ 上下文管理、压缩 |
| **关键词检测** | ✅ keyword-detector 模式 | - |
| **LSP 工具** | ✅ 直接复用 | - |
| **子 Agent** | - | ❌ 调度逻辑 |
| **MCP 对接** | - | ❌ MCP Client |
| **会话管理** | - | ❌ 会话状态 |
| **Skill 系统** | - | ❌ Skill 加载/执行 |
| **工具截断** | ✅ DynamicTruncator | - |
| **日志/工具函数** | ✅ shared/* | - |

---

## 十二、总结

### 复用策略

| 复用策略 | 适用模块 | 方式 |
|----------|----------|------|
| **直接导入** | shared/、部分 tools/、部分 hooks/ | `import from "oh-my-opencode/src/..."` |
| **复制修改** | 需要大幅定制的模块 | 复制到你的项目，修改 |
| **参考设计** | 架构、prompt 构建、状态管理 | 学习其设计，自己实现 |
| **不复用** | 和你的 SDK 冲突的模块 | 自己实现 |

### 核心原则

1. **TypeScript 层**：尽量复用 oh-my-opencode 的模式（Hook、配置、工具注册）
2. **Python 层**：必须完全自研（执行循环、工具执行、子 Agent、MCP、会话管理）
3. **桥接层**：TypeScript 工具负责接收请求、转发到 Python、返回结果

### 架构建议

```
fuyao-opencode/
├── src/                          # TypeScript 层（复用 oh-my-opencode 模式）
│   ├── index.ts                  # 插件入口（✅ 复用模式）
│   ├── hooks/                    # Hook 实现（✅ 可复用 keyword-detector 等）
│   ├── tools/                    # 桥接工具（✅ 复用注册模式，❌ 执行转发到 Python）
│   └── shared/                   # 工具函数（✅ 直接复用）
│
└── python-server/                # Python 层（必须自研）
    ├── agent/                    # ❌ Agent 执行循环
    ├── tools/                    # ❌ 工具执行引擎
    ├── scheduler/                # ❌ 子 Agent 调度
    ├── mcp/                      # ❌ MCP Client
    ├── session/                  # ❌ 会话管理
    └── skill/                    # ❌ Skill 系统
```

这样既能复用 oh-my-opencode 的成熟插件框架，又能保持 fuyao-opencode 的独立运行态优势。
