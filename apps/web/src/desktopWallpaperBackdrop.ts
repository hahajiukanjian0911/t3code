import type { DesktopBridge, DesktopWindowDisplaySpace } from "@t3tools/contracts";

import { getClientSettings, subscribeClientSettings } from "./hooks/useSettings";

const WALLPAPER_IMAGE_VAR = "--desktop-wallpaper-image";
const DISPLAY_WIDTH_VAR = "--desktop-display-width";
const DISPLAY_HEIGHT_VAR = "--desktop-display-height";
const WINDOW_OFFSET_X_VAR = "--desktop-window-offset-x";
const WINDOW_OFFSET_Y_VAR = "--desktop-window-offset-y";
const BLUR_CANVAS_WIDTH = 512;
const BLUR_OVERSCAN_PX = 28;

export type DesktopWallpaperBridge = Pick<
  DesktopBridge,
  "readDesktopWallpaper" | "onWindowDisplaySpaceChange"
>;

function applyDisplaySpace(root: HTMLElement, space: DesktopWindowDisplaySpace): void {
  root.style.setProperty(DISPLAY_WIDTH_VAR, `${space.displayWidth}px`);
  root.style.setProperty(DISPLAY_HEIGHT_VAR, `${space.displayHeight}px`);
  root.style.setProperty(WINDOW_OFFSET_X_VAR, `${space.offsetX}px`);
  root.style.setProperty(WINDOW_OFFSET_Y_VAR, `${space.offsetY}px`);
}

function clearWallpaperStyles(root: HTMLElement): void {
  delete root.dataset.desktopWallpaperActive;
  root.style.removeProperty(WALLPAPER_IMAGE_VAR);
  root.style.removeProperty(DISPLAY_WIDTH_VAR);
  root.style.removeProperty(DISPLAY_HEIGHT_VAR);
  root.style.removeProperty(WINDOW_OFFSET_X_VAR);
  root.style.removeProperty(WINDOW_OFFSET_Y_VAR);
}

async function preblurWallpaperBlob(rawBlob: Blob): Promise<string> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return URL.createObjectURL(rawBlob);
  }
  try {
    const bitmap = await createImageBitmap(rawBlob);
    try {
      const ratio = bitmap.width > 0 ? bitmap.height / bitmap.width : 0.625;
      const width = BLUR_CANVAS_WIDTH;
      const height = Math.max(256, Math.round(width * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return URL.createObjectURL(rawBlob);
      ctx.filter = "blur(20px) saturate(165%)";
      // Overscan past all four edges so Gaussian blur never vignettes at the display boundary.
      ctx.drawImage(
        bitmap,
        -BLUR_OVERSCAN_PX,
        -BLUR_OVERSCAN_PX,
        width + BLUR_OVERSCAN_PX * 2,
        height + BLUR_OVERSCAN_PX * 2,
      );
      const blurred = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.84),
      );
      return URL.createObjectURL(blurred ?? rawBlob);
    } finally {
      bitmap.close();
    }
  } catch {
    return URL.createObjectURL(rawBlob);
  }
}

export function installDesktopWallpaperBackdrop(
  resolveBridge: () => DesktopWallpaperBridge | undefined = () => window.desktopBridge,
  options: { preblur?: (blob: Blob) => Promise<string> } = {},
): () => void {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;
  const preblur = options.preblur ?? preblurWallpaperBlob;

  let activeObjectUrl: string | null = null;
  let activeRevision: string | null = null;
  let activeDisplayKey: string | null = null;
  let unsubscribeSpace: (() => void) | null = null;
  let focusListenerInstalled = false;
  let generation = 0;

  const revokeCurrentUrl = () => {
    if (activeObjectUrl !== null) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
    activeRevision = null;
    activeDisplayKey = null;
  };

  const refreshWallpaper = () => {
    const bridge = resolveBridge();
    if (typeof bridge?.readDesktopWallpaper !== "function") return;
    const token = ++generation;
    void bridge
      .readDesktopWallpaper()
      .then(async (snapshot) => {
        if (token !== generation) return;
        if (snapshot === null || snapshot.data.byteLength === 0) {
          revokeCurrentUrl();
          clearWallpaperStyles(root);
          return;
        }
        activeDisplayKey = snapshot.space.displayKey;
        applyDisplaySpace(root, snapshot.space);
        if (snapshot.revision === activeRevision && activeObjectUrl !== null) {
          root.dataset.desktopWallpaperActive = "true";
          return;
        }
        const rawBlob = new Blob([new Uint8Array(snapshot.data)], { type: snapshot.mimeType });
        const nextUrl = await preblur(rawBlob);
        if (token !== generation) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        if (activeObjectUrl !== null) URL.revokeObjectURL(activeObjectUrl);
        activeObjectUrl = nextUrl;
        activeRevision = snapshot.revision;
        root.style.setProperty(WALLPAPER_IMAGE_VAR, `url("${nextUrl}")`);
        root.dataset.desktopWallpaperActive = "true";
      })
      .catch(() => {
        if (token !== generation) return;
        revokeCurrentUrl();
        clearWallpaperStyles(root);
      });
  };

  const onWindowFocus = () => {
    refreshWallpaper();
  };

  const teardownActive = () => {
    generation += 1;
    unsubscribeSpace?.();
    unsubscribeSpace = null;
    if (focusListenerInstalled) {
      window.removeEventListener("focus", onWindowFocus);
      focusListenerInstalled = false;
    }
    revokeCurrentUrl();
    clearWallpaperStyles(root);
  };

  const sync = () => {
    const settings = getClientSettings();
    const bridge = resolveBridge();
    const shouldActivate =
      settings.glassBackdropSource === "wallpaper" &&
      settings.glassOpacity < 100 &&
      typeof bridge?.readDesktopWallpaper === "function";

    if (!shouldActivate) {
      teardownActive();
      return;
    }

    if (unsubscribeSpace === null && typeof bridge.onWindowDisplaySpaceChange === "function") {
      unsubscribeSpace = bridge.onWindowDisplaySpaceChange((space) => {
        applyDisplaySpace(root, space);
        if (space.displayKey !== activeDisplayKey) {
          activeDisplayKey = space.displayKey;
          refreshWallpaper();
        }
      });
    }
    if (!focusListenerInstalled) {
      window.addEventListener("focus", onWindowFocus);
      focusListenerInstalled = true;
    }
    if (activeObjectUrl === null) {
      refreshWallpaper();
    }
  };

  const unsubscribeSettings = subscribeClientSettings(sync);
  sync();

  return () => {
    unsubscribeSettings();
    teardownActive();
  };
}

export function startDesktopWallpaperBackdrop(): () => void {
  return installDesktopWallpaperBackdrop();
}
