#!/usr/bin/env node
/**
 * 安装后自动配置 Python 环境
 */
import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PYTHON_DIR = join(ROOT, "python-server");
const VENV_DIR = join(PYTHON_DIR, ".venv");

console.log("🔧 fuyao-opencode 安装配置中...\n");

// 配置选项
const USE_SYSTEM_PYTHON = process.env.MY_PLATFORM_USE_SYSTEM_PYTHON === "true";

// 检查 Python
function findPython() {
  const pythonCommands = ["python3", "python", "py"];
  
  for (const cmd of pythonCommands) {
    try {
      const version = execSync(`${cmd} --version`, { encoding: "utf-8" }).trim();
      console.log(`✓ 找到 Python: ${version}`);
      return cmd;
    } catch {
      // 继续尝试下一个
    }
  }
  
  return null;
}

// 创建虚拟环境并安装依赖
async function setupPython() {
  const python = findPython();
  
  if (!python) {
    console.log("⚠️  未找到 Python，请手动安装 Python 3.8+");
    console.log("   然后运行: cd python-server && pip install -r requirements.txt\n");
    return false;
  }
  
  // 选项 1: 使用系统 Python（不创建虚拟环境）
  if (USE_SYSTEM_PYTHON) {
    console.log("ℹ️  使用系统 Python（跳过虚拟环境）");
    console.log("📦 安装 Python 依赖到系统环境...");
    
    try {
      execSync(`${python} -m pip install -r requirements.txt`, {
        cwd: PYTHON_DIR,
        stdio: "inherit",
      });
      console.log("✓ 依赖安装完成（系统环境）\n");
      return true;
    } catch (error) {
      console.log("⚠️  依赖安装失败，请手动运行:");
      console.log(`   cd ${PYTHON_DIR}`);
      console.log("   pip install -r requirements.txt\n");
      return false;
    }
  }
  
  // 选项 2: 创建虚拟环境（默认，推荐）
  if (existsSync(VENV_DIR)) {
    console.log("✓ 虚拟环境已存在");
    return true;
  }
  
  console.log("📦 创建 Python 虚拟环境（隔离依赖）...");
  console.log("   💡 如需使用系统 Python，设置环境变量: MY_PLATFORM_USE_SYSTEM_PYTHON=true\n");
  
  try {
    // 创建虚拟环境
    execSync(`${python} -m venv "${VENV_DIR}"`, {
      cwd: PYTHON_DIR,
      stdio: "inherit",
    });
    
    // 获取 pip 路径
    const isWindows = process.platform === "win32";
    const pip = isWindows
      ? join(VENV_DIR, "Scripts", "pip.exe")
      : join(VENV_DIR, "bin", "pip");
    
    console.log("📦 安装 Python 依赖...");
    execSync(`"${pip}" install -r requirements.txt`, {
      cwd: PYTHON_DIR,
      stdio: "inherit",
    });
    
    console.log("✓ Python 环境配置完成\n");
    return true;
  } catch (error) {
    console.log("⚠️  Python 环境配置失败，请手动配置:");
    console.log(`   cd ${PYTHON_DIR}`);
    console.log("   python -m venv .venv");
    console.log("   .venv/bin/pip install -r requirements.txt\n");
    return false;
  }
}

// 显示使用说明
function showUsage() {
  console.log("========================================");
  console.log("📖 使用说明");
  console.log("========================================\n");
  
  console.log("1. 启动 Python 服务:");
  console.log("   npx fuyao-server start");
  console.log("   # 或");
  console.log("   fuyao-server start\n");
  
  console.log("2. 配置 OpenCode (.opencode/opencode.jsonc):");
  console.log('   {');
  console.log('     "plugin": ["fuyao-opencode"],');
  console.log('     "agent": "fuyao-agent"');
  console.log('   }\n');
  
  console.log("3. 启动 OpenCode:");
  console.log("   opencode\n");
  
  console.log("========================================\n");
}

// 主流程
async function main() {
  await setupPython();
  showUsage();
}

main().catch(console.error);
