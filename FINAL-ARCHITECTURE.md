# 我的 Agent 平台插件 - 最终架构与集成指南

## 一、最终形态总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OpenCode IDE                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    用户配置 .opencode/opencode.jsonc                │   │
│  │  {                                                                   │   │
│  │    "plugin": ["my-agent-platform-plugin"],  // 加载你的插件        │   │
│  │    "agent": "my-platform-agent"             // 使用你的 agent       │   │
│  │  }                                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │              my-agent-platform-plugin (TypeScript)                  │   │
│  │                                                                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │   │
│  │  │   Agents    │  │    Tools    │  │    Hooks    │  │    MCP     │ │   │
│  │  │ (桥接定义)   │  │ (HTTP调用)  │  │(参照oh-my)  │  │  (配置)    │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
└──────────────────────────────│──────────────────────────────────────────────┘
                               │ HTTP (localhost:8000)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Python 服务 (本地运行，你的 SDK)                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       FastAPI Server                                │   │
│  │  • /agents/run       - 调用你的 Agent SDK                          │   │
│  │  • /skills/execute   - 调用你的 Skill                              │   │
│  │  • /local/command    - 执行本地命令                                 │   │
│  │  • /local/tool       - 运行本地工具 (pytest, ruff, eslint...)      │   │
│  │  • /local/file/*     - 文件读写搜索                                 │   │
│  │  • /subagents/*      - SubAgent 编排                               │   │
│  │  • /knowledge/*      - 知识库查询                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      你的 Python SDK                                 │  │
│  │                                                                      │  │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │  │
│  │   │  Agents  │  │  Skills  │  │   MCP    │  │ SubAgent │           │  │
│  │   │ (你的AI) │  │ (你的能力)│  │ (你的MCP)│  │ (你的编排)│           │  │
│  │   └──────────┘  └──────────┘  └──────────┘  └──────────┘           │  │
│  │                                                                      │  │
│  │   ┌──────────────────────────────────────────────────────────────┐  │  │
│  │   │                   本地能力                                    │  │  │
│  │   │   文件系统 │ 命令执行 │ 工具运行 │ 环境访问                  │  │  │
│  │   └──────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、与 oh-my-opencode 架构对比

| 模块 | oh-my-opencode | my-agent-platform-plugin |
|------|----------------|--------------------------|
| **语言** | TypeScript (纯) | TypeScript + Python |
| **Agent 定义** | TypeScript 直接定义 prompt | TypeScript 定义桥接 prompt → 调用 Python SDK |
| **Tool 执行** | TypeScript 直接实现 | TypeScript HTTP 调用 → Python 执行 |
| **本地能力** | 通过 OpenCode 内置工具 | Python 服务直接执行 |
| **Hooks** | 完整实现 | 参考/复用 oh-my-opencode |
| **MCP** | 配置外部 MCP | 配置你的 Python MCP 服务 |

### 架构参照点

```
oh-my-opencode/                        my-agent-platform-plugin/
├── src/                               ├── src/                     (TypeScript 桥接层)
│   ├── index.ts           ← 参照 →   │   ├── index.ts             ✓ 已实现
│   ├── agents/            ← 参照 →   │   ├── agents/              ✓ 已实现 (桥接定义)
│   ├── tools/             ← 参照 →   │   ├── tools/               ✓ 已实现 (HTTP 调用)
│   ├── hooks/             ← 复用 →   │   ├── hooks/               ✓ 已实现 (简化版)
│   │   ├── rules-injector            │   │   ├── rules-injector   ✓ 复用
│   │   └── keyword-detector          │   │   └── keyword-detector ✓ 复用
│   ├── features/          ← 复用 →   │   ├── features/            ✓ 已实现 (简化版)
│   │   └── context-injector          │   │   └── context-collector✓ 复用
│   └── shared/            ← 复用 →   │   └── shared/              ✓ 已实现
│       ├── logger                    │       ├── logger           ✓ 复用
│       └── deep-merge                │       └── deep-merge       ✓ 复用
│                                     │
│                                     ├── python-server/           (Python 运行态)
│                                     │   ├── server.py            ✓ 已实现
│                                     │   ├── mcp_server.py        ✓ 可选
│                                     │   └── requirements.txt     ✓ 已实现
```

---

## 三、完整目录结构

```
my-agent-platform-plugin/
├── package.json                    # npm 包定义
├── README.md                       # 使用文档
├── FINAL-ARCHITECTURE.md           # 本文档
│
├── src/                            # TypeScript 源码 (OpenCode 插件层)
│   ├── index.ts                    # 插件入口，返回 Hooks
│   │
│   ├── agents/                     # Agent 定义 (桥接到 Python)
│   │   └── index.ts                # createBridgeAgents()
│   │
│   ├── tools/                      # Tool 定义 (HTTP 调用 Python)
│   │   └── index.ts                # createBridgeTools()
│   │
│   ├── mcp/                        # MCP 配置
│   │   └── index.ts                # getMcpConfig()
│   │
│   ├── hooks/                      # Hooks (参照 oh-my-opencode)
│   │   ├── rules-injector/         # 规则注入
│   │   │   └── index.ts
│   │   └── keyword-detector/       # 关键词检测
│   │       └── index.ts
│   │
│   ├── features/                   # Features (参照 oh-my-opencode)
│   │   └── context-collector/      # 上下文收集
│   │       └── index.ts
│   │
│   └── shared/                     # 共享工具 (参照 oh-my-opencode)
│       ├── logger.ts               # 日志
│       └── deep-merge.ts           # 深度合并
│
└── python-server/                  # Python 服务 (你的 SDK 运行态)
    ├── server.py                   # FastAPI 主服务
    ├── mcp_server.py               # MCP 服务 (可选)
    ├── requirements.txt            # Python 依赖
    └── README.md                   # Python 服务文档
```

---

## 四、集成到 OpenCode 的步骤

### 步骤 1: 构建 TypeScript 插件

```bash
cd my-agent-platform-plugin

# 安装依赖
bun install
# 或 npm install

# 构建
bun run build
# 输出到 dist/
```

### 步骤 2: 启动 Python 服务

```bash
cd python-server

# 安装依赖
pip install -r requirements.txt

# 启动服务 (保持运行)
python server.py
# 或
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

### 步骤 3: 配置 OpenCode

在你的项目根目录创建/编辑 `.opencode/opencode.jsonc`:

```jsonc
{
  // 方式1: 从本地路径加载插件
  "plugin": [
    "/path/to/my-agent-platform-plugin"
  ],
  
  // 方式2: 如果发布到 npm
  // "plugin": ["my-agent-platform-plugin"],
  
  // 设置默认使用你的 agent
  "agent": "my-platform-agent",
  
  // 可选：配置 MCP
  "mcp": {
    "my-platform-mcp": {
      "type": "sse",
      "url": "http://localhost:8000/mcp/sse"
    }
  }
}
```

### 步骤 4: 设置环境变量

```bash
# Linux/Mac
export MY_PLATFORM_URL="http://localhost:8000"
export MY_PLATFORM_TOKEN="your-token-if-needed"

# Windows PowerShell
$env:MY_PLATFORM_URL = "http://localhost:8000"
$env:MY_PLATFORM_TOKEN = "your-token-if-needed"
```

### 步骤 5: 启动 OpenCode

```bash
opencode
```

---

## 五、工作流程

### 用户发送消息

```
用户: "帮我重构 src/utils.ts 并运行测试"
```

### 执行流程

```
1. OpenCode 收到消息
       │
       ▼
2. chat.message Hook 触发
   ├── 关键词检测 (keyword-detector)
   └── 上下文收集 (context-collector)
       │
       ▼
3. LLM 生成响应，决定调用 tool
       │
       ▼
4. tool.execute.before Hook 触发
   └── 规则注入 (rules-injector)
       │
       ▼
5. Tool 执行 (例如 run_platform_agent)
   │
   │  TypeScript 插件
   │  ┌─────────────────────────────────┐
   │  │ async execute(args, context) {  │
   │  │   return callPlatformAPI(       │
   │  │     "/agents/run",              │
   │  │     { ...args,                  │
   │  │       directory: context.dir }) │  ──┐
   │  │ }                               │    │
   │  └─────────────────────────────────┘    │
   │                                          │ HTTP
   │                                          ▼
   │  Python 服务
   │  ┌─────────────────────────────────────────────────┐
   │  │ @app.post("/agents/run")                        │
   │  │ async def run_agent(request):                   │
   │  │     # 调用你的 SDK                              │
   │  │     result = await sdk.run_agent(               │
   │  │         request.agent_id,                       │
   │  │         request.task,                           │
   │  │         directory=request.directory  # 本地目录 │
   │  │     )                                           │
   │  │     # 你的 SDK 可以:                            │
   │  │     # - 读写本地文件                            │
   │  │     # - 执行本地命令                            │
   │  │     # - 运行 pytest/ruff 等                     │
   │  │     return result                               │
   │  └─────────────────────────────────────────────────┘
   │       │
   │       ▼
6. tool.execute.after Hook 触发
       │
       ▼
7. 结果返回给 LLM，继续对话
```

---

## 六、数据流详解

### TypeScript → Python 传递的上下文

```typescript
// TypeScript 插件调用 Python API 时传递:
{
  "agent_id": "coder",
  "task": "重构代码",
  "context": { /* 用户自定义 */ },
  
  // 关键：本地上下文
  "directory": "d:/projects/myapp",     // 当前项目目录
  "worktree": "d:/projects/myapp"       // Git worktree
}
```

### Python 使用本地上下文

```python
async def run_agent(self, agent_id, task, directory=None, ...):
    # 读取项目文件
    content = self.fs.read_file("src/utils.ts", directory)
    
    # 执行本地工具
    lint_result = await self.local_tools.run_tool("eslint", "src/", directory)
    
    # 调用你的 SDK (可以传递 directory)
    result = await self.your_sdk.agents.run(
        agent_id=agent_id,
        task=task,
        working_dir=directory,  # 你的 SDK 也能访问本地
    )
    
    return result
