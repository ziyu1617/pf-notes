"""Diary date API regressions; never initialize or edit the user's real database.

Run with: python3 -m unittest discover -s tests -p 'test_diary_date_api.py' -v
"""

import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


class DiaryDateApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.import_home = tempfile.TemporaryDirectory(prefix="smart-notes-diary-import-")
        cls.addClassCleanup(cls.import_home.cleanup)
        api_path = Path(__file__).resolve().parents[1] / "api.py"
        spec = importlib.util.spec_from_file_location("diary_date_test_api", api_path)
        cls.api = importlib.util.module_from_spec(spec)
        # api.py initializes both the database and uploads on import.
        with patch.object(Path, "home", return_value=Path(cls.import_home.name)):
            spec.loader.exec_module(cls.api)

    def setUp(self):
        self.test_dir = tempfile.TemporaryDirectory(prefix="smart-notes-diary-")
        self.addCleanup(self.test_dir.cleanup)
        self.api.DB_PATH = Path(self.test_dir.name) / "notes.db"
        self.api.init_db()
        self.client = TestClient(self.api.app)
        self.addCleanup(self.client.close)

    def create_note(self, **values):
        response = self.client.post("/api/notes", json={
            "title": "补记那一天", "content": "一些值得留下的事", "category": "日记", **values,
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_historical_date_persists_without_backdating_audit_timestamps(self):
        creation_time = "2026-09-25 14:25:30"
        with patch.object(self.api, "now", return_value=creation_time):
            note = self.create_note(diaryDate="2020-02-29", createdAt="2020-02-29", updatedAt="2020-02-29")
        self.assertEqual(note["diaryDate"], "2020-02-29")
        self.assertEqual(note["createdAt"], creation_time)
        self.assertEqual(note["updatedAt"], creation_time)
        with sqlite3.connect(self.api.DB_PATH) as conn:
            stored = conn.execute("SELECT diary_date, created_at, updated_at FROM notes").fetchone()
        self.assertEqual(stored, ("2020-02-29", creation_time, creation_time))
        with TestClient(self.api.app) as fresh_client:
            self.assertEqual(fresh_client.get(f"/api/notes/{note['id']}").json(), note)
            self.assertEqual(fresh_client.get("/api/notes").json(), [note])

    def test_omitted_or_null_create_date_stays_unassigned(self):
        omitted = self.create_note()
        explicit_null = self.create_note(diaryDate=None)
        self.assertIsNone(omitted["diaryDate"])
        self.assertIsNone(explicit_null["diaryDate"])
        self.assertEqual([note["diaryDate"] for note in self.client.get("/api/notes").json()], [None, None])

    def test_edit_preserves_date_unless_explicitly_changed_or_cleared(self):
        with patch.object(self.api, "now", return_value="2026-09-25 14:00:00"):
            note = self.create_note(diaryDate="2021-12-31")
        endpoint = f"/api/notes/{note['id']}"
        with patch.object(self.api, "now", return_value="2026-09-25 15:00:00"):
            edited = self.client.put(endpoint, json={"title": "补充细节", "content": "更新正文"}).json()
        self.assertEqual(edited["diaryDate"], "2021-12-31")
        self.assertEqual(edited["createdAt"], note["createdAt"])
        self.assertEqual(edited["updatedAt"], "2026-09-25 15:00:00")
        self.assertEqual(self.client.put(endpoint, json={}).json(), edited)
        self.assertEqual(self.client.put(endpoint, json={"title": None, "content": None, "category": None}).json(), edited)

        with patch.object(self.api, "now", return_value="2026-09-25 16:00:00"):
            changed = self.client.put(endpoint, json={"diaryDate": "2022-01-01"}).json()
        self.assertEqual(changed["diaryDate"], "2022-01-01")
        self.assertEqual(changed["title"], edited["title"])
        self.assertEqual(changed["createdAt"], note["createdAt"])
        self.assertEqual(changed["updatedAt"], "2026-09-25 16:00:00")

        with patch.object(self.api, "now", return_value="2026-09-25 17:00:00"):
            cleared = self.client.put(endpoint, json={"diaryDate": None}).json()
        self.assertIsNone(cleared["diaryDate"])
        self.assertEqual(cleared["createdAt"], note["createdAt"])
        self.assertEqual(cleared["updatedAt"], "2026-09-25 17:00:00")
        self.assertEqual(self.client.get(endpoint).json(), cleared)

    def test_invalid_dates_are_rejected_on_create_and_update_without_mutation(self):
        note = self.create_note(diaryDate="2024-02-29")
        invalid_dates = [
            "", " ", "2026-9-01", "26-09-01", "2026/09/01", " 2026-09-01",
            "2026-09-01 ", "2026-09-01T00:00:00", "2026-02-29", "1900-02-29",
            "2026-04-31", "2026-13-01", "2026-01-00", "0000-01-01", "10000-01-01",
            "２０２６-０９-０１", 20260901, False, ["2026-09-01"], {"date": "2026-09-01"},
        ]
        for invalid in invalid_dates:
            with self.subTest(diaryDate=invalid):
                response = self.client.post("/api/notes", json={"title": "无效日期", "content": "正文", "diaryDate": invalid})
                self.assertEqual(response.status_code, 422, response.text)
                response = self.client.put(f"/api/notes/{note['id']}", json={"title": "不应更改", "diaryDate": invalid})
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.get("/api/notes").json(), [note])

    def test_valid_leap_days_and_date_boundaries(self):
        for date in ["2000-02-29", "2024-02-29", "0001-01-01", "9999-12-31"]:
            with self.subTest(diaryDate=date):
                self.assertEqual(self.create_note(diaryDate=date)["diaryDate"], date)

    def test_old_schema_migration_is_additive_and_idempotent(self):
        self.api.DB_PATH = Path(self.test_dir.name) / "legacy.db"
        with sqlite3.connect(self.api.DB_PATH) as conn:
            conn.execute("""CREATE TABLE notes (
                id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )""")
            conn.execute("INSERT INTO notes VALUES (1, '旧笔记', '保留正文', '2020-04-05 06:07:08', '2021-04-05 06:07:08')")
        self.api.init_db()
        self.api.init_db()
        old_note = self.client.get("/api/notes/1").json()
        self.assertEqual(old_note, {
            "id": "1", "title": "旧笔记", "content": "保留正文", "category": "未分类",
            "diaryDate": None, "createdAt": "2020-04-05 06:07:08", "updatedAt": "2021-04-05 06:07:08",
        })
        updated = self.client.put("/api/notes/1", json={"diaryDate": "2019-03-02"}).json()
        self.api.init_db()
        self.assertEqual(self.client.get("/api/notes/1").json(), updated)

    def test_existing_cli_insert_and_update_statements_remain_compatible(self):
        with sqlite3.connect(self.api.DB_PATH) as conn:
            cursor = conn.execute(
                "INSERT INTO notes (title, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                ("CLI 笔记", "旧版本写入", "日记", "2026-09-25 11:00:00", "2026-09-25 11:00:00"),
            )
            note_id = cursor.lastrowid
        self.assertIsNone(self.client.get(f"/api/notes/{note_id}").json()["diaryDate"])
        self.client.put(f"/api/notes/{note_id}", json={"diaryDate": "2020-06-07"})
        with sqlite3.connect(self.api.DB_PATH) as conn:
            conn.execute(
                "UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?",
                ("CLI 修改", "正文更新", "2026-09-25 18:00:00", note_id),
            )
        note = self.client.get(f"/api/notes/{note_id}").json()
        self.assertEqual(note["diaryDate"], "2020-06-07")
        self.assertEqual(note["title"], "CLI 修改")

    def test_serializer_handles_legacy_rows_without_diary_date(self):
        with self.api.get_db() as conn:
            row = conn.execute("""SELECT 1 AS id, '旧笔记' AS title, '正文' AS content,
                '未分类' AS category, '2026-01-01' AS created_at, '2026-01-01' AS updated_at""").fetchone()
        self.assertIsNone(self.api.row_to_dict(row)["diaryDate"])


if __name__ == "__main__":
    unittest.main()
