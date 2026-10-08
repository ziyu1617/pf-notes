"""Native window lifecycle tests with no GUI, server, or user database access."""

import threading
import unittest
import weakref
import ast
import json
import shutil
import sqlite3
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from desktop_sticky import (CocoaWindows, Rect, StickyBridge, StickyWindowManager,
                            clamp_position, client_to_screen, resize_square, near_rect)


class Event:
    def __init__(self):
        self.handlers = []
        self.fired = False

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self

    def set(self):
        self.fired = True
        return any(handler() is False for handler in list(self.handlers))

    def is_set(self):
        return self.fired

    def wait(self, timeout=None):
        return self.fired


class Window:
    def __init__(self):
        self.events = SimpleNamespace(closing=Event(), closed=Event(), loaded=Event(), shown=Event())
        self.events.shown.set()
        self.scripts = []
        self.destroyed = False
        self.flush_ok = True

    def evaluate_js(self, script, callback=None):
        self.scripts.append(script)
        if callback:
            callback(self.flush_ok)

    def destroy(self):
        if not self.events.closing.set():
            self.destroyed = True
            self.events.closed.set()


class Windows:
    def __init__(self):
        self.created = []

    def create_window(self, title, url, **kwargs):
        window = Window()
        self.created.append((window, title, url, kwargs))
        return window


class Native:
    def __init__(self):
        self.placements = []
        self.moves = 0
        self.revealed = []
        self.main_revealed = []
        self.pointer_reads = 0
        self.last_pointer = None
        self.actions = []

    def place(self, window, source, point):
        self.placements.append((window, source, point))
        self.actions.append('place')

    def reveal(self, window):
        self.revealed.append(window)
        self.actions.append('reveal')

    def reveal_main(self, window):
        self.main_revealed.append(window)

    def pointer_state(self, point=None):
        self.pointer_reads += 1
        return 800 + self.pointer_reads, 600, self.pointer_reads < 2

    def drag_anchor(self, window, pointer):
        return 140, 15

    def move_to_pointer(self, window, anchor, pointer):
        self.moves += 1
        self.last_pointer = pointer
        self.actions.append('move')

    def install_quit_handler(self, callback):
        self.quit = callback


