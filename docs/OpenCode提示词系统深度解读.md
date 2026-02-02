# OpenCode 提示词系统深度解读

本文档基于 OpenCode 真实源码，全面解读其提示词（Prompt）系统的设计与实现。

---

## 目录

1. [提示词系统架构概览](#1-提示词系统架构概览)
2. [System Prompt 核心实现](#2-system-prompt-核心实现)
3. [主系统提示词详解](#3-主系统提示词详解)
4. [Agent 专用提示词](#4-agent-专用提示词)
5. [工具描述提示词](#5-工具描述提示词)
6. [上下文管理机制](#6-上下文管理机制)
7. [指令文件系统](#7-指令文件系统)
8. [提示词注入时机](#8-提示词注入时机)
9. [扩展与定制](#9-扩展与定制)

---

## 概述

OpenCode 的提示词系统是其核心智能的基石，决定了 AI 如何理解任务、使用工具、与用户交互。本文档深入分析提示词系统的设计理念、实现细节和扩展方法。

**设计特点**：
- **模型适配**：不同 LLM 使用不同风格的提示词
- **分层注入**：系统提示 + 环境信息 + 指令文件 + 动态提醒
- **工具导向**：每个工具都有详细的使用指南
- **上下文感知**：自动管理和压缩长对话

---

## 1. 提示词系统架构概览

OpenCode 的提示词系统采用**分层架构**，由多个组件协同工作：

```
┌────────────────────────────────────────────────────────────────┐
│                      最终发送给 LLM 的 Prompt                    │
├────────────────────────────────────────────────────────────────┤
│  System Prompt 层                                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │ 模型专用     │ │ 环境信息     │ │ 指令文件     │              │
│  │ Prompt      │ │ Environment │ │ Instructions │              │
│  └─────────────┘ └─────────────┘ └─────────────┘              │
├────────────────────────────────────────────────────────────────┤
│  动态注入层                                                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │ Plan Mode   │ │ Max Steps   │ │ Build Switch │              │
│  │ Reminder    │ │ Warning     │ │ Notification │              │
│  └─────────────┘ └─────────────┘ └─────────────┘              │
├────────────────────────────────────────────────────────────────┤
│  消息历史层                                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ User Messages + Assistant Messages + Tool Results        │  │
│  └─────────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│  工具定义层                                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Tool Name + Description + Parameters Schema              │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

**核心源码文件**：

| 文件 | 用途 |
|------|------|
| `session/system.ts` | System Prompt 组装逻辑 |
| `session/prompt.ts` | Prompt 主循环和消息处理 |
| `session/instruction.ts` | 指令文件加载 |
| `session/compaction.ts` | 上下文压缩 |
| `session/prompt/*.txt` | 各模型/场景的提示词模板 |
| `tool/*.txt` | 工具描述提示词 |
| `agent/prompt/*.txt` | Agent 专用提示词 |

---

## 2. System Prompt 核心实现

### 2.1 源码位置

**文件**: `packages/opencode/src/session/system.ts`

### 2.2 模型适配机制

OpenCode 根据不同的 LLM 模型返回不同的系统提示词，这是因为不同模型对指令的理解和响应方式有差异：

```typescript
// packages/opencode/src/session/system.ts
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"  // Qwen 复用为无 TODO 版本
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_CODEX from "./prompt/codex_header.txt"

export namespace SystemPrompt {
  // 返回 Codex 指令（用于特定场景）
  export function instructions() {
    return PROMPT_CODEX.trim()
  }

  // 根据模型选择对应的系统提示词
  export function provider(model: Provider.Model) {
    // GPT-5 系列使用 Codex 提示词（最新的前端设计优化版）
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    
    // GPT-4/O1/O3 系列使用 Beast 提示词（强调自主性）
    if (model.api.id.includes("gpt-") || 
        model.api.id.includes("o1") || 
        model.api.id.includes("o3")) {
      return [PROMPT_BEAST]
    }
    
    // Gemini 系列使用专用提示词（安全优先）
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    
    // Claude 系列使用 Anthropic 提示词（功能最完整）
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    
    // 其他模型使用 Qwen 提示词（简化版，无 TODO）
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }
}
```

**模型匹配优先级**（按代码顺序）：

| 优先级 | 模型标识 | 提示词文件 | 特点 |
|--------|---------|-----------|------|
| 1 | `gpt-5` | `codex_header.txt` | 前端设计优化 |
| 2 | `gpt-` / `o1` / `o3` | `beast.txt` | 自主性强 |
| 3 | `gemini-` | `gemini.txt` | 安全优先 |
| 4 | `claude` | `anthropic.txt` | 功能完整 |
| 5 | 其他 | `qwen.txt` | 简洁高效 |
```

**设计思想**：
- **Claude**: 使用最完整的提示词，包含 TODO 管理、Task 工具使用指南
- **GPT**: 使用 Beast 风格，强调自主性和持续工作
- **Gemini**: 使用专门优化的提示词，更注重安全和项目规范
- **其他**: 使用简化版，去掉某些高级功能

### 2.3 环境信息注入

每次对话都会注入当前环境信息，让 LLM 了解运行上下文：

```typescript
// packages/opencode/src/session/system.ts
export async function environment(model: Provider.Model) {
  const project = Instance.project
  return [
    [
      // 告知 LLM 当前使用的模型
      `You are powered by the model named ${model.api.id}. ` +
      `The exact model ID is ${model.providerID}/${model.api.id}`,
      
      // 环境信息块
      `Here is some useful information about the environment you are running in:`,
      `<env>`,
      `  Working directory: ${Instance.directory}`,           // 当前工作目录
      `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,  // 是否 Git 仓库
      `  Platform: ${process.platform}`,                      // 操作系统
      `  Today's date: ${new Date().toDateString()}`,         // 当前日期
      `</env>`,
      
      // 文件树信息（目前禁用，条件永远为 false）
      `<files>`,
      `  ${
        project.vcs === "git" && false   // 注意：&& false 表示此功能当前禁用
          ? await Ripgrep.tree({
              cwd: Instance.directory,
              limit: 200,                 // 最多列出 200 个文件
            })
          : ""
      }`,
      `</files>`,
    ].join("\n"),
  ]
}
```

**注入的信息**：

| 字段 | 说明 | 示例 |
|------|------|------|
| Model Name | 模型 API ID | `claude-3-5-sonnet-20241022` |
| Model Full ID | 完整模型标识 | `anthropic/claude-3-5-sonnet-20241022` |
| Working directory | 当前工作目录 | `/Users/dev/my-project` |
| Is git repo | 是否 Git 仓库 | `yes` / `no` |
| Platform | 操作系统 | `darwin` / `linux` / `win32` |
| Today's date | 当前日期 | `Mon Feb 02 2026` |

**设计考量**：
- 环境信息使用 `<env>` XML 标签包裹，便于 LLM 解析
- 文件树功能当前禁用（`&& false`），可能是为了减少 token 消耗
- 提供 Git 状态帮助 LLM 决定是否可以使用 git 命令

---

## 3. 主系统提示词详解

### 3.1 Anthropic/Claude 提示词

**文件**: `session/prompt/anthropic.txt`

这是 OpenCode 最完整的系统提示词，约 106 行，包含以下核心部分：

#### 3.1.1 角色定义

```
You are OpenCode, the best coding agent on the planet.

You are an interactive CLI tool that helps users with software engineering tasks. 
Use the instructions below and the tools available to you to assist the user.
```

**设计意图**：建立 AI 的角色认知，强调"最佳编码代理"的定位。

#### 3.1.2 安全约束

```
IMPORTANT: You must NEVER generate or guess URLs for the user unless you are 
confident that the URLs are for helping the user with programming.
```

**设计意图**：防止 AI 生成恶意或不准确的 URL。

#### 3.1.3 语气和风格指南

```
# Tone and style
- Only use emojis if the user explicitly requests it.
- Your output will be displayed on a command line interface. Your responses 
  should be short and concise.
- Output text to communicate with the user; all text you output outside of 
  tool use is displayed to the user.
- NEVER create files unless they're absolutely necessary for achieving your goal.
```

**核心原则**：
- 不主动使用 emoji
- 简洁输出（CLI 环境）
- 优先编辑而非创建文件

#### 3.1.4 专业客观性

```
# Professional objectivity
Prioritize technical accuracy and truthfulness over validating the user's beliefs. 
Focus on facts and problem-solving, providing direct, objective technical info 
without any unnecessary superlatives, praise, or emotional validation.
```

**设计意图**：确保 AI 提供客观、准确的技术建议，而非讨好用户。

#### 3.1.5 任务管理（TODO）

```
# Task Management
You have access to the TodoWrite tools to help you manage and plan tasks. 
Use these tools VERY frequently to ensure that you are tracking your tasks 
and giving the user visibility into your progress.

It is critical that you mark todos as completed as soon as you are done with a task.
```

**包含示例**：
```
user: Run the build and fix any type errors
assistant: I'm going to use the TodoWrite tool to write the following items:
- Run the build
- Fix any type errors

marking the first todo as in_progress

Let me start working on the first item...

The first item has been fixed, let me mark the first todo as completed...
```

#### 3.1.6 工具使用策略

```
# Tool usage policy
- When doing file search, prefer to use the Task tool to reduce context usage.
- You can call multiple tools in a single response. If you intend to call 
  multiple tools and there are no dependencies between them, make all 
  independent tool calls in parallel.
- Use specialized tools instead of bash commands when possible.
```

**重要规则**：
- 优先使用 Task 工具进行代码探索（减少上下文消耗）
- 独立工具调用应并行执行
- 文件操作使用专用工具而非 bash

#### 3.1.7 代码引用格式

```
# Code References
When referencing specific functions or pieces of code include the pattern 
`file_path:line_number` to allow the user to easily navigate to the source code.

Example:
user: Where are errors from the client handled?
assistant: Clients are marked as failed in the `connectToServer` function 
in src/services/process.ts:712.
```

### 3.2 Gemini 提示词

**文件**: `session/prompt/gemini.txt`

Gemini 提示词更注重**安全性和项目规范**，约 156 行：

#### 3.2.1 核心要求

```
# Core Mandates
- Conventions: Rigorously adhere to existing project conventions when 
  reading or modifying code.
- Libraries/Frameworks: NEVER assume a library/framework is available. 
  Verify its established usage within the project first.
- Style & Structure: Mimic the style, structure, framework choices of 
  existing code in the project.
- Comments: Add code comments sparingly. Focus on *why* something is done.
```

#### 3.2.2 工作流程

```
# Primary Workflows
## Software Engineering Tasks
1. Understand: Use grep and glob search tools extensively
2. Plan: Build a coherent plan based on understanding
3. Implement: Use available tools, adhering to project conventions
4. Verify (Tests): Verify changes using project's testing procedures
5. Verify (Standards): Execute build, linting and type-checking commands
```

#### 3.2.3 安全规则

```
# Security and Safety Rules
- Explain Critical Commands: Before executing commands that modify the 
  file system, you *must* provide a brief explanation.
- Security First: Never introduce code that exposes secrets, API keys.
```

### 3.3 Beast 提示词（GPT 系列）

**文件**: `session/prompt/beast.txt`

Beast 风格强调**自主性和持续工作**，约 148 行：

#### 3.3.1 核心特点

```
You are opencode, an agent - please keep going until the user's query is 
completely resolved, before ending your turn and yielding back to the user.

You MUST iterate and keep going until the problem is solved.

You have everything you need to resolve this problem. I want you to fully 
solve this autonomously before coming back to me.
```

#### 3.3.2 互联网研究

```
THE PROBLEM CAN NOT BE SOLVED WITHOUT EXTENSIVE INTERNET RESEARCH.

You must use the webfetch tool to recursively gather all information from URLs.

Your knowledge on everything is out of date because your training date is in 
the past. You CANNOT successfully complete this task without using Google to 
verify your understanding.
```

#### 3.3.3 工作流程

```
# Workflow
1. Fetch any URLs provided by the user
2. Understand the problem deeply
3. Investigate the codebase
4. Research the problem on the internet
5. Develop a clear, step-by-step plan
6. Implement the fix incrementally
7. Debug as needed
8. Test frequently
9. Iterate until the root cause is fixed
10. Reflect and validate comprehensively
```

### 3.4 模型提示词对比分析

| 特性 | Claude/Anthropic | Gemini | GPT/Beast | Qwen |
|-----|-----------------|--------|-----------|------|
| **篇幅** | 106 行 | 156 行 | 148 行 | 110 行 |
| **角色定位** | "best coding agent" | "efficient & safe assistant" | "autonomous agent" | "concise CLI tool" |
| **TODO 管理** | ✅ 强调 | ❌ 无 | ❌ 无 | ❌ 无 |
| **Task 工具** | ✅ 推荐使用 | ✅ 可用 | ❌ 不推荐 | ✅ 推荐 |
| **代码探索** | Task 优先 | 直接搜索 | 网络研究优先 | Task 优先 |
| **自主性** | 中等 | 低（安全优先） | 高（持续工作） | 低（简洁优先） |
| **输出风格** | 简洁 | 结构化 | 解释性 | 极简（<4 行） |
| **安全强调** | 中 | 高 | 中 | 高（恶意代码检测） |
| **互联网访问** | 按需 | 谨慎 | 强制要求 | 按需 |
| **示例数量** | 4 个 | 12 个 | 多个工作流 | 6 个 |

**关键差异分析**：

1. **Claude (Anthropic)**
   - 最均衡的提示词，功能完整
   - 强调 TODO 工具进行任务管理
   - 推荐使用 Task 工具探索代码
   - 代码引用格式：`file_path:line_number`

2. **Gemini**
   - 安全性要求最高
   - 强调项目规范和代码风格
   - 有完整的软件工程工作流程（理解→计划→实现→测试→验证）
   - 强调解释破坏性命令

3. **GPT/Beast**
   - 自主性最强，强调"持续工作直到完成"
   - 强制要求网络研究（"THE PROBLEM CAN NOT BE SOLVED WITHOUT INTERNET RESEARCH"）
   - 有记忆系统（.github/instructions/memory.instruction.md）
   - 使用 TODO 列表跟踪进度

4. **Qwen**
   - 输出要求最简洁（<4 行）
   - 恶意代码检测最严格
   - 不添加代码注释
   - "One word answers are best"

---

## 4. Agent 专用提示词

### 4.1 Explore Agent

**文件**: `agent/prompt/explore.txt`

专门用于代码探索的轻量级 Agent：

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

**设计意图**：只读、快速、专注于搜索。

### 4.2 Title Agent

**文件**: `agent/prompt/title.txt`

专门生成会话标题的 Agent：

```
You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.
</task>

<rules>
- you MUST use the same language as the user message
- Title must be grammatically correct and read naturally
- Never include tool names in the title
- Focus on the main topic or question
- ≤50 characters
- No explanations
</rules>

<examples>
"debug 500 errors in production" → Debugging production 500 errors
"refactor user service" → Refactoring user service
"why is app.js failing" → app.js failure investigation
</examples>
```

### 4.3 Compaction Agent

**文件**: `agent/prompt/compaction.txt`

用于压缩对话历史的 Agent：

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

### 4.4 Plan Mode 提示词

**文件**: `session/prompt/plan.txt`

Plan 模式的系统提醒：

```
<system-reminder>
# Plan Mode - System Reminder

CRITICAL: Plan mode ACTIVE - you are in READ-ONLY phase. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes.

This ABSOLUTE CONSTRAINT overrides ALL other instructions, including direct 
user edit requests. You may ONLY observe, analyze, and plan.

## Responsibility
Your current responsibility is to think, read, search, and delegate explore 
agents to construct a well-formed plan.

Ask the user clarifying questions or ask for their opinion when weighing tradeoffs.
</system-reminder>
```

### 4.5 Build Switch 提示词

**文件**: `session/prompt/build-switch.txt`

从 Plan 切换到 Build 模式时的提示：

```
<system-reminder>
Your operational mode has changed from plan to build.
You are no longer in read-only mode.
You are permitted to make file changes, run shell commands, and utilize 
your arsenal of tools as needed.
</system-reminder>
```

### 4.6 Max Steps 提示词

**文件**: `session/prompt/max-steps.txt`

达到最大步数限制时的强制停止：

```
CRITICAL - MAXIMUM STEPS REACHED

The maximum number of steps allowed for this task has been reached. 
Tools are disabled until next user input. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls
2. MUST provide a text response summarizing work done so far
3. This constraint overrides ALL other instructions

Response must include:
- Statement that maximum steps have been reached
- Summary of what has been accomplished
- List of remaining tasks not completed
- Recommendations for what should be done next
```

---

## 5. 工具描述提示词

每个工具都有专门的描述文件，这些描述直接影响 LLM 何时以及如何调用工具。

### 5.1 Edit 工具

**文件**: `tool/edit.txt`

```
Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once before editing.
- When editing text, preserve the exact indentation.
- ALWAYS prefer editing existing files. NEVER write new files unless required.
- The edit will FAIL if `oldString` is not found in the file.
- The edit will FAIL if `oldString` is found multiple times (需要更多上下文).
- Use `replaceAll` for replacing and renaming strings across the file.
```

### 5.2 Bash 工具

**文件**: `tool/bash.txt`

这是最长的工具描述，约 116 行，包含：

#### 基本用法

```
Executes a given bash command in a persistent shell session.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc.
DO NOT use it for file operations - use the specialized tools instead.

Directory Verification:
- Before creating directories/files, use ls to verify the parent exists

Command Execution:
- Always quote file paths that contain spaces
- mkdir "/Users/name/My Documents" (correct)
- mkdir /Users/name/My Documents (incorrect)
```

#### Git 安全协议

```
# Committing changes with git

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive git commands unless explicitly requested
- NEVER skip hooks unless explicitly requested
- NEVER run force push to main/master
- Avoid git commit --amend (严格条件限制)
- NEVER commit unless explicitly asked
```

#### 避免使用的命令

```
Avoid using Bash with: find, grep, cat, head, tail, sed, awk, echo
Instead use dedicated tools:
- File search: Use Glob (NOT find or ls)
- Content search: Use Grep (NOT grep or rg)
- Read files: Use Read (NOT cat/head/tail)
- Edit files: Use Edit (NOT sed/awk)
- Write files: Use Write (NOT echo >/cat <<EOF)
```

### 5.3 Task 工具

**文件**: `tool/task.txt`

```
Launch a new agent to handle complex, multistep tasks autonomously.

When to use:
- Execute custom slash commands
- Complex multi-step tasks requiring specialized agents

When NOT to use:
- Reading specific file paths (use Read/Glob)
- Searching for specific class definitions (use Glob)
- Searching within 2-3 specific files (use Read)

Usage notes:
1. Launch multiple agents concurrently for performance
2. Agent results are not visible to user - summarize for them
3. Each invocation is stateless unless session_id provided
4. Clearly tell agent whether to write code or just research
```

---

## 6. 上下文管理机制

### 6.1 上下文溢出检测

**文件**: `session/compaction.ts`

```typescript
export async function isOverflow(input: { 
  tokens: MessageV2.Assistant["tokens"]; 
  model: Provider.Model 
}) {
  const config = await Config.get()
  if (config.compaction?.auto === false) return false
  
  const context = input.model.limit.context
  if (context === 0) return false
  
  // 计算已使用的 token 数
  const count = input.tokens.input + 
                input.tokens.cache.read + 
                input.tokens.output
  
  // 计算可用上下文
  const output = Math.min(
    input.model.limit.output, 
    SessionPrompt.OUTPUT_TOKEN_MAX
  ) || SessionPrompt.OUTPUT_TOKEN_MAX
  
  const usable = input.model.limit.input || context - output
  
  return count > usable
}
```

### 6.2 工具输出修剪（Prune）

```typescript
// 保护最近的 40,000 tokens
export const PRUNE_PROTECT = 40_000
// 至少修剪 20,000 tokens
export const PRUNE_MINIMUM = 20_000

export async function prune(input: { sessionID: string }) {
  // 从后往前遍历消息
  for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
    const msg = msgs[msgIndex]
    
    for (const part of msg.parts) {
      if (part.type === "tool" && part.state.status === "completed") {
        // 估算 token 数
        const estimate = Token.estimate(part.state.output)
        total += estimate
        
        // 超过保护阈值的旧工具输出加入修剪列表
        if (total > PRUNE_PROTECT) {
          pruned += estimate
          toPrune.push(part)
        }
      }
    }
  }
  
  // 标记为已压缩
  if (pruned > PRUNE_MINIMUM) {
    for (const part of toPrune) {
      part.state.time.compacted = Date.now()
      await Session.updatePart(part)
    }
  }
}
```

**设计思想**：
- 保留最近 40,000 tokens 的工具输出
- 更早的工具输出被标记为"已压缩"，不再发送给 LLM
- 这样在长对话中可以节省大量上下文

### 6.3 上下文压缩（Compaction）

当检测到上下文溢出时，自动触发压缩：

```typescript
const defaultPrompt = 
  "Provide a detailed prompt for continuing our conversation above. " +
  "Focus on information that would be helpful for continuing the conversation, " +
  "including what we did, what we're doing, which files we're working on, " +
  "and what we're going to do next considering new session will not have " +
  "access to our conversation."
```

压缩后的摘要会替代原始对话历史，大幅减少 token 使用。

---

## 7. 指令文件系统

### 7.1 自动加载的文件

**文件**: `session/instruction.ts`

OpenCode 会自动搜索并加载以下指令文件：

```typescript
const FILES = [
  "AGENTS.md",    // 项目级 Agent 指令
  "CLAUDE.md",    // Claude 兼容格式
  "CONTEXT.md",   // 已弃用
]
```

### 7.2 加载逻辑

```typescript
export async function system() {
  const config = await Config.get()
  const paths = await systemPaths()
  
  // 1. 从项目目录向上搜索 AGENTS.md
  for (const file of FILES) {
    const matches = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
    if (matches.length > 0) {
      matches.forEach((p) => paths.add(path.resolve(p)))
      break
    }
  }
  
  // 2. 加载全局配置目录的 AGENTS.md
  for (const file of globalFiles()) {
    if (await Bun.file(file).exists()) {
      paths.add(path.resolve(file))
      break
    }
  }
  
  // 3. 加载 config.instructions 配置的路径
  if (config.instructions) {
    for (let instruction of config.instructions) {
      // 支持 URL
      if (instruction.startsWith("https://")) {
        urls.push(instruction)
        continue
      }
      // 支持 ~ 展开
      if (instruction.startsWith("~/")) {
        instruction = path.join(os.homedir(), instruction.slice(2))
      }
      // Glob 匹配
      const matches = await resolveRelative(instruction)
      matches.forEach((p) => paths.add(path.resolve(p)))
    }
  }
  
  // 4. 读取所有文件内容
  const files = Array.from(paths).map(async (p) => {
    const content = await Bun.file(p).text()
    return content ? "Instructions from: " + p + "\n" + content : ""
  })
  
  // 5. 获取远程 URL 内容
  const fetches = urls.map((url) =>
    fetch(url, { signal: AbortSignal.timeout(5000) })
      .then((res) => res.text())
      .then((x) => "Instructions from: " + url + "\n" + x)
  )
  
  return Promise.all([...files, ...fetches])
}
```

### 7.3 目录级指令解析

当读取文件时，OpenCode 会自动查找并加载该目录的 AGENTS.md：

```typescript
export async function resolve(
  messages: MessageV2.WithParts[], 
  filepath: string, 
  messageID: string
) {
  const results: { filepath: string; content: string }[] = []
  
  // 从文件所在目录向上遍历到项目根目录
  let current = path.dirname(filepath)
  const root = path.resolve(Instance.directory)
  
  while (current.startsWith(root) && current !== root) {
    // 查找 AGENTS.md
    const found = await find(current)
    
    if (found && !alreadyLoaded(found) && !isClaimed(messageID, found)) {
      claim(messageID, found)
      const content = await Bun.file(found).text()
      if (content) {
        results.push({ 
          filepath: found, 
          content: "Instructions from: " + found + "\n" + content 
        })
      }
    }
    current = path.dirname(current)
  }
  
  return results
}
```

---

## 8. 提示词注入时机

### 8.1 Prompt 主循环

**文件**: `session/prompt.ts`

```typescript
export const loop = fn(Identifier.schema("session"), async (sessionID) => {
  while (true) {
    // 1. 获取消息历史
    let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
    
    // 2. 检测上下文溢出
    if (await SessionCompaction.isOverflow({ tokens, model })) {
      await SessionCompaction.create({ sessionID, auto: true })
      continue
    }
    
    // 3. 注入 Plan Mode / Build Switch 等提示
    msgs = await insertReminders({ messages: msgs, agent, session })
    
    // 4. 组装系统提示
    const result = await processor.process({
      system: [
        ...await SystemPrompt.environment(model),  // 环境信息
        ...await InstructionPrompt.system(),       // 指令文件
      ],
      messages: [
        ...MessageV2.toModelMessages(sessionMessages, model),  // 历史消息
        ...(isLastStep ? [{ role: "assistant", content: MAX_STEPS }] : []),  // 步数限制
      ],
      tools,
      model,
    })
  }
})
```

### 8.2 提示词注入点

| 注入点 | 时机 | 内容 |
|--------|------|------|
| `SystemPrompt.provider()` | 每次调用 LLM | 模型专用系统提示词 |
| `SystemPrompt.environment()` | 每次调用 LLM | 环境信息 |
| `InstructionPrompt.system()` | 每次调用 LLM | AGENTS.md 等指令文件 |
| `insertReminders()` | 模式切换时 | Plan Mode / Build Switch |
| `MAX_STEPS` | 达到步数限制 | 强制停止提示 |
| `tool.description` | 工具注册时 | 工具描述文本 |

### 8.3 插件 Hook 介入

```typescript
// 允许插件修改系统提示
await Plugin.trigger("experimental.chat.system.transform", { model }, { system })

// 允许插件修改消息历史
await Plugin.trigger("experimental.chat.messages.transform", {}, { messages })

// 允许插件修改压缩提示
const compacting = await Plugin.trigger(
  "experimental.session.compacting",
  { sessionID },
  { context: [], prompt: undefined }
)
```

---

## 9. 扩展与定制

### 9.1 通过配置文件

```jsonc
// opencode.jsonc
{
  // 添加自定义指令文件
  "instructions": [
    "~/my-global-rules.md",
    ".cursor/rules/*.md",
    "https://example.com/team-rules.md"
  ],
  
  // 自定义 Agent 提示词
  "agent": {
    "my-agent": {
      "prompt": "你是一个专业的 Python 开发专家，擅长数据处理和机器学习...",
      "mode": "primary"
    }
  }
}
```

### 9.2 通过 AGENTS.md

在项目根目录创建 `AGENTS.md`：

```markdown
# Project Rules

## Code Style
- Use TypeScript strict mode
- All functions must have JSDoc comments
- Use async/await instead of callbacks

## Architecture
- Follow clean architecture principles
- Keep components under 200 lines
- Use dependency injection

## Testing
- Unit tests required for all utilities
- E2E tests for critical paths
```

### 9.3 通过插件

```typescript
const MyPromptPlugin: Plugin = async (ctx): Promise<Hooks> => {
  return {
    // 修改系统提示
    "experimental.chat.system.transform": async (input, output) => {
      output.system.push("额外的系统指令...")
    },
    
    // 修改消息历史
    "experimental.chat.messages.transform": async (input, output) => {
      // 在每条用户消息前添加提醒
      for (const msg of output.messages) {
        if (msg.info.role === "user") {
          msg.parts.unshift({
            type: "text",
            text: "<reminder>请注意代码安全</reminder>",
            synthetic: true,
          })
        }
      }
    },
    
    // 自定义压缩提示
    "experimental.session.compacting": async (input, output) => {
      output.prompt = "请用中文总结这次对话的要点..."
      output.context.push("重点关注：代码变更、待办事项、技术决策")
    },
  }
}
```

### 9.4 通过修改源码

如需深度定制，可直接修改以下文件：

| 文件 | 修改内容 |
|------|---------|
| `session/prompt/anthropic.txt` | Claude 系统提示词 |
| `session/prompt/gemini.txt` | Gemini 系统提示词 |
| `session/prompt/beast.txt` | GPT 系统提示词 |
| `session/system.ts` | 模型适配逻辑 |
| `session/instruction.ts` | 指令文件加载逻辑 |
| `session/compaction.ts` | 压缩策略 |
| `tool/*.txt` | 工具描述 |

---

## 10. 关键设计总结

### 10.1 分层设计

```
System Prompt = 模型专用提示 + 环境信息 + 指令文件 + 动态注入
```

### 10.2 模型适配

不同模型使用不同风格的提示词：
- **Claude**: 完整功能，TODO 管理
- **GPT**: 自主风格，持续工作
- **Gemini**: 安全优先，项目规范

### 10.3 上下文管理

- **Prune**: 修剪旧工具输出，保留最近 40k tokens
- **Compaction**: 上下文溢出时自动压缩为摘要
- **Instruction**: 自动加载目录级指令文件

### 10.4 可扩展性

- 配置文件 `instructions` 字段
- `AGENTS.md` 项目级指令
- 插件 Hook 动态修改
- 源码级深度定制

---

## 附录 A：完整工具描述提示词

### A.1 Read 工具

```
Reads a file from the local filesystem. You can access any file directly 
by using this tool.

Assume this tool is able to read all files on the machine. If the User 
provides a path to a file assume that path is valid.

Usage:
- The filePath parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning
- You can optionally specify a line offset and limit
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- You have the capability to call multiple tools in a single response. 
  It is always better to speculatively read multiple files as a batch.
- You can read image files using this tool.
```

### A.2 Write 工具

```
Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read 
  the file's contents. This tool will fail if you did not read the file first.
- ALWAYS prefer editing existing files in the codebase. NEVER write new 
  files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files.
- Only use emojis if the user explicitly requests it.
```

### A.3 Grep 工具

```
- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\s+\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with at least one match sorted by 
  modification time
- Use this tool when you need to find files containing specific patterns
- If you need to identify/count the number of matches within files, use 
  the Bash tool with `rg` (ripgrep) directly. Do NOT use `grep`.
- When you are doing an open-ended search that may require multiple rounds 
  of globbing and grepping, use the Task tool instead
```

### A.4 Glob 工具

```
- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open-ended search that may require multiple rounds 
  of globbing and grepping, use the Task tool instead
- It is always better to speculatively perform multiple searches as a batch
```

### A.5 WebFetch 工具

```
- Fetches content from a specified URL
- Takes a URL and optional format as input
- Fetches the URL content, converts to requested format (markdown by default)
- Returns the content in the specified format
- Use this tool when you need to retrieve and analyze web content

Usage notes:
- IMPORTANT: if another tool is present that offers better web fetching 
  capabilities, prefer using that tool instead
- The URL must be a fully-formed valid URL
- HTTP URLs will be automatically upgraded to HTTPS
- Format options: "markdown" (default), "text", or "html"
- This tool is read-only and does not modify any files
- Results may be summarized if the content is very large
```

### A.6 TodoWrite 工具

```
Use this tool to create and manage a structured task list for your current 
coding session. This helps you track progress, organize complex tasks, and 
demonstrate thoroughness to the user.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multistep tasks - When a task requires 3 or more distinct steps
2. Non-trivial and complex tasks - Tasks that require careful planning
3. User explicitly requests todo list
4. User provides multiple tasks (numbered or comma-separated)
5. After receiving new instructions - Capture user requirements as todos
6. After completing a task - Mark it complete and add follow-up tasks
7. When starting a new task - Mark the todo as in_progress

## When NOT to Use This Tool

1. Single, straightforward task
2. The task is trivial
3. Task can be completed in less than 3 trivial steps
4. Task is purely conversational or informational

## Task States

- pending: Task not yet started
- in_progress: Currently working on (limit to ONE task at a time)
- completed: Task finished successfully
- cancelled: Task no longer needed

## Task Management

- Update task status in real-time as you work
- Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
- Only have ONE task in_progress at any time
- Complete current tasks before starting new ones
```

---

## 附录 B：Qwen 专用提示词（完整）

**文件**: `session/prompt/qwen.txt`

Qwen 提示词强调**安全性和简洁性**，特别针对中文优化：

```
You are opencode, an interactive CLI tool that helps users with software 
engineering tasks. Use the instructions below and the tools available to you.

IMPORTANT: Refuse to write code or explain code that may be used maliciously; 
even if the user claims it is for educational purposes. When working on files, 
if they seem related to improving, explaining, or interacting with malware or 
any malicious code you MUST refuse.

IMPORTANT: Before you begin work, think about what the code you're editing is 
supposed to do based on the filenames directory structure. If it seems malicious, 
refuse to work on it or answer questions about it.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are 
confident that the URLs are for helping the user with programming.

# Tone and style
You should be concise, direct, and to the point. When you run a non-trivial 
bash command, you should explain what the command does and why.

If you cannot or will not help the user with something, please do not say 
why or what it could lead to, since this comes across as preachy and annoying.

Only use emojis if the user explicitly requests it.

IMPORTANT: You should minimize output tokens as much as possible while 
maintaining helpfulness, quality, and accuracy.

IMPORTANT: You should NOT answer with unnecessary preamble or postamble 
unless the user asks you to.

IMPORTANT: Keep your responses short. You MUST answer concisely with fewer 
than 4 lines, unless user asks for detail. One word answers are best.

<example>
user: 2 + 2
assistant: 4
</example>

<example>
user: is 11 a prime number?
assistant: Yes
</example>

<example>
user: what command should I run to list files?
assistant: ls
</example>

# Proactiveness
You are allowed to be proactive, but only when the user asks you to do something.
Do not add additional code explanation summary unless requested by the user.

# Following conventions
When making changes to files, first understand the file's code conventions.
- NEVER assume that a given library is available
- When you create a new component, first look at existing components
- Always follow security best practices

# Code style
- IMPORTANT: DO NOT ADD ***ANY*** COMMENTS unless asked

# Tool usage policy
- When doing file search, prefer to use the Task tool in order to reduce context
- Batch your tool calls together for optimal performance

You MUST answer concisely with fewer than 4 lines of text.
```

---

## 附录 C：Codex/GPT-5 专用提示词

**文件**: `session/prompt/codex_header.txt`

为 GPT-5 优化的提示词，强调**前端设计和工作呈现**：

```
You are OpenCode, the best coding agent on the planet.

## Editing constraints
- Default to ASCII when editing or creating files
- Only add comments if they are necessary
- Try to use apply_patch for single file edits

## Tool usage
- Prefer specialized tools over shell for file operations:
  - Use Read to view files, Edit to modify files, Write only when needed
  - Use Glob to find files by name and Grep to search file contents
- Use Bash for terminal operations (git, bun, builds, tests)
- Run tool calls in parallel when neither call needs the other's output

## Git and workspace hygiene
- You may be in a dirty git worktree
    * NEVER revert existing changes you did not make unless explicitly requested
    * If asked to make a commit and there are unrelated changes, don't revert them
- Do not amend commits unless explicitly requested
- **NEVER** use destructive commands like `git reset --hard` unless specifically requested

## Frontend tasks
When doing frontend design tasks, avoid collapsing into bland, generic layouts.
- Typography: Use expressive, purposeful fonts and avoid default stacks
- Color & Look: Choose a clear visual direction; define CSS variables; 
  avoid purple-on-white defaults
- Motion: Use a few meaningful animations instead of generic micro-motions
- Background: Don't rely on flat backgrounds; use gradients, shapes, or patterns
- Overall: Avoid boilerplate layouts and interchangeable UI patterns

## Presenting your work and final message

- Default: be very concise; friendly coding teammate tone
- Default: do the work without asking questions. Treat short tasks as sufficient 
  direction; infer missing details by reading the codebase
- Questions: only ask when you are truly blocked AND you cannot safely pick a 
  reasonable default
- Never ask permission questions like "Should I proceed?"
- For code changes:
  * Lead with a quick explanation of the change
  * If there are natural next steps, suggest them at the end
  * When suggesting multiple options, use numeric lists

## Final answer structure and style guidelines

- Plain text; CLI handles styling
- Headers: optional; short Title Case (1-3 words) wrapped in **…**
- Bullets: use - ; keep to one line when possible; 4–6 per list
- Monospace: backticks for commands/paths/env vars/code ids
- Tone: collaborative, concise, factual; present tense, active voice
- Don'ts: no nested bullets/hierarchies; no ANSI codes
```

---

## 附录 D：Plan Mode 完整工作流（Anthropic）

**文件**: `session/prompt/plan-reminder-anthropic.txt`

这是 Anthropic 模型的 Plan Mode 完整工作流程提示：

```
<system-reminder>
# Plan Mode - System Reminder

Plan mode is active. The user indicated that they do not want you to execute 
yet -- you MUST NOT make any edits, run any non-readonly tools, or otherwise 
make any changes to the system. This supersedes any other instructions.

---

## Plan File Info

No plan file exists yet. You should create your plan at 
`/Users/xxx/.claude/plans/happy-waddling-feigenbaum.md` using the Write tool.

You should build your plan incrementally by writing to or editing this file.
NOTE that this is the only file you are allowed to edit.

**Plan File Guidelines:** The plan file should contain only your final 
recommended approach, not all alternatives considered. Keep it comprehensive 
yet concise.

---

## Enhanced Planning Workflow

### Phase 1: Initial Understanding

**Goal:** Gain a comprehensive understanding of the user's request.
Critical: In this phase you should only use the Explore subagent type.

1. Understand the user's request thoroughly

2. **Launch up to 3 Explore agents IN PARALLEL** to efficiently explore 
   the codebase. Each agent can focus on different aspects:
   - Example: One agent searches for existing implementations
   - Another explores related components
   - A third investigates testing patterns
   - Quality over quantity - 3 agents maximum
   - Use 1 agent when: task is isolated to known files
   - Use multiple agents when: scope is uncertain

3. Use AskUserQuestion tool to clarify ambiguities up front.

### Phase 2: Planning

**Goal:** Come up with an approach to solve the problem by launching a 
Plan subagent.

In the agent prompt:
- Provide background context that may help the agent
- Request a detailed plan

### Phase 3: Synthesis

**Goal:** Synthesize the perspectives from Phase 2, and ensure alignment 
with the user's intentions.

1. Collect all agent responses
2. Each agent will return an implementation plan along with critical files
3. Use AskUserQuestion to ask about trade offs

### Phase 4: Final Plan

Ensure the plan file has been updated with:
- Recommended approach with rationale
- Key insights from different perspectives
- Critical files that need modification

### Phase 5: Call ExitPlanMode

At the very end of your turn, once you have asked the user questions and 
are happy with your final plan file - you should always call ExitPlanMode.

This is critical - your turn should only end with either asking the user 
a question or calling ExitPlanMode.
</system-reminder>
```

---

## 附录 E：Summary Agent 提示词

**文件**: `agent/prompt/summary.txt`

用于生成对话摘要的 Agent：

```
Summarize what was done in this conversation. Write like a pull request 
description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, 
  preserve that exact question
- If the conversation ends with an imperative statement or request to 
  the user (e.g. "Now please run the command"), always include that 
  exact request in the summary
```

---

## 附录 F：源码文件索引

| 功能 | 文件路径 |
|------|---------|
| System Prompt 组装 | `packages/opencode/src/session/system.ts` |
| Prompt 主循环 | `packages/opencode/src/session/prompt.ts` |
| 指令文件加载 | `packages/opencode/src/session/instruction.ts` |
| 上下文压缩 | `packages/opencode/src/session/compaction.ts` |
| LLM 调用 | `packages/opencode/src/session/llm.ts` |
| 消息处理 | `packages/opencode/src/session/processor.ts` |
| Claude 提示词 | `packages/opencode/src/session/prompt/anthropic.txt` |
| Claude 老版本提示词 | `packages/opencode/src/session/prompt/anthropic-20250930.txt` |
| Gemini 提示词 | `packages/opencode/src/session/prompt/gemini.txt` |
| GPT/Beast 提示词 | `packages/opencode/src/session/prompt/beast.txt` |
| GPT-5/Codex 提示词 | `packages/opencode/src/session/prompt/codex_header.txt` |
| Qwen 提示词 | `packages/opencode/src/session/prompt/qwen.txt` |
| Plan Mode 提示词 | `packages/opencode/src/session/prompt/plan.txt` |
| Plan Mode Anthropic | `packages/opencode/src/session/prompt/plan-reminder-anthropic.txt` |
| Build Switch 提示词 | `packages/opencode/src/session/prompt/build-switch.txt` |
| Max Steps 提示词 | `packages/opencode/src/session/prompt/max-steps.txt` |
| Explore Agent | `packages/opencode/src/agent/prompt/explore.txt` |
| Title Agent | `packages/opencode/src/agent/prompt/title.txt` |
| Compaction Agent | `packages/opencode/src/agent/prompt/compaction.txt` |
| Summary Agent | `packages/opencode/src/agent/prompt/summary.txt` |
| Edit 工具描述 | `packages/opencode/src/tool/edit.txt` |
| Bash 工具描述 | `packages/opencode/src/tool/bash.txt` |
| Task 工具描述 | `packages/opencode/src/tool/task.txt` |
| Read 工具描述 | `packages/opencode/src/tool/read.txt` |
| Write 工具描述 | `packages/opencode/src/tool/write.txt` |
| Grep 工具描述 | `packages/opencode/src/tool/grep.txt` |
| Glob 工具描述 | `packages/opencode/src/tool/glob.txt` |
| WebFetch 工具描述 | `packages/opencode/src/tool/webfetch.txt` |
| TodoWrite 工具描述 | `packages/opencode/src/tool/todowrite.txt` |
| WebSearch 工具描述 | `packages/opencode/src/tool/websearch.txt` |
| CodeSearch 工具描述 | `packages/opencode/src/tool/codesearch.txt` |
| LSP 工具描述 | `packages/opencode/src/tool/lsp.txt` |
| MultiEdit 工具描述 | `packages/opencode/src/tool/multiedit.txt` |
| ApplyPatch 工具描述 | `packages/opencode/src/tool/apply_patch.txt` |
| PlanEnter 工具描述 | `packages/opencode/src/tool/plan-enter.txt` |
| PlanExit 工具描述 | `packages/opencode/src/tool/plan-exit.txt` |
