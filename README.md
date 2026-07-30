# Smart Notes · 智能记事本

一个**本地优先**的智能记事本：Python 后端 + Next.js 前端，内置基于LLM的**流式 AI 助手**。既能作为**原生桌面应用**（PyWebView 窗口）运行，也提供**命令行 CLI**。复古 Windows 98 风格界面，所有笔记保存在本地 SQLite，不上传云端。

## ✨ 功能

- 📝 笔记的增删改查，按分类 / 日期浏览，全文搜索
- 💬 **AI 建议**：在笔记页右侧开启对话分栏（笔记 7 : AI 3），基于当前笔记内容流式问答，对话按笔记持久化
- 🍓 **草莓**：一个帮你结合日记反思的AI助手，流式输出、对话自动保存
- 🖥️ 原生桌面窗口（无需浏览器），也可用浏览器访问
- ⌨️ 命令行 CLI：`notes new / list / view / chat / ...`
- 🔒 数据全部本地：SQLite 存于 `~/.smart_notes.db`

## 🧱 技术栈

- **后端**：FastAPI + Uvicorn，SQLite，OpenAI SDK
- **前端**：Next.js（静态导出）+ Tailwind，由后端在同源 `8000` 端口托管
- **桌面**：PyWebView 原生窗口
- **AI**：智谱 `GLM-5.1`，流式输出

## 📁 目录结构

```
smart-notes/
├── api.py            # FastAPI 后端：笔记 CRUD + AI 流式接口 + 托管前端静态产物
├── app.py            # 桌面启动器（PyWebView 原生窗口）
├── notes.py / notes  # 命令行 CLI 及其启动脚本
├── desktop.sh        # 桌面版一键启动（自动装依赖 + 构建前端）
├── start.sh          # Web 开发模式（后端 :8000 + 前端 dev :3000）
├── requirements.txt
├── .env.example
└── frontend/         # Next.js 前端源码（构建产物 out/、node_modules 已被 git 忽略）
```

## 🚀 快速开始

### 1. 配置 API Key

```bash
cp .env.example .env
# 编辑 .env，填入智谱 API Key： ZHIPU_API_KEY=你的key
```

### 2. 安装依赖

```bash
pip install -r requirements.txt        # Python 后端 / CLI
cd frontend && npm install && cd ..    # 前端（首次）
```

### 3. 运行

**桌面版（推荐）** —— 自动构建前端并打开原生窗口：

```bash
./desktop.sh
# 或：python3 app.py（需先构建过前端）
```

**Web 开发模式** —— 后端 8000 + 前端热更新 3000：

```bash
./start.sh
# 浏览器打开 http://localhost:3000
```

**命令行 CLI**：

```bash
./notes list          # 列出笔记
./notes new           # 新建笔记
./notes view <id>     # 查看某条笔记
./notes chat <id>     # 和 AI 讨论某条笔记
./notes --help        # 查看全部命令
```

CLI 命令：`new` `list` `dir` `view` `edit` `delete` `search` `summarize` `assist` `chat` `open`

## 🔌 主要接口（后端 `:8000`）

| 用途 | 接口 |
|---|---|
| 笔记 CRUD | `GET/POST /api/notes`、`GET/PUT/DELETE /api/notes/{id}` |
| 笔记对话历史 | `GET/POST/DELETE /api/notes/{id}/chat` |
| AI 建议（流式，`text/plain`） | `POST /api/ai/chat` |
| AI 总结 / 助写（流式，后端仍提供） | `POST /api/ai/summarize`、`POST /api/ai/write` |
| 草莓（流式） | `POST /api/ai/strawberry` |
| 草莓对话历史 | `GET/POST/DELETE /api/strawberry/chat` |

## 💾 数据与配置

- 笔记与对话存于 `~/.smart_notes.db`（SQLite，已被 git 忽略，不会提交）
- 切换模型 / base_url：见 `api.py` 顶部的 `MODEL`、`ZHIPU_BASE_URL`
- 发送给模型的上下文最多保留最近 `MAX_CONTEXT_MESSAGES` 条，避免无限增长

## 📝 说明

- 前端 `frontend/out`、`frontend/node_modules` 不入库；首次运行由 `desktop.sh` 自动安装并构建
