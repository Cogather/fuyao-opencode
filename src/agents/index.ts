import type { PluginInput } from "@opencode-ai/plugin";

/**
 * Agent 配置类型
 */
interface AgentConfig {
  name: string;
  description?: string;
  mode: "primary" | "subagent" | "all";
  model?: string;
  prompt?: string;
  permission?: Record<string, "allow" | "deny" | "ask" | Record<string, "allow" | "deny" | "ask">>;
  temperature?: number;
  color?: string;
}

/**
 * 创建桥接 Agents
 * 
 * 这些 agent 的核心是 prompt：
 * - 告诉 LLM 扶摇平台有哪些能力
 * - 引导 LLM 使用桥接 tools 来调用平台
 * - 可以从平台 API 动态获取 agent 列表
 */
export function createBridgeAgents(
  ctx: PluginInput,
  platformBaseUrl: string
): Record<string, AgentConfig> {
  return {
    // ==================== 主 Agent：平台入口 ====================
    "fuyao-agent": {
      name: "fuyao-agent",
      description: "扶摇 Agent 平台 - 主入口，可以调用平台上的所有能力",
      mode: "all",
      prompt: `你是「扶摇 Agent 平台」的主入口 Agent。

## 平台能力

你可以通过以下工具调用平台的能力：

1. **run_platform_agent** - 调用平台上的特定 Agent
   - 平台上有多个专业 Agent：coder、reviewer、architect、tester 等
   - 每个 Agent 有各自的专长和上下文

2. **call_platform_skill** - 调用平台上的 Skill
   - 平台提供了大量预置 Skill
   - 可以执行特定的任务流程

3. **query_platform_knowledge** - 查询平台知识库
   - 搜索文档、代码示例、最佳实践

4. **manage_platform_session** - 管理平台会话
   - 创建/恢复/切换会话上下文

5. **run_local_tool** - 运行本地工具
   - 执行 pytest, ruff, eslint 等本地开发工具

6. **run_local_command** - 执行本地命令
   - 运行 shell 命令和脚本

## 使用原则

- 复杂任务应该委派给平台上的专业 Agent
- 需要持久上下文时使用平台会话管理
- 遇到不确定的问题先查询平台知识库

当前项目目录：${ctx.directory}
平台 API：${platformBaseUrl}`,
      permission: {
        "*": "allow",
      },
      temperature: 0.3,
      color: "#9C27B0", // 紫色
    },

    // ==================== 子 Agent：代码专家 ====================
    "fuyao-coder": {
      name: "fuyao-coder",
      description: "扶摇平台 - 代码专家（通过平台 SDK 运行）",
      mode: "subagent",
      prompt: `你是「扶摇 Agent 平台」的代码专家 Agent。

你的职责是编写高质量代码。但注意：
- 复杂的代码生成任务应该调用 run_platform_agent(agent_id="coder") 让平台处理
- 平台有更完整的上下文和更强的代码生成能力
- 你主要负责简单任务和结果整合

可用工具：run_platform_agent, call_platform_skill, run_local_tool`,
      permission: {
        "*": "allow",
        bash: "ask",
      },
      color: "#4CAF50",
    },

    // ==================== 子 Agent：架构师 ====================
    "fuyao-architect": {
      name: "fuyao-architect",
      description: "扶摇平台 - 架构师（通过平台 SDK 运行）",
      mode: "subagent",
      prompt: `你是「扶摇 Agent 平台」的架构师 Agent。

你的职责是设计系统架构。核心任务通过平台执行：
- 调用 run_platform_agent(agent_id="architect") 进行架构设计
- 调用 call_platform_skill(skill="design-review") 进行设计评审
- 调用 query_platform_knowledge(query="架构模式") 查找参考

可用工具：run_platform_agent, call_platform_skill, query_platform_knowledge`,
      permission: {
        "*": "deny",
        read: "allow",
        grep: "allow",
        glob: "allow",
        run_platform_agent: "allow",
        call_platform_skill: "allow",
        query_platform_knowledge: "allow",
      },
      color: "#FF9800",
    },

    // ==================== 子 Agent：代码审查 ====================
    "fuyao-reviewer": {
      name: "fuyao-reviewer",
      description: "扶摇平台 - 代码审查专家",
      mode: "subagent",
      prompt: `你是「扶摇 Agent 平台」的代码审查 Agent。

你的职责是审查代码质量：
- 调用 run_platform_agent(agent_id="reviewer") 进行深度代码审查
- 调用 run_local_tool(tool="ruff") 运行代码检查
- 调用 run_local_tool(tool="pytest") 运行测试

可用工具：run_platform_agent, call_platform_skill, run_local_tool`,
      permission: {
        "*": "deny",
        read: "allow",
        grep: "allow",
        glob: "allow",
        run_platform_agent: "allow",
        call_platform_skill: "allow",
        run_local_tool: "allow",
      },
      color: "#2196F3",
    },
  };
}

/**
 * 从平台 API 动态获取 Agent 列表（可选）
 */
export async function fetchAgentsFromPlatform(
  platformBaseUrl: string,
  token: string
): Promise<Record<string, AgentConfig>> {
  try {
    const response = await fetch(`${platformBaseUrl}/agents`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.warn("[Fuyao] 获取平台 agents 失败");
      return {};
    }

    const data = await response.json();
    const agents: Record<string, AgentConfig> = {};

    for (const item of data.agents || []) {
      agents[`fuyao-${item.id}`] = {
        name: `fuyao-${item.id}`,
        description: item.description,
        mode: "subagent",
        prompt: `你是「扶摇 Agent 平台」的 ${item.name} Agent。
        
通过 run_platform_agent(agent_id="${item.id}") 调用平台执行任务。

${item.instructions || ""}`,
        color: item.color,
      };
    }

    return agents;
  } catch (error) {
    console.error("[Fuyao] 获取平台 agents 出错:", error);
    return {};
  }
}
