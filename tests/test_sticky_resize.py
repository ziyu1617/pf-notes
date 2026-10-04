"""Geometry, scoped bridge and closing regressions; no desktop or data access."""
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from desktop_sticky import (Rect, StickyBridge, StickyWindowManager,
                            client_to_screen, resize_square, near_rect)
from test_desktop_sticky import Window, Native, Windows


class ResizeGeometryTests(unittest.TestCase):
    def test_left_corners_keep_opposite_corner_fixed(self):
        frame = Rect(300, 200, 240, 240)
        self.assertEqual(resize_square(frame, (300, 440), (270, 470), 'top-left'),
                         Rect(270, 200, 270, 270))
        self.assertEqual(resize_square(frame, (300, 200), (260, 160), 'bottom-left'),
                         Rect(260, 160, 280, 280))
        self.assertEqual(resize_square(frame, (300, 200), (320, 220), 'bottom-left'),
                         Rect(320, 220, 220, 220))

    def test_size_limits_and_screen_edge_do_not_move_fixed_corner(self):
        frame = Rect(30, 40, 240, 240)
        self.assertEqual(resize_square(frame, (30, 280), (-999, 999), 'top-left').width, 420)
        self.assertEqual(resize_square(frame, (30, 280), (999, -999), 'top-left').width, 200)
        resized = resize_square(frame, (30, 280), (-60, 370), 'top-left', [Rect(0, 0, 800, 600)])
        self.assertEqual(resized, Rect(0, 40, 270, 270))

    def test_dock_conversion_uses_content_origin_and_zoom_not_retina_scale(self):
        client = Rect(800, 300, 240, 240)
        content = Rect(-1440, 100, 1200, 800)
        self.assertEqual(client_to_screen(client, content), Rect(-640, 360, 240, 240))
        self.assertEqual(client_to_screen(Rect(20, 30, 100, 100), content, 1.5),
                         Rect(-1410, 705, 150, 150))
        self.assertTrue(near_rect((-645, 400), Rect(-640, 360, 240, 240)))
        self.assertFalse(near_rect((-700, 400), Rect(-640, 360, 240, 240)))


