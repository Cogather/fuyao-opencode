#!/usr/bin/env node
/**
 * fuyao-server CLI
 * 
 * 用法:
 *   fuyao-server start [--port 8000] [--host 0.0.0.0]
 *   fuyao-server stop
 *   fuyao-server status
 *   fuyao-server logs
 */
import { spawn, execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PYTHON_DIR = join(ROOT, "python-server");
const VENV_DIR = join(PYTHON_DIR, ".venv");
const PID_FILE = join(PYTHON_DIR, ".server.pid");
const LOG_FILE = join(PYTHON_DIR, "server.log");

const isWindows = process.platform === "win32";
const USE_SYSTEM_PYTHON = process.env.MY_PLATFORM_USE_SYSTEM_PYTHON === "true";

// exe 路径
const EXE_PATH = isWindows
  ? join(PYTHON_DIR, "dist", "fuyao-server.exe")
  : join(PYTHON_DIR, "dist", "fuyao-server");

// 检查是否有打包好的 exe
function hasExe() {
  return existsSync(EXE_PATH);
}

// 获取 Python 路径
function getPythonPath() {
  // 优先使用虚拟环境（除非明确指定使用系统 Python）
  if (!USE_SYSTEM_PYTHON && existsSync(VENV_DIR)) {
    const venvPython = isWindows
      ? join(VENV_DIR, "Scripts", "python.exe")
      : join(VENV_DIR, "bin", "python");
    
    if (existsSync(venvPython)) {
      return venvPython;
    }
  }
  
  // 使用系统 Python
  const pythonCommands = ["python3", "python", "py"];
  for (const cmd of pythonCommands) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" });
      return cmd;
    } catch {
      // 继续
    }
  }
  
  return null;
}

// 使用 exe 启动
async function startWithExe(port, host) {
  // 检查是否已运行
  if (await isServerRunning(port)) {
    console.log(`✓ 服务已在运行 (端口 ${port})`);
    return;
  }
  
  // 检查端口
  if (!(await isPortAvailable(port))) {
    console.error(`❌ 端口 ${port} 被占用`);
    process.exit(1);
  }
  
  // 启动 exe
  const child = spawn(EXE_PATH, ["--host", host, "--port", String(port)], {
    cwd: PYTHON_DIR,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  
  // 保存 PID
  writeFileSync(PID_FILE, String(child.pid));
  
  // 写日志
  const fs = await import("fs");
  const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  
  child.unref();
  
  console.log(`✓ 服务启动中... (PID: ${child.pid})`);
  
  // 等待就绪
  let retries = 10;
  while (retries > 0) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerRunning(port)) {
      console.log(`\n✅ 服务已就绪!`);
      console.log(`   URL: http://localhost:${port}`);
      console.log(`   文档: http://localhost:${port}/docs`);
      return;
    }
    retries--;
  }
  
  console.log("\n⚠️  服务启动中，请稍后检查: fuyao-server status");
}

// 检查端口是否可用
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

// 检查服务是否运行
async function isServerRunning(port = 8000) {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// 获取已保存的 PID
function getSavedPid() {
  if (existsSync(PID_FILE)) {
    try {
      return parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    } catch {
      return null;
    }
  }
  return null;
}

// 检查进程是否存在
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 启动服务
async function startServer(options = {}) {
  const port = options.port || 8000;
  const host = options.host || "0.0.0.0";
  
  console.log("🚀 启动 fuyao-server...\n");
  
  // 优先检查 exe
  if (hasExe()) {
    console.log(`✓ 使用打包版本: ${EXE_PATH}`);
    return startWithExe(port, host);
  }
  
  // 回退到 Python
  const python = getPythonPath();
  if (!python) {
    console.error("❌ 未找到 Python 或 exe，请先:");
    console.error("   1. 安装 Python 3.8+");
    console.error("   2. 或使用预打包的 exe 版本");
    process.exit(1);
  }
  console.log(`✓ Python: ${python}`);
  
  // 检查是否已运行
  if (await isServerRunning(port)) {
    console.log(`✓ 服务已在运行 (端口 ${port})`);
    return;
  }
  
  // 检查端口
  if (!(await isPortAvailable(port))) {
    console.error(`❌ 端口 ${port} 被占用，请使用 --port 指定其他端口`);
    process.exit(1);
  }
  
  // 启动服务
  const serverScript = join(PYTHON_DIR, "server.py");
  
  const child = spawn(python, ["-m", "uvicorn", "server:app", "--host", host, "--port", String(port)], {
    cwd: PYTHON_DIR,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
    },
  });
  
  // 保存 PID
  writeFileSync(PID_FILE, String(child.pid));
  
  // 写日志
  const logStream = require("fs").createWriteStream(LOG_FILE, { flags: "a" });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  
  // 分离子进程
  child.unref();
  
  console.log(`✓ 服务启动中... (PID: ${child.pid})`);
  
  // 等待服务就绪
  let retries = 10;
  while (retries > 0) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerRunning(port)) {
      console.log(`\n✅ 服务已就绪!`);
      console.log(`   URL: http://localhost:${port}`);
      console.log(`   文档: http://localhost:${port}/docs`);
      console.log(`\n💡 现在可以启动 OpenCode 了: opencode`);
      return;
    }
    retries--;
  }
  
  console.log("\n⚠️  服务启动中，请稍后检查状态: my-platform-server status");
}