class StickyWindowTests(unittest.TestCase):
    def setUp(self):
        self.webview = Windows()
        self.native = Native()
        self.known = {1, 2}
        self.manager = StickyWindowManager('http://127.0.0.1:8015/',
                                           self.known.__contains__, self.webview, self.native)
        # Execute event work directly; no OS window or real JS exists here.
        self.manager._background = lambda action: action()
        self.main = Window()
        self.manager.attach_main(self.main)

    def detach(self, note_id='1'):
        self.assertEqual(self.manager.bridge.detach_sticky(note_id), {'ok': True})
        return self.webview.created[-1][0]

    def test_window_is_fixed_square_topmost_and_scoped(self):
        self.detach()
        window, _, url, options = self.webview.created[0]
        self.assertEqual(url, 'http://127.0.0.1:8015/sticky.html?id=1')
        self.assertEqual((options['width'], options['height']), (240, 240))
        self.assertEqual(options['min_size'], (200, 200))
        self.assertTrue(options['on_top'])
        self.assertTrue(options['frameless'])
        self.assertFalse(options['resizable'])
        self.assertFalse(options['easy_drag'])
        self.assertTrue(options['hidden'])
        self.assertEqual(options['js_api'].get_sticky_windows(), ['1'])
        self.assertFalse(options['js_api'].detach_sticky('2')['ok'])
        self.assertFalse(options['js_api'].return_sticky('2')['ok'])
        self.assertFalse(options['js_api'].drag_sticky('2')['ok'])
        self.assertFalse(window.destroyed)

    def test_cocoa_creation_does_not_enable_pywebview_status_window_level(self):
        native = CocoaWindows.__new__(CocoaWindows)
        native.place = lambda *args: None
        native.reveal = lambda *args: None
        self.manager._native = native
        window = self.detach()
        self.assertFalse(self.webview.created[0][3]['on_top'])
        self.assertTrue(self.webview.created[0][3]['hidden'])
        window.events.loaded.set()
        self.assertTrue(self.manager.bridge.detach_sticky('1')['ok'])
        self.assertEqual(len(self.webview.created), 1)

    def test_invalid_ids_coordinates_and_missing_records_do_not_create_windows(self):
        for note_id in [True, 1.0, 0, -1, '', '01', '1;alert(1)', '9223372036854775808', None]:
            with self.subTest(note_id=note_id):
                self.assertFalse(self.manager.bridge.detach_sticky(note_id)['ok'])
        for point in [(True, 1), (1, None), (float('nan'), 1), (1, float('inf')), (10**8, 0), ('1', 1)]:
            with self.subTest(point=point):
                self.assertFalse(self.manager.bridge.detach_sticky('1', *point)['ok'])
        self.assertFalse(self.manager.bridge.detach_sticky('3')['ok'])
        self.assertEqual(self.webview.created, [])

    def test_existing_and_concurrent_detach_never_duplicate(self):
        entered, release = threading.Event(), threading.Event()
        original = self.webview.create_window

        def create(*args, **kwargs):
            entered.set()
            self.assertTrue(release.wait(2))
            return original(*args, **kwargs)

        self.webview.create_window = create
        worker = threading.Thread(target=lambda: self.manager.bridge.detach_sticky('1'))
        worker.start()
        self.assertTrue(entered.wait(2))
        self.assertEqual(self.manager.bridge.get_sticky_windows(), ['1'])
        self.assertTrue(self.manager.bridge.detach_sticky('1')['ok'])
        self.assertFalse(self.manager.bridge.return_sticky('1')['ok'])
        release.set()
        worker.join(2)
        self.assertFalse(worker.is_alive())
        window = self.webview.created[0][0]
        # A duplicate request must not reveal an unpositioned loading window.
        self.assertTrue(self.manager.bridge.detach_sticky('1')['ok'])
        self.assertEqual(self.native.revealed, [])
        window.events.loaded.set()
        self.assertTrue(self.manager.bridge.detach_sticky('1')['ok'])
        self.assertEqual(len(self.webview.created), 1)
        self.assertEqual(self.native.revealed, [window, window])

    def test_failed_creation_releases_reservation_for_retry(self):
        create = self.webview.create_window
        self.webview.create_window = lambda *args, **kwargs: None
        with self.assertLogs('desktop_sticky', level='ERROR'):
            self.assertFalse(self.manager.bridge.detach_sticky('1')['ok'])
        self.assertEqual(self.manager.bridge.get_sticky_windows(), [])
        self.webview.create_window = create
        self.assertTrue(self.manager.bridge.detach_sticky('1')['ok'])

    def test_native_close_requests_save_and_return_never_deletes_record(self):
        window = self.detach()
        window.destroy()  # OS close request is vetoed until frontend finishes.
        self.assertFalse(window.destroyed)
        self.assertIn('sticky-return-requested', window.scripts[-1])
        self.assertEqual(self.manager.bridge.get_sticky_windows(), ['1'])
        self.assertTrue(StickyBridge(self.manager, '1').return_sticky('1')['ok'])
        self.assertTrue(window.destroyed)
        self.assertEqual(self.manager.bridge.get_sticky_windows(), [])
        self.assertEqual(self.known, {1, 2})
        self.assertTrue(any('sticky-windows-changed' in script for script in self.main.scripts))
        self.assertTrue(self.manager.bridge.return_sticky('1')['ok'])

    def test_failed_main_save_keeps_main_and_sticky_windows(self):
        sticky = self.detach()
        self.main.flush_ok = False
        with patch('desktop_sticky.threading.Timer'):
            self.main.destroy()
        self.assertFalse(self.main.destroyed)
        self.assertFalse(sticky.destroyed)
        self.assertIn('smartNotesFlushSticky', self.main.scripts[-1])

    def test_closing_main_after_save_leaves_detached_sticky_alive(self):
        sticky = self.detach()
        with patch('desktop_sticky.threading.Timer'):
            self.main.destroy()
        self.assertTrue(self.main.destroyed)
        self.assertFalse(sticky.destroyed)
        self.assertEqual(self.manager.bridge.get_sticky_windows(), ['1'])
        self.assertTrue(self.manager.bridge.return_sticky('1')['ok'])
        self.assertTrue(sticky.destroyed)

    def test_repeated_activation_reveals_existing_main_without_sticky_styling(self):
        factory = MagicMock()
        self.assertTrue(self.manager.open_main_window(factory))
        self.assertTrue(self.manager.open_main_window(factory))
        factory.assert_not_called()
        self.assertEqual(self.native.main_revealed, [self.main, self.main])
        self.assertEqual(self.native.revealed, [])

    def test_reopen_main_resets_close_state_and_ignores_old_closed_callback(self):
        sticky = self.detach()
        with patch('desktop_sticky.threading.Timer'):
            self.main.destroy()
        replacement = Window()
        factory = MagicMock(return_value=replacement)
        self.assertTrue(self.manager.open_main_window(factory))
        factory.assert_called_once_with()
        self.main.events.closed.set()  # Delayed old pywebview event handler.
        self.assertIs(self.manager._main_window, replacement)
        replacement.flush_ok = False
        with patch('desktop_sticky.threading.Timer'):
            replacement.destroy()
        self.assertFalse(replacement.destroyed)
        self.assertIn('smartNotesFlushSticky', replacement.scripts[-1])
        self.assertFalse(sticky.destroyed)

    def test_concurrent_reopen_creates_only_one_main(self):
        self.main.events.closed.set()
        entered, release = threading.Event(), threading.Event()
        replacement, results = Window(), []

        def create():
            entered.set()
            self.assertTrue(release.wait(2))
            return replacement

        factory = MagicMock(side_effect=create)
        workers = [threading.Thread(target=lambda: results.append(
            self.manager.open_main_window(factory))) for _ in range(2)]
        workers[0].start()
        self.assertTrue(entered.wait(2))
        workers[1].start()
        release.set()
        for worker in workers:
            worker.join(2)
            self.assertFalse(worker.is_alive())
        self.assertEqual(results, [True, True])
        factory.assert_called_once_with()
        self.assertIs(self.manager._main_window, replacement)

    def test_activate_cancels_pending_save_and_late_close_reply(self):
        callbacks = []
        self.main.evaluate_js = lambda script, callback=None: callbacks.append(callback)
        with patch('desktop_sticky.threading.Timer'):
            self.main.destroy()
        self.assertTrue(self.manager.open_main_window(MagicMock()))
        callbacks[0](True)
        self.assertFalse(self.main.destroyed)
        self.assertFalse(self.manager._main_save_pending)

    def test_flush_callback_defers_destroy_and_activation_can_cancel_it(self):
        queued = []
        self.manager._background = queued.append
        with patch('desktop_sticky.threading.Timer'):
            self.main.destroy()
        queued.pop(0)()  # Renderer flush callback queues, never destroys inline.
        self.assertFalse(self.main.destroyed)
        self.assertEqual(len(queued), 1)
        self.assertTrue(self.manager.open_main_window(MagicMock()))
        queued.pop(0)()
        self.assertFalse(self.main.destroyed)

    def test_activation_waits_for_dispatched_close_before_reopening(self):
        queued = []
        self.manager._background = queued.append
        with patch('desktop_sticky.threading.Timer'):
            self.main.destroy()
        queued.pop(0)()
        self.main.destroy = MagicMock()  # Cocoa close is queued, not yet delivered.
        queued.pop(0)()
        closed = threading.Event()
        entered = threading.Event()

        def wait_closed(timeout):
            entered.set()
            return closed.wait(timeout)

        self.main.events.closed.wait = wait_closed
        replacement = Window()
        factory = MagicMock(return_value=replacement)
        results = []
        worker = threading.Thread(target=lambda: results.append(
            self.manager.open_main_window(factory)))
        worker.start()
        self.assertTrue(entered.wait(2))
        factory.assert_not_called()
        self.main.events.closed.set()
        closed.set()
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(results, [True])
        self.main.events.closed.set()
        self.assertIs(self.manager._main_window, replacement)
        factory.assert_called_once_with()

    def test_quit_requests_each_sticky_save_before_close(self):
        one, two = self.detach('1'), self.detach('2')
        self.main.flush_ok = False
        with patch('desktop_sticky.threading.Timer'):
            self.manager.request_quit()
        self.assertFalse(one.destroyed)
        self.assertFalse(two.destroyed)
        self.assertIn('sticky-return-requested', one.scripts[-1])
        self.assertIn('sticky-return-requested', two.scripts[-1])

    def test_late_flush_result_after_timeout_cannot_close_window(self):
        callbacks = []
        self.main.evaluate_js = lambda script, callback=None: callbacks.append(callback)
        with patch('desktop_sticky.threading.Timer') as timer:
            self.main.destroy()
            timer.call_args.args[1]()
        callbacks[0](True)
        self.assertFalse(self.main.destroyed)

    def test_load_does_not_reset_window_after_dock_drag(self):
        queued = []
        self.manager._background = queued.append
        self.assertTrue(self.manager.bridge.drag_sticky('1')['ok'])
        window = self.webview.created[0][0]
        self.assertTrue(self.webview.created[0][3]['hidden'])
        self.assertEqual(self.native.actions, [])
        next(action for action in queued if action.__name__ == 'capture')()
        # Mouse release is captured while the page is still loading. Later
        # pointer movement must not affect the window's first position.
        self.assertEqual(self.native.pointer_reads, 2)
        self.native.pointer_state = lambda *args: (9999, 9999, False)
        window.events.shown.fired = False
        window.events.loaded.set()
        self.assertEqual(self.native.actions, [])
        next(action for action in queued if action.__name__ == 'follow')()
        self.assertEqual(self.native.actions, ['move', 'reveal'])
        self.assertEqual(self.native.last_pointer, (802, 600, False))
        window.events.loaded.set()
        self.assertEqual(self.native.placements, [])

    def test_placement_runs_once_and_preserves_requested_position(self):
        self.assertTrue(self.manager.bridge.detach_sticky('1', -200, 30)['ok'])
        window = self.webview.created[0][0]
        self.assertEqual(self.native.actions, [])
        window.events.loaded.set()
        window.events.loaded.set()
        self.assertEqual(self.native.placements, [(window, self.main, (-200.0, 30.0))])
        self.assertEqual(self.native.actions, ['place', 'reveal'])

    @unittest.skipUnless(shutil.which('node'), 'Node is needed for the injected header event regression')
    def test_native_header_threshold_preserves_clicks_and_cleans_listeners(self):
        native = CocoaWindows.__new__(CocoaWindows)
        native.place = lambda *args: None
        native.reveal = lambda *args: None
        self.manager._native = native
        window = self.detach()
        window.events.loaded.set()
        script = window.scripts[-1]
        harness = r'''
const assert = require('node:assert/strict');
const vm = require('node:vm');
const source = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event = {}) { for (const callback of [...(this.listeners.get(type) || [])]) callback(event); }
  count(type) { return this.listeners.get(type)?.size || 0; }
}
class Element {
  constructor(blocked = false) { this.blocked = blocked; }
  closest(selector) { return selector === '.pywebview-drag-region' || this.blocked ? this : null; }
}
const document = new Target(), window = new Target(), drags = [];
window.pywebview = {api: {drag_sticky: (...args) => drags.push(args)}};
vm.runInNewContext(source, {document, window, Element, Math});
function event(overrides = {}) {
  return {button: 0, buttons: 1, target: new Element(), clientX: 10, clientY: 10,
    screenX: 120, screenY: 200, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }, ...overrides};
}
function clean() {
  assert.equal(document.count('mousemove'), 0);
  assert.equal(document.count('mouseup'), 0);
  assert.equal(window.count('blur'), 0);
}
// Ordinary click and double-click must not have their default action cancelled.
for (let n = 0; n < 2; n++) {
  const down = event(); document.emit('mousedown', down);
  assert.equal(down.prevented, false);
  const smallMove = event({clientX: 18}); document.emit('mousemove', smallMove);
  assert.equal(smallMove.prevented, false);
  document.emit('mouseup'); clean();
}
assert.equal(drags.length, 0);
let doubleClicks = 0;
document.addEventListener('dblclick', () => doubleClicks++);
document.emit('dblclick', event()); assert.equal(doubleClicks, 1);
// Nine pixels starts exactly one native gesture, at the latest screen point.
document.emit('mousedown', event());
const move = event({clientX: 19}); document.emit('mousemove', move);
assert.equal(move.prevented, true); assert.deepEqual(drags, [['1', 120, 200]]); clean();
document.emit('mousemove', move); assert.equal(drags.length, 1);
// Right-click and controls/menu/editor descendants remain untouched.
for (const down of [event({button: 2}), event({target: new Element(true)})]) {
  document.emit('mousedown', down); assert.equal(down.stopped, false); clean();
}
document.emit('mousedown', event()); window.emit('blur'); clean();
document.emit('mousedown', event()); window.emit('pagehide'); clean();
// Missed mouseup is also cleaned when the next movement reports no buttons.
document.emit('mousedown', event()); document.emit('mousemove', event({buttons: 0})); clean();
// Repeated injection must not add duplicate handlers.
vm.runInNewContext(source, {document, window, Element, Math});
assert.equal(document.count('mousedown'), 1);
'''
        result = subprocess.run([shutil.which('node'), '-e', harness], input=json.dumps(script),
                                text=True, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)


