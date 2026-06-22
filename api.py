#!/usr/bin/env python3
"""Smart Notes API - FastAPI 后端，供前端调用"""

import os
import sqlite3
import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Smart Notes API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path.home() / ".smart_notes.db"
ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/"
MODEL = "GLM-5.1"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '未分类',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        try:
            conn.execute("ALTER TABLE notes ADD COLUMN category TEXT NOT NULL DEFAULT '未分类'")
        except sqlite3.OperationalError:
            pass


def row_to_dict(row) -> dict:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "content": row["content"],
        "category": row["category"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_llm():
    api_key = os.getenv("ZHIPU_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="未配置 ZHIPU_API_KEY")
    return OpenAI(api_key=api_key, base_url=ZHIPU_BASE_URL)


def stream_completion(messages: list[dict]) -> StreamingResponse:
    """以纯文本流式返回模型输出，首字即时到达，避免前端请求超时。"""
    client = get_llm()  # 缺 key 时在此抛出 HTTPException（流开始前）

    def gen():
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                messages=messages,
                stream=True,
                # GLM 系列默认开启思考会拖慢首字，关闭后内容立即流出
                extra_body={"thinking": {"type": "disabled"}},
            )
            for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except Exception as e:  # 流中途出错时，把错误文本发给前端而非中断连接
            yield f"\n\n[AI 服务出错：{e}]"

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")


init_db()


# ── 数据模型 ──────────────────────────────────────────────

class NoteCreate(BaseModel):
    title: str
    content: str
    category: str = "未分类"


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None


class AISummarizeRequest(BaseModel):
    noteId: str


class AIWriteRequest(BaseModel):
    noteId: str
    prompt: str


class ChatMessage(BaseModel):
    role: str
    content: str


class AIChatRequest(BaseModel):
    messages: List[ChatMessage]
    noteId: Optional[str] = None


# ── 笔记 CRUD ─────────────────────────────────────────────

@app.get("/api/notes")
def list_notes():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM notes ORDER BY updated_at DESC").fetchall()
    return [row_to_dict(r) for r in rows]


@app.post("/api/notes", status_code=201)
def create_note(note: NoteCreate):
    t = now()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO notes (title, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (note.title, note.content, note.category, t, t)
        )
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_dict(row)


@app.get("/api/notes/{note_id}")
def get_note(note_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="笔记不存在")
    return row_to_dict(row)


@app.put("/api/notes/{note_id}")
def update_note(note_id: int, note: NoteUpdate):
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM notes WHERE id = ?", (note_id,)).fetchone():
            raise HTTPException(status_code=404, detail="笔记不存在")
        updates: dict = {k: v for k, v in note.model_dump().items() if v is not None}
        if not updates:
            row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
            return row_to_dict(row)
        updates["updated_at"] = now()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(
            f"UPDATE notes SET {set_clause} WHERE id = ?",
            [*updates.values(), note_id]
        )
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    return row_to_dict(row)


@app.delete("/api/notes/{note_id}")
def delete_note(note_id: int):
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM notes WHERE id = ?", (note_id,)).fetchone():
            raise HTTPException(status_code=404, detail="笔记不存在")
        conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    return {"ok": True}


# ── AI 接口 ───────────────────────────────────────────────

@app.post("/api/ai/summarize")
def ai_summarize(req: AISummarizeRequest):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (int(req.noteId),)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="笔记不存在")

    return stream_completion([
        {"role": "system", "content": "你是专业笔记助手，帮用户总结笔记要点，用清晰简洁的中文回答，使用 Markdown 格式。"},
        {"role": "user", "content": f"请总结以下笔记的关键要点：\n\n标题：{row['title']}\n分类：{row['category']}\n\n{row['content']}"}
    ])


@app.post("/api/ai/write")
def ai_write(req: AIWriteRequest):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (int(req.noteId),)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="笔记不存在")

    return stream_completion([
        {"role": "system", "content": "你是专业写作助手，帮用户改善文章质量，用中文回答。"},
        {"role": "user", "content": f"针对以下笔记，请执行操作：{req.prompt}\n\n标题：{row['title']}\n\n内容：\n{row['content']}"}
    ])


@app.post("/api/ai/chat")
def ai_chat(req: AIChatRequest):
    system_content = "你是一个智能笔记助手，帮助用户分析和讨论笔记内容。用中文回答。"

    if req.noteId:
        with get_db() as conn:
            row = conn.execute("SELECT * FROM notes WHERE id = ?", (int(req.noteId),)).fetchone()
        if row:
            system_content = (
                f"你是一个智能笔记助手。以下是用户的笔记，请基于此内容回答问题：\n\n"
                f"标题：{row['title']}\n分类：{row['category']}\n\n内容：\n{row['content']}\n\n用中文回答。"
            )

    messages = [{"role": "system", "content": system_content}]
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    return stream_completion(messages)


# ── 静态前端 ──────────────────────────────────────────────
# 若前端已构建（npm run export），则把它挂到根路径
FRONTEND_DIR = Path.home() / "Downloads" / "日记本" / "out"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