class ResizeBridgeTests(unittest.TestCase):
    def setUp(self):
        self.native = Native()
        self.native.set_size = MagicMock(side_effect=lambda window, size: size)
        self.windows = Windows()
        self.manager = StickyWindowManager('http://test', lambda i: i == 1, self.windows, self.native)
        self.manager._background = lambda action: action()
        self.main = Window()
        self.manager.attach_main(self.main)

    def test_default_size_and_updated_size_match_created_window(self):
        self.assertEqual(self.manager.bridge.set_sticky_size('1', 276), {'ok': True, 'size': 276})
        self.manager.bridge.detach_sticky('1')
        window, _, _, options = self.windows.created[0]
        self.assertEqual((options['width'], options['height']), (276, 276))
        window.events.loaded.set()
        self.assertEqual(self.manager.bridge.set_sticky_size('1', 180), {'ok': True, 'size': 200})
        self.native.set_size.assert_called_once_with(window, 200)
        self.assertIn('sticky-size-changed', window.scripts[-1])
        self.assertIn('"size": 200', self.main.scripts[-1])

    def test_child_cannot_resize_other_note_or_move_main_dock(self):
        child = StickyBridge(self.manager, '1')
        self.assertFalse(child.set_sticky_size('2', 240)['ok'])
        self.assertFalse(child.resize_sticky('2', 'top-left', 10, 10)['ok'])
        self.assertFalse(child.set_sticky_dock('1', None)['ok'])
        for invalid in (True, None, '240', float('nan')):
            self.assertFalse(child.set_sticky_size('1', invalid)['ok'])
        self.assertFalse(child.resize_sticky('1', 'middle', 0, 0)['ok'])
        self.assertFalse(self.manager.bridge.set_sticky_dock('1', {'x':0})['ok'])
        self.assertFalse(self.manager.bridge.set_sticky_dock('1', {'x':0,'y':0,'width':-1,'height':240})['ok'])

    def test_drop_requires_live_home_then_requests_save_not_destruction(self):
        self.manager.bridge.detach_sticky('1')
        window = self.windows.created[0][0]
        self.native.dock_near = MagicMock(return_value=True)
        bounds = {'x': 200, 'y': 300, 'width': 240, 'height': 240}
        self.manager.bridge.set_sticky_dock('1', bounds)
        self.main.evaluate_js = lambda script: bounds
        self.assertTrue(self.manager._try_snap('1', window, (220, 350)))
        self.assertIn('sticky-return-requested', window.scripts[-1])
        self.assertFalse(window.destroyed)
        self.main.evaluate_js = lambda script: None
        self.assertFalse(self.manager._try_snap('1', window, (220, 350)))
        self.manager.bridge.set_sticky_dock('1', None)
        self.assertFalse(self.manager._try_snap('1', window, (220, 350)))

    def test_hidden_main_cannot_snap_and_initial_detach_does_not_snap(self):
        self.native.dock_near = MagicMock(return_value=False)
        self.manager.bridge.set_sticky_dock('1', {'x':200,'y':300,'width':240,'height':240})
        self.manager.bridge.detach_sticky('1')
        window = self.windows.created[0][0]
        self.assertFalse(self.manager._try_snap('1', window, (220, 350)))
        self.assertFalse(any('sticky-return-requested' in script for script in window.scripts))

    def test_resize_tracks_release_and_publishes_final_square_size(self):
        self.manager.bridge.detach_sticky('1')
        window = self.windows.created[0][0]
        window.events.loaded.set()
        self.native.frame = lambda window: Rect(100, 100, 240, 240)
        self.native.screen_point = lambda point: point
        states = iter([(100, 340, True), (80, 360, False)])
        self.native.pointer_state = lambda *args: next(states)
        self.native.resize_to_pointer = lambda window, frame, start, pointer, corner: resize_square(frame, start, pointer, corner).width
        self.assertTrue(self.manager.bridge.resize_sticky('1', 'top-left', 100, 340)['ok'])
        self.assertEqual(self.manager._sizes['1'], 260)
        self.assertEqual(self.manager._resizing, set())
        self.assertIn('"size": 260', window.scripts[-1])


class CloseWaitTests(unittest.TestCase):
    def test_renderer_disappearing_releases_bridge_reply_thread(self):
        entered, release, done = threading.Event(), threading.Event(), threading.Event()
        window = Window()
        result = []
        def blocked(script):
            entered.set()
            release.wait(2)
        window.evaluate_js = blocked
        StickyWindowManager._guard_window_js(window)
        worker = threading.Thread(target=lambda: (result.append(window.evaluate_js('reply')), done.set()))
        worker.start()
        try:
            self.assertTrue(entered.wait(1))
            window.events.closed.set()
            self.assertTrue(done.wait(1))
            self.assertEqual(result, [None])
        finally:
            release.set()
            worker.join(2)
        self.assertFalse(worker.is_alive())

    def test_closed_window_never_calls_renderer_again(self):
        window = Window()
        evaluate = MagicMock()
        window.evaluate_js = evaluate
        StickyWindowManager._guard_window_js(window)
        window.events.closed.set()
        self.assertIsNone(window.evaluate_js('reply'))
        evaluate.assert_not_called()

    def test_guard_preserves_results_exceptions_and_async_callback(self):
        window = Window()
        callback = MagicMock()
        window.evaluate_js = lambda script, callback=None: callback(True) if callback else {'value': 4}
        StickyWindowManager._guard_window_js(window)
        self.assertEqual(window.evaluate_js('read'), {'value': 4})
        window.evaluate_js('flush', callback=callback)
        callback.assert_called_once_with(True)


if __name__ == '__main__':
    unittest.main()