class StickyLookupTests(unittest.TestCase):
    def test_native_lookup_excludes_soft_deleted_notes_without_importing_app(self):
        # Loading app.py imports API initialization; compile only this pure lookup
        # function so the test cannot initialize the user's database or GUI.
        path = Path(__file__).resolve().parents[1] / 'app.py'
        source = ast.parse(path.read_text())
        function = next(node for node in source.body
                        if isinstance(node, ast.FunctionDef) and node.name == 'sticky_exists')

        def database():
            conn = sqlite3.connect(':memory:')
            conn.execute('CREATE TABLE sticky_notes (id INTEGER PRIMARY KEY, deleted_at TEXT)')
            conn.execute('INSERT INTO sticky_notes VALUES (1, NULL)')
            conn.execute("INSERT INTO sticky_notes VALUES (2, '2026-10-03 12:00:00')")
            return conn

        namespace = {'get_db': database}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), 'exec'), namespace)
        self.assertTrue(namespace['sticky_exists'](1))
        self.assertFalse(namespace['sticky_exists'](2))
        self.assertFalse(namespace['sticky_exists'](3))


class ScreenBoundsTests(unittest.TestCase):
    def test_negative_origin_left_display_and_screen_gap(self):
        screens = [Rect(0, 40, 1440, 836), Rect(-1920, -160, 1920, 1040)]
        self.assertEqual(clamp_position(-2100, -300, screens), (-1920, -160))
        self.assertEqual(clamp_position(1300, 800, screens), (1200, 636))
        self.assertEqual(clamp_position(-600, 200, screens), (-600, 200))

    def test_above_display_and_small_visible_area(self):
        screens = [Rect(0, 0, 1440, 876), Rect(200, 900, 1000, 700)]
        self.assertEqual(clamp_position(1100, 1500, screens), (960, 1360))
        self.assertEqual(clamp_position(1, 1, [Rect(0, 0, 200, 200)]), (0, 0))


