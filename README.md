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

## 文档

- [完整架构文档](./FINAL-ARCHITECTURE.md)
- [分发指南](./DISTRIBUTION.md)
- [Python 服务文档](./python-server/README.md)
