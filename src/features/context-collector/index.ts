/**
 * 上下文收集器
 * 
 * 参考 oh-my-opencode/src/features/context-injector/
 * 简化版实现，用于收集和注入上下文
 */
import { log } from "../../shared/logger";

interface ContextEntry {
  type: string;
  priority: "low" | "medium" | "high";
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

interface ContextCollector {
  register: (entry: Omit<ContextEntry, "timestamp">) => void;
  collect: () => ContextEntry[];
  clear: () => void;
  getByType: (type: string) => ContextEntry[];
}

export function createContextCollector(): ContextCollector {
  const entries: ContextEntry[] = [];

  return {
    /**
     * 注册一个上下文条目
     */
    register(entry: Omit<ContextEntry, "timestamp">) {
      entries.push({
        ...entry,
        timestamp: Date.now(),
      });
      log("上下文已注册", { type: entry.type, priority: entry.priority });
    },

    /**
     * 收集所有上下文条目（按优先级和时间排序）
     */
    collect() {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return [...entries].sort((a, b) => {
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        return a.timestamp - b.timestamp;
      });
    },

    /**
     * 清空所有上下文条目
     */
    clear() {
      entries.length = 0;
      log("上下文已清空");
    },

    /**
     * 按类型获取上下文条目
     */
    getByType(type: string) {
      return entries.filter(e => e.type === type);
    },
  };
}

/**
 * 将上下文条目格式化为字符串
 */
export function formatContextEntries(entries: ContextEntry[]): string {
  if (entries.length === 0) {
    return "";
  }

  const sections = entries.map(entry => {
    const priorityLabel = entry.priority === "high" ? "⚠️" : entry.priority === "medium" ? "ℹ️" : "📝";
    return `${priorityLabel} [${entry.type}] ${entry.content}`;
  });

  return `## 上下文信息\n\n${sections.join("\n\n")}`;
}
