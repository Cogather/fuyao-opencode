# OpenCode Agent 工作原理深度解读

本文档深度解析 OpenCode 在代码生成上的工作原理，包括如何读取项目、Agent 如何工作、以及如何与上下文、工具等周边依赖协作。

---

## 目录

1. [整体架构概览](#1-整体架构概览)
2. [主执行循环详解](#2-主执行循环详解)
3. [项目读取机制](#3-项目读取机制)
4. [工具系统详解](#4-工具系统详解)
5. [上下文管理机制](#5-上下文管理机制)
6. [Agent 与工具的协作](#6-agent-与工具的协作)
7. [子任务调度机制](#7-子任务调度机制)
8. [指令文件系统](#8-指令文件系统)
9. [完整执行流程图解](#9-完整执行流程图解)
10. [关键源码文件索引](#10-关键源码文件索引)

---

## 1. 整体架构概览

### 1.1 核心组件关系

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          OpenCode Agent 架构                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐                                                        │
│  │   用户输入       │                                                        │
│  └────────┬────────┘                                                        │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    SessionPrompt.loop (主执行循环)                    │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  1. 获取消息历史 (MessageV2.stream)                          │   │   │
│  │  │  2. 检查待处理任务 (subtask/compaction)                      │   │   │
│  │  │  3. 获取 Agent 配置 (Agent.get)                              │   │   │
│  │  │  4. 解析可用工具 (resolveTools)                              │   │   │
│  │  │  5. 组装系统提示词 (SystemPrompt + InstructionPrompt)        │   │   │
│  │  │  6. 调用 LLM (SessionProcessor.process)                      │   │   │
│  │  │  7. 处理工具调用 (Tool.execute)                              │   │   │
│  │  │  8. 检查上下文溢出 (SessionCompaction.isOverflow)            │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│           │                                                                 │
│           ▼                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│  │   工具系统       │    │   上下文管理     │    │   Agent 配置    │        │
│  │  • ReadTool     │    │  • 消息历史      │    │  • prompt      │        │
│  │  • EditTool     │    │  • Token 计数    │    │  • permission  │        │
│  │  • GlobTool     │    │  • 溢出检测      │    │  • model       │        │
│  │  • GrepTool     │    │  • 压缩机制      │    │  • mode        │        │
│  │  • BashTool     │    │  • 修剪机制      │    │                │        │
│  │  • TaskTool     │    └─────────────────┘    └─────────────────┘        │
│  └─────────────────┘                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 数据流向

```
用户消息 → Session 存储 → loop 读取 → Agent 配置加载 → 工具解析 → LLM 调用
                                                                    ↓
                                              工具执行结果 ← 工具调用 ← LLM 响应
                                                    ↓
                                              上下文更新 → 继续循环或完成
```

---

## 2. 主执行循环详解

### 2.1 loop 函数核心逻辑

**源码位置**: `packages/opencode/src/session/prompt.ts` 第 267-655 行

```typescript
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  // 1. 启动会话，获取中止信号
  const abort = start(sessionID)
  if (!abort) {
    // 如果已有循环在运行，等待其完成
    return new Promise<MessageV2.WithParts>((resolve, reject) => {
      const callbacks = state()[sessionID].callbacks
      callbacks.push({ resolve, reject })
    })
  }

  let step = 0
  const session = await Session.get(sessionID)
  
  // 2. 主循环：持续处理直到完成
  while (true) {
    SessionStatus.set(sessionID, { type: "busy" })
    if (abort.aborted) break
    
    // 2.1 获取并过滤消息历史（跳过已压缩的）
    let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))

    // 2.2 查找关键消息
    let lastUser: MessageV2.User | undefined
    let lastAssistant: MessageV2.Assistant | undefined
    let lastFinished: MessageV2.Assistant | undefined
    let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
    
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (!lastUser && msg.info.role === "user") lastUser = msg.info
      if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info
      // ... 收集待处理任务
    }

    // 2.3 检查是否已完成
    if (lastAssistant?.finish && 
        !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
        lastUser.id < lastAssistant.id) {
      break  // 退出循环
    }

    step++
    const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID)
    const task = tasks.pop()

    // 2.4 处理待处理的子任务
    if (task?.type === "subtask") {
      // 执行子任务（详见第7节）
      continue
    }

    // 2.5 处理上下文压缩任务
    if (task?.type === "compaction") {
      await SessionCompaction.process(...)
      continue
    }

    // 2.6 检查上下文溢出，自动触发压缩
    if (lastAssistant && await SessionCompaction.isOverflow({
      tokens: lastAssistant.tokens,
      model,
    })) {
      await SessionCompaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
      continue
    }

    // 2.7 获取 Agent 配置
    const agent = await Agent.get(lastUser.agent)

    // 2.8 创建处理器
    const processor = SessionProcessor.create({
      assistantMessage: await Session.updateMessage({ role: "assistant", ... }),
      sessionID,
      model,
      abort,
    })

    // 2.9 解析可用工具
    const tools = await resolveTools({
      agent,
      session,
      model,
      tools: lastUser.tools,
      processor,
      bypassAgentCheck,
      messages: msgs,
    })

    // 2.10 组装系统提示词并调用 LLM
    const result = await processor.process({
      user: lastUser,
      agent,
      abort,
      sessionID,
      system: [
        ...await SystemPrompt.environment(model),  // 环境信息
        ...await InstructionPrompt.system(),       // 指令文件
      ],
      messages: MessageV2.toModelMessages(sessionMessages, model),
      tools,
      model,
    })

    // 2.11 处理结果
    if (result === "stop") break
    if (result === "compact") {
      await SessionCompaction.create({ ... })
    }
    continue
  }
  
  // 循环结束后修剪旧工具输出
  SessionCompaction.prune({ sessionID })
})
```

### 2.2 执行循环状态机

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         执行循环状态机                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                          ┌─────────────┐                                │
│                          │   开始      │                                │
│                          └──────┬──────┘                                │
│                                 │                                       │
│                                 ▼                                       │
│                     ┌───────────────────────┐                           │
│          ┌──────────│  获取消息历史          │                           │
│          │          └───────────┬───────────┘                           │
│          │                      │                                       │
│          │                      ▼                                       │
│          │          ┌───────────────────────┐                           │
│          │          │  有待处理任务？         │                           │
│          │          └───────────┬───────────┘                           │
│          │                      │                                       │
│          │         是           │           否                          │
│          │    ┌─────────────────┼─────────────────┐                    │
│          │    ▼                 │                 ▼                    │
│          │ ┌─────────┐          │          ┌─────────────┐             │
│          │ │ subtask │          │          │ 上下文溢出？ │             │
│          │ └────┬────┘          │          └──────┬──────┘             │
│          │      │               │                 │                    │
│          │      ▼               │        是       │       否           │
│          │ 执行子任务           │    ┌────────────┼───────────┐        │
│          │      │               │    ▼            │           ▼        │
│          │      │               │ 创建压缩任务     │     正常处理        │
│          │      │               │    │            │     (调用 LLM)      │
│          │      │               │    │            │           │        │
│          └──────┴───────────────┴────┴────────────┴───────────┘        │
│                                 │                                       │
│                                 ▼                                       │
│                     ┌───────────────────────┐                           │
│                     │  finish 状态？         │                           │
│                     └───────────┬───────────┘                           │
│                                 │                                       │
│              stop/length        │        tool-calls/unknown             │
│                    ┌────────────┴────────────┐                          │
│                    ▼                         ▼                          │
│              ┌──────────┐              继续循环                          │
│              │   结束    │                                              │
│              └──────────┘                                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 项目读取机制

### 3.1 ReadTool - 文件读取核心

**源码位置**: `packages/opencode/src/tool/read.ts`

OpenCode 通过 `ReadTool` 读取项目文件，这是 Agent 理解代码的核心工具。

```typescript
export const ReadTool = Tool.define("read", {
  parameters: z.object({
    filePath: z.string().describe("The path to the file to read"),
    offset: z.coerce.number().optional(),  // 起始行号（0-based）
    limit: z.coerce.number().optional(),   // 读取行数（默认 2000）
  }),
  
  async execute(params, ctx) {
    // 1. 路径处理
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }

    // 2. 权限检查
    await ctx.ask({
      permission: "read",
      patterns: [filepath],
      always: ["*"],
      metadata: {},
    })

    // 3. 文件存在性检查（提供相似文件建议）
    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const suggestions = findSimilarFiles(dir, base)
      throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions}`)
    }

    // 4. 自动加载目录 AGENTS.md（上下文注入）
    const instructions = await InstructionPrompt.resolve(ctx.messages, filepath, ctx.messageID)

    // 5. 处理图片/PDF（返回 base64 附件）
    if (isImage || isPdf) {
      return {
        attachments: [{
          type: "file",
          mime,
          url: `data:${mime};base64,${Buffer.from(await file.bytes()).toString("base64")}`,
        }],
      }
    }

    // 6. 读取文本文件（带限制）
    const limit = params.limit ?? 2000  // 默认 2000 行
    const offset = params.offset || 0
    const lines = await file.text().then(text => text.split("\n"))

    // 7. 字节数限制（MAX_BYTES = 50KB）
    const raw: string[] = []
    let bytes = 0
    for (let i = offset; i < Math.min(lines.length, offset + limit); i++) {
      const line = lines[i].length > 2000 
        ? lines[i].substring(0, 2000) + "..."  // 单行最长 2000 字符
        : lines[i]
      const size = Buffer.byteLength(line, "utf-8")
      if (bytes + size > 50 * 1024) {  // 50KB 限制
        truncatedByBytes = true
        break
      }
      raw.push(line)
      bytes += size
    }

    // 8. 格式化输出（带行号）
    const content = raw.map((line, index) => {
      return `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`
    })

    // 9. 预热 LSP 客户端（用于后续代码分析）
    LSP.touchFile(filepath, false)
    
    // 10. 记录读取时间（用于编辑时的冲突检测）
    FileTime.read(ctx.sessionID, filepath)

    // 11. 附加目录指令文件内容
    if (instructions.length > 0) {
      output += `\n\n<system-reminder>\n${instructions.map(i => i.content).join("\n\n")}\n</system-reminder>`
    }

    return { title, output, metadata: { preview, truncated } }
  },
})
```

### 3.2 读取限制与优化

| 限制项 | 值 | 说明 |
|--------|------|------|
| DEFAULT_READ_LIMIT | 2000 行 | 单次读取最大行数 |
| MAX_LINE_LENGTH | 2000 字符 | 单行最大长度 |
| MAX_BYTES | 50 KB | 单次读取最大字节数 |

**为什么有这些限制？**

1. **防止上下文爆炸**：大文件会迅速消耗 Token 预算
2. **保持响应速度**：减少 LLM 处理时间
3. **节省成本**：Token 计费按量收费

### 3.3 GlobTool - 文件搜索

**源码位置**: `packages/opencode/src/tool/glob.ts`

用于搜索文件，帮助 Agent 定位目标文件：

```typescript
export const GlobTool = Tool.define("glob", {
  parameters: z.object({
    pattern: z.string(),  // glob 模式，如 "**/*.ts"
    path: z.string().optional(),
  }),
  
  async execute(params, ctx) {
    // 使用 Ripgrep 高效搜索
    const files = []
    for await (const file of Ripgrep.files({
      cwd: search,
      glob: [params.pattern],
      signal: ctx.abort,
    })) {
      if (files.length >= 100) {  // 限制 100 个文件
        truncated = true
        break
      }
      files.push({ path: full, mtime: stats })
    }
    
    // 按修改时间排序（最新的在前）
    files.sort((a, b) => b.mtime - a.mtime)
    
    return { title, output, metadata: { count, truncated } }
  },
})
```

### 3.4 GrepTool - 内容搜索

**源码位置**: `packages/opencode/src/tool/grep.ts`

用于在代码中搜索特定内容：

```typescript
export const GrepTool = Tool.define("grep", {
  parameters: z.object({
    pattern: z.string(),  // 正则表达式
    path: z.string().optional(),
    include: z.string().optional(),  // 文件过滤
  }),
  
  async execute(params, ctx) {
    // 使用 ripgrep 搜索
    const proc = Bun.spawn([rgPath, "-nH", "--regexp", params.pattern, ...])
    
    // 解析输出
    const matches = []
    for (const line of lines) {
      const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
      matches.push({ path: filePath, lineNum, lineText })
    }
    
    // 按修改时间排序，限制 100 条
    matches.sort((a, b) => b.modTime - a.modTime)
    return matches.slice(0, 100)
  },
})
```

### 3.5 项目读取的典型流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Agent 读取项目的典型流程                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 用户提问："帮我修复 src/utils/api.ts 中的 bug"                       │
│                                                                         │
│  2. Agent 首先使用 glob 搜索文件                                         │
│     └─ glob({ pattern: "**/api.ts" })                                   │
│     └─ 返回：src/utils/api.ts, src/lib/api.ts, ...                      │
│                                                                         │
│  3. Agent 读取目标文件                                                   │
│     └─ read({ filePath: "src/utils/api.ts" })                           │
│     └─ 返回：带行号的文件内容 + 目录 AGENTS.md 指令                       │
│                                                                         │
│  4. 如果需要理解依赖，搜索相关代码                                        │
│     └─ grep({ pattern: "import.*api", include: "*.ts" })                │
│     └─ 返回：所有导入该文件的位置                                        │
│                                                                         │
│  5. Agent 分析代码，生成修复方案                                         │
│                                                                         │
│  6. 使用 edit 工具修改文件                                               │
│     └─ edit({ filePath: "...", oldString: "...", newString: "..." })    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 工具系统详解

### 4.1 工具注册表

**源码位置**: `packages/opencode/src/tool/registry.ts`

```typescript
export namespace ToolRegistry {
  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then(x => x.custom)  // 自定义工具
    const config = await Config.get()
    
    return [
      InvalidTool,        // 无效工具（用于错误处理）
      QuestionTool,       // 向用户提问
      BashTool,           // 执行 Shell 命令
      ReadTool,           // 读取文件
      GlobTool,           // 搜索文件
      GrepTool,           // 搜索内容
      EditTool,           // 编辑文件
      WriteTool,          // 写入文件
      TaskTool,           // 启动子任务
      WebFetchTool,       // 获取网页
      TodoWriteTool,      // 写入 TODO
      TodoReadTool,       // 读取 TODO
      WebSearchTool,      // 网络搜索
      CodeSearchTool,     // 代码搜索
      SkillTool,          // 技能工具
      ApplyPatchTool,     // 应用补丁（GPT-4 专用）
      ...custom,          // 用户自定义工具
    ]
  }
}
```

### 4.2 工具解析 (resolveTools)

**源码位置**: `packages/opencode/src/session/prompt.ts` 第 664-834 行

```typescript
async function resolveTools(input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  tools?: Record<string, boolean>
  processor: SessionProcessor.Info
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
}) {
  const tools: Record<string, AITool> = {}

  // 1. 为每个工具创建执行上下文
  const context = (args: any, options: ToolCallOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    agent: input.agent.name,
    messages: input.messages,  // 传递消息历史
    
    // 更新工具调用元数据（实时展示进度）
    metadata: async (val) => {
      const match = input.processor.partFromToolCall(options.toolCallId)
      if (match && match.state.status === "running") {
        await Session.updatePart({ ...match, state: { ...val, status: "running" } })
      }
    },
    
    // 权限检查（会触发用户确认）
    ask: async (req) => {
      await PermissionNext.ask({
        ...req,
        sessionID: input.session.id,
        ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
      })
    },
  })

  // 2. 从注册表获取工具并包装
  for (const item of await ToolRegistry.tools(input.model, input.agent)) {
    tools[item.id] = tool({
      id: item.id,
      description: item.description,
      inputSchema: jsonSchema(schema),
      
      async execute(args, options) {
        // 2.1 触发插件钩子（before）
        await Plugin.trigger("tool.execute.before", {
          tool: item.id,
          sessionID: input.session.id,
          callID: options.toolCallId,
        }, { args })
        
        // 2.2 执行工具
        const result = await item.execute(args, context(args, options))
        
        // 2.3 触发插件钩子（after）
        await Plugin.trigger("tool.execute.after", {
          tool: item.id,
          sessionID: input.session.id,
          callID: options.toolCallId,
        }, result)
        
        return result
      },
    })
  }

  // 3. 添加 MCP 工具
  for (const [key, item] of Object.entries(await MCP.tools())) {
    tools[key] = item
  }

  // 4. 添加插件注册的工具
  const plugin = await Plugin.trigger("tool", {}, {})
  for (const [name, t] of Object.entries(plugin)) {
    tools[name] = tool({
      id: name,
      description: t.description,
      inputSchema: jsonSchema(t.schema),
      async execute(args, options) {
        return t.execute(args, context(args, options))
      },
    })
  }

  return tools
}
```

### 4.3 EditTool - 代码编辑核心

**源码位置**: `packages/opencode/src/tool/edit.ts`

这是 OpenCode 代码生成效果好的关键工具之一：

```typescript
export const EditTool = Tool.define("edit", {
  parameters: z.object({
    filePath: z.string(),
    oldString: z.string(),   // 要替换的文本
    newString: z.string(),   // 替换后的文本
    replaceAll: z.boolean().optional(),
  }),
  
  async execute(params, ctx) {
    // 1. 文件时间戳检查（防止覆盖用户修改）
    await FileTime.assert(ctx.sessionID, filePath)
    
    // 2. 读取原内容
    contentOld = await file.text()
    
    // 3. 使用多种策略进行替换（这是代码编辑效果好的核心）
    contentNew = replace(contentOld, params.oldString, params.newString, params.replaceAll)
    
    // 4. 权限检查（展示 diff）
    diff = createTwoFilesPatch(filePath, filePath, contentOld, contentNew)
    await ctx.ask({
      permission: "edit",
      patterns: [filePath],
      metadata: { filepath: filePath, diff },
    })
    
    // 5. 写入文件
    await file.write(contentNew)
    
    // 6. LSP 诊断检查（检测引入的错误）
    const diagnostics = await LSP.diagnostics()
    if (errors.length > 0) {
      output += `\n\nLSP errors detected:\n${errors.join("\n")}`
    }
    
    return { title, output, metadata: { diff, diagnostics } }
  },
})
```

### 4.4 替换策略（Edit 成功率高的秘密）

OpenCode 使用多种替换策略来提高编辑成功率：

```typescript
// 替换策略（按顺序尝试，直到成功）
const REPLACERS = [
  SimpleReplacer,              // 精确匹配
  LineTrimmedReplacer,         // 行级 trim 匹配
  BlockAnchorReplacer,         // 块锚点匹配（首尾行匹配）
  WhitespaceNormalizedReplacer, // 空白规范化匹配
  IndentationFlexibleReplacer, // 缩进灵活匹配
  EscapeNormalizedReplacer,    // 转义规范化匹配
  ContextAwareReplacer,        // 上下文感知匹配
]

function replace(content: string, oldString: string, newString: string) {
  for (const Replacer of REPLACERS) {
    const result = new Replacer().replace(content, oldString, newString)
    if (result !== null) {
      return result  // 成功则返回
    }
  }
  throw new Error("No matching content found")
}
```

| 替换器 | 说明 | 场景 |
|--------|------|------|
| SimpleReplacer | 精确字符串匹配 | 理想情况 |
| LineTrimmedReplacer | 忽略行首尾空白 | 格式化差异 |
| BlockAnchorReplacer | 首尾行匹配，中间模糊 | 代码块变化 |
| WhitespaceNormalizedReplacer | 规范化所有空白 | 空白差异 |
| IndentationFlexibleReplacer | 允许缩进变化 | 缩进不一致 |
| EscapeNormalizedReplacer | 规范化转义字符 | 转义差异 |
| ContextAwareReplacer | 基于上下文模糊匹配 | 最后兜底 |

### 4.5 BashTool - 命令执行

**源码位置**: `packages/opencode/src/tool/bash.ts`

```typescript
export const BashTool = Tool.define("bash", {
  parameters: z.object({
    command: z.string(),
    timeout: z.number().optional(),  // 默认 2 分钟
    workdir: z.string().optional(),
    description: z.string(),         // 命令描述（必须）
  }),
  
  async execute(params, ctx) {
    // 1. 解析命令，提取路径和命令模式（用于权限检查）
    const tree = await parser().then(p => p.parse(params.command))
    
    // 2. 权限检查
    await ctx.ask({
      permission: "bash",
      patterns: [...patterns],
      metadata: { description: params.description },
    })
    
    // 3. 执行命令
    const proc = spawn(params.command, {
      shell: Shell.preferred(),
      cwd: params.workdir || Instance.directory,
      stdio: ["ignore", "pipe", "pipe"],
    })
    
    // 4. 实时更新输出（流式展示）
    proc.stdout?.on("data", (chunk) => {
      output += chunk.toString()
      ctx.metadata({ metadata: { output, description: params.description } })
    })
    
    // 5. 超时处理
    const timeoutTimer = setTimeout(() => kill(), timeout)
    
    // 6. 中止信号处理
    ctx.abort.addEventListener("abort", () => kill())
    
    return { title: params.description, output, metadata: { output, exit } }
  },
})
```

---

## 5. 上下文管理机制

### 5.1 消息历史结构

**源码位置**: `packages/opencode/src/session/message-v2.ts`

```typescript
export namespace MessageV2 {
  // 用户消息
  export type User = {
    id: string
    role: "user"
    agent: string                    // 当前使用的 Agent
    model: { providerID: string; modelID: string }
    parts: Part[]                    // 消息部分
  }
  
  // 助手消息
  export type Assistant = {
    id: string
    role: "assistant"
    agent: string
    finish?: "tool-calls" | "stop" | "length" | "unknown"
    tokens: {
      input: number
      output: number
      reasoning: number
      cache: { read: number; write: number }
    }
    summary?: boolean                // 是否为压缩后的摘要
  }
  
  // 消息部分类型
  export type Part = 
    | { type: "text"; text: string }
    | { type: "file"; mime: string; url: string }
    | { type: "tool"; tool: string; callID: string; state: ToolState }
    | { type: "subtask"; agent: string; prompt: string; description: string }
    | { type: "compaction"; auto: boolean }
    | { type: "reasoning"; content: string }
}
```

### 5.2 上下文溢出检测

**源码位置**: `packages/opencode/src/session/compaction.ts`

```typescript
export namespace SessionCompaction {
  export async function isOverflow(input: {
    tokens: MessageV2.Assistant["tokens"]
    model: Provider.Model
  }) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return false
    
    const context = input.model.limit.context
    if (context === 0) return false
    
    // 计算已使用的 token 数
    const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
    
    // 计算可用上下文大小
    const output = Math.min(input.model.limit.output, OUTPUT_TOKEN_MAX)
    const usable = input.model.limit.input || context - output
    
    return count > usable  // 超过则溢出
  }
}
```

### 5.3 上下文压缩 (Compaction)

当上下文溢出时，自动触发压缩：

```typescript
export async function process(input: {
  messages: MessageV2.WithParts[]
  sessionID: string
  abort: AbortSignal
  auto: boolean
}) {
  // 1. 使用 compaction Agent 生成摘要
  const agent = await Agent.get("compaction")
  const processor = SessionProcessor.create(...)
  
  // 2. 压缩提示词
  const defaultPrompt = `
    Provide a detailed prompt for continuing our conversation above.
    Focus on information that would be helpful for continuing the conversation,
    including what we did, what we're doing, which files we're working on,
    and what we're going to do next considering new session will not have
    access to our conversation.
  `
  
  // 3. 允许插件注入额外上下文
  const compacting = await Plugin.trigger(
    "experimental.session.compacting",
    { sessionID: input.sessionID },
    { context: [], prompt: undefined },
  )
  
  // 4. 调用 LLM 生成压缩摘要
  const result = await processor.process({
    messages: [
      ...MessageV2.toModelMessages(input.messages, model),
      { role: "user", content: [{ type: "text", text: promptText }] },
    ],
    tools: {},
    system: [],
  })
  
  // 5. 标记为摘要消息
  msg.summary = true
  
  // 6. 如果是自动压缩，添加继续提示
  if (result === "continue" && input.auto) {
    await Session.updatePart({
      type: "text",
      synthetic: true,
      text: "Continue if you have next steps",
    })
  }
}
```

### 5.4 工具输出修剪 (Prune)

为了控制上下文大小，会修剪旧的工具输出：

```typescript
export async function prune(input: { sessionID: string }) {
  const PRUNE_MINIMUM = 20_000   // 至少修剪 20K tokens
  const PRUNE_PROTECT = 40_000   // 保护最近 40K tokens
  const PRUNE_PROTECTED_TOOLS = ["skill"]  // 不修剪的工具
  
  // 从后往前遍历，找到 40K tokens 的工具调用
  let total = 0
  const toPrune = []
  
  for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
    const msg = msgs[msgIndex]
    for (const part of msg.parts) {
      if (part.type === "tool" && part.state.status === "completed") {
        if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue
        
        const estimate = Token.estimate(part.state.output)
        total += estimate
        
        if (total > PRUNE_PROTECT) {
          toPrune.push(part)  // 标记为需要修剪
        }
      }
    }
  }
  
  // 执行修剪（标记 compacted 时间戳）
  if (pruned > PRUNE_MINIMUM) {
    for (const part of toPrune) {
      part.state.time.compacted = Date.now()
      await Session.updatePart(part)
    }
  }
}
```

### 5.5 上下文管理图解

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        上下文管理流程                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Token 计数                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  input: 12,000 + cache.read: 5,000 + output: 3,000 = 20,000     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                              ▼                                          │
│                    ┌───────────────────┐                                │
│                    │ usable > count ?  │                                │
│                    └─────────┬─────────┘                                │
│                              │                                          │
│              是              │              否                           │
│         ┌────────────────────┴────────────────────┐                    │
│         ▼                                         ▼                    │
│  ┌─────────────┐                        ┌─────────────────┐            │
│  │  正常继续    │                        │  触发压缩流程    │            │
│  └─────────────┘                        └────────┬────────┘            │
│                                                  │                     │
│                                                  ▼                     │
│                                      ┌─────────────────────┐           │
│                                      │ 1. 创建压缩消息      │           │
│                                      │ 2. 调用 LLM 摘要     │           │
│                                      │ 3. 标记旧消息已压缩   │           │
│                                      │ 4. 继续执行          │           │
│                                      └─────────────────────┘           │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       工具输出修剪                                │   │
│  │                                                                   │   │
│  │  消息历史: [msg1, msg2, msg3, msg4, msg5, msg6, msg7, msg8]      │   │
│  │                 ↑                              ↑                  │   │
│  │           修剪这些工具输出              保护最近 40K tokens        │   │
│  │                                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Agent 与工具的协作

### 6.1 Agent 配置如何影响工具

```typescript
// Agent 配置
const agent: Agent.Info = {
  name: "build",
  prompt: "You are an expert software engineer...",
  permission: {
    edit: "allow",
    bash: "allow",
    read: "allow",
    glob: "allow",
    grep: "allow",
    task: "allow",
  },
  mode: "primary",
}

