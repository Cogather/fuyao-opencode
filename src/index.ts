import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin";
import { createBridgeAgents } from "./agents";
import { createBridgeTools } from "./tools";
import { getMcpConfig } from "./mcp";

// ============ 从 oh-my-opencode 复用的能力 ============
// 方式1: 直接导入（需要 oh-my-opencode 作为 peerDependency）
// import { log } from "oh-my-opencode/src/shared/logger";
// import { createRulesInjectorHook } from "oh-my-opencode/src/hooks/rules-injector";
// import { createContextInjectorMessagesTransformHook, contextCollector } from "oh-my-opencode/src/features/context-injector";
// import { lsp_goto_definition, lsp_find_references, lsp_rename } from "oh-my-opencode/src/tools/lsp/tools";

// 方式2: 使用本地复制的版本（更稳定，不依赖 oh-my-opencode 内部 API 变化）
import { log } from "./shared/logger";
import { createRulesInjector } from "./hooks/rules-injector";
import { createContextCollector } from "./features/context-collector";
import { createKeywordDetector } from "./hooks/keyword-detector";

/**
 * 扶摇 Agent 平台插件
 * 
 * 架构参考 oh-my-opencode，复用其高价值能力
 */
const FuyaoOpenCodePlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
  log("扶摇插件加载中...", { directory: ctx.directory });

  // 平台配置
  const platformBaseUrl = process.env.FUYAO_PLATFORM_URL || "http://localhost:8000";
  const platformToken = process.env.FUYAO_PLATFORM_TOKEN || "";

  // 创建 agents 和 tools
  const bridgeAgents = createBridgeAgents(ctx, platformBaseUrl);
  const bridgeTools = createBridgeTools(ctx, platformBaseUrl, platformToken);
  const mcpConfig = getMcpConfig(platformBaseUrl);

  // ============ 复用 oh-my-opencode 的 Hook 能力 ============
  
  // 1. 规则注入器：让你的 agent 遵循项目的 RULE.md
  const rulesInjector = createRulesInjector(ctx);

  // 2. 上下文收集器：收集和注入上下文
  const contextCollector = createContextCollector();

  // 3. 关键词检测器：检测 @fuyao 等关键词
  const keywordDetector = createKeywordDetector(ctx, {
    keywords: {
      "@fuyao": { action: "call_platform", hint: "调用扶摇平台处理" },
      "@fuyao-coder": { action: "call_agent", agentId: "coder", hint: "调用扶摇代码专家" },
      "@fuyao-review": { action: "call_agent", agentId: "reviewer", hint: "调用扶摇代码审查" },
    },
  });

  return {
    // ==================== config hook ====================
    config: async (config) => {
      // 注入 agents
      config.agent = {
        ...config.agent,
        ...bridgeAgents,
      };

      // 注入 MCP
      config.mcp = {
        ...config.mcp,
        ...mcpConfig,
      };

      // 可选：禁用某些和你平台冲突的工具
      // config.tools = { ...config.tools, "some_conflicting_tool": false };

      log("配置已注入", {
        agents: Object.keys(bridgeAgents),
        mcps: Object.keys(mcpConfig),
      });
    },

    // ==================== tool ====================
    tool: {
      ...bridgeTools,

      // 复用 oh-my-opencode 的 LSP 工具（如果需要）
      // lsp_goto_definition,
      // lsp_find_references,
      // lsp_rename,
    },

    // ==================== event ====================
    event: async ({ event }) => {
      // 复用规则注入器的事件处理
      await rulesInjector?.event?.({ event });

      // 你的自定义事件处理
      const props = event.properties as Record<string, unknown> | undefined;
      
      if (event.type === "session.created") {
        const info = props?.info as { id?: string } | undefined;
        log("新会话创建", { sessionId: info?.id });

        // 可选：通知你的平台
        // await notifyPlatform("session.created", info);
      }
    },

    // ==================== chat.message ====================
    "chat.message": async (input, output) => {
      // 复用关键词检测
      await keywordDetector?.["chat.message"]?.(input, output);

      // 你的自定义处理
      const parts = output.parts as Array<{ type: string; text?: string }>;
      const text = parts.filter(p => p.type === "text").map(p => p.text).join("\n");

      // 检测是否要转发到平台
      if (text.includes("@fuyao")) {
        log("检测到扶摇平台调用关键词");
        // 可以在这里注入上下文或修改 output
        contextCollector.register({
          type: "platform_hint",
          priority: "high",
          content: "用户请求使用平台能力处理此任务",
        });
      }
    },

    // ==================== experimental.chat.messages.transform ====================
    // 复用上下文注入能力
    "experimental.chat.messages.transform": async (input, output) => {
      // 注入收集到的上下文
      const contexts = contextCollector.collect();
      if (contexts.length > 0) {
        // 将上下文注入到消息中
        // 参考 oh-my-opencode 的实现
      }
    },

    // ==================== tool.execute.before ====================
    "tool.execute.before": async (input, output) => {
      // 复用规则注入器
      await rulesInjector?.["tool.execute.before"]?.(input, output);

      log(`工具 ${input.tool} 即将执行`);

      // 你的自定义拦截逻辑
      // 比如：拦截某些工具，转发到你的平台执行
    },

    // ==================== tool.execute.after ====================
    "tool.execute.after": async (input, output) => {
      // 复用规则注入器
      await rulesInjector?.["tool.execute.after"]?.(input, output);

      // 你的自定义后处理
      // 比如：记录工具执行结果到你的平台
    },
  };
};

export default FuyaoOpenCodePlugin;
