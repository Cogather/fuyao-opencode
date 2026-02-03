# OpenCode Agent 编码工程能力解读

本文档以**具体开发任务**为主线，按时序深度解析 OpenCode Agent 从接收任务到完成的完整工作过程。

---

## 目录

1. [任务场景设定](#1-任务场景设定)
2. [阶段一：接收任务与初始化](#2-阶段一接收任务与初始化)
3. [阶段二：理解需求与任务分解](#3-阶段二理解需求与任务分解)
4. [阶段三：探索项目代码](#4-阶段三探索项目代码)
5. [阶段四：读取目标文件](#5-阶段四读取目标文件)
6. [阶段五：编写代码](#6-阶段五编写代码)
7. [阶段六：验证与修复错误](#7-阶段六验证与修复错误)
8. [阶段七：任务完成](#8-阶段七任务完成)
9. [特殊情况处理](#9-特殊情况处理)
10. [可借鉴的设计模式总结](#10-可借鉴的设计模式总结)

---

## 1. 任务场景设定

我们同时跟踪两类典型任务，展示 Agent 在不同场景下的工作差异：

**简单任务**（功能添加）：
```
用户：帮我给 UserService 添加邮箱验证功能
```

**项目级任务**（从零创建）：
```
用户：帮我创建一个 Express + TypeScript 的 REST API 项目
```

**项目结构**（简单任务假设）：
```
my-project/
├── AGENTS.md              # 项目规则
├── package.json
├── src/
│   ├── services/
│   │   ├── user.ts        # 目标文件
│   │   └── email.ts       # 邮件服务
│   └── tests/
│       └── user.test.ts   # 测试文件
```

---

## 2. 阶段一：接收任务与初始化

> **本阶段工作的 Agent**：Primary Agent  
> **涉及模块**：`session/system.ts`, `session/instruction.ts`  
> **使用的工具**：无

### 2.1 用户输入进入系统

用户的消息进入 OpenCode 后，首先触发主循环的初始化。

```typescript
// packages/opencode/src/session/prompt.ts
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  // 主循环开始
  while (true) {
    // ...
  }
})
```

### 2.2 组装系统提示词

在第一次调用 LLM 之前，系统需要组装完整的系统提示词。这决定了 Agent 的"人格"和行为规范。

**Step 1：选择模型专用提示词**

```typescript
// packages/opencode/src/session/system.ts
export function provider(model: Provider.Model) {
  if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]  // 完整功能
  if (model.api.id.includes("gpt-"))   return [PROMPT_BEAST]      // 强自主
  if (model.api.id.includes("gemini")) return [PROMPT_GEMINI]     // 安全优先
  return [PROMPT_ANTHROPIC_WITHOUT_TODO]                          // 极简
}
```

假设用户使用 Claude，加载的核心提示词包含：
```
You are OpenCode, the best coding agent on the planet.

# Task Management
You have access to the TodoWrite tools to help you manage and plan tasks. 
Use these tools VERY frequently to ensure that you are tracking your tasks 
and giving the user visibility into your progress.

# Tool usage policy
When doing file search, prefer to use the Task tool to reduce context usage.
You can call multiple tools in a single response...
```

**Step 2：注入环境信息**

```typescript
// packages/opencode/src/session/system.ts
export async function environment(model: Provider.Model) {
  return [
    `You are powered by the model named claude-3-5-sonnet.`,
    `<env>`,
    `  Working directory: /Users/dev/my-project`,
    `  Is directory a git repo: yes`,
    `  Platform: darwin`,
    `  Today's date: Mon Feb 02 2026`,
    `</env>`,
  ].join("\n")
}
```

**Agent 现在知道**：工作目录是 `/Users/dev/my-project`，是个 Git 仓库，运行在 macOS 上。

**Step 3：加载项目规则 AGENTS.md**

```typescript
// packages/opencode/src/session/instruction.ts
export async function system() {
  // 1. 从项目目录向上查找 AGENTS.md
  const matches = await Filesystem.findUp("AGENTS.md", Instance.directory)
  // 找到 /Users/dev/my-project/AGENTS.md
  
  // 2. 读取内容
  const content = await Bun.file(matches[0]).text()
  return ["Instructions from: /Users/dev/my-project/AGENTS.md\n" + content]
}
```

假设项目的 `AGENTS.md` 内容是：
```markdown
# 项目规则

## 代码风格
- 使用 async/await，不使用回调
- 所有公共方法需要 JSDoc 注释
- 错误使用自定义 Error 类

## 目录结构
- services/ 放业务逻辑
- tests/ 放测试文件，命名为 xxx.test.ts
```

**Agent 现在知道**：项目的代码风格要求、目录结构约定。

### 2.3 第一次调用 LLM

系统提示词组装完成后，连同用户消息一起发送给 LLM：

```typescript
const result = await processor.process({
  system: [
    PROMPT_ANTHROPIC,           // 模型专用提示词
    environmentInfo,            // 环境信息
    agentsMdContent,            // 项目规则
  ],
  messages: [
    { role: "user", content: "帮我给 UserService 添加邮箱验证功能" }
    // 或者 "帮我创建一个 Express + TypeScript 的 REST API 项目"
  ],
  tools: registeredTools,       // 所有可用工具
  model: claudeModel,
})
```

---

## 3. 阶段二：理解需求与任务分解

> **本阶段工作的 Agent**：Primary Agent  
> **涉及模块**：`session/prompt.ts`  
> **使用的工具**：**TodoWrite**（任务规划）, **Grep**/**Bash**（初步操作）

### 3.1 LLM 第一轮思考

LLM 收到请求后，根据系统提示词的指导，决定先进行任务分解：

```
系统提示词中写着：
"Use TodoWrite tools VERY frequently to ensure tracking your tasks"
"It is critical that you mark todos as completed as soon as you are done"
```

### 3.2 LLM 返回第一次工具调用

**简单任务（功能添加）的任务分解**：
```json
{
  "tool_calls": [
    {
      "name": "todowrite",
      "arguments": {
        "todos": [
          { "id": "1", "content": "搜索 UserService 所在文件", "status": "in_progress" },
          { "id": "2", "content": "读取 UserService 代码，理解现有结构", "status": "pending" },
          { "id": "3", "content": "查看是否有现有的邮件服务", "status": "pending" },
          { "id": "4", "content": "实现邮箱验证方法", "status": "pending" },
          { "id": "5", "content": "添加测试用例", "status": "pending" }
        ]
      }
    },
    {
      "name": "grep",
      "arguments": { "pattern": "class UserService", "include": "*.ts" }
    }
  ]
}
```

**项目级任务（从零创建）的任务分解**：
```json
{
  "tool_calls": [
    {
      "name": "todowrite",
      "arguments": {
        "todos": [
          { "id": "1", "content": "创建项目目录结构", "status": "in_progress" },
          { "id": "2", "content": "初始化 package.json 和配置文件", "status": "pending" },
          { "id": "3", "content": "配置 TypeScript", "status": "pending" },
          { "id": "4", "content": "创建 Express 入口文件", "status": "pending" },
          { "id": "5", "content": "创建示例路由和控制器", "status": "pending" },
          { "id": "6", "content": "安装依赖并验证项目", "status": "pending" }
        ]
      }
    },
    {
      "name": "bash",
      "arguments": { "command": "mkdir -p src/{routes,controllers,services,models} tests config" }
    }
  ]
}
```

**注意**：LLM 同时返回了两个工具调用（任务分解 + 首个操作），因为提示词中说：
```
"You can call multiple tools in a single response. 
If there are no dependencies between them, make all independent tool calls in parallel."
```

### 3.3 工具执行

**TodoWrite 工具执行**：
```typescript
// packages/opencode/src/tool/todowrite.ts
// 将任务列表保存到会话状态
session.todos = params.todos
```

用户界面现在显示：
```
📋 任务列表：
1. [🔄] 搜索 UserService 所在文件 / 创建项目目录结构
2. [ ] 读取代码 / 初始化配置文件
3. [ ] ...
```

**Grep 工具执行**（简单任务）：
```typescript
// packages/opencode/src/tool/grep.ts
export const GrepTool = Tool.define("grep", {
  async execute(params, ctx) {
    // 使用 ripgrep 搜索
    const results = await Ripgrep.search({
      pattern: params.pattern,      // "class UserService"
      cwd: Instance.directory,
      include: params.include,      // "*.ts"
    })
    
    // 返回结果（按修改时间排序）
    return {
      output: `Found 1 match:\n  src/services/user.ts:15`
    }
  }
})
```

**Bash 工具执行**（项目级任务）：
```typescript
// packages/opencode/src/tool/bash.ts
export const BashTool = Tool.define("bash", {
  async execute(params, ctx) {
    const result = await exec(params.command, {
      cwd: Instance.directory,
      timeout: params.timeout || 30000,
    })
    return {
      output: `Exit code: ${result.exitCode}\n\nOutput:\n${result.stdout}`
    }
  }
})
```

### 3.4 工具结果加入上下文

工具的执行结果被加入消息历史：

```typescript
messages.push({
  role: "tool",
  tool_call_id: "todowrite_call_1",
  content: "Created 5 todos. Task 1 marked as in_progress."
})

messages.push({
  role: "tool", 
  tool_call_id: "grep_call_1",  // 或 bash_call_1
  content: "Found 1 match:\n  src/services/user.ts:15"
  // 或 "Exit code: 0\n\nOutput:\n(directories created)"
})
```

### 3.5 循环继续 - 检查是否完成

```typescript
// packages/opencode/src/session/prompt.ts
while (true) {
  // ...执行工具...
  
  // 检查是否完成
  if (lastAssistant?.finish && !["tool-calls", "unknown"].includes(lastAssistant.finish)) {
    break  // LLM 决定停止才退出
  }
  
  // LLM 返回了 tool-calls，说明还没完成，继续循环
}
```

由于 LLM 返回的是工具调用（而不是最终回复），循环继续。

---

## 4. 阶段三：探索项目代码

> **本阶段工作的 Agent**：Primary Agent（简单探索）或 **Explore Agent**（复杂探索时委派）  
> **涉及模块**：`tool/glob.ts`, `tool/grep.ts`, `tool/task.ts`  
> **使用的工具**：**Glob**（文件搜索）, **Grep**（内容搜索）, **Task**（委派探索）, **WebFetch/WebSearch**（项目级任务）

### 4.1 LLM 第二轮思考

**简单任务**：LLM 看到 Grep 结果，知道了 UserService 在 `src/services/user.ts:15`，需要读取代码并查看是否有现有的邮件服务。

**项目级任务**：目录创建完成，LLM 可能会先查询最新的最佳实践。

### 4.2 简单任务的探索操作

```json
{
  "tool_calls": [
    {
      "name": "todowrite",
      "arguments": {
        "todos": [
          { "id": "1", "status": "completed" },
          { "id": "2", "status": "in_progress" }
        ],
        "merge": true
      }
    },
    {
      "name": "read",
      "arguments": { "filePath": "/Users/dev/my-project/src/services/user.ts" }
    },
    {
      "name": "glob",
      "arguments": { "pattern": "**/email*.ts" }
    }
  ]
}
```

**三个并行操作**：
1. 更新任务状态（任务1完成，任务2开始）
2. 读取 user.ts
3. 搜索邮件相关文件

### 4.3 项目级任务的网络查询

```json
{
  "tool_calls": [
    {
      "name": "todowrite",
      "arguments": {
        "todos": [
          { "id": "1", "status": "completed" },
          { "id": "2", "status": "in_progress" }
        ],
        "merge": true
      }
    },
    {
      "name": "webfetch",
      "arguments": { "url": "https://expressjs.com/en/starter/hello-world.html" }
    },
    {
      "name": "websearch",
      "arguments": { "query": "Express TypeScript 2026 best practices project structure" }
    }
  ]
}
```

### 4.4 Glob 工具执行

```typescript
// packages/opencode/src/tool/glob.ts
export const GlobTool = Tool.define("glob", {
  async execute(params, ctx) {
    const matches = await Filesystem.glob({
      pattern: params.pattern,      // "**/email*.ts"
      cwd: Instance.directory,
      limit: 100,                   // 最多返回 100 个
    })
    
    // 按修改时间排序（最近修改的在前）
    matches.sort((a, b) => b.mtime - a.mtime)
    
    return {
      output: matches.length > 0 
        ? `Found ${matches.length} file(s):\n${matches.map(m => "  " + m.path).join("\n")}`
        : "No files found matching pattern"
    }
  }
})
```

**Glob 返回结果**：
```
Found 1 file(s):
  src/services/email.ts
```

### 4.5 复杂探索：委派给 Explore Agent

当任务需要大量探索时，主 Agent 会使用 **Task 工具** 委派给专门的 **Explore Agent**：

```json
{
  "tool_calls": [
    {
      "name": "task",
      "arguments": {
        "description": "探索认证模块架构",
        "prompt": "请帮我分析这个项目的认证模块是如何设计的，包括：1. 有哪些认证方式 2. token 是如何管理的 3. 中间件如何工作",
        "subagent_type": "explore"
      }
    }
  ]
}
```

**Task 工具执行**：
```typescript
// packages/opencode/src/tool/task.ts
export const TaskTool = Tool.define("task", {
  async execute(params, ctx) {
    // 1. 根据 subagent_type 获取 Agent 配置
    const agentConfig = AGENTS[params.subagent_type]  // explore
    
    // 2. 创建子会话
    const subSession = await Session.create({
      agent: agentConfig,
      prompt: params.prompt,
    })
    
    // 3. 子 Agent 有独立的工具权限
    // explore Agent 只有只读权限：grep, glob, read, bash(只读命令)
    
    // 4. 运行子 Agent 的主循环
    const result = await SessionPrompt.loop(subSession.id)
    
    // 5. 返回子 Agent 的最终输出
    return { output: result.summary }
  }
})
```

**Explore Agent 的权限配置**：
```typescript
// packages/opencode/src/agent/agent.ts
explore: {
  name: "explore",
  description: `Fast agent specialized for exploring codebases.`,
  permission: {
    grep: "allow",
    glob: "allow", 
    read: "allow",
    bash: "allow",    // 允许执行命令（如 git log）
    edit: "deny",     // 禁止编辑
    write: "deny",    // 禁止创建文件
  },
  prompt: PROMPT_EXPLORE,  // 专用提示词
}
```

**Explore Agent 专用提示词**：
```
You are a file search specialist. You excel at thoroughly navigating 
and exploring codebases.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path
- Do not create any files, or run bash commands that modify the system
```

### 4.6 当前工作状态

经过这一轮，Agent 获得了关键信息：

| 信息 | 来源 | 内容 |
|------|------|------|
| UserService 位置 | Grep 结果 | `src/services/user.ts:15` |
| UserService 代码 | Read 结果 | 完整代码 |
| 邮件服务位置 | Glob 结果 | `src/services/email.ts` |
| 项目规则 | AGENTS.md | 代码风格、目录结构 |
| 最新实践（项目级）| WebFetch/WebSearch | Express 最佳实践 |

---

## 5. 阶段四：读取目标文件

> **本阶段工作的 Agent**：Primary Agent  
> **涉及模块**：`tool/read.ts`, `session/instruction.ts`（目录级规则加载）  
> **使用的工具**：**Read**

### 5.1 Read 工具执行细节

```typescript
// packages/opencode/src/tool/read.ts
export const ReadTool = Tool.define("read", {
  async execute(params, ctx) {
    const file = Bun.file(params.filePath)
    const text = await file.text()
    const lines = text.split("\n")
    
    // 1. 应用行数限制（默认 2000 行）
    const limit = params.limit ?? 2000
    const offset = params.offset || 0
    const raw = lines.slice(offset, offset + limit)
    
    // 2. 格式化输出（带行号）
    const content = raw.map((line, index) => {
      const lineNum = (index + offset + 1).toString().padStart(5, "0")
      return `${lineNum}| ${line}`
    }).join("\n")
    
    // 3. 检查目录下是否有 AGENTS.md
    const dirPath = path.dirname(params.filePath)
    const instructions = await InstructionPrompt.resolve(ctx.messages, params.filePath, ctx.messageID)
    
    let output = content
    
    // 4. 如果有目录级 AGENTS.md，追加到输出
    if (instructions.length > 0) {
      output += `\n\n<system-reminder>\n${instructions.map(i => i.content).join("\n\n")}\n</system-reminder>`
    }
    
    return { output, metadata: { truncated: raw.length < lines.length } }
  }
})
```

### 5.2 Read 工具返回的内容

```
00001| import { Database } from '../database'
00002| import { Logger } from '../logger'
00003| import { hash, compare } from 'bcrypt'
00004| 
00005| /**
00006|  * 用户服务类
00007|  * 处理用户相关的业务逻辑
00008|  */
00009| export class UserService {
00010|   private db: Database
00011|   private logger: Logger
00012|   
00013|   constructor(db: Database, logger: Logger) {
00014|     this.db = db
00015|     this.logger = logger
00016|   }
00017|   
00018|   /**
00019|    * 用户注册
00020|    */
00021|   async register(email: string, password: string) {
00022|     const hashedPassword = await hash(password, 10)
00023|     return this.db.users.create({ email, password: hashedPassword })
00024|   }
00025|   
00026|   /**
00027|    * 用户登录
00028|    */
00029|   async login(email: string, password: string) {
00030|     const user = await this.db.users.findByEmail(email)
00031|     if (!user) throw new Error('User not found')
00032|     const valid = await compare(password, user.password)
00033|     if (!valid) throw new Error('Invalid password')
00034|     return user
00035|   }
00036| }
```

**关键设计点**：
- **带行号输出**：方便 LLM 后续引用具体位置（如 "在第 35 行后添加"）
- **自动加载目录规则**：如果 `src/services/` 目录有自己的 AGENTS.md，会追加为 `<system-reminder>`

### 5.3 读取邮件服务代码

**Read 返回结果**：
```
00001| import { createTransport } from 'nodemailer'
00002| 
00003| export class EmailService {
00004|   private transporter
00005|   
00006|   constructor() {
00007|     this.transporter = createTransport({
00008|       host: process.env.SMTP_HOST,
00009|       port: 587,
00010|       auth: {
00011|         user: process.env.SMTP_USER,
00012|         pass: process.env.SMTP_PASS,
00013|       }
00014|     })
00015|   }
00016|   
00017|   /**
00018|    * 发送邮件
00019|    */
00020|   async send(to: string, subject: string, html: string) {
00021|     return this.transporter.sendMail({
00022|       from: process.env.SMTP_FROM,
00023|       to,
00024|       subject,
00025|       html,
00026|     })
00027|   }
00028| }
```

### 5.4 Agent 的理解

现在 Agent 完全理解了：
1. **UserService** 的现有结构（register、login 方法）
2. **EmailService** 的接口（send 方法）
3. **项目规范**（需要 JSDoc 注释、使用 async/await）

---

## 6. 阶段五：编写代码

> **本阶段工作的 Agent**：Primary Agent  
> **涉及模块**：`tool/edit.ts`（7种替换策略）, `tool/write.ts`, `lsp/`（实时错误检测）  
> **使用的工具**：**Edit**（精确替换）, **Write**（创建新文件）, **Bash**（创建目录、安装依赖）

### 6.1 Edit vs Write 的选择逻辑

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Write vs Edit 选择逻辑                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Edit 工具（精确替换）：                                                  │
│  - 文件已存在，只需修改部分内容                                           │
│  - 必须先 Read 才能 Edit                                                │
│  - 使用 oldString → newString 替换                                      │
│  - 简单任务主要使用                                                      │
│                                                                         │
│  Write 工具（创建/覆盖文件）：                                            │
│  - 文件不存在，需要创建新文件                                             │
│  - 项目级任务主要使用                                                    │
│  - 注意：Write 会覆盖整个文件                                            │
│                                                                         │
│  系统提示词的指导：                                                       │
│  "ALWAYS prefer editing existing files. NEVER write new files           │
│   unless explicitly required."                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 简单任务：使用 Edit 工具

**第一次编辑 - 添加 import**：
```json
{
  "tool_calls": [
    {
      "name": "todowrite",
      "arguments": {
        "todos": [
          { "id": "3", "status": "completed" },
          { "id": "4", "status": "in_progress" }
        ],
        "merge": true
      }
    },
    {
      "name": "edit",
      "arguments": {
        "filePath": "/Users/dev/my-project/src/services/user.ts",
        "oldString": "import { Database } from '../database'\nimport { Logger } from '../logger'",
        "newString": "import { Database } from '../database'\nimport { Logger } from '../logger'\nimport { EmailService } from './email'\nimport { randomBytes } from 'crypto'"
      }
    }
  ]
}
```

### 6.3 Edit 工具执行细节

```typescript
// packages/opencode/src/tool/edit.ts
export const EditTool = Tool.define("edit", {
  parameters: z.object({
    filePath: z.string(),
    oldString: z.string(),
    newString: z.string(),
    replaceAll: z.boolean().optional(),
  }),
  
  async execute(params, ctx) {
    // 1. 检查是否已读取过文件（先读后改规则）
    if (!ctx.hasReadFile(params.filePath)) {
      throw new Error("Must read file before editing. Use Read tool first.")
    }
    
    // 2. 读取当前文件内容
    const contentOld = await Bun.file(params.filePath).text()
    
    // 3. 尝试替换（7 种策略依次尝试）
    let contentNew = null
    for (const Replacer of REPLACERS) {
      const result = new Replacer().replace(
        contentOld, 
        params.oldString, 
        params.newString, 
        params.replaceAll
      )
      if (result !== null) {
        contentNew = result
        break
      }
    }
    
    if (contentNew === null) {
      throw new Error("oldString not found in file content")
    }
    
    // 4. 写入文件
    await Bun.write(params.filePath, contentNew)
    
    // 5. LSP 诊断检查
    const diagnostics = await LSP.diagnostics(params.filePath)
    const errors = diagnostics.filter(d => d.severity === "error")
    
    let output = `Successfully edited ${params.filePath}`
    if (errors.length > 0) {
      output += `\n\nLSP errors detected:\n${errors.map(e => 
        `  Line ${e.line}: ${e.message}`
      ).join('\n')}`
    }
    
    return { output }
  }
})
```

### 6.4 7 种替换策略详解

当 LLM 提供的 `oldString` 与文件实际内容有微小差异时，Edit 工具会依次尝试：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  替换策略执行顺序                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. SimpleReplacer                                                      │
│     精确匹配，content.includes(oldString)                               │
│     ↓ 失败                                                              │
│                                                                         │
│  2. LineTrimmedReplacer                                                 │
│     每行 trim() 后比较，容忍行首尾空格                                    │
│     ↓ 失败                                                              │
│                                                                         │
│  3. BlockAnchorReplacer                                                 │
│     用首行和尾行定位代码块，替换整块                                      │
│     ↓ 失败                                                              │
│                                                                         │
│  4. WhitespaceNormalizedReplacer                                        │
│     多个空白字符规范化为单个空格                                          │
│     ↓ 失败                                                              │
│                                                                         │
│  5. IndentationFlexibleReplacer                                         │
│     忽略整体缩进差异（LLM 缩进常不准）                                     │
│     ↓ 失败                                                              │
│                                                                         │
│  6. EscapeNormalizedReplacer                                            │
│     处理转义字符差异（\n vs 实际换行）                                    │
│     ↓ 失败                                                              │
│                                                                         │
│  7. ContextAwareReplacer                                                │
│     使用上下文信息模糊定位                                                │
│     ↓ 失败                                                              │
│                                                                         │
│  全部失败 → 抛出错误 "oldString not found"                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.5 项目级任务：使用 Write 工具

```json
{
  "tool_calls": [
    {
      "name": "write",
      "arguments": {
        "filePath": "/Users/dev/new-project/package.json",
        "content": "{\n  \"name\": \"express-api\",\n  \"version\": \"1.0.0\",\n  \"scripts\": {\n    \"build\": \"tsc\",\n    \"start\": \"node dist/index.js\",\n    \"dev\": \"ts-node src/index.ts\"\n  }\n}"
      }
    },
    {
      "name": "write",
      "arguments": {
        "filePath": "/Users/dev/new-project/tsconfig.json",
        "content": "{\n  \"compilerOptions\": {\n    \"target\": \"ES2020\",\n    \"module\": \"commonjs\",\n    \"outDir\": \"./dist\",\n    \"strict\": true\n  }\n}"
      }
    },
    {
      "name": "write",
      "arguments": {
        "filePath": "/Users/dev/new-project/src/index.ts",
        "content": "import express from 'express'\n\nconst app = express()\nconst PORT = process.env.PORT || 3000\n\napp.use(express.json())\n\napp.get('/', (req, res) => {\n  res.json({ message: 'Hello World' })\n})\n\napp.listen(PORT, () => {\n  console.log(`Server running on port ${PORT}`)\n})"
      }
    }
  ]
}
```

### 6.6 第二次编辑 - 添加验证方法（简单任务）

```json
{
  "tool_calls": [
    {
      "name": "edit",
      "arguments": {
        "filePath": "/Users/dev/my-project/src/services/user.ts",
        "oldString": "    return user\n  }\n}",
        "newString": "    return user\n  }\n\n  /**\n   * 发送邮箱验证邮件\n   * @param email 用户邮箱\n   */\n  async sendVerificationEmail(email: string) {\n    const token = randomBytes(32).toString('hex')\n    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000)\n    \n    await this.db.verificationTokens.create({\n      email,\n      token,\n      expiresAt: expiry,\n    })\n    \n    const emailService = new EmailService()\n    await emailService.send(\n      email,\n      '请验证您的邮箱',\n      `<p>点击链接验证：</p><a href=\"${process.env.APP_URL}/verify?token=${token}\">验证</a>`\n    )\n    \n    this.logger.info(`Verification email sent to ${email}`)\n  }\n\n  /**\n   * 验证邮箱\n   * @param token 验证令牌\n   */\n  async verifyEmail(token: string) {\n    const record = await this.db.verificationTokens.findByToken(token)\n    if (!record) throw new Error('Invalid verification token')\n    if (record.expiresAt < new Date()) throw new Error('Token expired')\n    \n    await this.db.users.update(record.email, { emailVerified: true })\n    await this.db.verificationTokens.delete(token)\n    \n    this.logger.info(`Email verified for ${record.email}`)\n    return true\n  }\n}"
      }
    }
  ]
}
```

### 6.7 编辑结果

Agent 遵循了 AGENTS.md 中的规则：
- ✅ 使用 async/await
- ✅ 添加了 JSDoc 注释
- ✅ 使用了 Logger 记录日志

---

## 7. 阶段六：验证与修复错误

> **本阶段工作的 Agent**：Primary Agent  
> **涉及模块**：`lsp/`（LSP 诊断）  
> **使用的工具**：**Bash**（运行测试、构建）, Edit（修复错误）, Read（查看相关代码）

### 7.1 LSP 自动错误检测

Edit 工具执行后，自动检查 LSP 诊断：

```typescript
// 在 edit.ts 执行结束前
const diagnostics = await LSP.diagnostics(params.filePath)
const errors = diagnostics.filter(d => d.severity === "error")
```

假设 LSP 返回了一个错误：
```
Line 45: Property 'verificationTokens' does not exist on type 'Database'
```

Edit 工具的输出会包含这个错误：
```
Successfully edited /Users/dev/my-project/src/services/user.ts

LSP errors detected:
  Line 45: Property 'verificationTokens' does not exist on type 'Database'
```

### 7.2 LLM 看到错误并修复

LLM 在下一轮循环中看到这个错误，决定修复：

```json
{
  "thinking": "LSP 报告 Database 类型没有 verificationTokens 属性。我需要查看 Database 的定义，可能需要添加这个表。",
  "tool_calls": [
    {
      "name": "grep",
      "arguments": { "pattern": "class Database|interface Database", "include": "*.ts" }
    }
  ]
}
```

搜索后发现 Database 定义在 `src/database.ts`，读取并添加缺失的属性：

```json
{
  "tool_calls": [
    {
      "name": "read",
      "arguments": { "filePath": "/Users/dev/my-project/src/database.ts" }
    }
  ]
}
```

然后编辑 database.ts 添加 verificationTokens：

```json
{
  "tool_calls": [
    {
      "name": "edit",
      "arguments": {
        "filePath": "/Users/dev/my-project/src/database.ts",
        "oldString": "  users: UserRepository",
        "newString": "  users: UserRepository\n  verificationTokens: VerificationTokenRepository"
      }
    }
  ]
}
```

### 7.3 错误修复循环

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      错误修复循环                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Edit 执行                                                              │
│     │                                                                   │
│     ▼                                                                   │
│  LSP 检测 ──────────────── 无错误 ────────────────→ 继续下一步           │
│     │                                                                   │
│     │ 有错误                                                            │
│     ▼                                                                   │
│  错误信息加入工具输出                                                    │
│     │                                                                   │
│     ▼                                                                   │
│  LLM 下一轮看到错误                                                      │
│     │                                                                   │
│     ▼                                                                   │
│  LLM 分析错误原因                                                        │
│     │                                                                   │
│     ▼                                                                   │
│  LLM 决定修复（搜索 → 读取 → 编辑）                                       │
│     │                                                                   │
│     └──────────────────→ Edit 执行（循环）                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.4 运行测试验证（简单任务）

```json
{
  "tool_calls": [
    {
      "name": "bash",
      "arguments": { "command": "npm test -- --grep '邮箱验证'" }
    }
  ]
}
```

**测试输出**：
```
Exit code: 0

Output:
  邮箱验证
    ✓ 应该发送验证邮件 (15ms)
    ✓ 应该验证有效的 token (8ms)
    ✓ 应该拒绝无效的 token (5ms)

  3 passing (28ms)
```

### 7.5 安装依赖并构建验证（项目级任务）

```json
{
  "tool_calls": [
    {
      "name": "bash",
      "arguments": { "command": "npm install express cors helmet" }
    },
    {
      "name": "bash",
      "arguments": { "command": "npm install -D typescript @types/express @types/node ts-node" }
    }
  ]
}
```

然后验证构建：
```json
{
  "tool_calls": [
    {
      "name": "bash",
      "arguments": { "command": "npm run build" }
    }
  ]
}
```

---

## 8. 阶段七：任务完成

> **本阶段工作的 Agent**：Primary Agent（+ Summary Agent 可选）  
> **涉及模块**：`session/prompt.ts`（循环终止判断）  
> **使用的工具**：**TodoWrite**（标记完成）

### 8.1 更新任务状态

所有任务完成，LLM 决定结束：

```json
{
  "tool_calls": [
    {
      "name": "todowrite",
      "arguments": {
        "todos": [{ "id": "5", "status": "completed" }],
        "merge": true
      }
    }
  ],
  "content": "✅ 已完成邮箱验证功能的添加：\n\n**修改的文件：**\n- `src/services/user.ts` - 添加了 `sendVerificationEmail` 和 `verifyEmail` 方法\n- `src/database.ts` - 添加了 `verificationTokens` 仓库\n- `src/tests/user.test.ts` - 添加了 3 个测试用例\n\n**功能说明：**\n1. `sendVerificationEmail(email)` - 生成验证 token 并发送邮件\n2. `verifyEmail(token)` - 验证 token 并标记用户邮箱已验证\n\n**测试结果：** 全部通过 ✓"
}
```

### 8.2 循环终止

```typescript
// packages/opencode/src/session/prompt.ts
while (true) {
  const result = await processor.process(...)
  
  // LLM 返回了文本内容（而不是 tool-calls），表示任务完成
  if (lastAssistant?.finish === "stop") {
    break  // 退出循环
  }
}
```

---

## 9. 特殊情况处理

### 9.1 上下文溢出：Prune + Compaction

> **工作的 Agent**：Compaction Agent（上下文溢出时自动触发）  
> **涉及模块**：`session/compaction.ts`

当对话过长时，触发压缩机制：

```typescript
// packages/opencode/src/session/prompt.ts
while (true) {
  // 检查上下文是否溢出
  if (await SessionCompaction.isOverflow({ tokens, model })) {
    // 触发压缩
    await SessionCompaction.create({ sessionID, auto: true })
    continue  // 压缩后继续循环
  }
  // ...
}
```

**两级压缩策略**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      上下文压缩过程                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  第一级：Prune（轻量级）                                                  │
│  - 保留最近 40,000 tokens 的工具输出                                     │
│  - 更早的只保留工具调用输入，删除输出                                      │
│  - 不影响工作连续性                                                      │
│                                                                         │
│  第二级：Compaction（重量级）                                             │
│  1. 检测到上下文溢出                                                     │
│     │                                                                   │
│     ▼                                                                   │
│  2. 调用 Compaction Agent 生成摘要                                       │
│     提示词："Provide a detailed prompt for continuing...                │
│      Focus on what we did, what we're doing, which files..."            │
│     │                                                                   │
│     ▼                                                                   │
│  3. Compaction Agent 输出摘要                                           │
│     "我们正在为 UserService 添加邮箱验证功能。                            │
│      已完成：搜索定位文件、读取代码、添加验证方法                          │
│      当前文件：src/services/user.ts, src/database.ts                    │
│      下一步：添加测试用例"                                                │
│     │                                                                   │
│     ▼                                                                   │
│  4. 用摘要替换原始历史消息，继续工作                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Compaction Agent 专用提示词**：
```
You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary focusing on:
- What was done
- What is currently being worked on
- Which files are being modified
- What needs to be done next
- Key user requests and constraints
- Important technical decisions and why they were made
```

### 9.2 达到最大步数

防止 Agent 无限循环：

```typescript
// 系统提示词注入
if (isLastStep) {
  messages.push({
    role: "system",
    content: `CRITICAL - MAXIMUM STEPS REACHED
    
The maximum number of steps allowed has been reached.
Tools are disabled until next user input.

Response must include:
- Statement that maximum steps have been reached
- Summary of what has been accomplished
- List of remaining tasks not completed
- Recommendations for what should be done next`
  })
}
```

### 9.3 OpenCode 的 Agent 体系

| Agent 名称 | 源码位置 | 职责 | 工作时机 |
|-----------|---------|------|---------|
| **Primary Agent** | `session/prompt.ts` | 主 Agent，任务理解、决策、编码 | 用户发起请求 |
| **Explore Agent** | `agent/prompt/explore.txt` | 代码探索专家，只读操作 | Task 工具委派 |
| **Compaction Agent** | `agent/prompt/compaction.txt` | 会话压缩，生成摘要 | 上下文溢出 |
| **Title Agent** | `agent/prompt/title.txt` | 生成会话标题 | 会话开始 |
| **Summary Agent** | `agent/prompt/summary.txt` | 生成对话摘要 | 会话结束 |
| **Plan Agent** | `session/prompt/plan.txt` | 规划模式，只读分析 | Plan Mode |

### 9.4 工具完整清单

| 工具 | 源码 | 功能 | 关键特性 |
|------|------|------|---------|
| **TodoWrite** | `tool/todowrite.ts` | 任务规划 | 状态管理、进度可视化 |
| **Grep** | `tool/grep.ts` | 内容搜索 | 正则支持、返回文件+行号 |
| **Glob** | `tool/glob.ts` | 文件名搜索 | 按修改时间排序、最多100结果 |
| **Read** | `tool/read.ts` | 读取文件 | 带行号输出、自动加载 AGENTS.md |
| **Edit** | `tool/edit.ts` | 编辑文件 | 7种替换策略、LSP 错误检测 |
| **Write** | `tool/write.ts` | 创建文件 | 项目级任务常用 |
| **Bash** | `tool/bash.ts` | 执行命令 | Git 安全协议、持久 shell |
| **Task** | `tool/task.ts` | 委派子任务 | 启动子 Agent、并行执行 |
| **WebFetch** | `tool/webfetch.ts` | 获取网页 | 转 Markdown、内容摘要 |
| **WebSearch** | `tool/websearch.ts` | 网络搜索 | 获取最新信息 |

---

## 10. 可借鉴的设计模式总结

### 10.1 循环驱动模式

```
传统模式：用户 → AI → 用户 → AI → ...

OpenCode 模式：
用户 → Agent ──┐
                │ ← 循环直到完成
                ▼
         工具调用 → 结果 → LLM 分析 → 继续/停止
                │
                └───────────────────┘

借鉴价值：复杂任务无需用户多次干预，Agent 自主决定何时停止
```

### 10.2 先读后改模式

```typescript
// Edit 工具检查是否已读取目标文件
if (!ctx.hasReadFile(params.filePath)) {
  throw new Error("Must read file before editing")
}

// 借鉴价值：确保 Agent 了解当前代码状态，避免盲目修改
```

### 10.3 多策略容错模式

```
问题：LLM 输出的代码可能有微小差异（缩进、空格、转义）

解决方案：7 种替换策略依次尝试
SimpleReplacer → LineTrimmedReplacer → IndentationFlexibleReplacer → ...

借鉴价值：不要求 LLM 输出完美匹配，提高编辑成功率
```

### 10.4 渐进式上下文管理

```
第一级 Prune：保留最近 40k tokens，删除旧工具输出
第二级 Compaction：调用专门 Agent 生成摘要替换全部历史

借鉴价值：支持超长任务，渐进式释放空间，保留关键信息
```

### 10.5 专业分工模式

```
Primary Agent：理解需求、制定计划、执行编辑、拥有全部工具权限
Explore Agent：专注代码探索、只有只读权限、独立上下文

借鉴价值：权限最小化，探索任务不消耗主 Agent 上下文
```

### 10.6 分层项目规则

```
第一层：系统提示词（全局规则） - "ALWAYS prefer editing existing files"
第二层：项目 AGENTS.md（项目级规则） - 代码风格、目录结构
第三层：目录 AGENTS.md（模块级规则） - 读取文件时自动加载

借鉴价值：灵活的规范管理，不同模块可以有不同规则
```

### 10.7 模型适配模式

```
Claude：完整功能，强调 TODO 管理
GPT/Beast：强自主性，持续工作
Gemini：安全优先，严格规范
Qwen：极简输出

借鉴价值：发挥各模型优势，根据模型特性优化行为
```

### 10.8 实时错误反馈

```
Edit 执行 → LSP 诊断 → 错误加入输出 → LLM 下轮看到并修复

借鉴价值：立即发现编辑引入的错误，自动触发修复循环
```

---

## 11. OpenCode Agent 工作流程全景图

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    OpenCode Agent 完整工作流程                                                │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                             │
│   用户输入任务                                                                                               │
│   ├── 简单任务："帮我给 UserService 添加邮箱验证功能"                                                         │
│   └── 项目级任务："帮我创建一个 Express + TypeScript 的 REST API 项目"                                        │
│        │                                                                                                    │
│        ▼                                                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│   │  阶段一：初始化                                                                                       │  │
│   │  Agent: Primary Agent                                                                                │  │
│   │  模块: session/system.ts, session/instruction.ts                                                     │  │
│   │  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐    │  │
│   │  │  1. 选择模型专用提示词                                                                         │    │  │
│   │  │     ├── Claude → PROMPT_ANTHROPIC (完整功能，强调 TODO 管理)                                   │    │  │
│   │  │     ├── GPT/Beast → PROMPT_BEAST (强自主性，持续工作)                                          │    │  │
│   │  │     ├── Gemini → PROMPT_GEMINI (安全优先，严格规范)                                            │    │  │
│   │  │     └── Qwen → PROMPT_QWEN (极简输出)                                                          │    │  │
│   │  │                                                                                                │    │  │
│   │  │  2. 注入环境信息 <env>工作目录、Git状态、平台、日期</env>                                        │    │  │
│   │  │                                                                                                │    │  │
│   │  │  3. 加载项目 AGENTS.md (代码风格、目录结构约定)                                                  │    │  │
│   │  └─────────────────────────────────────────────────────────────────────────────────────────────┘    │  │
│   └─────────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│        │                                                                                                    │
│        ▼                                                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│   │                              主循环 while (true)  (session/prompt.ts)                                 │  │
│   │                                                                                                       │  │
│   │   ┌───────────────────────────────────────────────────────────────────────────────────────────────┐  │  │
│   │   │  边界条件检查                                                                                   │  │  │
│   │   │  ├── 上下文溢出？ ─是─→ Compaction Agent 生成摘要 (compaction.ts)                              │  │  │
│   │   │  │                      └── 第一级 Prune: 删除旧工具输出                                        │  │  │
│   │   │  │                      └── 第二级 Compaction: 调用 Agent 生成摘要替换历史                       │  │  │
│   │   │  └── 达到最大步数？ ─是─→ 强制停止，输出总结                                                    │  │  │
│   │   └───────────────────────────────────────────────────────────────────────────────────────────────┘  │  │
│   │        │                                                                                              │  │
│   │        ▼                                                                                              │  │
│   │   ┌───────────────────────────────────────────────────────────────────────────────────────────────┐  │  │
│   │   │  阶段二：任务分解                                                                               │  │  │
│   │   │  Agent: Primary Agent                                                                          │  │  │
│   │   │  工具: TodoWrite (tool/todowrite.ts)                                                           │  │  │
│   │   │  ┌───────────────────────────────────────────────────────────────────────────────────────┐    │  │  │
│   │   │  │  TodoWrite: 创建任务列表，追踪进度                                                       │    │  │  │
│   │   │  │  ├── 简单任务: [搜索定位, 读取代码, 查邮件服务, 实现功能, 添加测试]                        │    │  │  │
│   │   │  │  └── 项目级: [创建目录, 初始化配置, 配置TS, 创建入口, 创建路由, 安装验证]                   │    │  │  │
│   │   │  │                                                                                        │    │  │  │
│   │   │  │  并行操作（无依赖时同时调用多个工具）                                                     │    │  │  │
│   │   │  │  ├── 简单任务: TodoWrite + Grep("class UserService")                                   │    │  │  │
│   │   │  │  └── 项目级: TodoWrite + Bash("mkdir -p src/{routes,controllers}")                     │    │  │  │
│   │   │  └───────────────────────────────────────────────────────────────────────────────────────┘    │  │  │
│   │   └───────────────────────────────────────────────────────────────────────────────────────────────┘  │  │
│   │        │                                                                                              │  │
│   │        ▼                                                                                              │  │
│   │   ┌───────────────────────────────────────────────────────────────────────────────────────────────┐  │  │
│   │   │  阶段三：探索项目代码                                                                           │  │  │
│   │   │  Agent: Primary Agent 或 Explore Agent（复杂探索时通过 Task 工具委派）                          │  │  │
│   │   │  工具: Glob, Grep, Task, WebFetch, WebSearch                                                   │  │  │
│   │   │  ┌───────────────────────────────────────────────────────────────────────────────────────┐    │  │  │
│   │   │  │  Glob (tool/glob.ts): 按文件名搜索，按修改时间排序                                       │    │  │  │
│   │   │  │  └── glob("**/email*.ts") → "src/services/email.ts"                                    │    │  │  │
│   │   │  │                                                                                        │    │  │  │
│   │   │  │  Grep (tool/grep.ts): 按内容搜索，支持正则                                               │    │  │  │
│   │   │  │  └── grep("class UserService") → "src/services/user.ts:15"                             │    │  │  │
│   │   │  │                                                                                        │    │  │  │
│   │   │  │  Task (tool/task.ts): 委派给 Explore Agent                                              │    │  │  │
│   │   │  │  └── Explore Agent: 只读权限(grep,glob,read,bash)，独立上下文，返回汇总结果              │    │  │  │
│   │   │  │                                                                                        │    │  │  │
│   │   │  │  项目级任务额外操作：                                                                    │    │  │  │
│   │   │  │  ├── WebFetch: 获取官方文档 (expressjs.com)                                             │    │  │  │
│   │   │  │  └── WebSearch: 搜索最新最佳实践                                                        │    │  │  │
│   │   │  └───────────────────────────────────────────────────────────────────────────────────────┘    │  │  │
│   │   └───────────────────────────────────────────────────────────────────────────────────────────────┘  │  │
│   │        │                                                                                              │  │
│   │        ▼                                                                                              │  │
│   │   ┌───────────────────────────────────────────────────────────────────────────────────────────────┐  │  │
│   │   │  阶段四：读取目标文件                                                                           │  │  │
│   │   │  Agent: Primary Agent                                                                          │  │  │
│   │   │  工具: Read (tool/read.ts)                                                                     │  │  │
│   │   │  模块: session/instruction.ts (自动加载目录级 AGENTS.md)                                        │  │  │
│   │   │  ┌───────────────────────────────────────────────────────────────────────────────────────┐    │  │  │
│   │   │  │  Read 工具特性：                                                                         │    │  │  │
│   │   │  │  ├── 带行号输出: "00001| import { Database }..."                                        │    │  │  │
│   │   │  │  ├── 行数限制: 默认 2000 行，支持 offset/limit                                          │    │  │  │
│   │   │  │  └── 自动加载目录 AGENTS.md: 追加为 <system-reminder>                                   │    │  │  │
│   │   │  │                                                                                        │    │  │  │
│   │   │  │  分层规则系统：                                                                          │    │  │  │
│   │   │  │  ├── 系统提示词: "ALWAYS prefer editing existing files"                                 │    │  │  │
│   │   │  │  ├── 项目 AGENTS.md: 代码风格、目录结构                                                 │    │  │  │
│   │   │  │  └── 目录 AGENTS.md: 模块特定规则 (如 tests/ 测试规则)                                  │    │  │  │
│   │   │  └───────────────────────────────────────────────────────────────────────────────────────┘    │  │  │
│   │   └───────────────────────────────────────────────────────────────────────────────────────────────┘  │  │
│   │        │                                                                                              │  │
│   │        ▼                                                                                              │  │
│   │   ┌───────────────────────────────────────────────────────────────────────────────────────────────┐  │  │
│   │   │  阶段五：编写代码                                                                               │  │  │
│   │   │  Agent: Primary Agent                                                                          │  │  │
│   │   │  工具: Edit (tool/edit.ts), Write (tool/write.ts), Bash (tool/bash.ts)                         │  │  │
│   │   │  模块: lsp/ (实时错误检测)                                                                      │  │  │
│   │   │  ┌───────────────────────────────────────────────────────────────────────────────────────┐    │  │  │
│   │   │  │  Edit 工具 (修改现有文件):                                                               │    │  │  │
│   │   │  │  ├── 先读后改规则: 必须先 Read 才能 Edit                                                 │    │  │  │
│   │   │  │  ├── 7 种替换策略依次尝试 (容忍 LLM 输出差异):                                           │    │  │  │
│   │   │  │  │   1. SimpleReplacer (精确匹配)                                                       │    │  │  │
│   │   │  │  │   2. LineTrimmedReplacer (行首尾空格容忍)                                            │    │  │  │
│   │   │  │  │   3. BlockAnchorReplacer (首尾行定位)                                                │    │  │  │
│   │   │  │  │   4. WhitespaceNormalizedReplacer (空白规范化)                                       │    │  │  │
│   │   │  │  │   5. IndentationFlexibleReplacer (缩进容忍)                                          │    │  │  │
│   │   │  │  │   6. EscapeNormalizedReplacer (转义字符)                                             │    │  │  │
│   │   │  │  │   7. ContextAwareReplacer (上下文模糊定位)                                           │    │  │  │
│   │   │  │  └── LSP 集成: 编辑后自动检测错误                                                        │    │  │  │
│   │   │  │                                                                                        │    │  │  │
│   │   │  │  Write 工具 (创建新文件): 项目级任务常用                                                  │    │  │  │
│   │   │  │  └── package.json, tsconfig.json, src/index.ts ...                                     │    │  │  │
│   │   │  │                                                                                        │    │  │  │
│   │   │  │  Bash 工具: 创建目录、安装依赖                                                           │    │  │  │
│   │   │  │  └── mkdir -p, npm install, npm install -D                                             │    │  │  │
│   │   │  └───────────────────────────────────────────────────────────────────────────────────────┘    │  │  │
│   │   └───────────────────────────────────────────────────────────────────────────────────────────────┘  │  │
│   │        │                                                                                              │  │
│   │        ▼                                                                                              │  │
│   │   ┌───────────────────────────────────────────────────────────────────────────────────────────────┐  │  │
│   │   │  阶段六：验证与修复错误                                                                         │  │  │
│   │   │  Agent: Primary Agent                                                                          │  │  │
│   │   │  工具: Bash, Edit, Read, Grep                                                                  │  │  │
│   │   │  模块: lsp/ (LSP 诊断)                                                                         │  │  │
│   │   │  ┌───────────────────────────────────────────────────────────────────────────────────────┐    │  │  │
│   │   │  │  错误修复循环:                                                                           │    │  │  │
│   │   │  │  ┌─────────────────────────────────────────────────────────────────────────────────┐  │    │  │  │
│   │   │  │  │  Edit 执行 → LSP 检测                                                             │  │    │  │  │
│   │   │  │  │       │                                                                          │  │    │  │  │
│   │   │  │  │       ├── 无错误 → 继续下一步                                                    │  │    │  │  │
│   │   │  │  │       │                                                                          │  │    │  │  │
│   │   │  │  │       └── 有错误 → 错误加入工具输出                                               │  │    │  │  │
│   │   │  │  │                   → LLM 下一轮看到错误                                            │  │    │  │  │
│   │   │  │  │                   → Grep 定位 → Read 查看 → Edit 修复                            │  │    │  │  │
│   │   │  │  │                   → 返回 Edit 执行 (循环)                                         │  │    │  │  │
│   │   │  │  └─────────────────────────────────────────────────────────────────────────────────┘  │    │  │  │
│   │   │  │                                                                                        │    │  │  │
│   │   │  │  验证操作:                                                                              │    │  │  │
│   │   │  │  ├── 简单任务: Bash("npm test -- --grep '邮箱验证'")                                   │    │  │  │
│   │   │  │  └── 项目级: Bash("npm run build") + Bash("npm test")                                 │    │  │  │
│   │   │  └───────────────────────────────────────────────────────────────────────────────────────┘    │  │  │
│   │   └───────────────────────────────────────────────────────────────────────────────────────────────┘  │  │
│   │        │                                                                                              │  │
│   │        ▼                                                                                              │  │
│   │   ┌───────────────────────────────────────────────────────────────────────────────────────────────┐  │  │
│   │   │  阶段七：任务完成                                                                               │  │  │
│   │   │  Agent: Primary Agent (+ Summary Agent 可选)                                                   │  │  │
│   │   │  工具: TodoWrite                                                                               │  │  │
│   │   │  ┌───────────────────────────────────────────────────────────────────────────────────────┐    │  │  │
│   │   │  │  1. TodoWrite 标记所有任务为 completed                                                   │    │  │  │
│   │   │  │  2. LLM 返回最终文本回复（而非 tool-calls）                                               │    │  │  │
│   │   │  │  3. 循环检测到 finish === "stop"，退出主循环                                             │    │  │  │
│   │   │  └───────────────────────────────────────────────────────────────────────────────────────┘    │  │  │
│   │   └───────────────────────────────────────────────────────────────────────────────────────────────┘  │  │
│   │        │                                                                                              │  │
│   │        └── 工具结果加入消息历史 → 返回循环顶部                                                         │  │
│   │                                                                                                       │  │
│   └─────────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│        │                                                                                                    │
│        ▼                                                                                                    │
│   返回最终结果给用户                                                                                         │
│                                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Agent 体系与分工

| Agent 名称 | 源码位置 | 职责 | 工作时机 |
|-----------|---------|------|---------|
| **Primary Agent** | `session/prompt.ts` | 主 Agent，任务理解、决策、编码 | 用户发起请求 |
| **Explore Agent** | `agent/prompt/explore.txt` | 代码探索专家，只读操作 | Task 工具委派 |
| **Compaction Agent** | `agent/prompt/compaction.txt` | 会话压缩，生成摘要 | 上下文溢出 |
| **Title Agent** | `agent/prompt/title.txt` | 生成会话标题 | 会话开始 |
| **Summary Agent** | `agent/prompt/summary.txt` | 生成对话摘要 | 会话结束 |
| **Plan Agent** | `session/prompt/plan.txt` | 规划模式，只读分析 | Plan Mode |

### 工具完整清单

| 工具 | 源码 | 功能 | 关键特性 |
|------|------|------|---------|
| **TodoWrite** | `tool/todowrite.ts` | 任务规划 | 状态管理、进度可视化 |
| **Grep** | `tool/grep.ts` | 内容搜索 | 正则支持、返回文件+行号 |
| **Glob** | `tool/glob.ts` | 文件名搜索 | 按修改时间排序、最多100结果 |
| **Read** | `tool/read.ts` | 读取文件 | 带行号输出、自动加载 AGENTS.md |
| **Edit** | `tool/edit.ts` | 编辑文件 | 7种替换策略、LSP 错误检测 |
| **Write** | `tool/write.ts` | 创建文件 | 项目级任务常用 |
| **Bash** | `tool/bash.ts` | 执行命令 | Git 安全协议、持久 shell |
| **Task** | `tool/task.ts` | 委派子任务 | 启动子 Agent、并行执行 |
| **WebFetch** | `tool/webfetch.ts` | 获取网页 | 转 Markdown、内容摘要 |
| **WebSearch** | `tool/websearch.ts` | 网络搜索 | 获取最新信息 |

### 核心设计理念

| 理念 | 实现 | 价值 |
|------|------|------|
| **持续工作** | 循环驱动直到完成 | 无需用户多次干预 |
| **了解再改** | 先 Read 后 Edit | 避免盲目修改 |
| **容错优先** | 多种替换策略 | 容忍 LLM 小错误 |
| **规范遵循** | 多层 AGENTS.md | 自动遵循项目规范 |
| **实时反馈** | LSP 集成 | 立即发现错误 |
| **专业分工** | 多种 Agent 类型 | 各司其职 |
| **长任务支持** | Prune + Compaction | 支持超长会话 |

---

## 附录：源码文件索引

| 功能 | 源码位置 |
|------|---------|
| 主循环 | `packages/opencode/src/session/prompt.ts` |
| 系统提示词 | `packages/opencode/src/session/system.ts` |
| 模型提示词 | `packages/opencode/src/session/prompt/*.txt` |
| 指令加载 | `packages/opencode/src/session/instruction.ts` |
| 上下文压缩 | `packages/opencode/src/session/compaction.ts` |
| 工具定义 | `packages/opencode/src/tool/*.ts` |
| 工具描述 | `packages/opencode/src/tool/*.txt` |
| Agent 定义 | `packages/opencode/src/agent/agent.ts` |
| Agent 提示词 | `packages/opencode/src/agent/prompt/*.txt` |
| LSP 集成 | `packages/opencode/src/lsp/` |
