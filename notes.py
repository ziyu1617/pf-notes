#!/usr/bin/env python3
"""Smart Notes CLI - 带 AI 助手的命令行记事本"""

import os
import sys
import sqlite3
import datetime
import click
from pathlib import Path
from openai import OpenAI
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.markdown import Markdown
from rich.prompt import Prompt
from rich.tree import Tree
from rich import box
from dotenv import load_dotenv
from prompt_toolkit import Application
from prompt_toolkit.buffer import Buffer
from prompt_toolkit.document import Document
from prompt_toolkit.layout.containers import HSplit, Window
from prompt_toolkit.layout.controls import BufferControl, FormattedTextControl
from prompt_toolkit.layout import Layout
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.styles import Style

load_dotenv()

console = Console()

DB_PATH = Path.home() / ".smart_notes.db"
ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/"
MODEL = "GLM-5.1"

DEFAULT_CATEGORIES = ["日记", "工作", "学习", "想法", "其他"]


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
        # 迁移旧数据：若 category 列不存在则添加
        try:
            conn.execute("ALTER TABLE notes ADD COLUMN category TEXT NOT NULL DEFAULT '未分类'")
        except sqlite3.OperationalError:
            pass


def get_llm_client():
    api_key = os.getenv("ZHIPU_API_KEY")
    if not api_key:
        console.print("[red]错误：未设置 ZHIPU_API_KEY 环境变量[/red]")
        console.print("请在 .env 文件中设置：ZHIPU_API_KEY=你的密钥")
        sys.exit(1)
    return OpenAI(api_key=api_key, base_url=ZHIPU_BASE_URL)


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def open_editor(title: str, content: str = "") -> tuple:
    """全屏终端编辑器。返回 (内容, 是否已保存)。
    Ctrl+S 保存并退出，Ctrl+Q 放弃退出。
    """
    saved = [False]
    buf = Buffer(document=Document(content, len(content)), multiline=True)

    kb = KeyBindings()

    @kb.add("c-s")
    def _save(event):
        saved[0] = True
        event.app.exit()

    @kb.add("c-q")
    def _quit(event):
        event.app.exit()

    def get_status():
        row, col = buf.document.cursor_position_row + 1, buf.document.cursor_position_col + 1
        return [("class:status", f"  Ctrl+S 保存  │  Ctrl+Q 放弃退出  │  第 {row} 行 第 {col} 列")]

    layout = Layout(HSplit([
        Window(
            content=FormattedTextControl(lambda: [("class:titlebar", f"  ✏️  {title}  ")]),
            height=1,
        ),
        Window(content=BufferControl(buffer=buf), wrap_lines=True),
        Window(content=FormattedTextControl(get_status), height=1),
    ]))

    style = Style.from_dict({
        "titlebar": "bg:#005f87 #ffffff bold",
        "status":   "bg:#303030 #888888",
    })

    app = Application(
        layout=layout,
        key_bindings=kb,
        style=style,
        full_screen=True,
        mouse_support=True,
    )
    app.run()
    return buf.text, saved[0]


def pick_category(current=None):
    """交互式选择分类"""
    with get_db() as conn:
        existing = [r[0] for r in conn.execute(
            "SELECT DISTINCT category FROM notes ORDER BY category"
        ).fetchall()]

    all_cats = list(dict.fromkeys(DEFAULT_CATEGORIES + existing))

    console.print("\n[cyan]选择分类：[/cyan]")
    for i, cat in enumerate(all_cats, 1):
        marker = " [dim](当前)[/dim]" if cat == current else ""
        console.print(f"  [cyan]{i}[/cyan]  {cat}{marker}")
    console.print(f"  [cyan]N[/cyan]  新建分类")

    choice = Prompt.ask("请选择", default="1")

    if choice.upper() == "N":
        return Prompt.ask("[cyan]输入新分类名称[/cyan]")
    try:
        idx = int(choice) - 1
        if 0 <= idx < len(all_cats):
            return all_cats[idx]
    except ValueError:
        pass
    return current or "未分类"


