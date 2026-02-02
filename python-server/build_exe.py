"""
将 Python 服务打包为独立 exe

用法:
    pip install pyinstaller
    python build_exe.py

输出:
    dist/my-platform-server.exe  (Windows)
    dist/my-platform-server      (Linux/Mac)
"""
import PyInstaller.__main__
import platform
import os

# 配置
APP_NAME = "fuyao-server"
MAIN_SCRIPT = "server.py"

# PyInstaller 参数
args = [
    MAIN_SCRIPT,
    "--name", APP_NAME,
    "--onefile",           # 打包成单个文件
    "--console",           # 控制台应用
    "--clean",             # 清理临时文件
    
    # 隐式导入（FastAPI/uvicorn 需要）
    "--hidden-import", "uvicorn.logging",
    "--hidden-import", "uvicorn.loops",
    "--hidden-import", "uvicorn.loops.auto",
    "--hidden-import", "uvicorn.protocols",
    "--hidden-import", "uvicorn.protocols.http",
    "--hidden-import", "uvicorn.protocols.http.auto",
    "--hidden-import", "uvicorn.protocols.websockets",
    "--hidden-import", "uvicorn.protocols.websockets.auto",
    "--hidden-import", "uvicorn.lifespan",
    "--hidden-import", "uvicorn.lifespan.on",
    
    # 排除不需要的模块（减小体积）
    "--exclude-module", "tkinter",
    "--exclude-module", "matplotlib",
    "--exclude-module", "numpy",
    "--exclude-module", "pandas",
]

# 运行 PyInstaller
print(f"🔨 开始打包 {APP_NAME}...")
print(f"   平台: {platform.system()}")
print(f"   Python: {platform.python_version()}")
print("")

PyInstaller.__main__.run(args)

print("")
print("✅ 打包完成!")
print(f"   输出: dist/{APP_NAME}{'.exe' if platform.system() == 'Windows' else ''}")