class CocoaAppearanceTests(unittest.TestCase):
    def setUp(self):
        self.driver = CocoaWindows.__new__(CocoaWindows)
        self.driver._configured = weakref.WeakSet()
        self.driver._main = lambda action: action()
        self.application = MagicMock()
        self.driver._appkit = SimpleNamespace(
            NSFloatingWindowLevel=3,
            NSNormalWindowLevel=0,
            NSWindowCollectionBehaviorMoveToActiveSpace=2,
            NSWindowCollectionBehaviorCanJoinAllSpaces=1,
            NSWindowCollectionBehaviorFullScreenAuxiliary=256,
            NSApplication=SimpleNamespace(sharedApplication=lambda: self.application),
            NSColor=SimpleNamespace(clearColor=lambda: 'clear'))
        self.window = Window()
        self.window.native = MagicMock()
        self.window.native.collectionBehavior.return_value = 2 | 64

    def test_main_reveal_uses_normal_level_without_sticky_configuration(self):
        self.driver.reveal_main(self.window)
        self.window.native.setLevel_.assert_called_once_with(0)
        self.window.native.setCollectionBehavior_.assert_not_called()
        self.window.native.contentView.assert_not_called()
        self.window.native.deminiaturize_.assert_called_once_with(None)
        self.window.native.makeKeyAndOrderFront_.assert_called_once_with(None)
        self.application.activateIgnoringOtherApps_.assert_called_once_with(True)

    def test_all_spaces_round_content_preserves_external_shadow(self):
        driver, window = self.driver, self.window
        native = window.native
        native.collectionBehavior.return_value = 2 | 64
        layer = native.contentView.return_value.layer.return_value
        driver._configure(window)
        native.setCollectionBehavior_.assert_called_once_with(1 | 64 | 256)
        native.setHidesOnDeactivate_.assert_called_once_with(False)
        layer.setCornerRadius_.assert_called_once_with(3.0)
        layer.setMasksToBounds_.assert_called_once_with(True)
        native.setOpaque_.assert_called_once_with(False)
        native.setBackgroundColor_.assert_called_once_with('clear')
        native.setHasShadow_.assert_called_once_with(True)
        native.setLevel_.assert_called_once_with(3)
        driver._configure(window)
        self.assertEqual(layer.setCornerRadius_.call_count, 1)
        self.assertEqual([args.args[0] for args in native.setLevel_.call_args_list], [3, 3])

    def test_reveal_reapplies_floating_level_after_activation_without_on_top_setter(self):
        class GuardedWindow(Window):
            @property
            def on_top(self):
                return False

            @on_top.setter
            def on_top(self, value):
                raise AssertionError('Cocoa must not schedule pywebview set_on_top')

        window = GuardedWindow()
        window.native = self.window.native
        self.driver._configure(window)
        # Pretend a platform activation callback changes the window level. The
        # native reveal must leave it floating even for an already styled card.
        current_level = []
        window.native.setLevel_.side_effect = current_level.append
        self.application.activateIgnoringOtherApps_.side_effect = lambda _: current_level.append(25)
        self.driver.reveal(window)
        self.driver.reveal(window)
        self.assertEqual(current_level, [3, 25, 3, 3, 25, 3])
        self.assertEqual(window.native.deminiaturize_.call_count, 2)
        self.assertEqual(window.native.makeKeyAndOrderFront_.call_count, 2)
        self.assertEqual(window.native.contentView.return_value.layer.return_value.setCornerRadius_.call_count, 1)


if __name__ == '__main__':
    unittest.main()
