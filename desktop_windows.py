"""Windows sticky geometry using Win32 handles supplied by pywebview WinForms.

No GUI or Windows DLL is loaded at import time. The injected API permits useful
geometry/lifecycle tests on macOS; native Windows/WebView2 still needs release QA.
"""

import ctypes
import math
import weakref
from dataclasses import dataclass

from desktop_sticky import Rect, MIN_SIZE, clamp_position, contains_rect, near_rect, sticky_size


class Point(ctypes.Structure):
    _fields_ = [('x', ctypes.c_int32), ('y', ctypes.c_int32)]


class WinRect(ctypes.Structure):
    _fields_ = [('left', ctypes.c_int32), ('top', ctypes.c_int32),
                ('right', ctypes.c_int32), ('bottom', ctypes.c_int32)]


class MonitorInfo(ctypes.Structure):
    _fields_ = [('cbSize', ctypes.c_uint32), ('rcMonitor', WinRect),
                ('rcWork', WinRect), ('dwFlags', ctypes.c_uint32)]


class Win32API:
    def __init__(self):
        self.user = ctypes.WinDLL('user32', use_last_error=True)
        hwnd, integer, uint, boolean = ctypes.c_void_p, ctypes.c_int32, ctypes.c_uint32, ctypes.c_int32
        signatures = {
            'GetWindowRect': ([hwnd, ctypes.POINTER(WinRect)], boolean),
            'GetClientRect': ([hwnd, ctypes.POINTER(WinRect)], boolean),
            'ClientToScreen': ([hwnd, ctypes.POINTER(Point)], boolean),
            'GetCursorPos': ([ctypes.POINTER(Point)], boolean),
            'GetAsyncKeyState': ([integer], ctypes.c_int16),
            'GetDpiForWindow': ([hwnd], uint),
            'SetWindowPos': ([hwnd, hwnd, integer, integer, integer, integer, uint], boolean),
            'ShowWindow': ([hwnd, integer], boolean),
            'SetForegroundWindow': ([hwnd], boolean),
            'GetForegroundWindow': ([], hwnd),
            'IsWindowVisible': ([hwnd], boolean),
            'IsIconic': ([hwnd], boolean),
            'GetWindowThreadProcessId': ([hwnd, ctypes.POINTER(uint)], uint),
            'GetWindow': ([hwnd, uint], hwnd),
            'GetMonitorInfoW': ([hwnd, ctypes.POINTER(MonitorInfo)], boolean),
        }
        for name, (arguments, result) in signatures.items():
            function = getattr(self.user, name)
            function.argtypes, function.restype = arguments, result
        self._monitor_callback = ctypes.WINFUNCTYPE(boolean, hwnd, hwnd, ctypes.POINTER(WinRect), ctypes.c_ssize_t)
        self.user.EnumDisplayMonitors.argtypes = [hwnd, ctypes.POINTER(WinRect), self._monitor_callback, ctypes.c_ssize_t]
        self.user.EnumDisplayMonitors.restype = boolean

    @staticmethod
    def _check(result):
        if not result:
            raise ctypes.WinError(ctypes.get_last_error())

    def rect(self, hwnd, client=False):
        result = WinRect()
        self._check((self.user.GetClientRect if client else self.user.GetWindowRect)(hwnd, ctypes.byref(result)))
        origin = Point(result.left, result.top)
        if client:
            self._check(self.user.ClientToScreen(hwnd, ctypes.byref(origin)))
        return Rect(origin.x, origin.y, result.right - result.left, result.bottom - result.top)

    def scale(self, hwnd):
        dpi = self.user.GetDpiForWindow(hwnd)
        if not dpi:
            raise RuntimeError('便签窗口尚未准备好')
        return dpi / 96

    def pointer(self):
        point = Point()
        self._check(self.user.GetCursorPos(ctypes.byref(point)))
        return point.x, point.y, bool(self.user.GetAsyncKeyState(1) & 0x8000)

    def screens(self):
        screens = []

        def collect(monitor, _dc, _rect, _data):
            info = MonitorInfo()
            info.cbSize = ctypes.sizeof(info)
            if self.user.GetMonitorInfoW(monitor, ctypes.byref(info)):
                r = info.rcWork
                screens.append(Rect(r.left, r.top, r.right - r.left, r.bottom - r.top))
            return True

        self._check(self.user.EnumDisplayMonitors(None, None, self._monitor_callback(collect), 0))
        if not screens:
            raise RuntimeError('无法读取显示器范围')
        return screens

    def set_rect(self, hwnd, rect):
        self._check(self.user.SetWindowPos(hwnd, None, round(rect.x), round(rect.y),
                                          round(rect.width), round(rect.height), 0x0004 | 0x0010))

    def topmost(self, hwnd, enabled):
        self._check(self.user.SetWindowPos(hwnd, ctypes.c_void_p(-1 if enabled else -2),
                                          0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010))

    def reveal(self, hwnd):
        self.user.ShowWindow(hwnd, 9)  # SW_RESTORE also reveals a hidden window.
        # Windows may deny foreground activation; do not bypass that OS policy.
        self.user.SetForegroundWindow(hwnd)

    def visible(self, hwnd):
        return bool(self.user.IsWindowVisible(hwnd)) and not self.user.IsIconic(hwnd)

    def foreground_process(self, hwnd):
        foreground = self.user.GetForegroundWindow()
        if not foreground:
            return False
        own, active = ctypes.c_uint32(), ctypes.c_uint32()
        self.user.GetWindowThreadProcessId(hwnd, ctypes.byref(own))
        self.user.GetWindowThreadProcessId(foreground, ctypes.byref(active))
        return bool(own.value) and own.value == active.value

    def below_at(self, hwnd, point):
        seen = set()
        while hwnd and hwnd not in seen:
            seen.add(hwnd)
            hwnd = self.user.GetWindow(hwnd, 2)  # GW_HWNDNEXT, below the dragged card.
            if hwnd and self.visible(hwnd) and near_rect(point, self.rect(hwnd), 0):
                return hwnd
        return None


