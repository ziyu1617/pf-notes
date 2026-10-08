"""Native sticky windows. Storage stays in the REST API, never in this bridge.

The manager accepts its database lookup and window system as dependencies so its
lifecycle can be tested without opening windows or touching the user's database.
"""

import logging
import json
import math
import re
import sys
import threading
import time
import weakref
from dataclasses import dataclass


SIZE = 240
MIN_SIZE = 200
MAX_SIZE = 420
SNAP_DISTANCE = 24
logger = logging.getLogger(__name__)


def sticky_id(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError("无效的便签编号")
    value = str(value)
    if not re.fullmatch(r"[1-9][0-9]{0,18}", value) or int(value) > 9223372036854775807:
        raise ValueError("无效的便签编号")
    return value


def coordinates(x, y):
    if x is None and y is None:
        return None
    if any(isinstance(v, bool) or not isinstance(v, (int, float))
           or not math.isfinite(v) or abs(v) > 10_000_000 for v in (x, y)):
        raise ValueError("无效的屏幕位置")
    return float(x), float(y)


def sticky_size(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("无效的便签大小")
    return max(MIN_SIZE, min(MAX_SIZE, math.floor(value + 0.5)))


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    width: float
    height: float


def dock_rect(value):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {'x', 'y', 'width', 'height'}:
        raise ValueError("无效的便签位置")
    if any(v is None for v in value.values()):
        raise ValueError("无效的便签位置")
    x, y = coordinates(value['x'], value['y'])
    width, height = coordinates(value['width'], value['height'])
    if x < -1 or y < -1 or not 40 <= width <= 10000 or not 40 <= height <= 10000:
        raise ValueError("无效的便签位置")
    return Rect(x, y, width, height)


def client_to_screen(rect, content, zoom=1):
    """CSS pixels and Cocoa coordinates are points, not Retina backing pixels."""
    return Rect(content.x + rect.x * zoom,
                content.y + content.height - (rect.y + rect.height) * zoom,
                rect.width * zoom, rect.height * zoom)


def contains_rect(outer, inner, tolerance=1):
    return (inner.x >= outer.x - tolerance and inner.y >= outer.y - tolerance
            and inner.x + inner.width <= outer.x + outer.width + tolerance
            and inner.y + inner.height <= outer.y + outer.height + tolerance)


def near_rect(point, rect, distance=SNAP_DISTANCE):
    dx = max(rect.x - point[0], 0, point[0] - rect.x - rect.width)
    dy = max(rect.y - point[1], 0, point[1] - rect.y - rect.height)
    return math.hypot(dx, dy) <= distance


def resize_square(frame, start, pointer, corner, screens=()):
    """Resize in Cocoa points: TL fixes bottom-right; BL fixes top-right."""
    if corner not in ('top-left', 'bottom-left'):
        raise ValueError("无效的缩放方向")
    horizontal = start[0] - pointer[0]
    vertical = (pointer[1] - start[1]) * (1 if corner == 'top-left' else -1)
    delta = horizontal if abs(horizontal) > abs(vertical) else vertical
    size = sticky_size(frame.width + delta)
    right, top = frame.x + frame.width, frame.y + frame.height
    if screens:
        # Choose the original window's screen so a resize never jumps displays.
        cx, cy = frame.x + frame.width / 2, frame.y + frame.height / 2
        screen = min(screens, key=lambda s: max(s.x - cx, 0, cx - s.x - s.width) ** 2
                     + max(s.y - cy, 0, cy - s.y - s.height) ** 2)
        capacity = min(right - screen.x, screen.y + screen.height - frame.y
                       if corner == 'top-left' else top - screen.y)
        if capacity >= MIN_SIZE:
            size = min(size, math.floor(capacity))
        screens = (screen,)
    x, y = right - size, frame.y if corner == 'top-left' else top - size
    x, y = clamp_position(x, y, screens, size, size)
    return Rect(x, y, size, size)


def clamp_position(x, y, screens, width=SIZE, height=SIZE):
    """Clamp a window to the nearest visible screen, including negative origins."""
    if not screens:
        return x, y
    center_x, center_y = x + width / 2, y + height / 2

    def distance(screen):
        dx = max(screen.x - center_x, 0, center_x - screen.x - screen.width)
        dy = max(screen.y - center_y, 0, center_y - screen.y - screen.height)
        return dx * dx + dy * dy

    screen = min(screens, key=distance)
    return (min(max(x, screen.x), screen.x + max(0, screen.width - width)),
            min(max(y, screen.y), screen.y + max(0, screen.height - height)))


class CocoaWindows:
    """Cocoa positions are global screen points, with a bottom-left origin."""

    def __init__(self):
        import AppKit
        from PyObjCTools import AppHelper
        self._appkit = AppKit
        self._helper = AppHelper
        self._key_monitor = None
        self._configured = weakref.WeakSet()

    def _main(self, action):
        if threading.current_thread() is threading.main_thread():
            return action()
        completed = threading.Event()
        result = []

        def run():
            try:
                result.append((True, action()))
            except Exception as error:
                result.append((False, error))
            finally:
                completed.set()

        self._helper.callAfter(run)
        if not completed.wait(5):
            raise RuntimeError("桌面窗口暂时没有响应")
        success, value = result[0]
        if not success:
            raise value
        return value

    def _screens(self):
        return [Rect(s.visibleFrame().origin.x, s.visibleFrame().origin.y,
                     s.visibleFrame().size.width, s.visibleFrame().size.height)
                for s in self._appkit.NSScreen.screens()]

    def _set_frame(self, window, x, y, size):
        # Full-size content titlebars vary across macOS versions. Explicitly size
        # the native frame so the visible sticky stays square in screen points.
        window.native.setFrame_display_(self._appkit.NSMakeRect(x, y, size, size), True)

    @staticmethod
    def _rect(frame):
        return Rect(frame.origin.x, frame.origin.y, frame.size.width, frame.size.height)

    def frame(self, window):
        return self._main(lambda: self._rect(window.native.frame()))

    def screen_point(self, point):
        def convert():
            primary = self._appkit.NSScreen.screens()[0].frame()
            return point[0], primary.origin.y + primary.size.height - point[1]
        return self._main(convert)

    def set_size(self, window, size):
        def resize():
            frame = window.native.frame()
            x, y = clamp_position(frame.origin.x, frame.origin.y + frame.size.height - size,
                                  self._screens(), size, size)
            self._set_frame(window, x, y, size)
            return size
        return self._main(resize)

    def resize_to_pointer(self, window, frame, start, pointer, corner):
        def resize():
            resized = resize_square(frame, start, pointer, corner, self._screens())
            self._set_frame(window, resized.x, resized.y, resized.width)
            return resized.width
        return self._main(resize)

    def _configure(self, window):
        native = window.native
        # pywebview's Cocoa on_top=True uses NSStatusWindowLevel (25), which
        # can cover input-method candidate panels. A floating palette (3)
        # stays above normal app windows without using that status-bar level.
        # Reapply before the appearance cache guard, including every reveal.
        native.setLevel_(self._appkit.NSFloatingWindowLevel)
        behavior = int(native.collectionBehavior())
        behavior &= ~int(self._appkit.NSWindowCollectionBehaviorMoveToActiveSpace)
        behavior |= (int(self._appkit.NSWindowCollectionBehaviorCanJoinAllSpaces)
                     | int(self._appkit.NSWindowCollectionBehaviorFullScreenAuxiliary))
        native.setCollectionBehavior_(behavior)
        native.setHidesOnDeactivate_(False)
        if window in self._configured:
            return
        content = native.contentView()
        if content is not None:
            content.setWantsLayer_(True)
            layer = content.layer()
            if layer is not None:
                # Clip the content layer, not the window's outer shadow.
                # Match the paper-like frontend's subtle 3px corners.
                layer.setCornerRadius_(3.0)
                layer.setMasksToBounds_(True)
                native.setOpaque_(False)
                native.setBackgroundColor_(self._appkit.NSColor.clearColor())
                native.setHasShadow_(True)
                native.invalidateShadow()
        self._configured.add(window)

    def place(self, window, source=None, point=None):
        def position():
            self._configure(window)
            size = sticky_size(window.native.frame().size.width)
            if point is not None:
                # Browser screenX/screenY use the primary display's top-left.
                primary = self._appkit.NSScreen.screens()[0].frame()
                x, y = point[0], primary.origin.y + primary.size.height - point[1] - size
            elif source is not None and getattr(source, 'native', None) is not None:
                frame = source.native.frame()
                x = frame.origin.x + frame.size.width - size - 24
                y = frame.origin.y + frame.size.height - size - 72
            else:
                mouse = self._appkit.NSEvent.mouseLocation()
                x, y = mouse.x - size / 2, mouse.y - size + 20
            x, y = clamp_position(x, y, self._screens(), size, size)
            self._set_frame(window, x, y, size)

        self._main(position)

    def reveal(self, window):
        def show():
            self._configure(window)
            window.native.deminiaturize_(None)
            window.native.makeKeyAndOrderFront_(None)
            self._appkit.NSApplication.sharedApplication().activateIgnoringOtherApps_(True)
            window.native.setLevel_(self._appkit.NSFloatingWindowLevel)
        self._main(show)

    def reveal_main(self, window):
        def show():
            # A normal document window must not inherit the sticky's floating
            # level, all-Spaces behavior, or clipped content layer.
            window.native.setLevel_(self._appkit.NSNormalWindowLevel)
            window.native.deminiaturize_(None)
            window.native.makeKeyAndOrderFront_(None)
            self._appkit.NSApplication.sharedApplication().activateIgnoringOtherApps_(True)
        self._main(show)

    def pointer_state(self, point=None):
        def read():
            mouse = self._appkit.NSEvent.mouseLocation()
            pressed = bool(self._appkit.NSEvent.pressedMouseButtons() & 1)
            if not pressed and point is not None:
                primary = self._appkit.NSScreen.screens()[0].frame()
                return point[0], primary.origin.y + primary.size.height - point[1], False
            return mouse.x, mouse.y, pressed
        return self._main(read)

    def drag_anchor(self, window, pointer):
        def anchor():
            frame = window.native.frame()
            left, top = frame.origin.x, frame.origin.y + frame.size.height
            if left <= pointer[0] <= left + frame.size.width and top - frame.size.height <= pointer[1] <= top:
                return pointer[0] - left, top - pointer[1]
            return frame.size.width / 2, 20
        return self._main(anchor)

    def move_to_pointer(self, window, anchor, pointer):
        def move():
            if window not in self._configured:
                self._configure(window)
            size = sticky_size(window.native.frame().size.width)
            x, y = clamp_position(pointer[0] - anchor[0], pointer[1] - size + anchor[1], self._screens(), size, size)
            self._set_frame(window, x, y, size)
        return self._main(move)

    def dock_near(self, main, sticky, rect, pointer):
        def check():
            native = getattr(main, 'native', None)
            if (native is None or not native.isVisible() or native.isMiniaturized()
                    or not native.isOnActiveSpace()
                    or not self._appkit.NSApplication.sharedApplication().isActive()
                    or not (native.occlusionState() & self._appkit.NSWindowOcclusionStateVisible)):
                return False
            content = native.contentView()
            if content is None:
                return False
            bounds = content.bounds()
            screen = self._rect(native.convertRectToScreen_(content.convertRect_toView_(bounds, None)))
            zoom = float(content.pageZoom()) if hasattr(content, 'pageZoom') else 1.0
            if not math.isfinite(zoom) or zoom <= 0:
                return False
            target = client_to_screen(rect, screen, zoom)
            if not contains_rect(screen, target) or not any(contains_rect(s, target) for s in self._screens()):
                return False
            if not near_rect(pointer, target):
                return False
            # Exclude only the dragged card. Another app covering its home must
            # not cause an invisible snap, even if part of the main is visible.
            x = min(max(pointer[0], target.x + 1), target.x + target.width - 1)
            y = min(max(pointer[1], target.y + 1), target.y + target.height - 1)
            hit = self._appkit.NSWindow.windowNumberAtPoint_belowWindowWithWindowNumber_(
                self._appkit.NSPoint(x, y), sticky.native.windowNumber())
            return hit == native.windowNumber()
        return self._main(check)

    def install_quit_handler(self, callback):
        def install():
            if self._key_monitor is not None:
                return

            def key_down(event):
                # pywebview's Cocoa key handler stops the app directly on Cmd+Q.
                # Route it through the same save-before-close flow instead.
                if (event.modifierFlags() & self._appkit.NSEventModifierFlagCommand
                        and str(event.charactersIgnoringModifiers() or '').lower() == 'q'):
                    callback()
                    return None
                return event

            self._key_monitor = self._appkit.NSEvent.addLocalMonitorForEventsMatchingMask_handler_(
                self._appkit.NSEventMaskKeyDown, key_down)
        self._main(install)


class PortableWindows:
    """Basic placement fallback; header dragging is still provided by pywebview."""

    def __init__(self, webview):
        self._webview = webview

    def place(self, window, source=None, point=None):
        screens = [Rect(s.x, s.y, s.width, s.height) for s in self._webview.screens]
        x, y = point if point is not None else (
            (source.x + 48, source.y + 72) if source is not None else (60, 60))
        x, y = clamp_position(x, y, screens)
        window.move(round(x), round(y))

    def install_quit_handler(self, callback):
        pass

    def reveal(self, window):
        window.restore()
        window.show()

    def reveal_main(self, window):
        self.reveal(window)

    def set_size(self, window, size):
        window.resize(size, size)
        return size


class StickyBridge:
    """Only these methods are exposed to JS; child APIs are scoped to one ID."""

    def __init__(self, manager, own_id=None):
        self._manager = manager
        self._own_id = own_id

    def _id(self, value):
        value = sticky_id(value)
        if self._own_id is not None and value != self._own_id:
            raise ValueError("此窗口只能操作当前便签")
        return value

    def detach_sticky(self, note_id, screen_x=None, screen_y=None):
        try:
            return self._manager.detach(self._id(note_id), coordinates(screen_x, screen_y))
        except ValueError as error:
            return {"ok": False, "error": str(error)}

    def return_sticky(self, note_id):
        try:
            return self._manager.return_note(self._id(note_id))
        except ValueError as error:
            return {"ok": False, "error": str(error)}

    def get_sticky_windows(self):
        ids = self._manager.window_ids()
        return ids if self._own_id is None else [i for i in ids if i == self._own_id]

    def drag_sticky(self, note_id, screen_x=None, screen_y=None):
        try:
            return self._manager.drag(self._id(note_id), coordinates(screen_x, screen_y))
        except ValueError as error:
            return {"ok": False, "error": str(error)}

    def set_sticky_size(self, note_id, size):
        try:
            return self._manager.set_size(self._id(note_id), sticky_size(size))
        except ValueError as error:
            return {"ok": False, "error": str(error)}

    def resize_sticky(self, note_id, corner, screen_x=None, screen_y=None):
        try:
            if corner not in ('top-left', 'bottom-left'):
                raise ValueError('无效的缩放方向')
            return self._manager.resize(self._id(note_id), corner, coordinates(screen_x, screen_y))
        except ValueError as error:
            return {"ok": False, "error": str(error)}

    def set_sticky_dock(self, note_id, bounds):
        try:
            if self._own_id is not None:
                raise ValueError('只能在主窗口设置便签位置')
            return self._manager.set_dock(self._id(note_id), dock_rect(bounds))
        except ValueError as error:
            return {"ok": False, "error": str(error)}

    def set_sticky_composing(self, note_id, composing):
        try:
            if self._own_id is None or not isinstance(composing, bool):
                raise ValueError('无效的便签输入状态')
            return self._manager.set_composing(self._id(note_id), composing)
        except ValueError as error:
            return {"ok": False, "error": str(error)}


class StickyWindowManager:
    def __init__(self, base_url, exists, webview, native=None):
        self._base_url = base_url.rstrip('/')
        self._exists = exists
        self._webview = webview
        if native is not None:
            self._native = native
        elif sys.platform == 'darwin':
            self._native = CocoaWindows()
        elif sys.platform == 'win32':
            from desktop_windows import WindowsWindows
            self._native = WindowsWindows()
        else:
            self._native = PortableWindows(webview)
        self._lock = threading.RLock()
        self._main_open_lock = threading.Lock()
        self._windows = {}
        self._creating = set()
        self._returning = set()
        self._dragging = set()
        self._resizing = set()
        self._sizes = {}
        self._docks = {}
        self._positioned = set()
        self._visible = set()
        self._main_window = None
        self._main_allow_close = False
        self._main_save_pending = False
        self._main_close_request = None
        self._main_destroy_request = None
        self._main_destroying = None
        self.bridge = StickyBridge(self)

    @staticmethod
    def _guard_window_js(window):
        """Bound pywebview's synchronous Cocoa JS wait to the window lifetime.

        Its bridge replies run on non-daemon threads. Returning/closing a note
        can remove WKWebView before the reply completion arrives, otherwise
        leaving those threads waiting forever during Python shutdown.
        """
        if getattr(window, '_smart_notes_guarded_js', False):
            return
        evaluate = window.evaluate_js

        def guarded(script, *args, **kwargs):
            if window.events.closed.is_set():
                return None
            completed, result = threading.Event(), []

            def run():
                try:
                    result.append((True, evaluate(script, *args, **kwargs)))
                except Exception as error:
                    result.append((False, error))
                finally:
                    completed.set()

            threading.Thread(target=run, daemon=True, name='smart-notes-window-js').start()
            deadline = time.monotonic() + 5
            while not completed.wait(.05):
                if window.events.closed.is_set():
                    return None
                if time.monotonic() >= deadline:
                    raise RuntimeError('页面暂时没有响应，请重试')
            success, value = result[0]
            if not success:
                raise value
            return value

        window.evaluate_js = guarded
        window._smart_notes_guarded_js = True

    def attach_main(self, window):
        self._guard_window_js(window)
        with self._lock:
            self._main_window = window
            self._main_allow_close = False
            self._main_save_pending = False
            self._main_close_request = None
            self._main_destroy_request = None
            self._main_destroying = None
        window.events.closing += lambda: self._main_closing(window)
        window.events.closed += lambda: self._main_closed(window)
        window.events.loaded += lambda: self._background(lambda: self._main_loaded(window))
        if window.events.loaded.is_set():
            self._main_loaded(window)

    def open_main_window(self, factory):
        """Activate or recreate the main window; call from an IPC worker thread."""
        # Do not hold the lifecycle lock while waiting for Cocoa or a factory.
        # Separate serialization coalesces repeated launcher requests.
        with self._main_open_lock:
            try:
                with self._lock:
                    window = self._main_window
                    closing = window is not None and self._main_destroying is window
                    if not closing:
                        # A new activation cancels a save/close that has not yet
                        # dispatched native destruction. Late JS replies are stale.
                        self._main_close_request = None
                        self._main_save_pending = False
                        self._main_destroy_request = None
                        self._main_allow_close = False
                if window is not None and (closing or window.events.closed.is_set()):
                    if not window.events.closed.wait(5):
                        return False
                    self._main_closed(window)
                    window = None
                if window is None:
                    window = factory()
                    if window is None:
                        return False
                    self.attach_main(window)
                if not window.events.shown.wait(5):
                    return False
                self._native.reveal_main(window)
                return True
            except Exception:
                logger.exception("Could not open main window")
                return False

    @staticmethod
    def _background(action):
        threading.Thread(target=action, daemon=True).start()

    def _main_loaded(self, window):
        with self._lock:
            if self._main_window is not window:
                return
        try:
            self._native.install_quit_handler(self.request_quit)
        except Exception:
            logger.exception("Could not install safe desktop quit handler")

    def window_ids(self):
        with self._lock:
            return sorted(set(self._windows) | self._creating, key=int)

    def _notify(self):
        with self._lock:
            window = self._main_window
        if window is not None:
            self._background(lambda: self._emit(window, 'sticky-windows-changed'))

    @staticmethod
    def _emit(window, event, detail=None):
        try:
            window.evaluate_js('window.dispatchEvent(new CustomEvent(%s, {detail: %s}))'
                               % (json.dumps(event), json.dumps(detail)))
        except Exception:
            logger.debug("Window unavailable for %s", event)

    def _publish_size(self, note_id, size):
        with self._lock:
            self._sizes[note_id] = size
            windows = [self._main_window, self._windows.get(note_id)]
        for window in windows:
            if window is not None:
                self._background(lambda window=window: self._emit(
                    window, 'sticky-size-changed', {'id': note_id, 'size': size}))

    def set_size(self, note_id, size):
        with self._lock:
            if note_id in self._resizing or note_id in self._dragging:
                return {'ok': False, 'error': '请先完成当前拖动'}
            window = self._windows.get(note_id)
            if note_id in self._creating:
                return {'ok': False, 'error': '便签正在打开，请稍后重试'}
        try:
            if window is not None:
                size = self._native.set_size(window, size)
            elif not self._exists(int(note_id)):
                return {'ok': False, 'error': '便签不存在'}
            self._publish_size(note_id, size)
            return {'ok': True, 'size': size}
        except Exception:
            logger.exception('Could not resize sticky window')
            return {'ok': False, 'error': '无法调整便签大小，请重试'}

    def set_dock(self, note_id, bounds):
        with self._lock:
            if bounds is None:
                self._docks.pop(note_id, None)
            else:
                self._docks[note_id] = bounds
        return {'ok': True}

    def set_composing(self, note_id, composing):
        with self._lock:
            window = self._windows.get(note_id)
        if window is None or not hasattr(self._native, 'set_composing'):
            return {'ok': False, 'error': '便签输入窗口不可用'}
        try:
            self._native.set_composing(window, composing)
            return {'ok': True}
        except Exception:
            logger.exception('Could not update sticky composition state')
            return {'ok': False, 'error': '无法更新便签窗口状态'}

    def resize(self, note_id, corner, point):
        if not hasattr(self._native, 'resize_to_pointer'):
            return {'ok': False, 'error': '当前桌面暂不支持拖角缩放'}
        with self._lock:
            window = self._windows.get(note_id)
            if window is None or note_id not in self._visible:
                return {'ok': False, 'error': '便签尚未显示'}
            if note_id in self._resizing or note_id in self._dragging:
                return {'ok': True}
            self._resizing.add(note_id)
        try:
            frame = self._native.frame(window)
            state = self._native.pointer_state(point)
            start = self._native.screen_point(point) if point else state[:2]
        except Exception:
            with self._lock:
                self._resizing.discard(note_id)
            logger.exception('Could not begin sticky resize')
            return {'ok': False, 'error': '无法调整便签大小，请重试'}

        def follow_resize():
            size, current = frame.width, state
            try:
                deadline = time.monotonic() + 120
                while time.monotonic() < deadline:
                    with self._lock:
                        if self._windows.get(note_id) is not window or note_id in self._returning:
                            return
                    size = self._native.resize_to_pointer(window, frame, start, current, corner)
                    if not current[2]:
                        break
                    time.sleep(1 / 60)
                    current = self._native.pointer_state()
            except Exception:
                logger.exception('Could not resize sticky window')
            finally:
                with self._lock:
                    self._resizing.discard(note_id)
                self._publish_size(note_id, size)
        self._background(follow_resize)
        return {'ok': True}

    def _try_snap(self, note_id, window, pointer):
        with self._lock:
            main = self._main_window
            rect = self._docks.get(note_id)
        if main is None or rect is None or not hasattr(self._native, 'dock_near'):
            return False
        if not self._native.dock_near(main, window, rect, pointer):
            return False
        # Revalidate after the drag: navigation/scroll can invalidate an old
        # measurement before its bridge notification arrives.
        current = main.evaluate_js('''(() => {
          const el = document.querySelector('[data-sticky-dock-id="%s"] .sticky-note-home');
          if (!el || document.hidden) return null;
          const r = el.getBoundingClientRect();
          if (!r.width || r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return null;
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          if (!el.contains(hit)) return null;
          return {x:r.x,y:r.y,width:r.width,height:r.height};
        })()''' % note_id)
        if current is None:
            return False
        current = dock_rect(current)
        if not self._native.dock_near(main, window, current, pointer):
            return False
        with self._lock:
            if self._main_window is not main or self._windows.get(note_id) is not window:
                return False
        # The renderer flushes its draft and runs the return animation first.
        self._sticky_closing(note_id)
        return True

    def detach(self, note_id, point=None):
        with self._lock:
            existing = self._windows.get(note_id)
            if note_id in self._creating:
                return {"ok": True}
        if existing is not None:
            try:
                with self._lock:
                    visible = note_id in self._visible
                if visible:
                    self._native.reveal(existing)
                return {"ok": True}
            except Exception:
                logger.exception("Could not reveal sticky window")
                return {"ok": False, "error": "无法显示便签，请重试"}
        with self._lock:
            # Another bridge call may have reserved the same ID while focus was
            # checked outside the lock.
            if note_id in self._windows or note_id in self._creating:
                return {"ok": True}
            try:
                if not self._exists(int(note_id)):
                    return {"ok": False, "error": "便签不存在"}
            except Exception:
                logger.exception("Could not check sticky note")
                return {"ok": False, "error": "无法读取便签，请重试"}
            self._creating.add(note_id)
        window = None
        try:
            with self._lock:
                size = self._sizes.get(note_id, SIZE)
            window = self._webview.create_window(
                'smart notes · 便签', self._base_url + '/sticky.html?id=' + note_id,
                js_api=StickyBridge(self, note_id), width=size, height=size,
                min_size=(MIN_SIZE, MIN_SIZE), resizable=False, frameless=True,
                hidden=True,
                # Cocoa owns its floating level directly. Keeping pywebview's
                # flag false also avoids its async set_on_top status-level
                # callback overriding our native level after placement/show.
                easy_drag=False, on_top=not (isinstance(self._native, CocoaWindows)
                                             or getattr(self._native, 'native_topmost', False)),
                shadow=True, text_select=True,
                background_color='#FCF4C6')
            if window is None:
                raise RuntimeError("Window creation cancelled")
            self._guard_window_js(window)
            with self._lock:
                self._windows[note_id] = window
                self._creating.discard(note_id)
            window.events.closing += lambda: self._sticky_closing(note_id)
            window.events.closed += lambda: self._sticky_closed(note_id, window)
            window.events.loaded += lambda: self._background(lambda: self._sticky_loaded(note_id, window, point))
            # Events may already have fired while create_window returned.
            if window.events.loaded.is_set():
                self._background(lambda: self._sticky_loaded(note_id, window, point))
            self._notify()
            return {"ok": True}
        except Exception:
            with self._lock:
                self._creating.discard(note_id)
                if self._windows.get(note_id) is window:
                    self._windows.pop(note_id, None)
            if window is not None:
                try:
                    with self._lock:
                        self._returning.add(note_id)
                    window.destroy()
                except Exception:
                    logger.exception("Could not clean up incomplete sticky window")
                finally:
                    with self._lock:
                        self._returning.discard(note_id)
            logger.exception("Could not open sticky window")
            self._notify()
            return {"ok": False, "error": "无法打开桌面便签，请重试"}

    def _sticky_loaded(self, note_id, window, point):
        try:
            with self._lock:
                place = note_id not in self._positioned
                self._positioned.add(note_id)
            if place:
                self._native.place(window, self._main_window, point)
                self._show(note_id, window)
            if isinstance(self._native, CocoaWindows) or getattr(self._native, 'native_header_drag', False):
                # Use native global coordinates across displays. Intercept only
                # the header, leaving editor selection and all controls intact.
                window.evaluate_js("""(() => {
                  if (window.__smartNotesNativeDrag) return;
                  window.__smartNotesNativeDrag = true;
                  let cancelGesture = null;
                  document.addEventListener('mousedown', event => {
                    const target = event.target;
                    if (event.button !== 0 || !(target instanceof Element) ||
                        !target.closest('.pywebview-drag-region') ||
                        target.closest('button, input, textarea, select, a, [contenteditable], [role="button"], [role="menu"], [role="menuitem"]')) return;
                    if (cancelGesture) cancelGesture();
                    // Prevent pywebview's body listener from immediately moving
                    // the window, but preserve the browser's click/dblclick.
                    event.stopPropagation();
                    const startX = event.clientX, startY = event.clientY;
                    const finish = () => {
                      document.removeEventListener('mousemove', move, true);
                      document.removeEventListener('mouseup', finish, true);
                      window.removeEventListener('blur', finish);
                      if (cancelGesture === finish) cancelGesture = null;
                    };
                    const move = current => {
                      if (!(current.buttons & 1)) { finish(); return; }
                      if (Math.hypot(current.clientX - startX, current.clientY - startY) < 9) return;
                      finish();
                      current.preventDefault(); current.stopPropagation();
                      window.pywebview.api.drag_sticky(%s, current.screenX, current.screenY);
                    };
                    cancelGesture = finish;
                    document.addEventListener('mousemove', move, true);
                    document.addEventListener('mouseup', finish, true);
                    window.addEventListener('blur', finish);
                  }, true);
                  window.addEventListener('pagehide', () => {
                    if (cancelGesture) cancelGesture();
                  }, { once: true });
                })()""" % repr(note_id))
            if getattr(self._native, 'composition_events', False):
                self._native.set_composing(window, False)
                window.evaluate_js("""(() => {
                  if (window.__smartNotesComposition) return;
                  window.__smartNotesComposition = true;
                  let queue = Promise.resolve();
                  const composing = active => {
                    queue = queue.then(() => window.pywebview.api.set_sticky_composing(%s, active)).catch(() => {});
                  };
                  document.addEventListener('compositionstart', () => composing(true), true);
                  document.addEventListener('compositionend', () => composing(false), true);
                  window.addEventListener('blur', () => composing(false));
                })()""" % repr(note_id))
        except Exception:
            logger.exception("Could not position sticky window")

    def _show(self, note_id, window):
        with self._lock:
            if self._windows.get(note_id) is not window or note_id in self._returning:
                return
        self._native.reveal(window)
        with self._lock:
            if self._windows.get(note_id) is window:
                self._visible.add(note_id)

    def _sticky_closing(self, note_id):
        with self._lock:
            if note_id in self._returning:
                return True
            window = self._windows.get(note_id)
        if window is not None:
            self._background(lambda: self._emit(window, 'sticky-return-requested'))
        return False

    def return_note(self, note_id):
        with self._lock:
            if note_id in self._creating:
                return {"ok": False, "error": "便签正在打开，请稍后重试"}
            window = self._windows.get(note_id)
            if window is None:
                return {"ok": True}
            self._returning.add(note_id)
        try:
            window.destroy()
            return {"ok": True}
        except Exception:
            with self._lock:
                self._returning.discard(note_id)
            logger.exception("Could not return sticky window")
            return {"ok": False, "error": "无法收回便签，请重试"}

    def _sticky_closed(self, note_id, window):
        with self._lock:
            if self._windows.get(note_id) is window:
                self._windows.pop(note_id, None)
                self._returning.discard(note_id)
                self._positioned.discard(note_id)
                self._visible.discard(note_id)
        self._notify()

    def drag(self, note_id, point=None):
        if not hasattr(self._native, 'pointer_state'):
            return self.detach(note_id, point)
        with self._lock:
            if note_id in self._dragging or note_id in self._resizing:
                return {"ok": True}
            self._dragging.add(note_id)
            # Loading may finish after a dock drag has already positioned this
            # window. Do not snap it back to a default location at that point.
            self._positioned.add(note_id)
            existing = self._windows.get(note_id)

        cancelled = threading.Event()
        pointer_lock = threading.Lock()
        try:
            latest = [self._native.pointer_state(point)]
            start_pointer = latest[0][:2]
            anchor = self._native.drag_anchor(existing, latest[0]) if existing is not None else (self._sizes.get(note_id, SIZE) / 2, 20)
        except Exception:
            with self._lock:
                self._dragging.discard(note_id)
                self._positioned.discard(note_id)
            logger.exception("Could not begin sticky drag")
            return {"ok": False, "error": "无法拖动便签，请重试"}

        def capture():
            deadline = time.monotonic() + 120
            try:
                while latest[0][2] and not cancelled.is_set() and time.monotonic() < deadline:
                    state = self._native.pointer_state()
                    with pointer_lock:
                        latest[0] = state
                    if state[2]:
                        time.sleep(1 / 60)
            except Exception:
                logger.exception("Could not track sticky drag")
            finally:
                with pointer_lock:
                    latest[0] = (latest[0][0], latest[0][1], False)

        # Capture release even while create_window / page loading is pending.
        self._background(capture)
        result = self.detach(note_id)
        if not result['ok']:
            cancelled.set()
            with self._lock:
                self._dragging.discard(note_id)
                self._positioned.discard(note_id)
            return result

        def follow():
            try:
                with self._lock:
                    window = self._windows.get(note_id)
                # Hidden windows must never wait to become visible before the
                # code that positions and shows them. Wait for page readiness.
                if window is None or not window.events.loaded.wait(30):
                    return
                deadline = time.monotonic() + 120
                while time.monotonic() < deadline:
                    with self._lock:
                        if self._windows.get(note_id) is not window or note_id in self._returning:
                            break
                    with pointer_lock:
                        pointer = latest[0]
                    self._native.move_to_pointer(window, anchor, pointer)
                    with self._lock:
                        visible = note_id in self._visible
                    if not visible:
                        self._show(note_id, window)
                    if not pointer[2]:
                        if existing is not None and math.hypot(pointer[0] - start_pointer[0], pointer[1] - start_pointer[1]) >= 9:
                            self._try_snap(note_id, window, pointer)
                        break
                    time.sleep(1 / 60)
            except Exception:
                logger.exception("Could not drag sticky window")
            finally:
                cancelled.set()
                with self._lock:
                    self._dragging.discard(note_id)
        self._background(follow)
        return result

    def _main_closing(self, window=None):
        with self._lock:
            if window is None:
                window = self._main_window
            if window is None or self._main_window is not window:
                return True
            if self._main_allow_close:
                return True
            if self._main_save_pending or self._main_destroy_request is not None:
                return False
            self._main_save_pending = True
            request = object()
            self._main_close_request = request

        def saved(success):
            with self._lock:
                if self._main_close_request is not request:
                    return
                self._main_close_request = None
                self._main_save_pending = False
                if success is not True or self._main_window is not window:
                    return
                self._main_destroy_request = request

            def destroy():
                with self._lock:
                    if (self._main_window is not window
                            or self._main_destroy_request is not request):
                        return
                    self._main_destroy_request = None
                    self._main_destroying = window
                    self._main_allow_close = True
                try:
                    window.destroy()
                except Exception:
                    with self._lock:
                        if self._main_window is window:
                            self._main_allow_close = False
                            self._main_destroying = None
                    logger.exception("Could not close main window")

            # Cocoa delivers JS promise callbacks on its bridge/main thread.
            # Leave that callback before calling a pywebview window API, whose
            # readiness waits can otherwise block native event processing.
            self._background(destroy)

        def flush():
            try:
                window.evaluate_js("""(async () => {
                  try {
                    return typeof window.smartNotesFlushSticky !== 'function' ||
                      await window.smartNotesFlushSticky() === true;
                  } catch { return false; }
                })()""", callback=saved)
            except Exception:
                saved(False)
        # An unresponsive renderer must not permanently disable the close button.
        # A timeout leaves the window and its unsaved editor intact.
        timer = threading.Timer(20, lambda: saved(False))
        timer.daemon = True
        timer.start()
        self._background(flush)
        return False

    def _main_closed(self, window):
        with self._lock:
            if self._main_window is window:
                self._main_window = None
                self._main_allow_close = False
                self._main_save_pending = False
                self._main_close_request = None
                self._main_destroy_request = None
                self._main_destroying = None
                self._docks.clear()
        # pywebview keeps its event loop alive while any detached window exists.

    def request_quit(self):
        with self._lock:
            ids = list(self._windows)
        for note_id in ids:
            self._sticky_closing(note_id)
        self._main_closing()
