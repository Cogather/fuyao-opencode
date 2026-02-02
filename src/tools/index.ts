import { tool } from "@opencode-ai/plugin";
import type { PluginInput } from "@opencode-ai/plugin";

/**
 * 创建桥接 Tools
 * 
 * 调用你的 Python 平台，支持：
 * 1. Agent 执行
 * 2. Skill 调用
 * 3. 本地命令执行
 * 4. 本地文件操作
 * 5. 本地工具运行
 */
export function createBridgeTools(
  ctx: PluginInput,
  platformBaseUrl: string,
  platformToken: string
) {
  // 通用 API 调用
  async function callPlatformAPI(
    endpoint: string,
    method: "GET" | "POST" = "POST",
    body?: unknown,
    signal?: AbortSignal
  ) {
    const url = endpoint.startsWith("http") ? endpoint : `${platformBaseUrl}${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${platformToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Platform API error: ${response.status} - ${text}`);
    }

    return response.json();
  }

  return {
    // ==================== Agent 执行 ====================
    run_platform_agent: tool({
      description: `调用「扶摇 Agent 平台」上的 Agent 执行任务。

Agent 运行在 Python SDK 上，可以：
- 访问本地文件系统
- 执行本地命令
- 运行本地工具（lint、test 等）
- 调用扶摇平台的专有能力

可用 Agent: coder, reviewer, architect, tester 等`,
      args: {
        agent_id: tool.schema.string().describe("Agent ID"),
        task: tool.schema.string().describe("任务描述"),
        context: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
        wait_for_completion: tool.schema.boolean().optional().default(true),
      },
      async execute(args, context) {
        const result = await callPlatformAPI("/agents/run", "POST", {
          agent_id: args.agent_id,
          task: args.task,
          context: args.context,
          wait: args.wait_for_completion,
          // 传递本地上下文给 Python
          directory: context.directory,
          worktree: context.worktree,
        }, context.abort);

        if (!args.wait_for_completion) {
          return `任务已提交 [${args.agent_id}]\nTask ID: ${result.task_id}`;
        }

        return `## Agent [${args.agent_id}] 执行结果

**状态**: ${result.status}
**耗时**: ${result.duration_ms}ms

### 输出
${result.output}`;
      },
    }),

    // ==================== Skill 执行 ====================
    call_platform_skill: tool({
      description: `调用「扶摇 Agent 平台」上的 Skill。

Skill 可以访问本地文件并执行本地工具。

可用 Skill: code-review, refactor, test, format, lint 等`,
      args: {
        skill: tool.schema.string().describe("Skill 名称"),
        input: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
        target_files: tool.schema.array(tool.schema.string()).optional().describe("目标文件"),
      },
      async execute(args, context) {
        const result = await callPlatformAPI("/skills/execute", "POST", {
          skill: args.skill,
          input: args.input,
          target_files: args.target_files,
          directory: context.directory,
        }, context.abort);

        return `## Skill [${args.skill}] 执行结果

**状态**: ${result.status}

### 输出
${result.output}`;
      },
    }),

    // ==================== 本地命令执行 ====================
    run_local_command: tool({
      description: `通过平台执行本地命令。

命令在 Python 服务所在机器上执行，可以访问本地环境。
适用于需要运行 shell 命令、脚本等场景。`,
      args: {
        command: tool.schema.string().describe("命令"),
        args: tool.schema.array(tool.schema.string()).optional().describe("命令参数"),
        timeout: tool.schema.number().optional().default(60).describe("超时秒数"),
      },
      async execute(args, context) {
        // 请求权限
        await context.ask({
          permission: "run_local_command",
          patterns: [args.command],
          always: [],
          metadata: { command: args.command, args: args.args },
        });

        const result = await callPlatformAPI("/local/command", "POST", {
          command: args.command,
          args: args.args,
          directory: context.directory,
          timeout: args.timeout,
        }, context.abort);

        const output = [`## 命令执行结果`, ``, `**命令**: ${args.command} ${(args.args || []).join(" ")}`, `**退出码**: ${result.exit_code}`, `**耗时**: ${result.duration_ms}ms`];

        if (result.stdout) {
          output.push(``, `### stdout`, "```", result.stdout.trim(), "```");
        }
        if (result.stderr) {
          output.push(``, `### stderr`, "```", result.stderr.trim(), "```");
        }

        return output.join("\n");
      },
    }),

    // ==================== 本地工具运行 ====================
    run_local_tool: tool({
      description: `运行预定义的本地工具。

可用工具:
- Python: pytest, pylint, black, mypy, ruff, ruff-fix
- Node: npm-test, npm-build, npm-lint, tsc, eslint, prettier
- Bun: bun-test, bun-build
- Git: git-status, git-diff, git-log

注意：如果工具未安装，会返回安装命令，你可以使用 Bash 工具执行安装后重试。`,
      args: {
        tool: tool.schema.string().describe("工具名称"),
        target: tool.schema.string().optional().describe("目标文件/目录"),
        options: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional(),
      },
      async execute(args, context) {
        const result = await callPlatformAPI("/local/tool", "POST", {
          tool: args.tool,
          target: args.target,
          directory: context.directory,
          options: args.options,
        }, context.abort);

        // 处理工具缺失的情况 - 返回 LLM 友好的提示
        if (result.tool_missing) {
          const output = [
            `## ⚠️ 工具 [${args.tool}] 未安装`,
            ``,
          ];
          
          if (result.can_auto_install && result.install_command) {
            output.push(
              `**可以自动安装**: 是`,
              `**安装命令**: \`${result.install_command}\``,
              ``,
              `### 下一步操作`,
              `请使用 **Bash** 工具执行以下命令安装:`,
              ``,
              "```bash",
              result.install_command,
              "```",
              ``,
              `安装完成后，重新运行 \`run_local_tool\` 工具。`,
            );
          } else {
            output.push(
              `**错误信息**: ${result.stderr}`,
              ``,
              `此工具需要手动安装，无法自动安装。`,
            );
          }
          
          return output.join("\n");
        }

        const output = [`## 工具 [${args.tool}] 执行结果`, ``, `**退出码**: ${result.exit_code}`, `**耗时**: ${result.duration_ms}ms`];

        if (result.stdout) {
          output.push(``, `### 输出`, "```", result.stdout.trim().slice(0, 3000), "```");
        }
        if (result.stderr && result.exit_code !== 0) {
          output.push(``, `### 错误`, "```", result.stderr.trim().slice(0, 1000), "```");
        }

        return output.join("\n");
      },
    }),

    // ==================== 文件读取 ====================
    read_platform_file: tool({
      description: `通过平台读取本地文件。

用于读取 Python 服务能访问的文件。`,
      args: {
        path: tool.schema.string().describe("文件路径（相对或绝对）"),
      },
      async execute(args, context) {
        const result = await callPlatformAPI("/local/file/read", "POST", {
          path: args.path,
          directory: context.directory,
        }, context.abort);

        return `## 文件: ${args.path}

\`\`\`
${result.content.slice(0, 5000)}
\`\`\`${result.content.length > 5000 ? `\n\n... (截断，共 ${result.content.length} 字符)` : ""}`;
      },
    }),

    // ==================== 文件写入 ====================
    write_platform_file: tool({
      description: `通过平台写入本地文件。`,
      args: {
        path: tool.schema.string().describe("文件路径"),
        content: tool.schema.string().describe("文件内容"),
      },
      async execute(args, context) {
        await context.ask({
          permission: "write_platform_file",
          patterns: [args.path],
          always: [],
          metadata: { path: args.path },
        });

        await callPlatformAPI("/local/file/write", "POST", {
          path: args.path,
          content: args.content,
          directory: context.directory,
        }, context.abort);

        return `文件已写入: ${args.path} (${args.content.length} 字符)`;
      },
    }),

    // ==================== 文件搜索 ====================
    search_platform_files: tool({
      description: `在本地文件中搜索内容。`,
      args: {
        pattern: tool.schema.string().describe("搜索内容"),
        include: tool.schema.array(tool.schema.string()).optional().describe("包含的文件模式，如 *.py"),
        exclude: tool.schema.array(tool.schema.string()).optional().describe("排除的文件模式"),
      },
      async execute(args, context) {
        const result = await callPlatformAPI("/local/file/search", "POST", {
          pattern: args.pattern,
          directory: context.directory,
          include: args.include,
          exclude: args.exclude,
        }, context.abort);

        if (result.count === 0) {
          return `未找到包含 "${args.pattern}" 的文件`;
        }

        return `## 搜索结果: "${args.pattern}"

找到 ${result.count} 个文件:

${result.files.slice(0, 20).map((f: string) => `- ${f}`).join("\n")}${result.count > 20 ? `\n... (共 ${result.count} 个)` : ""}`;
      },
    }),

    // ==================== 知识库查询 ====================
    query_platform_knowledge: tool({
      description: `查询平台知识库。`,
      args: {
        query: tool.schema.string().describe("搜索关键词"),
        category: tool.schema.enum(["docs", "code", "practices", "all"]).optional().default("all"),
        limit: tool.schema.number().int().min(1).max(20).optional().default(5),
      },
      async execute(args, context) {
        const result = await callPlatformAPI(`/knowledge/search?query=${encodeURIComponent(args.query)}&category=${args.category}&limit=${args.limit}`, "POST", undefined, context.abort);

        if (!result.items?.length) {
          return "未找到相关结果";
        }

        return `## 知识库搜索: "${args.query}"

${result.items.map((item: { title: string; content: string }, i: number) => `### ${i + 1}. ${item.title}\n${item.content}`).join("\n\n---\n\n")}`;
      },
    }),

    // ==================== SubAgent 编排 ====================
    delegate_to_platform_subagent: tool({
      description: `委派给平台的 SubAgent 系统执行任务。

SubAgent 可以：
- 多 Agent 协作
- 并行执行
- 访问本地文件和工具`,
      args: {
        task: tool.schema.string().describe("任务描述"),
        strategy: tool.schema.enum(["auto", "sequential", "parallel"]).optional().default("auto"),
        agents: tool.schema.array(tool.schema.string()).optional().describe("指定 Agent"),
      },
      async execute(args, context) {
        const result = await callPlatformAPI(`/subagents/orchestrate?task=${encodeURIComponent(args.task)}&strategy=${args.strategy}`, "POST", {
          agents: args.agents,
          directory: context.directory,
        }, context.abort);

        return `## SubAgent 编排结果

**策略**: ${args.strategy}
**Agent**: ${result.agents_used?.join(", ")}
**状态**: ${result.status}

### 执行步骤
${result.steps?.map((s: { agent: string; task: string; status: string }) => `- [${s.agent}] ${s.task}: ${s.status}`).join("\n")}

### 输出
${result.output}`;
      },
    }),
  };
}
