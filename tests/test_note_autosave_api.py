"""Autosave creation retries use isolated databases, never the user's notes."""

import importlib.util
import sqlite3
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


class NoteAutosaveApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.import_home = tempfile.TemporaryDirectory(prefix="smart-notes-autosave-import-")
        cls.addClassCleanup(cls.import_home.cleanup)
        spec = importlib.util.spec_from_file_location(
            "note_autosave_test_api", Path(__file__).resolve().parents[1] / "api.py"
        )
        cls.api = importlib.util.module_from_spec(spec)
        with patch.object(Path, "home", return_value=Path(cls.import_home.name)):
            spec.loader.exec_module(cls.api)

    def setUp(self):
        self.test_dir = tempfile.TemporaryDirectory(prefix="smart-notes-autosave-")
        self.addCleanup(self.test_dir.cleanup)
        self.api.DB_PATH = Path(self.test_dir.name) / "notes.db"
        self.api.init_db()
        self.client = TestClient(self.api.app)
        self.addCleanup(self.client.close)

    def test_interrupted_create_retry_returns_original_note_then_updates_latest_content(self):
        draft_id = str(uuid.uuid4())
        original = self.client.post("/api/notes", json={
            "title": "未命名笔记", "content": "第一句\n", "category": "日记",
            "diaryDate": "2020-02-29", "draftId": draft_id,
        })
        self.assertEqual(original.status_code, 201, original.text)
        retry = self.client.post("/api/notes", json={
            "title": "新标题", "content": "第一句\n第二句\n", "draftId": draft_id,
        })
        self.assertEqual(retry.json(), original.json())
        self.assertEqual(len(self.client.get("/api/notes").json()), 1)
        latest = self.client.put(f"/api/notes/{retry.json()['id']}", json={
            "title": "新标题", "content": "第一句\n第二句\n", "category": "日记",
        }).json()
        self.assertEqual(latest["content"], "第一句\n第二句\n")
        self.assertEqual(latest["diaryDate"], "2020-02-29")
        self.assertEqual(latest["createdAt"], original.json()["createdAt"])

    def test_concurrent_creation_with_same_draft_id_creates_one_note(self):
        draft_id = str(uuid.uuid4())
        payload = self.api.NoteCreate(title="未命名笔记", content="输入内容", draftId=draft_id)
        with ThreadPoolExecutor(max_workers=4) as executor:
            notes = list(executor.map(lambda _: self.api.create_note(payload), range(8)))
        self.assertEqual(len({note["id"] for note in notes}), 1)
        self.assertEqual(len(self.client.get("/api/notes").json()), 1)

    def test_legacy_manual_creation_still_creates_independent_notes(self):
        payload = {"title": "相同标题", "content": "相同正文"}
        one = self.client.post("/api/notes", json=payload).json()
        two = self.client.post("/api/notes", json=payload).json()
        self.assertNotEqual(one["id"], two["id"])
        self.assertEqual(len(self.client.get("/api/notes").json()), 2)

    def test_invalid_draft_id_rejected_without_creating_note(self):
        response = self.client.post("/api/notes", json={
            "title": "正文", "content": "内容", "draftId": "invalid",
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.get("/api/notes").json(), [])

    def test_existing_database_migration_preserves_notes_and_is_repeatable(self):
        self.api.DB_PATH = Path(self.test_dir.name) / "legacy.db"
        with sqlite3.connect(self.api.DB_PATH) as conn:
            conn.execute("""CREATE TABLE notes (
                id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
                category TEXT NOT NULL, diary_date TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )""")
            conn.execute("INSERT INTO notes VALUES (7, '旧笔记', '原正文', '日记', '2020-02-29', 'a', 'b')")
        self.api.init_db()
        self.api.init_db()
        with sqlite3.connect(self.api.DB_PATH) as conn:
            self.assertEqual(conn.execute("SELECT * FROM notes").fetchone(),
                             (7, "旧笔记", "原正文", "日记", "2020-02-29", "a", "b", None))
        self.assertEqual(self.client.get("/api/notes/7").json()["content"], "原正文")


if __name__ == "__main__":
    unittest.main()