// 停止服务
async function stopServer() {
  console.log("🛑 停止服务...\n");
  
  const pid = getSavedPid();
  
  if (pid && isProcessRunning(pid)) {
    try {
      if (isWindows) {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      } else {
        process.kill(pid, "SIGTERM");
      }
      console.log(`✓ 已停止服务 (PID: ${pid})`);
    } catch (error) {
      console.log(`⚠️  无法停止进程 ${pid}`);
    }
  } else {
    console.log("ℹ️  服务未运行");
  }
  
  // 清理 PID 文件
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE);
  }
}

// 检查状态
async function checkStatus(port = 8000) {
  console.log("📊 服务状态\n");
  
  const pid = getSavedPid();
  const processRunning = pid && isProcessRunning(pid);
  const serverResponding = await isServerRunning(port);
  
  console.log(`PID 文件: ${pid || "无"}`);
  console.log(`进程状态: ${processRunning ? "✓ 运行中" : "✗ 未运行"}`);
  console.log(`HTTP 响应: ${serverResponding ? "✓ 正常" : "✗ 无响应"}`);
  console.log(`端口: ${port}`);
  
  if (serverResponding) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      const data = await response.json();
      console.log(`工作目录: ${data.cwd}`);
    } catch {
      // 忽略
    }
  }
  
  console.log("");
  
  if (!serverResponding) {
    console.log("💡 启动服务: fuyao-server start");
  }
}

// 查看日志
function showLogs(lines = 50) {
  if (!existsSync(LOG_FILE)) {
    console.log("ℹ️  暂无日志");
    return;
  }
  
  const content = readFileSync(LOG_FILE, "utf-8");
  const allLines = content.split("\n");
  const lastLines = allLines.slice(-lines).join("\n");
  
  console.log(`📜 最近 ${lines} 行日志:\n`);
  console.log(lastLines);
}

// 解析命令行参数
function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      options.port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--host" && args[i + 1]) {
      options.host = args[i + 1];
      i++;
    } else if (args[i] === "--lines" && args[i + 1]) {
      options.lines = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return options;
}

// 显示帮助
function showHelp() {
  console.log(`
fuyao-server - 扶摇 Agent 平台 Python 服务管理

用法:
  fuyao-server <command> [options]

命令:
  start     启动服务
  stop      停止服务
  status    查看状态
  logs      查看日志
  restart   重启服务

选项:
  --port <port>   指定端口 (默认: 8000)
  --host <host>   指定主机 (默认: 0.0.0.0)
  --lines <n>     日志行数 (默认: 50)

示例:
  fuyao-server start
  fuyao-server start --port 9000
  fuyao-server status
  fuyao-server logs --lines 100
`);
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const options = parseArgs(args.slice(1));
  
  switch (command) {
    case "start":
      await startServer(options);
      break;
    case "stop":
      await stopServer();
      break;
    case "status":
      await checkStatus(options.port || 8000);
      break;
    case "logs":
      showLogs(options.lines || 50);
      break;
    case "restart":
      await stopServer();
      await new Promise((r) => setTimeout(r, 1000));
      await startServer(options);
      break;
    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;
    default:
      if (command) {
        console.log(`未知命令: ${command}\n`);
      }
      showHelp();
      break;
  }
}

main().catch(console.error);
