# 扶摇 Python 服务

为 fuyao-opencode 插件提供 HTTP API 接口，支持**本地执行**能力。

## 本地能力

| 能力 | API | 说明 |
|------|-----|------|
| **执行命令** | `/local/command` | 运行任意 shell 命令 |
| **运行工具** | `/local/tool` | pytest, eslint, ruff 等预定义工具 |
| **读取文件** | `/local/file/read` | 读取本地文件 |
| **写入文件** | `/local/file/write` | 写入本地文件 |
| **搜索文件** | `/local/file/search` | 搜索文件内容 |
| **Agent 执行** | `/agents/run` | 调用你的 SDK，可访问本地资源 |

## 安装

```bash
cd python-server
pip install -r requirements.txt
```

## 启动

```bash
python server.py
# 或带热重载
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

服务启动后：
- API 文档: http://localhost:8000/docs
- 健康检查: http://localhost:8000/health

## API 接口

### Agent 执行

```bash
curl -X POST http://localhost:8000/agents/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "coder",
    "task": "实现一个排序算法",
    "directory": "/path/to/project",
    "wait": true
  }'
```

### 本地命令

```bash
curl -X POST http://localhost:8000/local/command \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ls",
    "args": ["-la"],
    "directory": "/path/to/project"
  }'
```

### 本地工具

```bash
# 列出可用工具
curl http://localhost:8000/local/tools

# 运行 pytest
curl -X POST http://localhost:8000/local/tool \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "pytest",
    "target": "tests/",
    "directory": "/path/to/project"
  }'

# 运行 ruff
curl -X POST http://localhost:8000/local/tool \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "ruff",
    "target": "src/",
    "directory": "/path/to/project"
  }'
```

### 可用工具

| 工具名 | 命令 | 说明 |
|--------|------|------|
| `pytest` | `pytest -v` | Python 测试 |
| `pylint` | `pylint` | Python lint |
| `black` | `black` | Python 格式化 |
| `mypy` | `mypy` | Python 类型检查 |
| `ruff` | `ruff check` | Python 快速 lint |
| `ruff-fix` | `ruff check --fix` | Python 自动修复 |
| `npm-test` | `npm test` | Node 测试 |
| `npm-build` | `npm run build` | Node 构建 |
| `eslint` | `eslint` | JS/TS lint |
| `prettier` | `prettier --write` | JS/TS 格式化 |
| `tsc` | `tsc --noEmit` | TypeScript 检查 |
| `bun-test` | `bun test` | Bun 测试 |
| `git-status` | `git status` | Git 状态 |
| `git-diff` | `git diff` | Git diff |
| `git-log` | `git log --oneline -10` | Git 日志 |

### 文件操作

```bash
# 读取文件
curl -X POST http://localhost:8000/local/file/read \
  -H "Content-Type: application/json" \
  -d '{"path": "src/main.py", "directory": "/project"}'

# 写入文件
curl -X POST http://localhost:8000/local/file/write \
  -H "Content-Type: application/json" \
  -d '{"path": "output.txt", "content": "Hello", "directory": "/project"}'

# 搜索文件
curl -X POST http://localhost:8000/local/file/search \
  -H "Content-Type: application/json" \
  -d '{"pattern": "TODO", "directory": "/project", "include": ["*.py"]}'

# 列出文件
curl "http://localhost:8000/local/file/list?directory=/project&pattern=*.py"
```

## 集成你的 SDK

编辑 `server.py` 中的 `FuyaoAgentSDK` 类：

```python
class FuyaoAgentSDK:
    def __init__(self):
        # 初始化你的 SDK
        from your_sdk import YourAgentClient
        self.client = YourAgentClient(api_key="...")
        
        # 本地工具（保留）
        self.local_tools = LocalTools()
        self.fs = FileSystem()
    
    async def run_agent(
        self,
        agent_id: str,
        task: str,
        context: dict = None,
        directory: str = None,  # 当前工作目录
        worktree: str = None,   # Git worktree
    ) -> dict:
        # 你的 SDK 调用
        result = await self.client.agents.run(
            agent_id=agent_id,
            task=task,
            context={
                **(context or {}),
                "directory": directory,  # 传递本地目录
            },
        )
        
        # 可以在这里加入本地工具调用
        if directory and agent_id == "coder":
            lint_result = await self.local_tools.run_tool("ruff", ".", directory)
            result["output"] += f"\n\nLint: {lint_result['exit_code']}"
        
        return result
```

## 添加自定义工具

```python
# 在 LocalTools 类的 __init__ 中添加
self.tool_commands = {
    # ... 现有工具
    
    # 你的自定义工具
    "my-lint": ["python", "-m", "my_linter"],
    "my-test": ["python", "-m", "pytest", "--my-plugin"],
}
```

## 安全考虑

⚠️ 此服务允许执行本地命令和文件操作，请注意：

1. **只在本地运行**：不要暴露到公网
2. **认证**：可以添加 API Token 认证
3. **路径限制**：可以限制文件操作的目录范围
4. **命令白名单**：可以限制允许执行的命令

```python
# 添加简单的 Token 认证
from fastapi import Header, HTTPException

async def verify_token(authorization: str = Header(...)):
    if authorization != f"Bearer {os.environ.get('FUYAO_PLATFORM_TOKEN')}":
        raise HTTPException(status_code=401, detail="Invalid token")

# 在路由上使用
@app.post("/local/command", dependencies=[Depends(verify_token)])
async def run_local_command(request: LocalCommandRequest):
    ...
```
