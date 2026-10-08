"""Windows driver contract/geometry tests, with no DLL, GUI, or database access.

Run: python3 -m unittest discover -s tests -p 'test_desktop_windows.py' -v
These mocks cannot establish real WebView2/IME behavior on a Windows desktop.
"""

import ctypes
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from desktop_sticky import Rect, StickyBridge, StickyWindowManager
from desktop_windows import (DragAnchor, MonitorInfo, Point, WinRect, WindowsFrame,
                             WindowsWindows, resized_frame)


class FakeAPI:
    def __init__(self):
        self.rects = {1: Rect(100, 100, 1200, 900), 0x123456789: Rect(1200, 600, 360, 360)}
        self.scales = {1: 1.5, 0x123456789: 1.5}
        self.work = [Rect(0, 0, 2560, 1440)]
        self.cursor = (1300, 650, True)
        self.top_calls = []
        self.reveals = []
        self.shown = True
        self.foreground = True
        self.hit = 1
        self.hit_point = None

    def rect(self, hwnd, client=False):
        return self.rects[hwnd]

    def scale(self, hwnd):
        return self.scales[hwnd]

    def screens(self):
        return self.work

    def set_rect(self, hwnd, rect):
        self.rects[hwnd] = rect

    def pointer(self):
        return self.cursor

    def topmost(self, hwnd, enabled):
        self.top_calls.append((hwnd, enabled))

    def reveal(self, hwnd):
        self.reveals.append(hwnd)

    def visible(self, hwnd):
        return self.shown

    def foreground_process(self, hwnd):
        return self.foreground

    def below_at(self, hwnd, point):
        self.hit_point = point
        return self.hit


class Window:
    def __init__(self, hwnd):
        self.native = SimpleNamespace(Handle=SimpleNamespace(ToInt64=lambda: hwnd))


class WindowsGeometryTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeAPI()
        self.driver = WindowsWindows(self.api)
        self.main, self.sticky = Window(1), Window(0x123456789)

    def test_win32_structures_have_windows_layout_even_when_test_host_uses_64_bit_longs(self):
        self.assertEqual(ctypes.sizeof(Point), 8)
        self.assertEqual(ctypes.sizeof(WinRect), 16)
        self.assertEqual(ctypes.sizeof(MonitorInfo), 40)

    def test_64_bit_handle_and_logical_size_are_not_truncated_or_double_scaled(self):
        self.assertEqual(self.driver.frame(self.sticky).width, 240)
        self.assertEqual(self.driver.set_size(self.sticky, 300), 300)
        self.assertEqual(self.api.rects[0x123456789], Rect(1200, 600, 450, 450))
        self.assertEqual(self.driver.frame(self.sticky).width, 300)
        self.driver.set_size(self.sticky, 900)
        self.assertEqual(self.api.rects[0x123456789].width, 630)

    def test_left_corners_keep_the_opposite_corner_fixed_at_150_percent_dpi(self):
        frame = self.driver.frame(self.sticky)
        upper, size = resized_frame(frame, (1200, 600), (1050, 600), 'top-left', self.api.work)
        self.assertEqual(size, 340)
        self.assertEqual(upper, Rect(1050, 450, 510, 510))
        lower, size = resized_frame(frame, (1200, 960), (1200, 1110), 'bottom-left', self.api.work)
        self.assertEqual(size, 340)
        self.assertEqual(lower, Rect(1050, 600, 510, 510))
        shrunk, size = resized_frame(frame, (1200, 600), (2000, 600), 'top-left', self.api.work)
        self.assertEqual(size, 200)
        self.assertEqual(shrunk, Rect(1260, 660, 300, 300))

    def test_resize_stays_on_original_negative_origin_monitor_and_does_not_cross_work_area(self):
        frame = WindowsFrame(Rect(-1920, 0, 480, 480), 2)
        screens = [Rect(-1920, 0, 1920, 1040), Rect(0, 0, 2560, 1440)]
        rect, size = resized_frame(frame, (-1920, 0), (-3000, -900), 'top-left', screens)
        self.assertEqual((rect, size), (frame.raw, 240))
        self.api.work = screens
        self.api.rects[0x123456789] = frame.raw
        self.api.scales[0x123456789] = 2
        self.driver.move_to_pointer(self.sticky, DragAnchor(.5, .1), (-3000, -100, False))
        self.assertEqual(self.api.rects[0x123456789], frame.raw)

    def test_drag_anchor_tracks_window_fraction_when_monitor_dpi_changes(self):
        anchor = self.driver.drag_anchor(self.sticky, (1300, 650, True))
        self.api.rects[0x123456789] = Rect(1200, 600, 480, 480)
        self.api.scales[0x123456789] = 2
        self.driver.move_to_pointer(self.sticky, anchor, (1400, 750, False))
        moved = self.api.rects[0x123456789]
        self.assertAlmostEqual(moved.x, 1400 - 100 / 360 * 480)
        self.assertAlmostEqual(moved.y, 750 - 50 / 360 * 480)
        self.assertEqual(moved.width, 480)
        # Physical OS cursor coordinates win over ambiguous CSS screenX/Y.
        self.assertEqual(self.driver.pointer_state((1, 2)), self.api.cursor)

    def test_dock_mapping_checks_dpi_visibility_foreground_and_occlusion(self):
        self.api.scales[1] = 2
        slot = Rect(20, 30, 240, 240)
        self.assertTrue(self.driver.dock_near(self.main, self.sticky, slot, (200, 200, False)))
        self.assertEqual(self.api.hit_point, (200, 200))
        self.assertFalse(self.driver.dock_near(self.main, self.sticky, slot, (1000, 200, False)))
        self.assertFalse(self.driver.dock_near(self.main, self.sticky, Rect(900, 0, 240, 240), (200, 200, False)))
        self.api.hit = 99
        self.assertFalse(self.driver.dock_near(self.main, self.sticky, slot, (200, 200, False)))
        self.api.hit = 1
        self.api.shown = False
        self.assertFalse(self.driver.dock_near(self.main, self.sticky, slot, (200, 200, False)))
        self.api.shown = True
        self.api.foreground = False
        self.assertFalse(self.driver.dock_near(self.main, self.sticky, slot, (200, 200, False)))

    def test_ime_temporarily_releases_topmost_and_reveal_does_not_override_composition(self):
        self.driver.reveal(self.sticky)
        self.driver.set_composing(self.sticky, True)
        self.driver.reveal(self.sticky)
        self.driver.set_composing(self.sticky, False)
        self.driver.reveal_main(self.main)
        self.assertEqual(self.api.top_calls, [
            (0x123456789, True), (0x123456789, False),
            (0x123456789, False), (0x123456789, True), (1, False),
        ])
        # Only explicit reveal changes focus, never an IME event.
        self.assertEqual(self.api.reveals, [0x123456789, 0x123456789, 1])

    def test_windows_platform_selects_native_driver_without_loading_cocoa(self):
        with patch('desktop_sticky.sys.platform', 'win32'), \
                patch('desktop_windows.WindowsWindows', return_value=self.driver):
            manager = StickyWindowManager('http://localhost', lambda _: True, object())
        self.assertIs(manager._native, self.driver)

    def test_ime_bridge_is_scoped_to_child_window_and_accepts_only_booleans(self):
        manager = StickyWindowManager('http://localhost', lambda _: True, object(), self.driver)
        manager._windows['1'] = self.sticky
        child = StickyBridge(manager, '1')
        self.assertTrue(child.set_sticky_composing('1', True)['ok'])
        self.assertFalse(child.set_sticky_composing('2', True)['ok'])
        self.assertFalse(child.set_sticky_composing('1', 'false')['ok'])
        self.assertFalse(manager.bridge.set_sticky_composing('1', False)['ok'])
        self.assertEqual(self.api.top_calls, [(0x123456789, False)])


if __name__ == '__main__':
    unittest.main()
