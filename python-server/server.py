"""
扶摇 Agent 平台 - Python API Server

支持：
1. 调用扶摇 Agent SDK
2. 本地文件操作
3. 本地命令执行
4. 本地工具运行
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
import asyncio
import subprocess
import os
import json
import uuid
from pathlib import Path

app = FastAPI(title="Fuyao Agent Platform API")


# ============ 数据模型 ============

class AgentRunRequest(BaseModel):
    agent_id: str
    task: str
    context: Optional[dict] = None
    wait: bool = True
    # 本地上下文
    directory: Optional[str] = None  # 当前工作目录
    worktree: Optional[str] = None   # Git worktree 根目录


class AgentRunResponse(BaseModel):
    task_id: str
    status: str
    output: Optional[str] = None
    duration_ms: Optional[int] = None
    artifacts: Optional[list] = None


class SkillExecuteRequest(BaseModel):
    skill: str
    input: Optional[dict] = None
    target_files: Optional[list[str]] = None
    context: Optional[dict] = None
    directory: Optional[str] = None


class LocalCommandRequest(BaseModel):
    """本地命令执行请求"""
    command: str
    args: Optional[list[str]] = None
    directory: Optional[str] = None
    env: Optional[dict[str, str]] = None
    timeout: Optional[int] = 60


class LocalCommandResponse(BaseModel):
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int


class FileReadRequest(BaseModel):
    """文件读取请求"""
    path: str
    directory: Optional[str] = None  # 基础目录
    encoding: str = "utf-8"


class FileWriteRequest(BaseModel):
    """文件写入请求"""
    path: str
    content: str
    directory: Optional[str] = None
    encoding: str = "utf-8"


class FileSearchRequest(BaseModel):
    """文件搜索请求"""
    pattern: str
    directory: Optional[str] = None
    include: Optional[list[str]] = None
    exclude: Optional[list[str]] = None


class LocalToolRequest(BaseModel):
    """本地工具执行请求"""
    tool: str  # lint, test, build, format, typecheck 等
    target: Optional[str] = None  # 目标文件或目录
    directory: Optional[str] = None
    options: Optional[dict] = None


# ============ 本地工具类 ============

class LocalTools:
    """本地工具执行器"""
    
    def __init__(self):
        # 工具命令映射
        self.tool_commands = {
            # Python
            "pytest": ["pytest", "-v"],
            "pylint": ["pylint"],
            "black": ["black"],
            "mypy": ["mypy"],
            "ruff": ["ruff", "check"],
            "ruff-fix": ["ruff", "check", "--fix"],
            
            # Node/TypeScript
            "npm-test": ["npm", "test"],
            "npm-build": ["npm", "run", "build"],
            "npm-lint": ["npm", "run", "lint"],
            "tsc": ["tsc", "--noEmit"],
            "eslint": ["eslint"],
            "prettier": ["prettier", "--write"],
            
            # Bun
            "bun-test": ["bun", "test"],
            "bun-build": ["bun", "run", "build"],
            
            # 通用
            "git-status": ["git", "status"],
            "git-diff": ["git", "diff"],
            "git-log": ["git", "log", "--oneline", "-10"],
        }
    
    async def run_command(
        self,
        command: str | list[str],
        directory: str = None,
        env: dict = None,
        timeout: int = 60,
    ) -> dict:
        """执行本地命令"""
        import time
        start_time = time.time()
        
        # 处理命令
        if isinstance(command, str):
            cmd = command.split()
        else:
            cmd = command
        
        # 合并环境变量
        run_env = os.environ.copy()
        if env:
            run_env.update(env)
        
        # 执行命令
        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=directory,
                env=run_env,
            )
            
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout,
            )
            
            duration_ms = int((time.time() - start_time) * 1000)
            
            return {
                "exit_code": process.returncode,
                "stdout": stdout.decode("utf-8", errors="replace"),
                "stderr": stderr.decode("utf-8", errors="replace"),
                "duration_ms": duration_ms,
            }
        except asyncio.TimeoutError:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds",
                "duration_ms": timeout * 1000,
            }
        except Exception as e:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": str(e),
                "duration_ms": int((time.time() - start_time) * 1000),
            }
    
    # 工具安装命令映射（可被 OpenCode 的 Bash 工具执行）
    INSTALL_COMMANDS = {
        # Python 工具
        "pytest": {"cmd": "pip install pytest", "type": "pip"},
        "pylint": {"cmd": "pip install pylint", "type": "pip"},
        "black": {"cmd": "pip install black", "type": "pip"},
        "mypy": {"cmd": "pip install mypy", "type": "pip"},
        "ruff": {"cmd": "pip install ruff", "type": "pip"},
        "ruff-fix": {"cmd": "pip install ruff", "type": "pip"},
        
        # Node 工具
        "npm-test": {"cmd": None, "type": "manual", "hint": "请安装 Node.js: https://nodejs.org"},
        "npm-build": {"cmd": None, "type": "manual", "hint": "请安装 Node.js: https://nodejs.org"},
        "npm-lint": {"cmd": None, "type": "manual", "hint": "请安装 Node.js: https://nodejs.org"},
        "tsc": {"cmd": "npm install -g typescript", "type": "npm"},
        "eslint": {"cmd": "npm install -g eslint", "type": "npm"},
        "prettier": {"cmd": "npm install -g prettier", "type": "npm"},
        
        # Bun 工具
        "bun-test": {"cmd": None, "type": "manual", "hint": "请安装 Bun: https://bun.sh"},
        "bun-build": {"cmd": None, "type": "manual", "hint": "请安装 Bun: https://bun.sh"},
        
        # Git
        "git-status": {"cmd": None, "type": "manual", "hint": "请安装 Git: https://git-scm.com"},
        "git-diff": {"cmd": None, "type": "manual", "hint": "请安装 Git: https://git-scm.com"},
        "git-log": {"cmd": None, "type": "manual", "hint": "请安装 Git: https://git-scm.com"},
    }

    def check_tool_available(self, tool: str) -> dict:
        """
        检查工具是否可用
        
        返回格式设计为 LLM 友好，便于 OpenCode 自动安装
        """
        if tool not in self.tool_commands:
            return {
                "available": False,
                "error": f"未知工具: {tool}",
                "can_auto_install": False,
            }
        
        cmd = self.tool_commands[tool][0]
        
        # 检查命令是否存在
        import shutil
        if not shutil.which(cmd):
            install_info = self.INSTALL_COMMANDS.get(tool, {})
            install_cmd = install_info.get("cmd")
            install_type = install_info.get("type", "manual")
            hint = install_info.get("hint", f"请确保 {cmd} 已安装")
            
            return {
                "available": False,
                "tool": tool,
                "command": cmd,
                "error": f"工具 '{cmd}' 未安装",
                # 关键：告诉 OpenCode 可以自动安装
                "can_auto_install": install_cmd is not None,
                "install_command": install_cmd,
                "install_type": install_type,
                "hint": hint if not install_cmd else f"运行: {install_cmd}",
                # LLM 友好的消息
                "message_for_llm": f"工具 {tool} 未安装。" + (
                    f"请使用 Bash 工具执行安装命令: `{install_cmd}`，然后重试。"
                    if install_cmd else hint
                ),
            }
        
        return {"available": True, "tool": tool}

    async def run_tool(
        self,
        tool: str,
        target: str = None,
        directory: str = None,
        options: dict = None,
    ) -> dict:
        """运行预定义的本地工具"""
        # 检查工具是否可用
        check_result = self.check_tool_available(tool)
        if not check_result.get("available"):
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": check_result.get("message_for_llm", check_result.get("error")),
                "duration_ms": 0,
                # 关键信息：让 OpenCode 知道可以自动安装
                "tool_missing": True,
                "can_auto_install": check_result.get("can_auto_install", False),
                "install_command": check_result.get("install_command"),
            }
        
        if tool not in self.tool_commands:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Unknown tool: {tool}. Available: {list(self.tool_commands.keys())}",
                "duration_ms": 0,
            }
        
        cmd = self.tool_commands[tool].copy()
        
        # 添加目标
        if target:
            cmd.append(target)
        
        # 添加额外选项
        if options:
            for key, value in options.items():
                if value is True:
                    cmd.append(f"--{key}")
                elif value is not False and value is not None:
                    cmd.extend([f"--{key}", str(value)])
        
        return await self.run_command(cmd, directory=directory)


class FileSystem:
    """文件系统操作"""
    
    def resolve_path(self, path: str, base_dir: str = None) -> Path:
        """解析路径"""
        p = Path(path)
        if not p.is_absolute() and base_dir:
            p = Path(base_dir) / p
        return p.resolve()
    
    def read_file(self, path: str, base_dir: str = None, encoding: str = "utf-8") -> str:
        """读取文件"""
        full_path = self.resolve_path(path, base_dir)
        return full_path.read_text(encoding=encoding)
    
    def write_file(self, path: str, content: str, base_dir: str = None, encoding: str = "utf-8"):
        """写入文件"""
        full_path = self.resolve_path(path, base_dir)
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content, encoding=encoding)
    
    def list_files(self, directory: str, pattern: str = "*", recursive: bool = True) -> list[str]:
        """列出文件"""
        p = Path(directory)
        if recursive:
            files = list(p.rglob(pattern))
        else:
            files = list(p.glob(pattern))
        return [str(f.relative_to(p)) for f in files if f.is_file()]
    
    def search_files(
        self,
        directory: str,
        pattern: str,
        include: list[str] = None,
        exclude: list[str] = None,
    ) -> list[str]:
        """搜索文件"""
        import fnmatch
        
        p = Path(directory)
        all_files = []
        
        for f in p.rglob("*"):
            if not f.is_file():
                continue
            
            rel_path = str(f.relative_to(p))
            
            # 排除
            if exclude:
                if any(fnmatch.fnmatch(rel_path, ex) for ex in exclude):
                    continue
            
            # 包含
            if include:
                if not any(fnmatch.fnmatch(rel_path, inc) for inc in include):
                    continue
            
            # 内容搜索
            try:
                content = f.read_text(encoding="utf-8", errors="ignore")
                if pattern in content:
                    all_files.append(rel_path)
            except:
                pass
        
        return all_files


# ============ 你的 Agent SDK 集成 ============

class FuyaoAgentSDK:
    """
    你的 Agent SDK 封装
    
    现在支持本地上下文：
    - directory: 当前工作目录
    - worktree: Git worktree
    - 可以读写文件、执行命令
    """
    
    def __init__(self):
        self.local_tools = LocalTools()
        self.fs = FileSystem()
        
        # 初始化你的 SDK
        # from your_sdk import YourAgentClient
        # self.client = YourAgentClient()
    
    async def run_agent(
        self,
        agent_id: str,
        task: str,
        context: dict = None,
        directory: str = None,
        worktree: str = None,
    ) -> dict:
        """
        调用你的 Agent 执行任务
        
        Args:
            agent_id: Agent ID
            task: 任务描述
            context: 额外上下文
            directory: 当前工作目录（可用于文件操作）
            worktree: Git worktree 根目录
        """
        # 示例实现 - 替换为你的 SDK 调用
        # 
        # result = await self.client.agents.run(
        #     agent_id=agent_id,
        #     task=task,
        #     context={
        #         **(context or {}),
        #         "directory": directory,
        #         "worktree": worktree,
        #     },
        # )
        
        # 模拟执行（包含本地工具调用示例）
        import time
        start_time = time.time()
        
        output_parts = [f"Agent [{agent_id}] 执行任务:\n{task}\n"]
        
        # 示例：如果是代码相关任务，可以运行 lint
        if directory and agent_id == "coder":
            output_parts.append("\n--- 代码检查 ---")
            # 检测项目类型并运行对应工具
            if (Path(directory) / "package.json").exists():
                lint_result = await self.local_tools.run_tool("eslint", ".", directory)
                output_parts.append(f"ESLint: exit={lint_result['exit_code']}")
            elif (Path(directory) / "pyproject.toml").exists() or (Path(directory) / "setup.py").exists():
                lint_result = await self.local_tools.run_tool("ruff", ".", directory)
                output_parts.append(f"Ruff: exit={lint_result['exit_code']}")
        
        duration_ms = int((time.time() - start_time) * 1000)
        
        return {
            "status": "completed",
            "output": "\n".join(output_parts),
            "duration_ms": duration_ms,
        }
    
    async def call_skill(
        self,
        skill: str,
        input_data: dict = None,
        target_files: list = None,
        directory: str = None,
    ) -> dict:
        """
        调用你的 Skill
        
        Skill 可以：
        - 读取目标文件
        - 执行本地命令
        - 返回处理结果
        """
        output_parts = [f"Skill [{skill}] 执行"]
        
        # 示例：code-review skill
        if skill == "code-review" and target_files and directory:
            for f in target_files[:3]:  # 最多处理3个文件
                try:
                    content = self.fs.read_file(f, directory)
                    output_parts.append(f"\n--- {f} ({len(content)} chars) ---")
                    # 这里调用你的 SDK 进行代码审查
                    # review = await self.client.skills.review(content)
                    output_parts.append("审查结果: (示例) 代码结构良好")
                except Exception as e:
                    output_parts.append(f"\n--- {f}: 读取失败 ({e}) ---")
        
        # 示例：test skill
        elif skill == "test" and directory:
            if (Path(directory) / "package.json").exists():
                result = await self.local_tools.run_tool("npm-test", directory=directory)
            else:
                result = await self.local_tools.run_tool("pytest", directory=directory)
            output_parts.append(f"\n测试结果: exit={result['exit_code']}")
            if result['stdout']:
                output_parts.append(result['stdout'][:1000])
        
        return {
            "status": "completed",
            "output": "\n".join(output_parts),
        }
    
    async def search_knowledge(self, query: str, category: str = "all", limit: int = 5) -> list:
        """搜索知识库"""
        # 替换为你的 SDK 调用
        return [
            {
                "title": f"关于 {query} 的文档",
                "content": f"这是关于 {query} 的示例内容...",
                "source": "knowledge-base",
            },
        ]
    
    async def orchestrate_subagents(
        self,
        task: str,
        strategy: str,
        agents: list = None,
        directory: str = None,
    ) -> dict:
        """编排 SubAgent"""
        # 替换为你的 SDK 调用
        await asyncio.sleep(0.5)
        
        return {
            "status": "completed",
            "agents_used": agents or ["coder", "reviewer"],
            "steps": [
                {"agent": "coder", "task": "编写代码", "status": "completed"},
                {"agent": "reviewer", "task": "审查代码", "status": "completed"},
            ],
            "output": f"SubAgent 编排完成。\n\n任务: {task}",
        }


# 全局实例
sdk = FuyaoAgentSDK()
local_tools = LocalTools()
fs = FileSystem()


# ============ API 路由 ============

@app.get("/health")
async def health_check():
    """健康检查"""
    return {"status": "healthy", "cwd": os.getcwd()}


# === Agent API ===

@app.post("/agents/run", response_model=AgentRunResponse)
async def run_agent(request: AgentRunRequest):
    """调用 Agent 执行任务"""
    task_id = str(uuid.uuid4())
    
    try:
        if request.wait:
            result = await sdk.run_agent(
                request.agent_id,
                request.task,
                request.context,
                directory=request.directory,
                worktree=request.worktree,
            )
            return AgentRunResponse(
                task_id=task_id,
                status=result["status"],
                output=result["output"],
                duration_ms=result.get("duration_ms"),
                artifacts=result.get("artifacts"),
            )
        else:
            asyncio.create_task(sdk.run_agent(
                request.agent_id,
                request.task,
                request.context,
                directory=request.directory,
            ))
            return AgentRunResponse(task_id=task_id, status="running")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/skills/execute")
async def execute_skill(request: SkillExecuteRequest):
    """执行 Skill"""
    try:
        result = await sdk.call_skill(
            request.skill,
            request.input,
            request.target_files,
            directory=request.directory,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# === 本地命令 API ===

@app.post("/local/command", response_model=LocalCommandResponse)
async def run_local_command(request: LocalCommandRequest):
    """执行本地命令"""
    cmd = [request.command] + (request.args or [])
    result = await local_tools.run_command(
        cmd,
        directory=request.directory,
        env=request.env,
        timeout=request.timeout,
    )
    return LocalCommandResponse(**result)


@app.post("/local/tool")
async def run_local_tool(request: LocalToolRequest):
    """运行本地工具"""
    result = await local_tools.run_tool(
        request.tool,
        target=request.target,
        directory=request.directory,
        options=request.options,
    )
    return result


@app.get("/local/tools")
async def list_local_tools():
    """列出可用的本地工具及其状态"""
    tools_status = {}
    for tool in local_tools.tool_commands.keys():
        available, error = local_tools.check_tool_available(tool)
        tools_status[tool] = {
            "available": available,
            "error": error if not available else None,
        }
    
    available_count = sum(1 for t in tools_status.values() if t["available"])
    
    return {
        "tools": tools_status,
        "summary": {
            "total": len(tools_status),
            "available": available_count,
            "missing": len(tools_status) - available_count,
        },
    }


# === 文件系统 API ===

@app.post("/local/file/read")
async def read_file(request: FileReadRequest):
    """读取本地文件"""
    try:
        content = fs.read_file(request.path, request.directory, request.encoding)
        return {"path": request.path, "content": content}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {request.path}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/local/file/write")
async def write_file(request: FileWriteRequest):
    """写入本地文件"""
    try:
        fs.write_file(request.path, request.content, request.directory, request.encoding)
        return {"path": request.path, "status": "written"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/local/file/search")
async def search_files(request: FileSearchRequest):
    """搜索文件"""
    try:
        files = fs.search_files(
            request.directory or os.getcwd(),
            request.pattern,
            request.include,
            request.exclude,
        )
        return {"files": files, "count": len(files)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/local/file/list")
async def list_files(directory: str, pattern: str = "*", recursive: bool = True):
    """列出目录文件"""
    try:
        files = fs.list_files(directory, pattern, recursive)
        return {"files": files, "count": len(files)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# === 知识库 & 会话 API ===

@app.post("/knowledge/search")
async def search_knowledge(query: str, category: str = "all", limit: int = 5):
    """搜索知识库"""
    items = await sdk.search_knowledge(query, category, limit)
    return {"items": items}


@app.post("/sessions")
async def manage_session(action: str, session_id: str = None, name: str = None):
    """管理会话"""
    if action == "create":
        return {"session_id": str(uuid.uuid4()), "name": name, "status": "created"}
    elif action == "list":
        return {"sessions": []}
    else:
        return {"session_id": session_id, "status": f"{action}d"}


@app.post("/subagents/orchestrate")
async def orchestrate_subagents(task: str, strategy: str = "auto", agents: list = None, directory: str = None):
    """编排 SubAgent"""
    result = await sdk.orchestrate_subagents(task, strategy, agents, directory)
    return result


# ============ 启动服务 ============

if __name__ == "__main__":
    import uvicorn
    import argparse
    
    parser = argparse.ArgumentParser(description="My Agent Platform Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind (default: 8000)")
    args = parser.parse_args()
    
    print("启动扶摇 Agent 平台服务...")
    print(f"工作目录: {os.getcwd()}")
    print(f"监听: http://{args.host}:{args.port}")
    print(f"API 文档: http://localhost:{args.port}/docs")
    
    uvicorn.run(app, host=args.host, port=args.port)
