"""Calendar API regression tests; all database and upload paths are temporary.

Run with: python3 -m unittest discover -s tests -p 'test_calendar_api.py' -v
"""

import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


class CalendarApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.import_home = tempfile.TemporaryDirectory(prefix="smart-notes-import-")
        cls.addClassCleanup(cls.import_home.cleanup)
        # api.py initializes its database and uploads directory on import. Patch
        # home before loading, so even that initialization cannot touch real data.
        api_path = Path(__file__).resolve().parents[1] / "api.py"
        spec = importlib.util.spec_from_file_location("calendar_test_api", api_path)
        cls.api = importlib.util.module_from_spec(spec)
        with patch.object(Path, "home", return_value=Path(cls.import_home.name)):
            spec.loader.exec_module(cls.api)

    def setUp(self):
        self.test_dir = tempfile.TemporaryDirectory(prefix="smart-notes-calendar-")
        self.addCleanup(self.test_dir.cleanup)
        self.api.DB_PATH = Path(self.test_dir.name) / "notes.db"
        self.api.init_db()
        self.client = TestClient(self.api.app)
        self.addCleanup(self.client.close)

    def tag(self, name="工作", color="#abc123"):
        response = self.client.post("/api/calendar/tags", json={"name": name, "color": color})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def item(self, **values):
        response = self.client.post("/api/calendar/items", json={
            "title": "项目评审", "date": "2026-09-21", **values,
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_create_read_update_delete_and_persist(self):
        tag = self.tag(name="  工作  ")
        self.assertEqual(tag["name"], "工作")
        self.assertEqual(tag["color"], "#ABC123")
        item = self.item(title="  项目评审  ", description="带上笔记", time="09:30", tagIds=[tag["id"]])
        self.assertIsInstance(item["id"], str)
        self.assertEqual(item["title"], "项目评审")
        self.assertFalse(item["completed"])
        self.assertTrue(item["createdAt"])
        with TestClient(self.api.app) as fresh_client:
            self.assertEqual(fresh_client.get("/api/calendar").json(), {"items": [item], "tags": [tag]})
        with sqlite3.connect(self.api.DB_PATH) as conn:
            self.assertEqual(conn.execute("SELECT title FROM calendar_items").fetchone()[0], "项目评审")

        response = self.client.put(f"/api/calendar/items/{item['id']}", json={
            "completed": True, "date": "2026-10-01", "time": "", "tagIds": [],
        })
        self.assertEqual(response.status_code, 200, response.text)
        updated = response.json()
        self.assertTrue(updated["completed"])
        self.assertEqual(updated["description"], "带上笔记")
        self.assertEqual(updated["date"], "2026-10-01")
        self.assertEqual(updated["time"], "")
        self.assertEqual(updated["tagIds"], [])
        self.assertEqual(updated["createdAt"], item["createdAt"])
        self.assertEqual(self.client.delete(f"/api/calendar/items/{item['id']}").status_code, 200)
        self.assertEqual(self.client.get("/api/calendar").json()["items"], [])

    def test_defaults_and_leap_day(self):
        item = self.item(date="2028-02-29")
        self.assertEqual(item["description"], "")
        self.assertEqual(item["time"], "")
        self.assertEqual(item["tagIds"], [])
        self.assertFalse(item["completed"])

    def test_item_tag_associations_and_tag_deletion(self):
        first, second = self.tag("工作"), self.tag("生活", "#123456")
        item = self.item(tagIds=[first["id"], second["id"], first["id"]])
        self.assertEqual(item["tagIds"], [first["id"], second["id"]])
        self.assertEqual(self.client.delete(f"/api/calendar/tags/{first['id']}").status_code, 200)
        result = self.client.get("/api/calendar").json()
        self.assertEqual(result["items"][0]["tagIds"], [second["id"]])
        self.assertEqual(result["items"][0]["id"], item["id"])
        self.assertEqual(result["tags"], [second])
        self.client.delete(f"/api/calendar/items/{item['id']}")
        with sqlite3.connect(self.api.DB_PATH) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM calendar_item_tags").fetchone()[0], 0)
        self.assertEqual(self.client.get("/api/calendar").json()["tags"], [second])

    def test_duplicate_tag_names_and_partial_tag_update(self):
        first = self.tag("Work")
        response = self.client.post("/api/calendar/tags", json={"name": " work ", "color": "#123456"})
        self.assertEqual(response.status_code, 409)
        self.assertIn("同名", response.json()["detail"])
        second = self.tag("生活")
        conflict = self.client.put(f"/api/calendar/tags/{second['id']}", json={"name": "WORK"})
        self.assertEqual(conflict.status_code, 409)
        response = self.client.put(f"/api/calendar/tags/{first['id']}", json={"color": "#fedcba"})
        self.assertEqual(response.json(), {**first, "color": "#FEDCBA"})
        self.assertEqual(self.client.put(f"/api/calendar/tags/{second['id']}", json={}).json(), second)

    def test_nonexistent_tag_rolls_back_item_create_and_update(self):
        tag = self.tag()
        response = self.client.post("/api/calendar/items", json={
            "title": "不应保存", "date": "2026-09-21", "tagIds": ["999999"],
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.get("/api/calendar").json()["items"], [])
        item = self.item(tagIds=[tag["id"]])
        response = self.client.put(f"/api/calendar/items/{item['id']}", json={
            "title": "不应更改", "completed": True, "tagIds": [tag["id"], "999999"],
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.get("/api/calendar").json()["items"], [item])

    def test_item_validation_and_chinese_error_messages(self):
        cases = [
            {"title": "  "}, {"title": "字" * 201}, {"date": "2026-02-29"},
            {"date": "2026-9-21"}, {"date": "2026-13-01"}, {"date": "0000-01-01"},
            {"time": "24:00"}, {"time": "09:60"}, {"time": "9:30"}, {"time": "09:30:00"},
            {"title": None}, {"description": None}, {"tagIds": None}, {"tagIds": [None]},
            {"tagIds": ["0"]}, {"tagIds": ["1 OR 1=1"]}, {"tagIds": ["9223372036854775808"]},
            {"unknown": "value"},
        ]
        for invalid in cases:
            with self.subTest(invalid=invalid):
                response = self.client.post("/api/calendar/items", json={
                    "title": "评审", "date": "2026-09-21", **invalid,
                })
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIsInstance(response.json()["detail"], str)
                self.assertRegex(response.json()["detail"], "[\u4e00-\u9fff]")
        self.assertEqual(self.client.get("/api/calendar").json()["items"], [])

    def test_tag_validation(self):
        for invalid in [{"name": " "}, {"name": "字" * 31}, {"color": "pink"}, {"color": "#fff"}, {"color": None}]:
            with self.subTest(invalid=invalid):
                response = self.client.post("/api/calendar/tags", json={"name": "工作", "color": "#123456", **invalid})
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.get("/api/calendar").json()["tags"], [])

    def test_null_updates_are_rejected_and_empty_values_can_clear(self):
        tag = self.tag()
        item = self.item(description="详情", time="12:30", tagIds=[tag["id"]])
        for field in ["title", "description", "date", "time", "completed", "tagIds"]:
            with self.subTest(field=field):
                response = self.client.put(f"/api/calendar/items/{item['id']}", json={field: None})
                self.assertEqual(response.status_code, 422, response.text)
        for field in ["name", "color"]:
            response = self.client.put(f"/api/calendar/tags/{tag['id']}", json={field: None})
            self.assertEqual(response.status_code, 422, response.text)
        for invalid_completed in ["false", 1, 0]:
            response = self.client.put(f"/api/calendar/items/{item['id']}", json={"completed": invalid_completed})
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.client.put(f"/api/calendar/items/{item['id']}", json={}).json(), item)
        self.assertEqual(self.client.get("/api/calendar").json()["items"], [item])
        response = self.client.put(f"/api/calendar/items/{item['id']}", json={"description": "", "time": "", "tagIds": []})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["description"], "")

    def test_missing_resources_return_404(self):
        for path, payload in [("items", {"title": "不存在"}), ("tags", {"name": "不存在"})]:
            with self.subTest(path=path):
                self.assertEqual(self.client.put(f"/api/calendar/{path}/99999", json=payload).status_code, 404)
                self.assertEqual(self.client.delete(f"/api/calendar/{path}/99999").status_code, 404)

    def test_malformed_resource_ids_do_not_reach_sqlite(self):
        for path in ["items", "tags"]:
            for resource_id in ["invalid", "0", "-1", "9223372036854775808"]:
                with self.subTest(path=path, resource_id=resource_id):
                    response = self.client.delete(f"/api/calendar/{path}/{resource_id}")
                    self.assertEqual(response.status_code, 422, response.text)
                    self.assertRegex(response.json()["detail"], "[\u4e00-\u9fff]")

    def test_schema_migration_is_additive_and_idempotent(self):
        self.api.DB_PATH = Path(self.test_dir.name) / "legacy.db"
        with sqlite3.connect(self.api.DB_PATH) as conn:
            conn.execute("""CREATE TABLE notes (
                id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )""")
            conn.execute("INSERT INTO notes VALUES (1, '已有笔记', '正文', '2026-01-01', '2026-01-01')")
        self.api.init_db()
        self.api.init_db()
        notes = self.client.get("/api/notes").json()
        self.assertEqual(notes[0]["title"], "已有笔记")
        self.assertEqual(notes[0]["content"], "正文")
        self.assertEqual(notes[0]["category"], "未分类")
        self.item()
        self.assertEqual(self.client.get("/api/notes").json(), notes)

    def test_note_and_chat_endpoints_remain_independent(self):
        note = self.client.post("/api/notes", json={"title": "原有笔记", "content": "正文", "category": "工作"}).json()
        self.client.post(f"/api/notes/{note['id']}/chat", json={"role": "user", "content": "原有对话"})
        self.client.post("/api/strawberry/chat", json={"role": "user", "content": "草莓对话"})
        item = self.item(title="'); DROP TABLE notes; --")
        self.client.delete(f"/api/calendar/items/{item['id']}")
        self.assertEqual(self.client.get(f"/api/notes/{note['id']}").json(), note)
        self.assertEqual(self.client.get(f"/api/notes/{note['id']}/chat").json(), [{"role": "user", "content": "原有对话"}])
        self.assertEqual(self.client.get("/api/strawberry/chat").json(), [{"role": "user", "content": "草莓对话"}])


if __name__ == "__main__":
    unittest.main()
