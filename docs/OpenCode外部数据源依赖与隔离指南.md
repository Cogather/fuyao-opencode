# OpenCode 外部数据源依赖与隔离指南

如果需要修改 OpenCode 源码，确保数据不传到 OpenCode 官方外部数据源，需要关注以下内容。

---

## 目录

1. [外部数据源一览](#1-外部数据源一览)
2. [内置插件依赖](#2-内置插件依赖)
3. [禁用外部数据源的方法](#3-禁用外部数据源的方法)
4. [关键源码文件详解](#4-关键源码文件详解)
5. [完全隔离配置示例](#5-完全隔离配置示例)
6. [需要源码修改的彻底隔离](#6-需要源码修改的彻底隔离)
7. [数据流向示意图](#7-数据流向示意图)

---

## 1. 外部数据源一览

| 数据源 | 用途 | 访问 URL | 源码文件 |
|--------|------|----------|---------|
| **models.dev** | 获取 LLM 模型信息 | `https://models.dev/api.json` | `provider/models.ts` |
| **opencode.ai API** | 分享功能 | `https://api.opencode.ai` | `share/share.ts` |
| **Exa MCP API** | 代码搜索工具 | `https://mcp.exa.ai/mcp` | `tool/codesearch.ts` |
| **Exa MCP API** | 网络搜索工具 | `https://mcp.exa.ai/mcp` | `tool/websearch.ts` |
| **OpenAI OAuth** | Codex 认证 | `https://auth.openai.com` | `plugin/codex.ts` |
| **ChatGPT API** | Codex 推理 | `https://chatgpt.com/backend-api` | `plugin/codex.ts` |
| **GitHub OAuth** | Copilot 认证 | `https://github.com/login/device/code` | `plugin/copilot.ts` |
| **GitHub Copilot API** | Copilot 推理 | `https://copilot-api.github.com` | `plugin/copilot.ts` |
| **npm Registry** | 安装插件 | `https://registry.npmjs.org` | `plugin/index.ts`, `bun/index.ts` |
| **GitHub Releases** | 版本检查 | `https://api.github.com/repos/anomalyco/opencode` | `installation/index.ts` |
| **Brew Formula** | 版本检查 | `https://formulae.brew.sh/api/formula` | `installation/index.ts` |
| **Chocolatey** | 版本检查 | `https://community.chocolatey.org/api/v2` | `installation/index.ts` |
| **Scoop** | 版本检查 | `https://raw.githubusercontent.com/ScoopInstaller` | `installation/index.ts` |

---

## 2. 内置插件依赖

OpenCode 默认会从 npm 安装以下内置插件：

```typescript
// packages/opencode/src/plugin/index.ts 第 18 行
const BUILTIN = ["opencode-anthropic-auth@0.0.13", "@gitlab/opencode-gitlab-auth@1.3.2"]

// 内部集成的插件（不从 npm 安装）
const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin]
```

| 内置插件 | 用途 | 外部依赖 |
|---------|------|---------|
| `opencode-anthropic-auth` | Anthropic OAuth 认证 | Anthropic 认证服务 |
| `@gitlab/opencode-gitlab-auth` | GitLab OAuth 认证 | GitLab 认证服务 |
| `CodexAuthPlugin` | OpenAI Codex 认证 | OpenAI OAuth、ChatGPT API |
| `CopilotAuthPlugin` | GitHub Copilot 认证 | GitHub OAuth、Copilot API |

---

## 3. 禁用外部数据源的方法

### 3.1 方法一：环境变量（推荐）

```bash
# 禁用分享功能（不发送数据到 opencode.ai）
export OPENCODE_DISABLE_SHARE=true

# 禁用从 models.dev 获取模型信息
export OPENCODE_DISABLE_MODELS_FETCH=true

# 使用自定义模型数据源
export OPENCODE_MODELS_URL="https://your-internal-server.com/models"

# 使用本地模型信息文件
export OPENCODE_MODELS_PATH="/path/to/local/models.json"

# 禁用内置插件（不自动安装 npm 插件）
export OPENCODE_DISABLE_DEFAULT_PLUGINS=true

# 自定义 API 地址（替换 opencode.ai API）
export OPENCODE_API="https://your-internal-api.com"
```

### 3.2 方法二：修改源码

**1. 禁用分享功能**

```typescript
// packages/opencode/src/share/share.ts
// 修改第 73 行，强制禁用
const disabled = true  // 原来是 process.env["OPENCODE_DISABLE_SHARE"] === "true"
```

**2. 禁用 models.dev 获取**

```typescript
// packages/opencode/src/provider/models.ts
// 删除或注释第 125-132 行
// if (!Flag.OPENCODE_DISABLE_MODELS_FETCH) {
//   ModelsDev.refresh()
//   setInterval(async () => {
//     await ModelsDev.refresh()
//   }, 60 * 1000 * 60).unref()
// }
```

**3. 移除内置插件**

```typescript
// packages/opencode/src/plugin/index.ts
// 修改第 18-21 行
const BUILTIN: string[] = []  // 清空内置 npm 插件
const INTERNAL_PLUGINS: PluginInstance[] = []  // 清空内部插件
```

**4. 移除代码搜索工具（Exa API）**

```typescript
// packages/opencode/src/tool/registry.ts
// 从 BUILTIN_TOOLS 数组中移除 CodeSearchTool
export const BUILTIN_TOOLS = [
  // ... 其他工具
  // CodeSearchTool,  // 注释或删除此行
]
```

**5. 移除网络搜索工具（Exa API）**

```typescript
// packages/opencode/src/tool/registry.ts
// 从 BUILTIN_TOOLS 数组中移除 WebSearchTool
export const BUILTIN_TOOLS = [
  // ... 其他工具
  // WebSearchTool,  // 注释或删除此行
]
```

**6. 禁用版本检查**

```typescript
// packages/opencode/src/installation/index.ts
// 修改 latest() 函数，返回当前版本
export async function latest(installMethod?: Method) {
  return VERSION  // 直接返回当前版本，不请求外部
}
```

---

## 4. 关键源码文件详解

### 4.1 分享功能 - `share/share.ts`

```typescript
// packages/opencode/src/share/share.ts

// 外部 API URL（第 69-71 行）
export const URL =
  process.env["OPENCODE_API"] ??
  (Installation.isPreview() || Installation.isLocal() 
    ? "https://api.dev.opencode.ai" 
    : "https://api.opencode.ai")

// 禁用开关（第 73 行）
const disabled = process.env["OPENCODE_DISABLE_SHARE"] === "true"

// 数据同步函数（第 13-47 行）
export async function sync(key: string, content: any) {
  if (disabled) return  // 禁用后不发送
  // ... 发送数据到 opencode.ai
  return fetch(`${URL}/share_sync`, {
    method: "POST",
    body: JSON.stringify({
      sessionID: sessionID,
      secret,
      key: key,
      content,  // ⚠️ 会话内容会被上传
    }),
  })
}

// 创建分享链接（第 75-83 行）
export async function create(sessionID: string) {
  if (disabled) return { url: "", secret: "" }
  return fetch(`${URL}/share_create`, { ... })
}
```

**数据泄露风险**：会话内容（`content`）会通过 `share_sync` 接口上传到 opencode.ai。

**隔离方法**：
- 环境变量：`OPENCODE_DISABLE_SHARE=true`
- 或自定义 API：`OPENCODE_API=https://your-server.com`

### 4.2 模型信息 - `provider/models.ts`

```typescript
// packages/opencode/src/provider/models.ts

// 外部 URL（第 83-85 行）
function url() {
  return Flag.OPENCODE_MODELS_URL || "https://models.dev"
}

// 数据获取（第 87-99 行）
export const Data = lazy(async () => {
  // 1. 先尝试读取本地缓存文件
  const file = Bun.file(Flag.OPENCODE_MODELS_PATH ?? filepath)
  const result = await file.json().catch(() => {})
  if (result) return result
  
  // 2. 再尝试读取内置快照
  const snapshot = await import("./models-snapshot").catch(() => undefined)
  if (snapshot) return snapshot
  
  // 3. 如果禁用获取，返回空
  if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {}
  
  // 4. 最后从 models.dev 获取
  const json = await fetch(`${url()}/api.json`).then((x) => x.text())
  return JSON.parse(json)
})

// 定时刷新（第 125-132 行）
if (!Flag.OPENCODE_DISABLE_MODELS_FETCH) {
  ModelsDev.refresh()  // 启动时刷新
  setInterval(async () => {
    await ModelsDev.refresh()  // 每小时刷新
  }, 60 * 1000 * 60).unref()
}
```

**隔离方法**：
- 使用本地文件：`OPENCODE_MODELS_PATH=/path/to/models.json`
- 使用内部服务：`OPENCODE_MODELS_URL=https://internal-server.com`
- 禁用获取：`OPENCODE_DISABLE_MODELS_FETCH=true`

### 4.3 代码搜索 - `tool/codesearch.ts`

```typescript
// packages/opencode/src/tool/codesearch.ts

// 外部 API（第 5-9 行）
const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",  // ⚠️ Exa 搜索服务
  ENDPOINTS: {
    CONTEXT: "/mcp",
  },
} as const

// 发送搜索请求（第 85-89 行）
const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.CONTEXT}`, {
  method: "POST",
  headers,
  body: JSON.stringify(codeRequest),  // ⚠️ 搜索查询被发送到 Exa
})
```

**数据泄露风险**：搜索查询（`query`）会被发送到 Exa API。

**隔离方法**：
- 从工具注册表移除此工具
- 或修改 `API_CONFIG.BASE_URL` 为内部服务

### 4.4 网络搜索 - `tool/websearch.ts`

```typescript
// packages/opencode/src/tool/websearch.ts

// 外部 API（第 5-10 行）
const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",  // ⚠️ Exa 搜索服务
  ENDPOINTS: {
    SEARCH: "/mcp",
  },
  DEFAULT_NUM_RESULTS: 8,
} as const

// 发送搜索请求（第 103-108 行）
const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`, {
  method: "POST",
  headers,
  body: JSON.stringify(searchRequest),  // ⚠️ 搜索查询被发送到 Exa
})
```

**数据泄露风险**：搜索查询（`query`）会被发送到 Exa API。

**隔离方法**：
- 从工具注册表移除此工具
- 或修改 `API_CONFIG.BASE_URL` 为内部服务

### 4.5 内置插件 - `plugin/index.ts`

```typescript
// packages/opencode/src/plugin/index.ts

// 内置 npm 插件（第 18 行）
const BUILTIN = ["opencode-anthropic-auth@0.0.13", "@gitlab/opencode-gitlab-auth@1.3.2"]

// 内部插件（第 21 行）
const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin]

// 禁用开关（第 47-48 行）
if (!Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS) {
  plugins.push(...BUILTIN)  // 只有不禁用时才加载内置插件
}
```

**隔离方法**：`OPENCODE_DISABLE_DEFAULT_PLUGINS=true`

### 4.6 Codex 认证 - `plugin/codex.ts`

```typescript
// packages/opencode/src/plugin/codex.ts

// 外部服务（第 10-12 行）
const ISSUER = "https://auth.openai.com"  // OpenAI OAuth 服务
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"  // ChatGPT API

// OAuth 授权（第 100 行）
return `${ISSUER}/oauth/authorize?${params.toString()}`

// API 请求重写（第 447-454 行）
const url =
  parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
    ? new URL(CODEX_API_ENDPOINT)  // ⚠️ 重写到 ChatGPT
    : parsed
```

**隔离方法**：
- 不使用 Codex 认证
- 或设置 `OPENCODE_DISABLE_DEFAULT_PLUGINS=true`

### 4.7 Copilot 认证 - `plugin/copilot.ts`

```typescript
// packages/opencode/src/plugin/copilot.ts

// GitHub OAuth（第 5 行）
const CLIENT_ID = "Ov23li8tweQw6odWQebz"

// 获取 URL（第 13-18 行）
function getUrls(domain: string) {
  return {
    DEVICE_CODE_URL: `https://${domain}/login/device/code`,
    ACCESS_TOKEN_URL: `https://${domain}/login/oauth/access_token`,
  }
}

// Copilot API（第 30 行）
const baseURL = enterpriseUrl 
  ? `https://copilot-api.${normalizeDomain(enterpriseUrl)}` 
  : undefined  // 默认使用 copilot-api.github.com
```

**隔离方法**：
- 不使用 Copilot 认证
- 或设置 `OPENCODE_DISABLE_DEFAULT_PLUGINS=true`

### 4.8 版本检查 - `installation/index.ts`

```typescript
// packages/opencode/src/installation/index.ts

// 检查最新版本（第 186-245 行）
export async function latest(installMethod?: Method) {
  // Brew
  return fetch("https://formulae.brew.sh/api/formula/opencode.json")
  
  // npm
  return fetch(`${registry}/opencode-ai/${channel}`)
  
  // Chocolatey
  return fetch("https://community.chocolatey.org/api/v2/Packages...")
  
  // Scoop
  return fetch("https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/opencode.json")
  
  // GitHub Releases（默认）
  return fetch("https://api.github.com/repos/anomalyco/opencode/releases/latest")
}
```

**隔离方法**：修改 `latest()` 函数直接返回当前版本

---

## 5. 完全隔离配置示例

如果需要完全隔离，不向任何 OpenCode 官方服务发送数据：

```bash
# ~/.bashrc 或 ~/.zshrc

# 1. 禁用分享功能
export OPENCODE_DISABLE_SHARE=true

# 2. 禁用 models.dev 获取
export OPENCODE_DISABLE_MODELS_FETCH=true

# 3. 使用本地模型信息（需要预先准备）
export OPENCODE_MODELS_PATH="$HOME/.opencode/models.json"

# 4. 禁用内置插件
export OPENCODE_DISABLE_DEFAULT_PLUGINS=true
```

**本地模型信息文件示例**（`~/.opencode/models.json`）：

```json
{
  "anthropic": {
    "id": "anthropic",
    "name": "Anthropic",
    "env": ["ANTHROPIC_API_KEY"],
    "models": {
      "claude-3-5-sonnet-20241022": {
        "id": "claude-3-5-sonnet-20241022",
        "name": "Claude 3.5 Sonnet",
        "tool_call": true,
        "attachment": true,
        "reasoning": false,
        "temperature": true,
        "release_date": "2024-10-22",
        "limit": { "context": 200000, "output": 8192 },
        "cost": {
          "input": 3,
          "output": 15,
          "cache_read": 0.3,
          "cache_write": 3.75
        }
      }
    }
  },
  "openai": {
    "id": "openai",
    "name": "OpenAI",
    "env": ["OPENAI_API_KEY"],
    "models": {
      "gpt-4o": {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "tool_call": true,
        "attachment": true,
        "reasoning": false,
        "temperature": true,
        "release_date": "2024-05-13",
        "limit": { "context": 128000, "output": 16384 },
        "cost": {
          "input": 2.5,
          "output": 10,
          "cache_read": 1.25
        }
      }
    }
  }
}
```

---

## 6. 需要源码修改的彻底隔离

如果需要彻底移除所有外部依赖（包括工具），需要修改以下文件：

| 文件 | 修改内容 | 影响 |
|------|---------|------|
| `packages/opencode/src/tool/registry.ts` | 移除 `CodeSearchTool`、`WebSearchTool` | 禁用代码/网络搜索 |
| `packages/opencode/src/plugin/index.ts` | 清空 `BUILTIN` 和 `INTERNAL_PLUGINS` | 禁用所有内置插件 |
| `packages/opencode/src/share/share.ts` | 强制 `disabled = true` | 禁用分享功能 |
| `packages/opencode/src/provider/models.ts` | 移除定时刷新逻辑 | 禁用模型信息更新 |
| `packages/opencode/src/installation/index.ts` | 移除版本检查的外部请求 | 禁用自动更新检查 |

### 6.1 修改示例：registry.ts

```typescript
// packages/opencode/src/tool/registry.ts

// 原始代码
import { CodeSearchTool } from "./codesearch"
import { WebSearchTool } from "./websearch"

export const BUILTIN_TOOLS = [
  ReadTool,
  EditTool,
  // ... 其他工具
  CodeSearchTool,  // ← 删除
  WebSearchTool,   // ← 删除
]

// 修改后
export const BUILTIN_TOOLS = [
  ReadTool,
  EditTool,
  // ... 其他工具
  // CodeSearchTool,  // 已移除
  // WebSearchTool,   // 已移除
]
```

### 6.2 修改示例：plugin/index.ts

```typescript
// packages/opencode/src/plugin/index.ts

// 原始代码
const BUILTIN = ["opencode-anthropic-auth@0.0.13", "@gitlab/opencode-gitlab-auth@1.3.2"]
const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin]

// 修改后
const BUILTIN: string[] = []  // 清空
const INTERNAL_PLUGINS: PluginInstance[] = []  // 清空
```

---

## 7. 数据流向示意图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          OpenCode 数据流向                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐                                                    │
│  │  用户输入/代码   │                                                    │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐    share_sync     ┌─────────────────────────┐     │
│  │ Session 数据     │─────────────────▶│ api.opencode.ai         │ ⚠️  │
│  │ (分享功能)       │                   │ 会话内容可能被上传       │     │
│  └─────────────────┘                   └─────────────────────────┘     │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐    search query   ┌─────────────────────────┐     │
│  │ codesearch/     │─────────────────▶│ mcp.exa.ai              │ ⚠️  │
│  │ websearch 工具   │                   │ 搜索查询被发送           │     │
│  └─────────────────┘                   └─────────────────────────┘     │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐    fetch models   ┌─────────────────────────┐     │
│  │ 模型信息获取     │─────────────────▶│ models.dev              │     │
│  └─────────────────┘                   │ 只读公开数据             │     │
│           │                            └─────────────────────────┘     │
│           ▼                                                             │
│  ┌─────────────────┐    OAuth flow     ┌─────────────────────────┐     │
│  │ Codex/Copilot   │─────────────────▶│ auth.openai.com         │     │
│  │ 认证插件        │                   │ github.com              │     │
│  └─────────────────┘                   └─────────────────────────┘     │
│           │                                                             │
│           ▼                                                             │
│  ┌─────────────────┐    LLM 请求       ┌─────────────────────────┐     │
│  │ AI 推理请求     │─────────────────▶│ LLM Provider API        │ ✅  │
│  │ (用户配置)      │                   │ (用户选择的服务)         │     │
│  └─────────────────┘                   └─────────────────────────┘     │
│                                                                         │
│  ⚠️ = 可能包含敏感数据，需要隔离                                         │
│  ✅ = 用户主动配置的服务，符合预期                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8. 环境变量汇总

| 环境变量 | 作用 | 默认值 |
|---------|------|-------|
| `OPENCODE_DISABLE_SHARE` | 禁用分享功能 | `false` |
| `OPENCODE_DISABLE_MODELS_FETCH` | 禁用从 models.dev 获取模型信息 | `false` |
| `OPENCODE_MODELS_URL` | 自定义模型信息 URL | `https://models.dev` |
| `OPENCODE_MODELS_PATH` | 本地模型信息文件路径 | `~/.cache/opencode/models.json` |
| `OPENCODE_DISABLE_DEFAULT_PLUGINS` | 禁用内置插件 | `false` |
| `OPENCODE_API` | 自定义 API 地址 | `https://api.opencode.ai` |

---

## 9. 源码文件索引

| 功能 | 源码文件 | 关键行号 |
|------|---------|---------|
| **分享功能** | `packages/opencode/src/share/share.ts` | 13-92 |
| **模型信息获取** | `packages/opencode/src/provider/models.ts` | 83-132 |
| **代码搜索工具** | `packages/opencode/src/tool/codesearch.ts` | 5-132 |
| **网络搜索工具** | `packages/opencode/src/tool/websearch.ts` | 5-150 |
| **插件加载** | `packages/opencode/src/plugin/index.ts` | 18-90 |
| **Codex 认证** | `packages/opencode/src/plugin/codex.ts` | 10-590 |
| **Copilot 认证** | `packages/opencode/src/plugin/copilot.ts` | 5-325 |
| **版本检查** | `packages/opencode/src/installation/index.ts` | 186-245 |
| **工具注册** | `packages/opencode/src/tool/registry.ts` | 全文件 |
