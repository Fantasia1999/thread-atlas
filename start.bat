@echo off
chcp 65001 > nul
echo === 正在启动 ThreadAtlas 生产环境 (Windows) ===

:: 1. 检查 Node.js 环境
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo 错误: 未检测到 Node.js 环境，请先安装 Node.js (推荐 v22.12.0 或以上)。
    pause
    exit /b 1
)

:: 2. 检查依赖是否安装
if not exist "node_modules" (
    echo 检测到未安装依赖，正在执行 npm install...
    call npm install
)

:: 3. 运行构建并启动
echo 正在编译项目并拉起服务...
call npm start
pause