@dataclass(frozen=True)
class WindowsFrame:
    # Manager publishes logical sizes; this driver tracks physical screen pixels.
    raw: Rect
    scale: float

    @property
    def width(self):
        return self.raw.width / self.scale


@dataclass(frozen=True)
class DragAnchor:
    x: float
    y: float


def resized_frame(frame, start, pointer, corner, screens):
    if corner not in ('top-left', 'bottom-left'):
        raise ValueError('无效的缩放方向')
    horizontal = (start[0] - pointer[0]) / frame.scale
    vertical = (pointer[1] - start[1]) / frame.scale * (-1 if corner == 'top-left' else 1)
    delta = horizontal if abs(horizontal) > abs(vertical) else vertical
    size = sticky_size(frame.width + delta)
    r = frame.raw
    right, bottom = r.x + r.width, r.y + r.height
    if screens:
        cx, cy = r.x + r.width / 2, r.y + r.height / 2
        screen = min(screens, key=lambda s: max(s.x - cx, 0, cx - s.x - s.width) ** 2
                     + max(s.y - cy, 0, cy - s.y - s.height) ** 2)
        capacity = min(right - screen.x, bottom - screen.y if corner == 'top-left'
                       else screen.y + screen.height - r.y) / frame.scale
        if capacity >= MIN_SIZE:
            size = min(size, math.floor(capacity))
        screens = [screen]
    pixels = round(size * frame.scale)
    x, y = clamp_position(right - pixels, bottom - pixels if corner == 'top-left' else r.y,
                          screens, pixels, pixels)
    return Rect(x, y, pixels, pixels), size


