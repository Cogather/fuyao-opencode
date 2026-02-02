# Windows 构建脚本
# 用法: .\build.ps1

Write-Host "🔨 构建 my-platform-server.exe" -ForegroundColor Cyan
Write-Host ""

# 检查 Python
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "❌ 未找到 Python" -ForegroundColor Red
    exit 1
}

# 安装依赖
Write-Host "📦 安装依赖..."
pip install -r requirements.txt
pip install -r requirements-dev.txt

# 打包
Write-Host ""
Write-Host "📦 打包中..."
python build_exe.py

Write-Host ""
Write-Host "✅ 完成! 输出: dist\my-platform-server.exe" -ForegroundColor Green
