"""
我的 Agent 平台 - MCP Server

为 OpenCode 提供 MCP 协议接口
参考: https://modelcontextprotocol.io/

使用方式:
1. 直接运行: python mcp_server.py
2. 或通过 stdio: python -m mcp_server
"""
import asyncio
import json
from typing import Any

# MCP SDK (需要安装: pip install mcp)
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent, Resource
    HAS_MCP = True
except ImportError:
    HAS_MCP = False
    print("警告: MCP SDK 未安装，运行 'pip install mcp' 安装")


# 你的 Agent SDK
class MyAgentSDK:
    """你的 Agent SDK - 同 server.py"""
    
    async def run_agent(self, agent_id: str, task: str, context: dict = None) -> dict:
        await asyncio.sleep(0.5)
        return {
            "status": "completed",
            "output": f"Agent [{agent_id}] 执行完成。\n\n任务: {task}",
        }
    
    async def call_skill(self, skill: str, input_data: dict = None) -> dict:
        await asyncio.sleep(0.3)
        return {
            "status": "completed",
            "output": f"Skill [{skill}] 执行完成。",
        }
    
    async def search_knowledge(self, query: str, limit: int = 5) -> list:
        return [{"title": f"关于 {query}", "content": f"{query} 的相关内容..."}]


sdk = MyAgentSDK()


if HAS_MCP:
    # 创建 MCP Server
    server = Server("my-agent-platform")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        """列出可用的 MCP Tools"""
        return [
            Tool(
                name="run_agent",
                description="调用我的平台上的 Agent 执行任务",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "agent_id": {
                            "type": "string",
                            "description": "Agent ID，如: coder, reviewer, architect",
                        },
                        "task": {
                            "type": "string",
                            "description": "要执行的任务描述",
                        },
                    },
                    "required": ["agent_id", "task"],
                },
            ),
            Tool(
                name="call_skill",
                description="调用我的平台上的 Skill",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "skill": {
                            "type": "string",
                            "description": "Skill 名称",
                        },
                        "input": {
                            "type": "object",
                            "description": "Skill 输入参数",
                        },
                    },
                    "required": ["skill"],
                },
            ),
            Tool(
                name="search_knowledge",
                description="搜索我的平台知识库",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "搜索关键词",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "返回结果数量",
                            "default": 5,
                        },
                    },
                    "required": ["query"],
                },
            ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
        """执行 MCP Tool"""
        if name == "run_agent":
            result = await sdk.run_agent(
                arguments["agent_id"],
                arguments["task"],
                arguments.get("context"),
            )
            return [TextContent(type="text", text=result["output"])]
        
        elif name == "call_skill":
            result = await sdk.call_skill(
                arguments["skill"],
                arguments.get("input"),
            )
            return [TextContent(type="text", text=result["output"])]
        
        elif name == "search_knowledge":
            items = await sdk.search_knowledge(
                arguments["query"],
                arguments.get("limit", 5),
            )
            output = "\n\n".join([
                f"### {item['title']}\n{item['content']}"
                for item in items
            ])
            return [TextContent(type="text", text=output)]
        
        else:
            raise ValueError(f"Unknown tool: {name}")

    @server.list_resources()
    async def list_resources() -> list[Resource]:
        """列出可用的 MCP Resources"""
        return [
            Resource(
                uri="platform://agents",
                name="可用 Agents",
                description="我的平台上可用的 Agent 列表",
                mimeType="application/json",
            ),
            Resource(
                uri="platform://skills",
                name="可用 Skills",
                description="我的平台上可用的 Skill 列表",
                mimeType="application/json",
            ),
        ]

    @server.read_resource()
    async def read_resource(uri: str) -> str:
        """读取 MCP Resource"""
        if uri == "platform://agents":
            return json.dumps({
                "agents": [
                    {"id": "coder", "name": "代码专家", "description": "编写高质量代码"},
                    {"id": "reviewer", "name": "代码审查", "description": "审查代码质量"},
                    {"id": "architect", "name": "架构师", "description": "设计系统架构"},
                ]
            }, ensure_ascii=False, indent=2)
        
        elif uri == "platform://skills":
            return json.dumps({
                "skills": [
                    {"name": "code-review", "description": "代码审查"},
                    {"name": "refactor", "description": "代码重构"},
                    {"name": "test-gen", "description": "测试生成"},
                ]
            }, ensure_ascii=False, indent=2)
        
        else:
            raise ValueError(f"Unknown resource: {uri}")


async def main():
    if not HAS_MCP:
        print("MCP SDK 未安装，无法启动 MCP Server")
        return
    
    print("启动 MCP Server...")
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