// 工具解析时根据 permission 过滤
const tools = await ToolRegistry.tools(model, agent)
  .filter(tool => {
    const rule = PermissionNext.evaluate(tool.id, "*", agent.permission)
    return rule.action !== "deny"
  })
```

### 6.2 权限检查流程

```typescript
// 每个工具执行前都会进行权限检查
async function execute(args, ctx) {
  // ctx.ask 会触发权限检查
  await ctx.ask({
    permission: "edit",              // 权限类型
    patterns: [filePath],            // 资源模式
    always: ["*"],                   // 总是允许的模式
    metadata: { filepath, diff },    // 元数据（展示给用户）
  })
  
  // 只有用户确认后才会继续执行
  // ...
}
```

### 6.3 工具调用与消息的关系

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    工具调用与消息的关系                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User Message                                                           │
│  ├── parts: [{ type: "text", text: "帮我修复 bug" }]                    │
│                                                                         │
│  Assistant Message                                                      │
│  ├── parts:                                                             │
│  │   ├── { type: "text", text: "我来帮你分析代码" }                      │
│  │   ├── { type: "tool", tool: "read", state: { status: "completed" } } │
│  │   │   └── state.output: "00001| function foo() { ... }"              │
│  │   ├── { type: "text", text: "我发现了问题" }                          │
│  │   ├── { type: "tool", tool: "edit", state: { status: "completed" } } │
│  │   │   └── state.metadata: { diff: "..." }                            │
│  │   └── { type: "text", text: "已修复" }                                │
│  └── finish: "stop"                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.4 消息转换为 LLM 格式

```typescript
export function toModelMessages(messages: MessageV2.WithParts[], model: Provider.Model) {
  const result = []
  
  for (const msg of messages) {
    if (msg.info.role === "user") {
      result.push({
        role: "user",
        content: msg.parts
          .filter(p => p.type === "text" && !p.ignored)
          .map(p => ({ type: "text", text: p.text })),
      })
    }
    
    if (msg.info.role === "assistant") {
      const content = []
      
      for (const part of msg.parts) {
        if (part.type === "text") {
          content.push({ type: "text", text: part.text })
        }
        
        if (part.type === "tool") {
          // 工具调用
          content.push({
            type: "tool_use",
            id: part.callID,
            name: part.tool,
            input: part.state.input,
          })
        }
      }
      
      result.push({ role: "assistant", content })
      
      // 工具结果作为单独消息
      for (const part of msg.parts) {
        if (part.type === "tool" && part.state.status === "completed") {
          result.push({
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: part.callID,
              content: part.state.output,
            }],
          })
        }
      }
    }
  }
  
  return result
}
```

---

## 7. 子任务调度机制

### 7.1 TaskTool - 子任务入口

**源码位置**: `packages/opencode/src/tool/task.ts`

```typescript
export const TaskTool = Tool.define("task", async (ctx) => {
  // 获取可用的子 Agent
  const agents = await Agent.list().then(x => x.filter(a => a.mode !== "primary"))
  
  return {
    parameters: z.object({
      description: z.string().describe("A short (3-5 words) description of the task"),
      prompt: z.string().describe("The task for the agent to perform"),
      subagent_type: z.string().describe("The type of specialized agent to use"),
    }),
    
    async execute(params, ctx) {
      // 1. 权限检查
      await ctx.ask({
        permission: "task",
        patterns: [params.subagent_type],
        metadata: { description: params.description, subagent_type: params.subagent_type },
      })
      
      // 2. 获取子 Agent 配置
      const agent = await Agent.get(params.subagent_type)
      
      // 3. 创建子会话
      const session = await Session.create({
        parentID: ctx.sessionID,
        title: params.description + ` (@${agent.name} subagent)`,
        permission: [
          { permission: "todowrite", pattern: "*", action: "deny" },
          { permission: "todoread", pattern: "*", action: "deny" },
          // ... 子任务默认禁用一些权限
        ],
      })
      
      // 4. 启动子任务执行
      const result = await SessionPrompt.prompt({
        sessionID: session.id,
        model: agent.model ?? { modelID: msg.info.modelID, providerID: msg.info.providerID },
        parts: promptParts,
      })
      
      // 5. 返回结果
      return {
        title: params.description,
        output: lastMessage?.parts.filter(p => p.type === "text").map(p => p.text).join("\n"),
        metadata: { sessionId: session.id },
      }
    },
  }
})
```

### 7.2 子任务执行流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        子任务执行流程                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  主 Agent (build)                                                       │
│       │                                                                 │
│       │ task({ subagent_type: "explore", prompt: "搜索相关代码" })       │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       TaskTool.execute                           │   │
│  │                                                                   │   │
│  │  1. 创建子会话 (parentID = 主会话 ID)                             │   │
│  │  2. 应用子 Agent 权限限制                                         │   │
│  │  3. 调用 SessionPrompt.prompt 启动子循环                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  子 Agent (explore)                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  独立的执行循环（但共享文件系统）                                  │   │
│  │                                                                   │   │
│  │  explore Agent 的权限：                                           │   │
│  │  - read: allow                                                    │   │
│  │  - glob: allow                                                    │   │
│  │  - grep: allow                                                    │   │
│  │  - edit: deny   ← 只读 Agent                                      │   │
│  │  - bash: deny                                                     │   │
│  │  - task: deny   ← 不能再启动子任务                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       │ 返回搜索结果                                                    │
│       ▼                                                                 │
│  主 Agent 继续处理                                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.3 子任务在主循环中的处理

```typescript
// packages/opencode/src/session/prompt.ts 第 327-468 行
if (task?.type === "subtask") {
  // 1. 获取 TaskTool
  const taskTool = await TaskTool.init()
  
  // 2. 创建助手消息
  const assistantMessage = await Session.updateMessage({
    role: "assistant",
    agent: task.agent,
    // ...
  })
  
  // 3. 创建工具调用部分
  let part = await Session.updatePart({
    type: "tool",
    tool: TaskTool.id,
    state: { status: "running", input: { ... } },
  })
  
  // 4. 触发插件钩子
  await Plugin.trigger("tool.execute.before", { tool: "task", ... })
  
  // 5. 执行子任务
  const taskCtx: Tool.Context = {
    agent: task.agent,
    sessionID: sessionID,
    abort,
    messages: msgs,
    ask: async (req) => {
      await PermissionNext.ask({
        ...req,
        ruleset: PermissionNext.merge(taskAgent.permission, session.permission ?? []),
      })
    },
  }
  
  const result = await taskTool.execute(taskArgs, taskCtx)
  
  // 6. 触发插件钩子
  await Plugin.trigger("tool.execute.after", { tool: "task", ... }, result)
  
  // 7. 更新工具调用状态
  await Session.updatePart({
    ...part,
    state: { status: "completed", output: result.output, ... },
  })
  
  continue  // 继续主循环
}
```

---

## 8. 指令文件系统

### 8.1 指令文件加载

**源码位置**: `packages/opencode/src/session/instruction.ts`

OpenCode 会自动加载项目中的指令文件，注入到系统提示词：

```typescript
const FILES = [
  "AGENTS.md",   // OpenCode 官方格式
  "CLAUDE.md",   // Claude Code 兼容
  "CONTEXT.md",  // 已废弃
]

