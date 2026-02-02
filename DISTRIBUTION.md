# 插件分发指南

## 分发方式对比

| 方式 | TypeScript 插件 | Python 服务 | 适合场景 |
|------|----------------|-------------|----------|
| **npm + pip** | npm 发布 | pip/PyPI 发布 | 开发者用户 |
| **npm + Docker** | npm 发布 | Docker 镜像 | 简化 Python 环境 |
| **All-in-One** | 打包到一起 | 内嵌启动 | 一键安装 |
| **CLI 工具** | 全局 CLI | 自动管理 | 最佳用户体验 |

---

## 方式 1: npm + pip (开发者友好)

### 发布 TypeScript 插件到 npm

```bash
cd my-agent-platform-plugin

# 1. 确保 package.json 正确
# 2. 构建
bun run build

# 3. 发布
npm publish
# 或 npm publish --access public (如果是 scoped 包)
```

### 发布 Python 服务到 PyPI

```bash
cd python-server

# 创建 setup.py 或 pyproject.toml
pip install build twine
python -m build
twine upload dist/*
```

### 用户安装

```bash
# 1. 安装 Python 服务
pip install my-agent-platform-server

# 2. 配置 OpenCode
# .opencode/opencode.jsonc
{
  "plugin": ["my-agent-platform-plugin"]
}

# 3. 启动服务
my-platform-server start
```

---

## 方式 2: npm + Docker (简化环境)

### 发布 Docker 镜像

```dockerfile
# python-server/Dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY mcp_server.py .

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
```

```bash
# 构建并推送
docker build -t your-registry/my-platform-server:latest python-server/
docker push your-registry/my-platform-server:latest
```

### 用户安装

```bash
# 1. 启动 Docker 服务
docker run -d -p 8000:8000 your-registry/my-platform-server:latest

# 2. 配置 OpenCode
# .opencode/opencode.jsonc
{
  "plugin": ["my-agent-platform-plugin"]
}
```

---

## 方式 3: All-in-One 包 (推荐)

将 TypeScript 插件和 Python 服务打包在一起，插件自动启动 Python 服务。

### 目录结构

```
my-agent-platform-plugin/
├── package.json
├── dist/                    # TypeScript 编译输出
│   └── index.js
├── python/                  # Python 服务内嵌
│   ├── server.py
│   ├── requirements.txt
│   └── venv/               # 可选：预装虚拟环境
└── bin/
    └── postinstall.js      # 安装后自动配置 Python
```

### 已实现的 All-in-One 方案

本插件已实现此方案，包含：

1. **postinstall.js** - 安装后自动配置 Python 虚拟环境
2. **cli.js** - CLI 工具管理 Python 服务

### 用户安装流程

```bash
# 1. 安装插件 (自动配置 Python)
npm install my-agent-platform-plugin

# 2. 启动 Python 服务
npx my-platform-server start

# 3. 配置 OpenCode
# .opencode/opencode.jsonc
{
  "plugin": ["my-agent-platform-plugin"],
  "agent": "my-platform-agent"
}

# 4. 使用
opencode
```

### CLI 命令

```bash
my-platform-server start              # 启动服务
my-platform-server start --port 9000  # 指定端口
my-platform-server stop               # 停止服务
my-platform-server status             # 查看状态
my-platform-server logs               # 查看日志
my-platform-server restart            # 重启
```

---

## 方式 4: CLI 工具 + 自动启动 (最佳体验)

让插件自动启动 Python 服务，用户无需手动管理。

### 修改插件入口自动启动

```typescript
// src/index.ts
import { spawn } from "child_process";
import { join } from "path";

async function ensurePythonServerRunning(port: number = 8000) {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    if (response.ok) return true;
  } catch {
    // 服务未运行，启动它
  }
  
  const serverDir = join(__dirname, "..", "python-server");
  const python = process.platform === "win32"
    ? join(serverDir, ".venv", "Scripts", "python.exe")
    : join(serverDir, ".venv", "bin", "python");
  
  spawn(python, ["-m", "uvicorn", "server:app", "--port", String(port)], {
    cwd: serverDir,
    detached: true,
    stdio: "ignore",
  }).unref();
  
  // 等待服务就绪
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) return true;
    } catch {}
  }
  
  return false;
}

const MyPlugin: Plugin = async (ctx) => {
  // 自动启动 Python 服务
  await ensurePythonServerRunning(8000);
  
  // ... 其余代码
};
```

---

## 发布到 npm

### 1. 准备发布

```bash
# 确保 package.json 中的信息正确
# - name: 唯一的包名
# - version: 语义化版本
# - repository: Git 仓库地址
# - license: 开源协议
```

### 2. 登录 npm

```bash
npm login
```

### 3. 构建并发布

```bash
# 构建
bun run build

# 发布
npm publish

# 如果是 scoped 包 (@your-org/my-plugin)
npm publish --access public
```

### 4. 用户安装

```bash
npm install my-agent-platform-plugin
# 或全局安装
npm install -g my-agent-platform-plugin
```

---

## 其他分发渠道

### GitHub Releases

1. 打包为 tar.gz
```bash
npm pack
# 生成 my-agent-platform-plugin-1.0.0.tgz
```

2. 上传到 GitHub Releases

3. 用户安装
```bash
npm install https://github.com/your-org/repo/releases/download/v1.0.0/my-agent-platform-plugin-1.0.0.tgz
```

### 私有 npm Registry

```bash
# 发布到私有 registry
npm publish --registry https://your-private-registry.com

# 用户配置 .npmrc
registry=https://your-private-registry.com
```

### Git 直接安装

```bash
# 用户可以直接从 Git 安装
npm install git+https://github.com/your-org/my-agent-platform-plugin.git
```

---

## 推荐的发布清单

- [ ] 更新 package.json 版本号
- [ ] 更新 README.md 使用文档
- [ ] 确保 Python requirements.txt 依赖正确
- [ ] 运行 `bun run build` 构建
- [ ] 本地测试 `npm pack` + 安装
- [ ] 运行 `npm publish`
- [ ] 创建 GitHub Release
- [ ] 更新文档站点

---

## 用户完整使用流程

```
┌─────────────────────────────────────────────────────────┐
│                    用户安装流程                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. npm install my-agent-platform-plugin                │
│     └── 自动运行 postinstall.js                         │
│         └── 检测 Python                                 │
│         └── 创建虚拟环境                                │
│         └── 安装 Python 依赖                            │
│                                                         │
│  2. npx my-platform-server start                        │
│     └── 启动 Python FastAPI 服务                        │
│     └── 监听 localhost:8000                             │
│                                                         │
│  3. 配置 .opencode/opencode.jsonc                       │
│     {                                                   │
│       "plugin": ["my-agent-platform-plugin"],           │
│       "agent": "my-platform-agent"                      │
│     }                                                   │
│                                                         │
│  4. opencode                                            │
│     └── 加载插件                                        │
│     └── 注册 agents, tools, hooks                       │
│     └── 用户开始使用                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