```

---

## 七、可用能力汇总

### TypeScript 插件提供的 Tools

| Tool | 说明 | Python API |
|------|------|------------|
| `run_platform_agent` | 调用你的 Agent | `/agents/run` |
| `call_platform_skill` | 调用你的 Skill | `/skills/execute` |
| `run_local_command` | 执行本地命令 | `/local/command` |
| `run_local_tool` | 运行本地工具 | `/local/tool` |
| `read_platform_file` | 读取本地文件 | `/local/file/read` |
| `write_platform_file` | 写入本地文件 | `/local/file/write` |
| `search_platform_files` | 搜索文件内容 | `/local/file/search` |
| `query_platform_knowledge` | 查询知识库 | `/knowledge/search` |
| `delegate_to_platform_subagent` | SubAgent 编排 | `/subagents/orchestrate` |

### TypeScript 插件提供的 Agents

| Agent | 说明 |
|-------|------|
| `my-platform-agent` | 主入口 Agent，协调任务 |
| `my-platform-coder` | 代码开发 Agent |
| `my-platform-architect` | 架构设计 Agent |
| `my-platform-reviewer` | 代码审查 Agent |

### Hooks (参照 oh-my-opencode)

| Hook | 说明 |
|------|------|
| `config` | 注入 agents、MCP 配置 |
| `event` | 处理会话创建等事件 |
| `chat.message` | 关键词检测、上下文收集 |
| `tool.execute.before` | 规则注入、拦截 |
| `tool.execute.after` | 后处理、记录 |

---

## 八、与你的 Python SDK 集成

编辑 `python-server/server.py` 中的 `MyAgentSDK` 类:

```python
class MyAgentSDK:
    def __init__(self):
        # ====== 初始化你的 SDK ======
        from your_sdk import YourAgentClient, YourSkillRunner
        
        self.agent_client = YourAgentClient(
            api_key=os.environ.get("YOUR_SDK_KEY"),
        )
        self.skill_runner = YourSkillRunner()
        
        # 保留本地工具能力
        self.local_tools = LocalTools()
        self.fs = FileSystem()
    
    async def run_agent(self, agent_id, task, directory=None, ...):
        # ====== 调用你的 SDK ======
        result = await self.agent_client.run(
            agent_id=agent_id,
            task=task,
            context={
                "working_directory": directory,
                # 你的 SDK 可以使用这个目录
            },
        )
        
        # 可选：结合本地工具
        if directory:
            lint = await self.local_tools.run_tool("ruff", ".", directory)
            result["lint_status"] = lint["exit_code"]
        
        return result
    
    async def call_skill(self, skill, input_data, directory=None, ...):
        # ====== 调用你的 Skill ======
        return await self.skill_runner.execute(
            skill_name=skill,
            input=input_data,
            cwd=directory,
        )