export namespace InstructionPrompt {
  // 系统级指令文件路径
  export async function systemPaths() {
    const paths = new Set<string>()
    
    // 1. 项目目录指令文件（向上查找）
    for (const file of FILES) {
      const matches = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
      if (matches.length > 0) {
        matches.forEach(p => paths.add(path.resolve(p)))
        break
      }
    }
    
    // 2. 全局配置目录指令文件
    for (const file of globalFiles()) {
      if (await Bun.file(file).exists()) {
        paths.add(path.resolve(file))
        break
      }
    }
    
    // 3. 配置文件中指定的指令文件
    if (config.instructions) {
      for (let instruction of config.instructions) {
        // 支持 URL、绝对路径、相对路径、glob
        const matches = await resolveInstruction(instruction)
        matches.forEach(p => paths.add(path.resolve(p)))
      }
    }
    
    return paths
  }
  
  // 加载系统指令内容
  export async function system() {
    const paths = await systemPaths()
    
    const files = Array.from(paths).map(async (p) => {
      const content = await Bun.file(p).text().catch(() => "")
      return content ? "Instructions from: " + p + "\n" + content : ""
    })
    
    // 支持 URL 指令
    const urls = config.instructions?.filter(i => i.startsWith("http"))
    const fetches = urls.map(url =>
      fetch(url, { signal: AbortSignal.timeout(5000) })
        .then(res => res.ok ? res.text() : "")
        .then(x => x ? "Instructions from: " + url + "\n" + x : "")
    )
    
    return Promise.all([...files, ...fetches]).then(result => result.filter(Boolean))
  }
}
```

### 8.2 目录级指令注入

当读取文件时，自动加载该目录的 AGENTS.md：

```typescript
// packages/opencode/src/tool/read.ts
async execute(params, ctx) {
  // ...
  
  // 自动加载目录指令
  const instructions = await InstructionPrompt.resolve(ctx.messages, filepath, ctx.messageID)
  
  // ...
  
  // 附加到输出末尾
  if (instructions.length > 0) {
    output += `\n\n<system-reminder>\n${instructions.map(i => i.content).join("\n\n")}\n</system-reminder>`
  }
}

