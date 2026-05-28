#!/bin/bash

# 确保脚本在出错时退出
set -e

echo "=== 正在启动 ThreadAtlas 生产环境 (Linux/macOS) ==="

# 1. 检查 Node.js 环境
if ! command -v node &> /dev/null; then
    echo "错误: 未检测到 Node.js 环境，请先安装 Node.js (推荐 v22.12.0 或以上)。"
    exit 1
fi

# 2. 检查依赖是否安装
if [ ! -d "node_modules" ]; then
    echo "检测到未安装依赖，正在执行 npm install..."
    npm install
fi

# 3. 运行构建并启动
echo "正在编译项目并拉起服务..."
npm start
