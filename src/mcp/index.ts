/**
 * 你的平台 MCP Server 配置
 * 
 * 这里配置指向你平台的 MCP Server，让 OpenCode 能够：
 * - 调用你平台的 MCP Tools
 * - 访问你平台的 MCP Resources
 * - 使用你平台的 MCP Prompts
 */

interface McpServerConfig {
  type: "remote" | "local";
  url?: string;
  command?: string[];
  environment?: Record<string, string>;
  enabled?: boolean;
}

/**
 * 获取你平台的 MCP 配置
 */
export function getMcpConfig(platformBaseUrl: string): Record<string, McpServerConfig> {
  const mcpUrl = platformBaseUrl.replace("/api", "/mcp");

  return {
    // ==================== 远程 MCP Server（推荐） ====================
    // 你的平台提供的 MCP Server（通过 SSE/HTTP）
    "my-platform-mcp": {
      type: "remote",
      url: `${mcpUrl}/sse`,  // 或 /mcp 取决于你的实现
      enabled: true,
    },

    // ==================== 本地 MCP Server（可选） ====================
    // 如果你的平台提供本地 CLI 工具
    // "my-platform-local": {
    //   type: "local",
    //   command: ["my-platform-cli", "mcp", "serve"],
    //   environment: {
    //     MY_PLATFORM_TOKEN: process.env.MY_PLATFORM_TOKEN || "",
    //   },
    //   enabled: false,
    // },

    // ==================== 你平台的其他 MCP Server ====================
    // 比如专门的知识库 MCP
    // "my-platform-knowledge": {
    //   type: "remote",
    //   url: `${mcpUrl}/knowledge`,
    //   enabled: true,
    // },
  };
}

/**
 * MCP Server 能力说明
 * 
 * 你的 MCP Server 应该提供：
 * 
 * 1. Tools（工具）
 *    - 对应你平台的各种能力
 *    - 比如：run_agent, call_skill, query_knowledge 等
 * 
 * 2. Resources（资源）
 *    - 对应你平台的数据
 *    - 比如：项目配置、知识库条目、会话历史等
 * 
 * 3. Prompts（提示模板）
 *    - 对应你平台的预置 Prompt
 *    - 比如：code-review-prompt, refactor-prompt 等
 * 
 * MCP Server 实现参考：
 * - https://modelcontextprotocol.io/
 * - https://github.com/modelcontextprotocol/servers
 */