```

---

## 九、发布与分发

### 方式 1: 本地使用

```jsonc
// .opencode/opencode.jsonc
{
  "plugin": ["/absolute/path/to/my-agent-platform-plugin"]
}
```

### 方式 2: 发布到 npm

```bash
cd my-agent-platform-plugin
npm publish
```

```jsonc
// .opencode/opencode.jsonc
{
  "plugin": ["my-agent-platform-plugin"]
}
```

### 方式 3: 打包为完整工具

提供一个启动脚本同时启动 Python 服务和配置环境:

```bash
#!/bin/bash
# start-my-platform.sh

# 启动 Python 服务
cd python-server
python server.py &
PYTHON_PID=$!

# 设置环境变量
export MY_PLATFORM_URL="http://localhost:8000"

# 等待服务就绪
sleep 2

echo "Platform ready. Python PID: $PYTHON_PID"
echo "Now run 'opencode' in your project directory"
```

---

## 十、总结

你的最终形态是一个**双层架构插件**:

1. **TypeScript 层** (OpenCode 插件规范)
   - 定义 Agents (prompt 引导 LLM 调用你的 tools)
   - 定义 Tools (HTTP 调用 Python 服务)
   - 实现 Hooks (参照 oh-my-opencode)
   - 配置 MCP

2. **Python 层** (你的 SDK 运行态)
   - FastAPI 服务接收请求
   - 调用你的 Agent SDK
   - 执行本地命令和工具
   - 访问本地文件系统

这种架构让你:
- ✅ 完全复用你现有的 Python SDK
- ✅ 获得完整的本地执行能力
- ✅ 参照 oh-my-opencode 的成熟模式
- ✅ 与 OpenCode 无缝集成