def show_directory():
    """显示按分类分组的目录树"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, title, category, updated_at FROM notes ORDER BY category, updated_at DESC"
        ).fetchall()

    if not rows:
        console.print("[yellow]还没有任何笔记[/yellow]")
        return

    # 按分类分组
    groups: dict = {}
    for row in rows:
        cat = row["category"] or "未分类"
        groups.setdefault(cat, []).append(row)

    tree = Tree("[bold cyan]📓 我的笔记目录[/bold cyan]")
    for cat, notes in sorted(groups.items()):
        branch = tree.add(f"[bold yellow]📁 {cat}[/bold yellow]  [dim]({len(notes)} 条)[/dim]")
        for note in notes:
            branch.add(
                f"[cyan]#{note['id']}[/cyan]  {note['title']}  "
                f"[dim]{note['updated_at'][:10]}[/dim]"
            )

    console.print(Panel(tree, border_style="cyan", padding=(1, 2)))


@click.group()
def cli():
    """Smart Notes - 智能命令行记事本"""
    init_db()


@cli.command("new")
@click.argument("title")
@click.option("--category", "-c", default=None, help="分类名称")
def new_note(title, category):
    """新建笔记：notes new <标题>"""
    console.print(f"[cyan]正在创建笔记「{title}」，输入内容（按 Ctrl+D 结束）：[/cyan]")
    try:
        lines = sys.stdin.read()
    except KeyboardInterrupt:
        console.print("\n[yellow]已取消[/yellow]")
        return

    if not lines.strip():
        console.print("[yellow]内容为空，已取消[/yellow]")
        return

    cat = category or "未分类"
    t = now()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO notes (title, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (title, lines, cat, t, t)
        )
        note_id = cur.lastrowid

    console.print(f"[green]✓ 笔记已保存，ID: {note_id}，分类: {cat}[/green]")


@cli.command("list")
@click.option("--category", "-c", default=None, help="按分类筛选")
def list_notes(category):
    """列出所有笔记"""
    with get_db() as conn:
        if category:
            rows = conn.execute(
                "SELECT id, title, category, created_at, updated_at FROM notes WHERE category = ? ORDER BY updated_at DESC",
                (category,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, title, category, created_at, updated_at FROM notes ORDER BY updated_at DESC"
            ).fetchall()

    if not rows:
        console.print("[yellow]没有找到笔记[/yellow]")
        return

    table = Table(title="我的笔记", show_lines=True)
    table.add_column("ID", style="cyan", width=5)
    table.add_column("分类", style="yellow", width=8)
    table.add_column("标题", style="bold")
    table.add_column("最后修改", style="dim")

    for row in rows:
        table.add_row(str(row["id"]), row["category"], row["title"], row["updated_at"])

    console.print(table)


@cli.command("dir")
def show_dir():
    """显示笔记目录（按分类分组）"""
    show_directory()


@cli.command("view")
@click.argument("note_id", type=int)
def view_note(note_id):
    """查看笔记内容：notes view <ID>"""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()

    if not row:
        console.print(f"[red]找不到 ID 为 {note_id} 的笔记[/red]")
        return

    console.print(Panel(
        Markdown(row["content"]),
        title=f"[bold cyan]{row['title']}[/bold cyan]  [yellow][{row['category']}][/yellow]",
        subtitle=f"[dim]创建: {row['created_at']}  |  修改: {row['updated_at']}[/dim]"
    ))


@cli.command("edit")
@click.argument("note_id", type=int)
@click.argument("title", required=False)
def edit_note(note_id, title):
    """编辑笔记内容：notes edit <ID> [新标题]"""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()

    if not row:
        console.print(f"[red]找不到 ID 为 {note_id} 的笔记[/red]")
        return

    new_title = title or row["title"]
    new_content, saved = open_editor(new_title, row["content"])

    if not saved:
        console.print("[yellow]已放弃编辑[/yellow]")
        return

    with get_db() as conn:
        conn.execute(
            "UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?",
            (new_title, new_content, now(), note_id)
        )

    console.print("[green]✓ 笔记已保存[/green]")


@cli.command("delete")
@click.argument("note_id", type=int)
def delete_note(note_id):
    """删除笔记：notes delete <ID>"""
    with get_db() as conn:
        row = conn.execute("SELECT title FROM notes WHERE id = ?", (note_id,)).fetchone()

    if not row:
        console.print(f"[red]找不到 ID 为 {note_id} 的笔记[/red]")
        return

    confirm = Prompt.ask(f"[yellow]确认删除「{row['title']}」？[/yellow]", choices=["y", "n"], default="n")
    if confirm != "y":
        console.print("[dim]已取消[/dim]")
        return

    with get_db() as conn:
        conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))

    console.print("[green]✓ 笔记已删除[/green]")


@cli.command("search")
@click.argument("keyword")
def search_notes(keyword):
    """搜索笔记：notes search <关键词>"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, title, category, created_at FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC",
            (f"%{keyword}%", f"%{keyword}%")
        ).fetchall()

    if not rows:
        console.print(f"[yellow]没有找到包含「{keyword}」的笔记[/yellow]")
        return

    table = Table(title=f"搜索结果：{keyword}", show_lines=True)
    table.add_column("ID", style="cyan", width=5)
    table.add_column("分类", style="yellow", width=8)
    table.add_column("标题", style="bold")
    table.add_column("创建时间", style="dim")

    for row in rows:
        table.add_row(str(row["id"]), row["category"], row["title"], row["created_at"])

    console.print(table)


