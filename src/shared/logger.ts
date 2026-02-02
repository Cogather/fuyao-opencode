/**
 * 日志工具
 * 
 * 参考 oh-my-opencode/src/shared/logger.ts
 * 复制并修改为你的插件使用
 */
import path from "path";
import os from "os";
import fs from "fs";

const LOG_PREFIX = "[MyPlatform]";
const logFile = path.join(os.tmpdir(), "my-platform-plugin.log");

/**
 * 记录日志到文件和控制台
 */
export function log(message: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  const logLine = `[${timestamp}] ${LOG_PREFIX} ${message}${dataStr}\n`;
  
  // 写入文件
  try {
    fs.appendFileSync(logFile, logLine);
  } catch {
    // 忽略文件写入错误
  }
  
  // 输出到控制台
  if (data) {
    console.log(`${LOG_PREFIX} ${message}`, data);
  } else {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

/**
 * 获取日志文件路径
 */
export function getLogFilePath(): string {
  return logFile;
}