class WindowsWindows:
    native_header_drag = True
    composition_events = True
    native_topmost = True

    def __init__(self, api=None):
        self.api = api or Win32API()
        self._composing = weakref.WeakSet()

    @staticmethod
    def _handle(window):
        native = getattr(window, 'native', None)
        if native is None or not hasattr(native, 'Handle'):
            raise RuntimeError('Windows 便签需要 pywebview WinForms 窗口')
        # Avoid ToInt32 truncation in a 64-bit build.
        return int(native.Handle.ToInt64())

    def frame(self, window):
        hwnd = self._handle(window)
        return WindowsFrame(self.api.rect(hwnd), self.api.scale(hwnd))

    def pointer_state(self, point=None):
        # Keep the cursor and window rectangles in the same Win32 coordinate
        # space instead of mixing them with WebView2 screenX/Y CSS units.
        # pywebview's DPI awareness policy still governs cross-monitor scaling.
        return self.api.pointer()

    def screen_point(self, point):
        return self.api.pointer()[:2]

    def set_size(self, window, size):
        frame = self.frame(window)
        pixels = round(sticky_size(size) * frame.scale)
        x, y = clamp_position(frame.raw.x, frame.raw.y, self.api.screens(), pixels, pixels)
        self.api.set_rect(self._handle(window), Rect(x, y, pixels, pixels))
        return sticky_size(size)

    def place(self, window, source=None, point=None):
        frame = self.frame(window)
        if point is not None:
            mouse = self.api.pointer()
            x, y = mouse[0] - frame.raw.width / 2, mouse[1] - 20 * frame.scale
        elif source is not None:
            parent = self.api.rect(self._handle(source), client=True)
            x, y = parent.x + parent.width - frame.raw.width - 24 * frame.scale, parent.y + 48 * frame.scale
        else:
            mouse = self.api.pointer()
            x, y = mouse[0] - frame.raw.width / 2, mouse[1] - 20 * frame.scale
        x, y = clamp_position(x, y, self.api.screens(), frame.raw.width, frame.raw.width)
        self.api.set_rect(self._handle(window), Rect(x, y, frame.raw.width, frame.raw.width))

    def reveal(self, window):
        hwnd = self._handle(window)
        self.api.topmost(hwnd, window not in self._composing)
        self.api.reveal(hwnd)

    def reveal_main(self, window):
        hwnd = self._handle(window)
        self.api.topmost(hwnd, False)
        self.api.reveal(hwnd)

    def set_composing(self, window, composing):
        if composing:
            self._composing.add(window)
        else:
            self._composing.discard(window)
        # Temporarily remove topmost while IME composition owns a candidate
        # panel, restoring it at compositionend/blur without changing focus.
        self.api.topmost(self._handle(window), not composing)

    def drag_anchor(self, window, pointer):
        r = self.frame(window).raw
        if near_rect(pointer, r, 0):
            return DragAnchor((pointer[0] - r.x) / r.width, (pointer[1] - r.y) / r.height)
        return DragAnchor(.5, 20 / self.frame(window).width)

    def move_to_pointer(self, window, anchor, pointer):
        frame = self.frame(window)
        if isinstance(anchor, DragAnchor):
            dx, dy = anchor.x * frame.raw.width, anchor.y * frame.raw.height
        else:
            dx, dy = anchor[0] * frame.scale, anchor[1] * frame.scale
        x, y = clamp_position(pointer[0] - dx, pointer[1] - dy, self.api.screens(), frame.raw.width, frame.raw.height)
        self.api.set_rect(self._handle(window), Rect(x, y, frame.raw.width, frame.raw.height))

    def resize_to_pointer(self, window, frame, start, pointer, corner):
        rect, size = resized_frame(frame, start, pointer, corner, self.api.screens())
        self.api.set_rect(self._handle(window), rect)
        return size

    def dock_near(self, main, sticky, rect, pointer):
        hwnd, dragged = self._handle(main), self._handle(sticky)
        if not self.api.visible(hwnd) or not self.api.foreground_process(hwnd):
            return False
        content, scale = self.api.rect(hwnd, client=True), self.api.scale(hwnd)
        target = Rect(content.x + rect.x * scale, content.y + rect.y * scale,
                      rect.width * scale, rect.height * scale)
        if not contains_rect(content, target) or not any(contains_rect(s, target) for s in self.api.screens()):
            return False
        if not near_rect(pointer, target, 24 * scale):
            return False
        hit = (min(max(pointer[0], target.x + 1), target.x + target.width - 1),
               min(max(pointer[1], target.y + 1), target.y + target.height - 1))
        return self.api.below_at(dragged, hit) == hwnd

    def install_quit_handler(self, callback):
        # WinForms Alt+F4 already passes through the existing closing veto.
        pass
