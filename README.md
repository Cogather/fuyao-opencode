# Fuyao OpenCode

扶摇 Agent 平台 OpenCode 插件。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                    OpenCode IDE                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │       TypeScript 插件 (OpenCode 插件规范)         │  │
│  │  • Agents (桥接定义)                              │  │
│  │  • Tools (HTTP 调用)                              │  │
│  │  • Hooks (参照 oh-my-opencode)                    │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                         │ HTTP
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Python 服务 (本地运行)                      │
│  • 扶摇 Agent SDK                                       │
│  • 本地命令执行                                         │
│  • 本地工具 (pytest, ruff, eslint...)                   │
│  • 文件读写                                             │
└─────────────────────────────────────────────────────────┘
```

## 快速开始

### 1. 安装插件

```bash
npm install fuyao-opencode
```

### 2. 启动 Python 服务

```bash
fuyao-server start
# 或
npx fuyao-server start
```

### 3. 配置 OpenCode

在项目目录创建 `.opencode/opencode.jsonc`:

```jsonc
{
  "plugin": ["fuyao-opencode"],
  "agent": "fuyao-agent"
}
```

### 4. 启动 OpenCode

```bash
opencode
```

## 环境变量

```bash
# Python 服务地址 (默认 http://localhost:8000)
export FUYAO_PLATFORM_URL="http://localhost:8000"

# 平台 Token (可选)
export FUYAO_PLATFORM_TOKEN="your-token"
```

## 提供的 Agents

| Agent | 说明 |
|-------|------|
| `fuyao-agent` | 主入口，协调任务 |
| `fuyao-coder` | 代码开发专家 |
| `fuyao-architect` | 架构设计专家 |
| `fuyao-reviewer` | 代码审查专家 |

## 提供的 Tools

| Tool | 说明 |
|------|------|
| `run_platform_agent` | 调用扶摇 Agent |
| `call_platform_skill` | 调用扶摇 Skill |
| `run_local_command` | 执行本地命令 |
| `run_local_tool` | 运行本地工具 |
| `read_platform_file` | 读取文件 |
| `write_platform_file` | 写入文件 |
| `search_platform_files` | 搜索文件 |

## CLI 命令

```bash
fuyao-server start              # 启动服务
fuyao-server start --port 9000  # 指定端口
fuyao-server stop               # 停止服务
fuyao-server status             # 查看状态
fuyao-server logs               # 查看日志
fuyao-server restart            # 重启服务
```

## 与 Agent 市场对接方式的区别

OpenCode 支持两种扩展 Agent 的方式：

1. **配置注入方式**（Agent 市场、oh-my-opencode）：向 OpenCode 注入 Agent 配置，运行态由 OpenCode 控制
2. **独立运行态方式**（本插件）：OpenCode 作为入口，实际执行在独立后端服务

| 对比维度 | 配置注入方式 | 独立运行态方式 |
|---------|------------|--------------|
| **代表** | Agent 市场、oh-my-opencode | 本插件 |
| **运行态** | OpenCode 统一运行时 | 自定义 Python 运行时 |
| **Agent 本质** | **配置**（prompt、model） | **独立执行体** |
| **工具执行** | OpenCode 内置工具 | 转发到后端执行 |
| **子 Agent** | OpenCode Task 工具 | 自己的子 Agent 调度 |
| **MCP 对接** | OpenCode MCP 机制 | 自己的 MCP Server |
| **扩展自由度** | 受限于 Hook 能力 | 完全自主 |

> **注意**：oh-my-opencode 虽然功能丰富（提供 Prometheus、Atlas 等 Agent），但它的 Agent 执行
> 仍然在 OpenCode 的 `SessionPrompt.loop` 中，属于配置注入方式。

### 架构对比

```
┌─────────────────────────────────────────────────────────────┐
│  配置注入方式：Agent = 配置，运行态 = OpenCode               │
│  （Agent 市场、oh-my-opencode）                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  插件/配置 ───(config hook)───▶ OpenCode 运行时             │
│      │                          (SessionPrompt.loop)        │
│      │ 提供：prompt, model, permission                      │
│      ▼                                                      │
│  OpenCode 控制整个执行流程                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  独立运行态方式：OpenCode = 入口，运行态 = 后端服务           │
│  （本插件）                                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  OpenCode ◀──(HTTP)──▶ Python 运行时                        │
│   (入口/UI)                │                                │
│      │                     │ 自定义执行循环                  │
│      │ 注册工具：           │ - 自己的 Agent 调度            │
│      │ run_platform_agent  │ - 自己的 MCP 对接              │
│      ▼                     │ - 自己的 Skill 系统            │
│  实际运行在后端平台         └────────────────────────────────│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 选择建议

| 场景 | 推荐方式 |
|-----|---------|
| 快速添加预设 Agent | 配置注入（Agent 市场） |
| 复用 OpenCode 能力和工具 | 配置注入（oh-my-opencode） |
| 自定义 Agent 调度逻辑 | 独立运行态 |
| 对接自己的 MCP/Skill/子Agent | 独立运行态 |
| 使用 Python 运行时 | 独立运行态 |
| 保护 Agent 实现细节 | 独立运行态 |

**简单说**：
- **配置注入方式**（含 oh-my-opencode）是"把配置喂给 OpenCode，由 OpenCode 执行"
- **独立运行态方式**是"把 OpenCode 当入口，实际跑自己的逻辑"

## 文档

- [完整架构文档](./FINAL-ARCHITECTURE.md)
- [分发指南](./DISTRIBUTION.md)
- [Python 服务文档](./python-server/README.md)
- [OpenCode 与 OhMyOpenCode 解读](./docs/OpenCode与OhMyOpenCode解读.md)
- [OpenCode 外部数据源隔离指南](./docs/OpenCode外部数据源依赖与隔离指南.md)
