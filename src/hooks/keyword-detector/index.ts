/**
 * 关键词检测器
 * 
 * 参考 oh-my-opencode/src/hooks/keyword-detector/
 * 简化版实现，用于检测用户消息中的关键词并触发相应动作
 */
import type { PluginInput } from "@opencode-ai/plugin";
import { log } from "../../shared/logger";

interface KeywordConfig {
  action: string;
  agentId?: string;
  hint?: string;
  handler?: (ctx: KeywordContext) => void | Promise<void>;
}

interface KeywordContext {
  sessionID: string;
  keyword: string;
  text: string;
  config: KeywordConfig;
}

interface KeywordDetectorOptions {
  keywords: Record<string, KeywordConfig>;
}

export function createKeywordDetector(ctx: PluginInput, options: KeywordDetectorOptions) {
  const { keywords } = options;

  return {
    "chat.message": async (
      input: { sessionID: string; agent?: string },
      output: { parts: Array<{ type: string; text?: string }> }
    ) => {
      const text = output.parts
        .filter(p => p.type === "text" && p.text)
        .map(p => p.text)
        .join("\n")
        .toLowerCase();

      for (const [keyword, config] of Object.entries(keywords)) {
        if (text.includes(keyword.toLowerCase())) {
          log("检测到关键词", { keyword, action: config.action, hint: config.hint });

          const context: KeywordContext = {
            sessionID: input.sessionID,
            keyword,
            text,
            config,
          };

          // 执行自定义处理器
          if (config.handler) {
            await config.handler(context);
          }

          // 可以在这里添加更多处理逻辑
          // 比如：修改 output.parts 注入提示
        }
      }
    },
  };
}

/**
 * 预置的关键词配置
 */
export const DEFAULT_KEYWORDS: Record<string, KeywordConfig> = {
  "@myplatform": {
    action: "call_platform",
    hint: "调用我的平台处理此任务",
  },
  "@mycoder": {
    action: "call_agent",
    agentId: "coder",
    hint: "调用我的代码专家",
  },
  "@myreview": {
    action: "call_agent",
    agentId: "reviewer",
    hint: "调用我的代码审查",
  },
  "@myarchitect": {
    action: "call_agent",
    agentId: "architect",
    hint: "调用我的架构师",
  },
};
