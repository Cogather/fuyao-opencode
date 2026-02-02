# 扶摇 OpenCode 插件 - 用户安装指南

## 快速开始

### 第一步：安装插件

```bash
npm install -g fuyao-opencode
```

或从 URL 安装：
```bash
npm install -g https://your-download-url/fuyao-opencode-1.0.0.tgz
```

### 第二步：启动扶摇服务

```bash
fuyao-server start
```

看到以下提示表示启动成功：
```
✅ 服务已就绪!
   URL: http://localhost:8000
   文档: http://localhost:8000/docs
```

### 第三步：配置 OpenCode

在你的项目根目录创建 `.opencode/opencode.jsonc` 文件：

```jsonc
{
  "plugin": ["fuyao-opencode"],
  "agent": "fuyao-agent"
}
```

### 第四步：启动 OpenCode

```bash
opencode
```

现在你可以使用扶摇平台的能力了！

---

## 服务管理

### 启动服务
```bash
fuyao-server start
```

### 停止服务
```bash
fuyao-server stop
```

### 查看状态
```bash
fuyao-server status
```

### 查看日志
```bash
fuyao-server logs
```

### 重启服务
```bash
fuyao-server restart
```

### 指定端口
```bash
fuyao-server start --port 9000
```

---

## 可用的 Agent

| Agent | 说明 | 使用场景 |
|-------|------|----------|
| `fuyao-agent` | 主入口 Agent | 通用任务，自动分配 |
| `fuyao-coder` | 代码专家 | 编写代码 |
| `fuyao-architect` | 架构师 | 系统设计 |
| `fuyao-reviewer` | 代码审查 | 代码审查、质量检查 |

### 切换 Agent

在 OpenCode 中使用 `/agent` 命令切换：
```
/agent fuyao-coder
```

或在配置文件中指定默认 Agent：
```jsonc
{
  "plugin": ["fuyao-opencode"],
  "agent": "fuyao-coder"
}
```

---

## 可用的工具

扶摇插件提供以下工具，OpenCode 会根据任务自动调用：

| 工具 | 说明 |
|------|------|
| `run_platform_agent` | 调用扶摇 Agent 执行任务 |
| `call_platform_skill` | 调用扶摇 Skill |
| `run_local_tool` | 运行本地工具（pytest, ruff, eslint 等） |
| `run_local_command` | 执行本地命令 |
| `read_platform_file` | 读取文件 |
| `write_platform_file` | 写入文件 |
| `search_platform_files` | 搜索文件内容 |

### 本地工具列表

```
Python: pytest, pylint, black, mypy, ruff
Node:   npm-test, npm-build, eslint, prettier, tsc
Git:    git-status, git-diff, git-log
```

---

## 关键词触发

在对话中使用以下关键词可以快速触发相应功能：

| 关键词 | 效果 |
|--------|------|
| `@fuyao` | 调用扶摇平台处理 |
| `@fuyao-coder` | 调用代码专家 |
| `@fuyao-review` | 调用代码审查 |

示例：
```
帮我 @fuyao-review 这个文件的代码
```

---

## 环境变量（可选）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FUYAO_PLATFORM_URL` | `http://localhost:8000` | 扶摇服务地址 |
| `FUYAO_PLATFORM_TOKEN` | 空 | 认证 Token（如需要） |

设置方式：
```bash
# Linux/Mac
export FUYAO_PLATFORM_URL="http://localhost:8000"

# Windows PowerShell
$env:FUYAO_PLATFORM_URL = "http://localhost:8000"

# Windows CMD
set FUYAO_PLATFORM_URL=http://localhost:8000
```

---

## 更新插件

```bash
# 停止服务
fuyao-server stop

# 更新
npm install -g fuyao-opencode@latest --force
# 或从 URL 更新
npm install -g https://your-download-url/fuyao-opencode-1.0.1.tgz --force

# 重启服务
fuyao-server start
```

---

## 卸载

```bash
# 停止服务
fuyao-server stop

# 卸载插件
npm uninstall -g fuyao-opencode
```

---

## 常见问题

### Q: 服务启动失败怎么办？

检查 Python 是否安装：
```bash
python --version
# 或
python3 --version
```

如果没有 Python，请先安装 Python 3.8+。

### Q: 端口被占用怎么办？

使用其他端口：
```bash
fuyao-server start --port 9000
```

然后设置环境变量：
```bash
export FUYAO_PLATFORM_URL="http://localhost:9000"
```

### Q: 本地工具（pytest 等）执行失败？

确保工具已安装：
```bash
# Python 工具
pip install pytest ruff black

# Node 工具
npm install -g eslint prettier typescript
```

### Q: 如何查看详细日志？

```bash
fuyao-server logs --lines 100
```

### Q: OpenCode 找不到插件？

1. 确认已全局安装：`npm list -g fuyao-opencode`
2. 确认配置正确：检查 `.opencode/opencode.jsonc`
3. 重启 OpenCode

---

## 获取帮助

```bash
fuyao-server --help
```

---

## 完整配置示例

`.opencode/opencode.jsonc`:

```jsonc
{
  // 加载扶摇插件
  "plugin": ["fuyao-opencode"],
  
  // 默认 Agent
  "agent": "fuyao-agent",
  
  // 可选：自定义 Agent 权限
  "agent": {
    "fuyao-agent": {
      "permission": {
        "*": "allow"
      }
    }
  }
}
```