@cli.command("summarize")
@click.argument("note_id", type=int)
def summarize_note(note_id):
    """用 AI 总结笔记：notes summarize <ID>"""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()

    if not row:
        console.print(f"[red]找不到 ID 为 {note_id} 的笔记[/red]")
        return

    client = get_llm_client()
    console.print("[cyan]AI 正在总结...[/cyan]")

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "你是一个专业的笔记助手，帮助用户总结和整理笔记内容。用简洁清晰的中文回答。"},
            {"role": "user", "content": f"请总结以下笔记内容，提炼关键要点：\n\n标题：{row['title']}\n\n内容：\n{row['content']}"}
        ]
    )

    summary = response.choices[0].message.content
    console.print(Panel(
        Markdown(summary),
        title=f"[bold green]AI 总结：{row['title']}[/bold green]"
    ))


@cli.command("assist")
@click.argument("note_id", type=int)
def assist_writing(note_id):
    """AI 写作辅助：notes assist <ID>"""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()

    if not row:
        console.print(f"[red]找不到 ID 为 {note_id} 的笔记[/red]")
        return

    action = Prompt.ask(
        "[cyan]你想对这篇笔记做什么？[/cyan]",
        choices=["润色", "扩写", "改写", "纠错"],
        default="润色"
    )

    client = get_llm_client()
    console.print(f"[cyan]AI 正在{action}...[/cyan]")

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "你是一个专业的写作助手，帮助用户改善文章质量。用中文回答。"},
            {"role": "user", "content": f"请对以下笔记内容进行{action}，保持原意，改善表达：\n\n标题：{row['title']}\n\n内容：\n{row['content']}"}
        ]
    )

    result = response.choices[0].message.content
    console.print(Panel(
        Markdown(result),
        title=f"[bold green]AI {action}结果[/bold green]"
    ))

    save = Prompt.ask("[yellow]是否将结果保存为新笔记？[/yellow]", choices=["y", "n"], default="n")
    if save == "y":
        t = now()
        with get_db() as conn:
            cur = conn.execute(
                "INSERT INTO notes (title, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (f"{row['title']}（AI {action}版）", result, row["category"], t, t)
            )
            console.print(f"[green]✓ 已保存为新笔记，ID: {cur.lastrowid}[/green]")


@cli.command("chat")
@click.argument("note_id", type=int)
def chat_with_note(note_id):
    """基于笔记与 AI 对话：notes chat <ID>"""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()

    if not row:
        console.print(f"[red]找不到 ID 为 {note_id} 的笔记[/red]")
        return

    client = get_llm_client()
    messages = [
        {"role": "system", "content": f"你是一个笔记助手。以下是用户的笔记，请基于此内容回答用户的问题：\n\n标题：{row['title']}\n\n内容：\n{row['content']}"},
    ]

    console.print(Panel(
        f"[bold]正在基于笔记「{row['title']}」进行对话[/bold]\n[dim]输入 quit 或 exit 退出[/dim]",
        style="cyan"
    ))

    while True:
        try:
            user_input = Prompt.ask("\n[bold blue]你[/bold blue]")
        except (KeyboardInterrupt, EOFError):
            console.print("\n[dim]对话结束[/dim]")
            break

        if user_input.lower() in ("quit", "exit", "q", "退出"):
            console.print("[dim]对话结束[/dim]")
            break

        if not user_input.strip():
            continue

        messages.append({"role": "user", "content": user_input})

        with console.status("[dim]AI 思考中...[/dim]"):
            response = client.chat.completions.create(model=MODEL, messages=messages)

        reply = response.choices[0].message.content
        messages.append({"role": "assistant", "content": reply})

        console.print(Panel(Markdown(reply), title="[bold green]AI[/bold green]", border_style="green"))