// packages/opencode/src/session/instruction.ts
export async function resolve(messages: MessageV2.WithParts[], filepath: string, messageID: string) {
  const system = await systemPaths()  // 系统级已加载的
  const already = loaded(messages)     // 会话中已加载的
  const results = []
  
  // 从文件所在目录向上查找 AGENTS.md
  let current = path.dirname(filepath)
  const root = path.resolve(Instance.directory)
  
  while (current.startsWith(root) && current !== root) {
    const found = await find(current)  // 查找 AGENTS.md
    
    // 避免重复加载
    if (found && !system.has(found) && !already.has(found) && !isClaimed(messageID, found)) {
      claim(messageID, found)
      const content = await Bun.file(found).text()
      results.push({ filepath: found, content: "Instructions from: " + found + "\n" + content })
    }
    
    current = path.dirname(current)
  }
  
  return results
}
```

### 8.3 指令文件的作用

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        指令文件的作用                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  项目根目录/AGENTS.md                                                    │
│  ├── 项目整体说明                                                        │
│  ├── 代码规范要求                                                        │
│  ├── 架构约束                                                           │
│  └── 技术栈说明                                                          │
│                                                                         │
│  src/components/AGENTS.md                                               │
│  ├── 组件开发规范                                                        │
│  ├── 样式要求                                                           │
│  └── 命名约定                                                           │
│                                                                         │
│  src/api/AGENTS.md                                                      │
│  ├── API 设计规范                                                        │
│  ├── 错误处理要求                                                        │
│  └── 认证约定                                                           │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  当 Agent 读取 src/api/user.ts 时，会自动注入：                    │   │
│  │  1. 项目根目录/AGENTS.md（系统级）                                 │   │
│  │  2. src/api/AGENTS.md（目录级）                                   │   │
│  │                                                                   │   │
│  │  这使得 Agent 能够遵循不同目录的特定规范                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 9. 完整执行流程图解

### 9.1 单次交互完整流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      单次交互完整流程                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  用户: "帮我在 src/utils/api.ts 中添加错误处理"                          │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 1: 创建用户消息                                            │   │
│  │  • 存储到 Session                                                │   │
│  │  • 记录 agent: "build", model: "claude-3.5-sonnet"              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 2: 进入主循环 (SessionPrompt.loop)                         │   │
│  │  • 获取消息历史                                                   │   │
│  │  • 检查待处理任务（无）                                           │   │
│  │  • 检查上下文溢出（否）                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 3: 准备 LLM 调用                                           │   │
│  │  • Agent.get("build") → 获取 Agent 配置                          │   │
│  │  • resolveTools() → 解析可用工具                                  │   │
│  │  • SystemPrompt.environment() → 环境信息                         │   │
│  │  • InstructionPrompt.system() → 加载 AGENTS.md                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 4: 调用 LLM (SessionProcessor.process)                     │   │
│  │  • 发送: system prompt + 消息历史 + 工具定义                      │   │
│  │  • 流式接收响应                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 5: LLM 决定读取文件                                        │   │
│  │  • LLM 输出: tool_use(read, { filePath: "src/utils/api.ts" })   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 6: 执行 ReadTool                                           │   │
│  │  • Plugin.trigger("tool.execute.before")                         │   │
│  │  • ctx.ask({ permission: "read" }) → 权限检查                    │   │
│  │  • 读取文件内容（带行号）                                         │   │
│  │  • InstructionPrompt.resolve() → 加载目录 AGENTS.md              │   │
│  │  • Plugin.trigger("tool.execute.after")                          │   │
│  │  • 返回: 文件内容 + 目录指令                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 7: LLM 继续处理                                            │   │
│  │  • 分析代码                                                       │   │
│  │  • 决定编辑: tool_use(edit, { oldString: "...", newString: "..." })
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 8: 执行 EditTool                                           │   │
│  │  • FileTime.assert() → 检查文件是否被外部修改                     │   │
│  │  • replace() → 多策略替换（7种替换器）                            │   │
│  │  • ctx.ask({ permission: "edit", metadata: { diff } })           │   │
│  │  • 写入文件                                                       │   │
│  │  • LSP.diagnostics() → 检查引入的错误                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 9: LLM 完成                                                │   │
│  │  • LLM 输出: "已添加错误处理，请查看修改。"                        │   │
│  │  • finish: "stop"                                                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 10: 循环结束                                               │   │
│  │  • SessionCompaction.prune() → 修剪旧工具输出                    │   │
│  │  • 返回助手消息                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 9.2 系统提示词组装

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      系统提示词组装                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 模型专用提示词 (SystemPrompt.provider)                               │
│     ├── Claude: anthropic.txt（详细的工具使用规范）                       │
│     ├── GPT: beast.txt（简化版规范）                                      │
│     ├── Gemini: gemini.txt                                               │
│     └── Qwen: qwen.txt                                                   │
│                                                                         │
│  2. 环境信息 (SystemPrompt.environment)                                  │
│     ├── "You are powered by the model named claude-3-5-sonnet-20241022" │
│     ├── "Working directory: /Users/dev/my-project"                      │
│     ├── "Platform: darwin"                                              │
│     └── "Today's date: Monday Feb 2, 2026"                              │
│                                                                         │
│  3. 指令文件 (InstructionPrompt.system)                                  │
│     ├── "Instructions from: /Users/dev/my-project/AGENTS.md"            │
│     │   └── 项目级规范                                                   │
│     └── "Instructions from: ~/.config/opencode/AGENTS.md"               │
│         └── 全局规范                                                     │
│                                                                         │
│  4. Agent 专用提示词                                                     │
│     └── agent.prompt（如果定义了的话）                                   │
│                                                                         │
│  5. 动态提醒                                                             │
│     ├── Plan Mode 提醒（如果是 plan agent）                              │
│     ├── Max Steps 提醒（如果接近步数限制）                               │
│     └── 用户消息包装（多轮对话时的提醒）                                 │
│                                                                         │
│  最终组装顺序:                                                           │
│  system = [                                                             │
│    ...SystemPrompt.provider(model),   // 模型提示词                     │
│    ...SystemPrompt.environment(model), // 环境信息                       │
│    ...InstructionPrompt.system(),     // 指令文件                        │
│    agent.prompt,                      // Agent 提示词                    │
│  ]                                                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 10. 关键源码文件索引

| 功能 | 文件路径 | 关键行号 |
|------|---------|---------|
| **主执行循环** | `packages/opencode/src/session/prompt.ts` | 267-655 |
| **工具解析** | `packages/opencode/src/session/prompt.ts` | 664-834 |
| **系统提示词** | `packages/opencode/src/session/system.ts` | 全文件 |
| **指令文件** | `packages/opencode/src/session/instruction.ts` | 全文件 |
| **上下文压缩** | `packages/opencode/src/session/compaction.ts` | 全文件 |
| **消息处理** | `packages/opencode/src/session/message-v2.ts` | 全文件 |
| **LLM 调用** | `packages/opencode/src/session/llm.ts` | 全文件 |
| **会话处理器** | `packages/opencode/src/session/processor.ts` | 全文件 |
| **ReadTool** | `packages/opencode/src/tool/read.ts` | 全文件 |
| **EditTool** | `packages/opencode/src/tool/edit.ts` | 全文件 |
| **GlobTool** | `packages/opencode/src/tool/glob.ts` | 全文件 |
| **GrepTool** | `packages/opencode/src/tool/grep.ts` | 全文件 |
| **BashTool** | `packages/opencode/src/tool/bash.ts` | 全文件 |
| **TaskTool** | `packages/opencode/src/tool/task.ts` | 全文件 |
| **工具注册表** | `packages/opencode/src/tool/registry.ts` | 全文件 |
| **工具基类** | `packages/opencode/src/tool/tool.ts` | 全文件 |
| **Agent 定义** | `packages/opencode/src/agent/agent.ts` | 全文件 |
| **权限系统** | `packages/opencode/src/permission/next.ts` | 全文件 |
| **插件系统** | `packages/opencode/src/plugin/index.ts` | 全文件 |

---

## 总结

OpenCode 在代码生成上效果好的关键因素：

1. **智能的文件读取**：
   - 带行号输出，方便 LLM 定位
   - 字节/行数限制，控制上下文
   - 自动加载目录 AGENTS.md，提供上下文

2. **多策略编辑**：
   - 7 种替换策略，提高匹配成功率
   - LSP 诊断检查，及时发现错误
   - 文件时间戳检查，防止覆盖用户修改

3. **上下文管理**：
   - 自动溢出检测
   - 智能压缩摘要
   - 旧工具输出修剪

4. **指令文件系统**：
   - 项目级 + 目录级规范
   - 自动注入到上下文
   - 支持 URL 和 glob

5. **子任务调度**：
   - 专业化的子 Agent
   - 独立会话，共享文件系统
   - 权限隔离

6. **插件扩展**：
   - 工具执行前后钩子
   - 配置注入
   - 消息转换
