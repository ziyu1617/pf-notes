"""Sticky-note persistence tests; all database and upload paths are temporary.

Run with: python3 -m unittest discover -s tests -p 'test_sticky_notes_api.py' -v
"""

import importlib.util
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


class StickyNotesApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.import_home = tempfile.TemporaryDirectory(prefix="smart-notes-sticky-import-")
        cls.addClassCleanup(cls.import_home.cleanup)
        api_path = Path(__file__).resolve().parents[1] / "api.py"
        spec = importlib.util.spec_from_file_location("sticky_notes_test_api", api_path)
        cls.api = importlib.util.module_from_spec(spec)
        # api.py initializes the database and uploads on import. Never use the
        # user's home, even for the initial module load.
        with patch.object(Path, "home", return_value=Path(cls.import_home.name)):
            spec.loader.exec_module(cls.api)

    def setUp(self):
        self.test_dir = tempfile.TemporaryDirectory(prefix="smart-notes-sticky-")
        self.addCleanup(self.test_dir.cleanup)
        self.api.DB_PATH = Path(self.test_dir.name) / "notes.db"
        self.api.init_db()
        self.client = TestClient(self.api.app)
        self.addCleanup(self.client.close)

    def create_sticky(self, **values):
        response = self.client.post("/api/sticky-notes", json={"date": "2026-10-03", **values})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def list_date(self, date="2026-10-03"):
        response = self.client.get("/api/sticky-notes", params={"date": date})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def delete_sticky(self, note_id, revision):
        return self.client.request("DELETE", f"/api/sticky-notes/{note_id}", json={"revision": revision})

    def assert_unique_create_race(self, date):
        barrier = threading.Barrier(2)

        def create_from_window(content):
            with TestClient(self.api.app) as client:
                barrier.wait(timeout=5)
                response = client.post("/api/sticky-notes", json={"date": date, "content": content, "color": "pink"})
                return response.status_code, response.json()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(create_from_window, text) for text in ["窗口一", "窗口二"]]
            results = [future.result(timeout=10) for future in futures]
        self.assertEqual(sorted(status for status, _ in results), [201, 409])
        winner = next(body for status, body in results if status == 201)
        rejected = next(body for status, body in results if status == 409)
        self.assertIn("只能创建一张", rejected["detail"])
        self.assertEqual(self.list_date(date), [winner])
        return winner

    def test_notes_are_persistent_and_isolated_by_date(self):
        with patch.object(self.api, "now", return_value="2026-10-03 10:11:12"):
            blank = self.create_sticky()
        body = "  保留缩进\n第二行\n<script>只是文本</script>\n'); DROP TABLE notes; --  "
        second = self.create_sticky(date="2026-10-04", content=body, color="blue")
        other = self.create_sticky(date="2020-02-29", content="过去的一天")
        self.assertEqual(blank, {
            "id": "1", "date": "2026-10-03", "content": "", "color": "yellow", "revision": 0,
            "createdAt": "2026-10-03 10:11:12", "updatedAt": "2026-10-03 10:11:12",
        })
        self.assertEqual(second["content"], body)
        self.assertEqual(second["color"], "blue")
        self.assertEqual(self.list_date(), [blank])
        self.assertEqual(self.list_date("2026-10-04"), [second])
        self.assertEqual(self.list_date("2020-02-29"), [other])
        self.assertEqual(self.list_date("2026-10-05"), [])

        # A fresh client and repeated initialization model closing/reopening
        # windows and restarting the application, without deleting any notes.
        self.api.init_db()
        with TestClient(self.api.app) as fresh_client:
            self.assertEqual(fresh_client.get(f"/api/sticky-notes/{second['id']}").json(), second)
        with sqlite3.connect(self.api.DB_PATH) as conn:
            rows = conn.execute("SELECT date, content, revision FROM sticky_notes ORDER BY id").fetchall()
        self.assertEqual(rows, [(blank["date"], "", 0), (second["date"], body, 0), (other["date"], other["content"], 0)])

    def test_update_preserves_date_and_creation_time_and_can_clear_text(self):
        with patch.object(self.api, "now", return_value="2026-10-03 10:00:00"):
            note = self.create_sticky(content="初稿")
        endpoint = f"/api/sticky-notes/{note['id']}"
        with patch.object(self.api, "now", return_value="2026-10-03 11:00:00"):
            response = self.client.put(endpoint, json={"content": "  新内容\n", "revision": 0})
        self.assertEqual(response.status_code, 200, response.text)
        updated = response.json()
        self.assertEqual(updated, {**note, "content": "  新内容\n", "revision": 1, "updatedAt": "2026-10-03 11:00:00"})
        self.assertEqual(self.client.get(endpoint).json(), updated)
        cleared = self.client.put(endpoint, json={"content": "", "revision": 1})
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertEqual(cleared.json()["content"], "")
        self.assertEqual(cleared.json()["revision"], 2)
        self.assertEqual(cleared.json()["date"], note["date"])
        self.assertEqual(cleared.json()["createdAt"], note["createdAt"])

    def test_color_and_content_can_update_separately_or_atomically(self):
        note = self.create_sticky(content="保留正文")
        endpoint = f"/api/sticky-notes/{note['id']}"
        blue = self.client.put(endpoint, json={"color": "blue", "revision": 0})
        self.assertEqual(blue.status_code, 200, blue.text)
        self.assertEqual(blue.json()["content"], "保留正文")
        self.assertEqual(blue.json()["color"], "blue")
        self.assertEqual(blue.json()["revision"], 1)
        green = self.client.put(endpoint, json={"content": "新正文", "color": "green", "revision": 1})
        self.assertEqual(green.status_code, 200, green.text)
        self.assertEqual(green.json()["content"], "新正文")
        self.assertEqual(green.json()["color"], "green")
        self.assertEqual(green.json()["revision"], 2)
        stale = self.client.put(endpoint, json={"content": "旧草稿", "color": "pink", "revision": 1})
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(self.client.get(endpoint).json(), green.json())
        cleared = self.client.put(endpoint, json={"content": "", "revision": 2})
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertEqual(cleared.json()["color"], "green")
        pink = self.client.put(endpoint, json={"color": "pink", "revision": 3})
        self.assertEqual(pink.status_code, 200, pink.text)
        self.assertEqual(pink.json()["content"], "")
        self.assertEqual(pink.json()["color"], "pink")
        self.assertEqual(pink.json()["revision"], 4)
        self.api.init_db()
        self.assertEqual(self.client.get(endpoint).json(), pink.json())

    def test_colors_and_partial_update_fields_are_strictly_validated(self):
        note = self.create_sticky(content="原文")
        endpoint = f"/api/sticky-notes/{note['id']}"
        for value in [None, "", "orange", "Blue", "#ffffff", False, 123, [], {}]:
            with self.subTest(color=value):
                create = self.client.post("/api/sticky-notes", json={"date": "2026-10-04", "color": value})
                update = self.client.put(endpoint, json={"color": value, "revision": 0})
                self.assertEqual(create.status_code, 422, create.text)
                self.assertEqual(update.status_code, 422, update.text)
        for body in [{"revision": 0}, {"content": None, "color": "blue", "revision": 0}, {"color": None, "content": "新正文", "revision": 0}]:
            self.assertEqual(self.client.put(endpoint, json=body).status_code, 422)
        self.assertEqual(self.client.get(endpoint).json(), note)
        self.assertEqual(self.list_date("2026-10-04"), [])

    def test_each_date_is_unique_even_with_concurrent_creates_and_can_reopen_after_delete(self):
        with sqlite3.connect(self.api.DB_PATH) as conn:
            index = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'idx_sticky_one_active_date'").fetchone()
        self.assertIsNotNone(index)
        self.assertIn("WHERE deleted_at IS NULL", index[0])
        winner = self.assert_unique_create_race("2026-10-03")
        duplicate = self.client.post("/api/sticky-notes", json={"date": winner["date"], "content": "不能覆盖", "color": "green"})
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        self.assertEqual(self.client.get(f"/api/sticky-notes/{winner['id']}").json(), winner)
        self.assertEqual(self.delete_sticky(winner["id"], winner["revision"]).status_code, 200)
        rebuilt = self.create_sticky(content="删除后新建", color="green")
        self.assertNotEqual(rebuilt["id"], winner["id"])
        self.assertEqual(self.list_date(), [rebuilt])
        self.assertEqual(rebuilt["color"], "green")
        self.assertEqual(self.client.get(f"/api/sticky-notes/{winner['id']}").status_code, 404)

    def test_legacy_duplicates_are_preserved_while_triggers_reject_new_duplicates_atomically(self):
        self.api.DB_PATH = Path(self.test_dir.name) / "legacy-duplicates.db"
        with sqlite3.connect(self.api.DB_PATH) as conn:
            conn.execute("""CREATE TABLE sticky_notes (
                id INTEGER PRIMARY KEY, date TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
            )""")
            original_rows = [
                (4, "2020-01-01", "第一张旧便签", "2020-01-01", "2020-01-02", None),
                (5, "2020-01-01", "第二张旧便签\n保留每个字", "2020-01-01", "2020-01-03", None),
                (6, "2020-01-01", "此前已删除便签", "2020-01-01", "2020-01-04", "2020-01-05"),
            ]
            conn.executemany("INSERT INTO sticky_notes VALUES (?, ?, ?, ?, ?, ?)", original_rows)
        self.api.init_db()
        self.api.init_db()
        with sqlite3.connect(self.api.DB_PATH) as conn:
            self.assertEqual(conn.execute("SELECT id, date, content, created_at, updated_at, deleted_at FROM sticky_notes ORDER BY id").fetchall(), original_rows)
            self.assertEqual(conn.execute("SELECT color, revision FROM sticky_notes ORDER BY id").fetchall(), [("yellow", 0)] * 3)
            self.assertIsNone(conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'idx_sticky_one_active_date'").fetchone())
            # Reopening a tombstone also must not evade the one-per-day rule.
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("UPDATE sticky_notes SET deleted_at = NULL WHERE id = 6")
        existing = self.list_date("2020-01-01")
        self.assertEqual([note["id"] for note in existing], ["4", "5"])
        self.assertEqual(existing[1]["content"], original_rows[1][2])
        duplicate = self.client.post("/api/sticky-notes", json={"date": "2020-01-01", "content": "不要新增"})
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        # The entire database currently lacks a unique index. Its trigger must
        # still serialize racing POSTs on a different, previously empty date.
        self.assert_unique_create_race("2026-10-04")
        edited = self.client.put("/api/sticky-notes/4", json={"content": "仍可编辑旧便签", "color": "blue", "revision": 0})
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual(self.delete_sticky("4", 1).status_code, 200)
        self.assertEqual(self.client.post("/api/sticky-notes", json={"date": "2020-01-01"}).status_code, 409)
        self.assertEqual(self.delete_sticky("5", 0).status_code, 200)
        rebuilt = self.create_sticky(date="2020-01-01", content="新建唯一便签")
        self.assertGreater(int(rebuilt["id"]), 6)
        self.api.init_db()
        with sqlite3.connect(self.api.DB_PATH) as conn:
            self.assertIsNotNone(conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'idx_sticky_one_active_date'").fetchone())
            self.assertEqual(conn.execute("SELECT content FROM sticky_notes WHERE id = 5").fetchone()[0], original_rows[1][2])
        self.assertEqual(self.list_date("2020-01-01"), [rebuilt])

    def test_stale_revision_does_not_overwrite_a_newer_draft(self):
        note = self.create_sticky(content="原文")
        endpoint = f"/api/sticky-notes/{note['id']}"
        accepted = self.client.put(endpoint, json={"content": "窗口一的新内容", "revision": 0}).json()
        with patch.object(self.api, "now", return_value="2099-01-01 00:00:00"):
            conflict = self.client.put(endpoint, json={"content": "窗口二的旧草稿", "revision": 0})
        self.assertEqual(conflict.status_code, 409, conflict.text)
        self.assertIn("其他窗口", conflict.json()["detail"])
        self.assertEqual(self.client.get(endpoint).json(), accepted)
        retry = self.client.put(endpoint, json={"content": "已核对最新内容后的草稿", "revision": accepted["revision"]})
        self.assertEqual(retry.status_code, 200, retry.text)
        self.assertEqual(retry.json()["revision"], 2)

    def test_concurrent_text_and_color_changes_cannot_both_save_the_same_revision(self):
        note = self.create_sticky(content="原文")
        endpoint = f"/api/sticky-notes/{note['id']}"
        barrier = threading.Barrier(2)

        def save_from_window(changes):
            with TestClient(self.api.app) as client:
                barrier.wait(timeout=5)
                response = client.put(endpoint, json={**changes, "revision": 0})
                return response.status_code, response.json(), changes

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(save_from_window, changes) for changes in [{"content": "窗口一"}, {"color": "blue"}]]
            results = [future.result(timeout=10) for future in futures]
        self.assertEqual(sorted(result[0] for result in results), [200, 409])
        winner = next(result for result in results if result[0] == 200)
        stored = self.client.get(endpoint).json()
        self.assertEqual(stored, winner[1])
        self.assertEqual(stored["content"], winner[2].get("content", note["content"]))
        self.assertEqual(stored["color"], winner[2].get("color", note["color"]))
        self.assertEqual(stored["revision"], 1)

    def test_date_query_is_required_and_invalid_dates_never_write(self):
        self.assertEqual(self.client.get("/api/sticky-notes").status_code, 422)
        invalid_dates = [
            "", " ", "2026-1-03", "26-10-03", "2026/10/03", " 2026-10-03", "2026-10-03 ",
            "2026-10-03T00:00:00", "2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01",
            "2026-01-00", "0000-01-01", "10000-01-01", "２０２６-１０-０３",
        ]
        for value in invalid_dates:
            with self.subTest(date=value):
                self.assertEqual(self.client.get("/api/sticky-notes", params={"date": value}).status_code, 422)
                self.assertEqual(self.client.post("/api/sticky-notes", json={"date": value}).status_code, 422)
        for value in [None, 20261003, False, ["2026-10-03"], {"date": "2026-10-03"}]:
            with self.subTest(date=value):
                self.assertEqual(self.client.post("/api/sticky-notes", json={"date": value}).status_code, 422)
        self.assertEqual(self.list_date(), [])
        for value in ["0001-01-01", "2000-02-29", "2024-02-29", "9999-12-31"]:
            self.assertEqual(self.create_sticky(date=value)["date"], value)

    def test_plain_text_limit_and_strict_update_validation(self):
        note = self.create_sticky(content="文" * 20000)
        endpoint = f"/api/sticky-notes/{note['id']}"
        for content in [None, False, 123, ["文字"], {"text": "文字"}, "文" * 20001]:
            with self.subTest(content_type=type(content).__name__):
                self.assertEqual(self.client.post("/api/sticky-notes", json={"date": "2026-10-03", "content": content}).status_code, 422)
                self.assertEqual(self.client.put(endpoint, json={"content": content, "revision": 0}).status_code, 422)
        for revision in [-1, True, False, 0.0, "0", None, [], {}, 9223372036854775807]:
            with self.subTest(revision=revision):
                response = self.client.put(endpoint, json={"content": "不应保存", "revision": revision})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIsInstance(response.json()["detail"], str)
        for body in [{}, {"content": "缺少版本"}, {"revision": 0}, {"content": "改日期", "revision": 0, "date": "2026-10-04"}]:
            self.assertEqual(self.client.put(endpoint, json=body).status_code, 422)
        for body in [{"content": "缺日期"}, {"date": "2026-10-03", "itemId": "1"}, {"date": "2026-10-03", "revision": 5}]:
            self.assertEqual(self.client.post("/api/sticky-notes", json=body).status_code, 422)
        self.assertEqual(self.client.get(endpoint).json(), note)

    def test_missing_and_invalid_ids_have_expected_errors(self):
        for value in ["0", "-1", "01", "1.0", "+1", "1e0", "abc", "9223372036854775808", "9" * 40]:
            with self.subTest(id=value):
                endpoint = f"/api/sticky-notes/{value}"
                self.assertEqual(self.client.get(endpoint).status_code, 422)
                self.assertEqual(self.client.put(endpoint, json={"content": "x", "revision": 0}).status_code, 422)
                self.assertEqual(self.delete_sticky(value, 0).status_code, 422)
        for value in ["1", "9223372036854775807"]:
            endpoint = f"/api/sticky-notes/{value}"
            self.assertEqual(self.client.get(endpoint).status_code, 404)
            self.assertEqual(self.client.put(endpoint, json={"content": "x", "revision": 0}).status_code, 404)
            self.assertEqual(self.delete_sticky(value, 0).status_code, 404)

    def test_delete_requires_current_revision_and_never_revives_or_reuses_an_id(self):
        note = self.create_sticky(content="准备删除")
        other = self.create_sticky(date="2026-10-04", content="保留另一张")
        endpoint = f"/api/sticky-notes/{note['id']}"
        latest = self.client.put(endpoint, json={"content": "其他窗口刚更新", "revision": 0}).json()
        rejected = self.delete_sticky(note["id"], 0)
        self.assertEqual(rejected.status_code, 409, rejected.text)
        self.assertEqual(self.client.get(endpoint).json(), latest)

        deleted = self.delete_sticky(note["id"], 1)
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(deleted.json(), {"success": True})
        self.assertEqual(self.list_date(), [])
        self.assertEqual(self.list_date("2026-10-04"), [other])
        self.assertEqual(self.client.get(endpoint).status_code, 404)
        self.assertEqual(self.delete_sticky(note["id"], 1).status_code, 404)
        self.assertEqual(self.client.put(endpoint, json={"content": "旧窗口不能复活", "revision": 1}).status_code, 404)
        self.assertEqual(self.delete_sticky(other["id"], 0).status_code, 200)
        self.api.init_db()
        replacement = self.create_sticky(content="新建便签")
        self.assertGreater(int(replacement["id"]), int(other["id"]))
        self.assertEqual(self.list_date(), [replacement])

    def test_delete_strictly_validates_revision_without_writing(self):
        note = self.create_sticky(content="保留内容")
        endpoint = f"/api/sticky-notes/{note['id']}"
        for revision in [-1, True, False, 0.0, "0", None, [], {}, 9223372036854775808]:
            with self.subTest(revision=revision):
                response = self.delete_sticky(note["id"], revision)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIsInstance(response.json()["detail"], str)
        for body in [{}, {"revision": 0, "content": "不接受额外字段"}]:
            self.assertEqual(self.client.request("DELETE", endpoint, json=body).status_code, 422)
        self.assertEqual(self.client.delete(endpoint).status_code, 422)
        self.assertEqual(self.client.get(endpoint).json(), note)

    def test_delete_and_save_cannot_both_accept_the_same_revision(self):
        note = self.create_sticky(content="原文")
        endpoint = f"/api/sticky-notes/{note['id']}"
        barrier = threading.Barrier(2)

        def request_from_window(method):
            with TestClient(self.api.app) as client:
                barrier.wait(timeout=5)
                body = {"revision": 0, **({"content": "新内容"} if method == "PUT" else {})}
                response = client.request(method, endpoint, json=body)
                return method, response.status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(request_from_window, method) for method in ["PUT", "DELETE"]]
            results = dict(future.result(timeout=10) for future in futures)
        self.assertEqual(sum(status == 200 for status in results.values()), 1)
        if results["PUT"] == 200:
            self.assertEqual(results["DELETE"], 409)
            self.assertEqual(self.client.get(endpoint).json()["content"], "新内容")
        else:
            self.assertEqual(results["PUT"], 404)
            self.assertEqual(self.client.get(endpoint).status_code, 404)
            self.assertEqual(self.list_date(), [])

    def test_calendar_tasks_and_existing_notes_are_independent(self):
        regular = self.client.post("/api/notes", json={"title": "日记", "content": "正文", "category": "日记", "diaryDate": "2026-10-03"}).json()
        self.client.post(f"/api/notes/{regular['id']}/chat", json={"role": "user", "content": "旧对话"})
        task = self.client.post("/api/calendar/items", json={"title": "事项", "date": "2026-10-03"}).json()
        sticky = self.create_sticky(content="独立便签")
        self.client.delete(f"/api/calendar/items/{task['id']}")
        self.assertEqual(self.list_date(), [sticky])
        self.assertEqual(self.client.get(f"/api/notes/{regular['id']}").json(), regular)
        self.assertEqual(self.client.get(f"/api/notes/{regular['id']}/chat").json(), [{"role": "user", "content": "旧对话"}])
        self.assertEqual(self.client.delete(f"/api/sticky-notes/{sticky['id']}").status_code, 422)
        self.assertEqual(self.list_date(), [sticky])
        self.assertEqual(self.delete_sticky(sticky["id"], 0).status_code, 200)
        self.assertEqual(self.client.get(f"/api/notes/{regular['id']}").json(), regular)
        self.assertEqual(self.client.get(f"/api/notes/{regular['id']}/chat").json(), [{"role": "user", "content": "旧对话"}])

    def test_legacy_database_migration_keeps_old_records_and_is_idempotent(self):
        self.api.DB_PATH = Path(self.test_dir.name) / "legacy.db"
        with sqlite3.connect(self.api.DB_PATH) as conn:
            conn.execute("""CREATE TABLE notes (
                id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )""")
            conn.execute("INSERT INTO notes VALUES (7, '旧笔记', '旧正文', '2020-01-01', '2020-01-02')")
            conn.execute("""CREATE TABLE sticky_notes (
                id INTEGER PRIMARY KEY, date TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )""")
            conn.execute("INSERT INTO sticky_notes VALUES (4, '2020-01-01', '旧便签', '2020-01-01', '2020-01-02')")
        self.api.init_db()
        self.api.init_db()
        original = self.client.get("/api/notes/7").json()
        self.assertEqual(original["content"], "旧正文")
        self.assertEqual(original["category"], "未分类")
        old_sticky = self.client.get("/api/sticky-notes/4").json()
        self.assertEqual(old_sticky["content"], "旧便签")
        self.assertEqual(old_sticky["revision"], 0)
        self.assertEqual(old_sticky["color"], "yellow")
        self.assertEqual(old_sticky["createdAt"], "2020-01-01")
        saved = self.client.put("/api/sticky-notes/4", json={"content": "补充", "revision": 0})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.api.init_db()
        self.assertEqual(self.client.get("/api/sticky-notes/4").json(), saved.json())
        self.assertEqual(self.client.get("/api/notes/7").json(), original)
        self.assertEqual(self.delete_sticky("4", 1).status_code, 200)
        self.api.init_db()
        # This legacy table has no AUTOINCREMENT: retaining the tombstone must
        # still prevent a stale window for ID 4 from targeting a new note.
        replacement = self.create_sticky(content="新便签")
        self.assertGreater(int(replacement["id"]), 4)
        self.assertEqual(self.client.get("/api/sticky-notes/4").status_code, 404)
        self.assertEqual(self.client.put("/api/sticky-notes/4", json={"content": "旧请求", "revision": 1}).status_code, 404)
        self.assertEqual(self.client.get("/api/notes/7").json(), original)


if __name__ == "__main__":
    unittest.main()