@cli.command("open")
def interactive_mode():
    """交互式菜单模式"""
    console.print(Panel(
        "[bold cyan]Smart Notes[/bold cyan]  智能记事本\n[dim]使用数字键选择操作，Ctrl+C 退出[/dim]",
        border_style="cyan"
    ))

    while True:
        with get_db() as conn:
            count = conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]

        console.print(f"\n[dim]当前共有 {count} 条笔记[/dim]")
        console.print("\n [bold]主菜单[/bold]")
        console.print("  [cyan]1[/cyan]  📁 查看目录（按分类浏览）")
        console.print("  [cyan]2[/cyan]  📋 所有笔记列表")
        console.print("  [cyan]3[/cyan]  ✏️  新建笔记")
        console.print("  [cyan]4[/cyan]  👁  查看笔记")
        console.print("  [cyan]5[/cyan]  📝 编辑笔记（Ctrl+S 保存）")
        console.print("  [cyan]6[/cyan]  🔍 搜索笔记")
        console.print("  [cyan]7[/cyan]  🤖 AI 总结笔记")
        console.print("  [cyan]8[/cyan]  ✨ AI 写作辅助")
        console.print("  [cyan]9[/cyan]  💬 与 AI 对话")
        console.print("  [cyan]d[/cyan]  🗑  删除笔记")
        console.print("  [cyan]0[/cyan]  退出")

        try:
            choice = Prompt.ask("\n请选择", choices=["0","1","2","3","4","5","6","7","8","9","d","D"])
        except (KeyboardInterrupt, EOFError):
            console.print("\n[dim]再见！[/dim]")
            break

        if choice == "0":
            console.print("[dim]再见！[/dim]")
            break

        elif choice == "1":
            show_directory()

        elif choice == "2":
            with get_db() as conn:
                rows = conn.execute(
                    "SELECT id, title, category, updated_at FROM notes ORDER BY category, updated_at DESC"
                ).fetchall()
            if not rows:
                console.print("[yellow]还没有任何笔记[/yellow]")
            else:
                table = Table(show_lines=True, box=box.ROUNDED)
                table.add_column("ID", style="cyan", width=5)
                table.add_column("分类", style="yellow", width=8)
                table.add_column("标题", style="bold")
                table.add_column("最后修改", style="dim")
                for row in rows:
                    table.add_row(str(row["id"]), row["category"], row["title"], row["updated_at"])
                console.print(table)

        elif choice == "3":
            title = Prompt.ask("[cyan]笔记标题[/cyan]")
            if not title.strip():
                continue
            cat = pick_category()
            new_content, saved = open_editor(title)
            if saved and new_content.strip():
                t = now()
                with get_db() as conn:
                    cur = conn.execute(
                        "INSERT INTO notes (title, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                        (title, new_content, cat, t, t)
                    )
                console.print(f"[green]✓ 已保存到「{cat}」，ID: {cur.lastrowid}[/green]")
            else:
                console.print("[yellow]已取消，未保存[/yellow]")

        elif choice == "4":
            note_id = Prompt.ask("[cyan]输入笔记 ID[/cyan]")
            try:
                note_id = int(note_id)
            except ValueError:
                console.print("[red]请输入有效的 ID 数字[/red]")
                continue
            with get_db() as conn:
                row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
            if not row:
                console.print(f"[red]找不到 ID {note_id} 的笔记[/red]")
            else:
                console.print(Panel(
                    Markdown(row["content"]),
                    title=f"[bold cyan]{row['title']}[/bold cyan]  [yellow][{row['category']}][/yellow]",
                    subtitle=f"[dim]创建: {row['created_at']}[/dim]"
                ))

        elif choice == "5":
            note_id = Prompt.ask("[cyan]输入笔记 ID[/cyan]")
            try:
                note_id = int(note_id)
            except ValueError:
                console.print("[red]请输入有效的 ID 数字[/red]")
                continue
            with get_db() as conn:
                row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
            if not row:
                console.print(f"[red]找不到 ID {note_id} 的笔记[/red]")
                continue
            new_content, saved = open_editor(row["title"], row["content"])
            if saved:
                with get_db() as conn:
                    conn.execute(
                        "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
                        (new_content, now(), note_id)
                    )
                console.print("[green]✓ 笔记已保存[/green]")
            else:
                console.print("[yellow]已放弃编辑[/yellow]")

        elif choice == "6":
            keyword = Prompt.ask("[cyan]搜索关键词[/cyan]")
            with get_db() as conn:
                rows = conn.execute(
                    "SELECT id, title, category, updated_at FROM notes WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC",
                    (f"%{keyword}%", f"%{keyword}%")
                ).fetchall()
            if not rows:
                console.print(f"[yellow]没有找到「{keyword}」相关笔记[/yellow]")
            else:
                table = Table(title=f"搜索：{keyword}", show_lines=True, box=box.ROUNDED)
                table.add_column("ID", style="cyan", width=5)
                table.add_column("分类", style="yellow", width=8)
                table.add_column("标题", style="bold")
                table.add_column("修改时间", style="dim")
                for row in rows:
                    table.add_row(str(row["id"]), row["category"], row["title"], row["updated_at"])
                console.print(table)

        elif choice in ("7", "8", "9"):
            note_id = Prompt.ask("[cyan]输入笔记 ID[/cyan]")
            try:
                note_id = int(note_id)
            except ValueError:
                console.print("[red]请输入有效的 ID 数字[/red]")
                continue
            with get_db() as conn:
                row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
            if not row:
                console.print(f"[red]找不到 ID {note_id} 的笔记[/red]")
                continue

            client = get_llm_client()

            if choice == "7":
                with console.status("[dim]AI 总结中...[/dim]"):
                    response = client.chat.completions.create(
                        model=MODEL,
                        messages=[
                            {"role": "system", "content": "你是专业笔记助手，帮用户总结笔记要点，用中文回答。"},
                            {"role": "user", "content": f"请总结以下笔记：\n\n标题：{row['title']}\n\n{row['content']}"}
                        ]
                    )
                console.print(Panel(Markdown(response.choices[0].message.content), title="[bold green]AI 总结[/bold green]"))

            elif choice == "8":
                action = Prompt.ask("选择操作", choices=["润色", "扩写", "改写", "纠错"], default="润色")
                with console.status(f"[dim]AI {action}中...[/dim]"):
                    response = client.chat.completions.create(
                        model=MODEL,
                        messages=[
                            {"role": "system", "content": "你是专业写作助手，用中文回答。"},
                            {"role": "user", "content": f"请对以下笔记进行{action}：\n\n标题：{row['title']}\n\n{row['content']}"}
                        ]
                    )
                result = response.choices[0].message.content
                console.print(Panel(Markdown(result), title=f"[bold green]AI {action}[/bold green]"))
                save = Prompt.ask("保存为新笔记？", choices=["y", "n"], default="n")
                if save == "y":
                    t = now()
                    with get_db() as conn:
                        cur = conn.execute(
                            "INSERT INTO notes (title, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                            (f"{row['title']}（{action}版）", result, row["category"], t, t)
                        )
                    console.print(f"[green]✓ 已保存，ID: {cur.lastrowid}[/green]")

            elif choice == "9":
                messages = [
                    {"role": "system", "content": f"你是笔记助手，基于以下笔记回答问题：\n\n标题：{row['title']}\n\n{row['content']}"},
                ]
                console.print(Panel(f"[bold]基于「{row['title']}」对话[/bold]\n[dim]输入 quit 退出[/dim]", style="cyan"))
                while True:
                    try:
                        user_input = Prompt.ask("\n[bold blue]你[/bold blue]")
                    except (KeyboardInterrupt, EOFError):
                        break
                    if user_input.lower() in ("quit", "exit", "q", "退出"):
                        break
                    if not user_input.strip():
                        continue
                    messages.append({"role": "user", "content": user_input})
                    with console.status("[dim]AI 思考中...[/dim]"):
                        response = client.chat.completions.create(model=MODEL, messages=messages)
                    reply = response.choices[0].message.content
                    messages.append({"role": "assistant", "content": reply})
                    console.print(Panel(Markdown(reply), title="[bold green]AI[/bold green]", border_style="green"))

        elif choice in ("d", "D"):
            note_id = Prompt.ask("[cyan]输入要删除的笔记 ID[/cyan]")
            try:
                note_id = int(note_id)
            except ValueError:
                console.print("[red]请输入有效的 ID 数字[/red]")
                continue
            with get_db() as conn:
                row = conn.execute("SELECT title FROM notes WHERE id = ?", (note_id,)).fetchone()
            if not row:
                console.print(f"[red]找不到 ID {note_id} 的笔记[/red]")
                continue
            confirm = Prompt.ask(f"[yellow]确认删除「{row['title']}」？[/yellow]", choices=["y", "n"], default="n")
            if confirm == "y":
                with get_db() as conn:
                    conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
                console.print("[green]✓ 已删除[/green]")


if __name__ == "__main__":
    cli()
