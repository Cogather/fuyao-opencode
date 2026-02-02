/**
 * 规则注入器
 * 
 * 参考 oh-my-opencode/src/hooks/rules-injector/
 * 简化版实现，用于注入项目的 RULE.md 规则
 */
import type { PluginInput } from "@opencode-ai/plugin";
import { log } from "../../shared/logger";
import fs from "fs";
import path from "path";

interface RulesInjectorState {
  injectedSessions: Set<string>;
  rules: Map<string, string>;
}

export function createRulesInjector(ctx: PluginInput) {
  const state: RulesInjectorState = {
    injectedSessions: new Set(),
    rules: new Map(),
  };

  // 查找并加载 RULE.md 文件
  function loadRules(directory: string): string[] {
    const rules: string[] = [];
    const ruleFiles = [
      path.join(directory, "RULE.md"),
      path.join(directory, ".opencode", "RULE.md"),
      path.join(directory, "AGENTS.md"),
      path.join(directory, ".opencode", "AGENTS.md"),
    ];

    for (const file of ruleFiles) {
      if (fs.existsSync(file)) {
        try {
          const content = fs.readFileSync(file, "utf-8");
          rules.push(`# Rules from ${path.basename(file)}\n\n${content}`);
          log("加载规则文件", { file });
        } catch (error) {
          log("加载规则文件失败", { file, error: String(error) });
        }
      }
    }

    return rules;
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
      if (event.type === "session.created") {
        const info = event.properties?.info as { id?: string } | undefined;
        if (info?.id) {
          // 加载规则
          const rules = loadRules(ctx.directory);
          if (rules.length > 0) {
            state.rules.set(info.id, rules.join("\n\n---\n\n"));
            log("规则已准备", { sessionId: info.id, ruleCount: rules.length });
          }
        }
      }
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
      output: { args: Record<string, unknown> }
    ) => {
      // 在特定工具执行前注入规则上下文
      if (["task", "delegate_task", "run_platform_agent"].includes(input.tool)) {
        const rules = state.rules.get(input.sessionID);
        if (rules && !state.injectedSessions.has(input.sessionID)) {
          // 可以在这里修改 output.args 注入规则
          log("规则上下文已注入", { tool: input.tool, sessionId: input.sessionID });
          state.injectedSessions.add(input.sessionID);
        }
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      // 工具执行后的处理（如果需要）
    },

    // 获取已加载的规则
    getRules: (sessionId: string) => state.rules.get(sessionId),
  };
}
