"""Multi-écrans pour le pilote d'ordinateur local de H (macOS).

Problème : le pilote de H (hai_drivers.desktop.local.LocalDesktopDriver) capture l'écran avec pyautogui,
qui ne voit que l'écran PRINCIPAL. Avec un MacBook + moniteurs, si l'app à piloter s'ouvre sur un autre
écran, Holo ne la voit pas et ne peut pas y cliquer.

Solution (sans modifier le paquet de H) : à chaque capture, on prend l'écran où se trouve la fenêtre
au premier plan (à défaut, celui où est la souris), et on convertit les coordonnées de Holo vers cet
écran. Les clics de H partent déjà en coordonnées globales macOS, donc ils atteignent n'importe quel écran.

    from twiin.clients.holo import multiscreen
    multiscreen.enable()      # avant de démarrer une session locale
"""
from __future__ import annotations

import logging
import threading

log = logging.getLogger("twiin.multiscreen")
_enabled = False
_listeners: list = []
_lock = threading.Lock()


def on_switch(callback) -> None:
    """callback(index, nb_ecrans, (x, y, largeur, hauteur)) appelé quand Holo change d'écran."""
    _listeners.append(callback)


def displays() -> list[tuple[int, tuple[float, float, float, float]]]:
    import Quartz
    ids = Quartz.CGGetActiveDisplayList(16, None, None)[1]
    out = []
    for did in ids:
        b = Quartz.CGDisplayBounds(did)
        out.append((did, (b.origin.x, b.origin.y, b.size.width, b.size.height)))
    return out


def _contains(bounds, x, y) -> bool:
    bx, by, bw, bh = bounds
    return bx <= x < bx + bw and by <= y < by + bh


_IGNORED_OWNERS = {"Window Server", "Dock", "SystemUIServer", "Control Center", "Centre de contrôle", "Notification Center"}


def _frontmost_window_center() -> tuple[float, float] | None:
    """Centre de la fenêtre au premier plan.

    On n'utilise PAS NSWorkspace.frontmostApplication() : dans un processus qui tourne longtemps sans
    boucle d'événements (le pilote de H), sa valeur reste figée. La liste des fenêtres de Quartz, elle,
    est relue à chaque appel et triée du premier plan vers l'arrière-plan : on prend la première vraie
    fenêtre (niveau normal, assez grande pour ne pas être une barre d'outils ou une bulle).
    """
    import Quartz
    wins = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements, Quartz.kCGNullWindowID)
    for w in wins or []:
        if w.get("kCGWindowLayer", 0) != 0 or w.get("kCGWindowOwnerName") in _IGNORED_OWNERS:
            continue
        b = w.get("kCGWindowBounds", {})
        if b.get("Width", 0) >= 300 and b.get("Height", 0) >= 200:
            return b["X"] + b["Width"] / 2, b["Y"] + b["Height"] / 2
    return None


def _mouse() -> tuple[float, float]:
    import Quartz
    p = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
    return p.x, p.y


def active_display() -> tuple[int, tuple[float, float, float, float], int, int]:
    """(id, bornes en points globaux, rang 1..n, nombre d'écrans) de l'écran à montrer à Holo."""
    ds = displays()
    for point in (_frontmost_window_center(), _mouse()):
        if point is None:
            continue
        for i, (did, b) in enumerate(ds, 1):
            if _contains(b, *point):
                return did, b, i, len(ds)
    import Quartz
    main = Quartz.CGMainDisplayID()
    for i, (did, b) in enumerate(ds, 1):
        if did == main:
            return did, b, i, len(ds)
    return ds[0][0], ds[0][1], 1, len(ds)


def _grab(did):
    import Quartz
    from PIL import Image
    cg = Quartz.CGDisplayCreateImage(did)
    if cg is None:
        raise RuntimeError("capture de l'écran refusée (autorisation Enregistrement de l'écran ?)")
    w, h = Quartz.CGImageGetWidth(cg), Quartz.CGImageGetHeight(cg)
    bpr = Quartz.CGImageGetBytesPerRow(cg)
    data = Quartz.CGDataProviderCopyData(Quartz.CGImageGetDataProvider(cg))
    return Image.frombuffer("RGBA", (w, h), bytes(data), "raw", "BGRA", bpr, 1).convert("RGB")


def enable() -> None:
    """Remplace, dans le pilote local de H, la capture et la conversion de coordonnées par la version multi-écrans."""
    global _enabled
    if _enabled:
        return
    import pyautogui
    from hai_drivers.desktop.local import driver as drv

    D = drv.LocalDesktopDriver

    def _capture_screenshot(self):
        with _lock:
            did, b, idx, n = active_display()
            img = _grab(did)
            if getattr(self, "_ms_display", None) != did:
                log.info("Holo regarde l'écran %d/%d (%dx%d)", idx, n, int(b[2]), int(b[3]))
                for cb in _listeners:
                    try:
                        cb(idx, n, b)
                    except Exception:  # noqa: BLE001
                        pass
            self._ms_display, self._ms_bounds = did, b
            self._screenshot_size = (img.width, img.height)       # repère de Holo : pixels de la capture
            self._screen_size = (int(b[2]), int(b[3]))           # taille de l'écran en points macOS
            return img

    def _screenshot_to_screen(self, x, y):
        if getattr(self, "_ms_bounds", None) is None:
            self._capture_screenshot()
        bx, by, bw, bh = self._ms_bounds
        sw, sh = self._screenshot_size
        return round(bx + x * bw / sw), round(by + y * bh / sh)

    def get_mouse_position(self):
        if getattr(self, "_ms_bounds", None) is None:
            self._capture_screenshot()
        p = pyautogui.position()
        bx, by, bw, bh = self._ms_bounds
        sw, sh = self._screenshot_size
        x = min(max(p.x - bx, 0), bw - 1)
        y = min(max(p.y - by, 0), bh - 1)
        return round(x * sw / bw), round(y * sh / bh)

    D._capture_screenshot = _capture_screenshot
    D._screenshot_to_screen = _screenshot_to_screen
    D.get_mouse_position = get_mouse_position
    _enabled = True
