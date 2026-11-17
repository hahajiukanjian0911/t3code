import type { DesktopWallpaperRead, DesktopWindowDisplaySpace } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const WALLPAPER_PROBE_TIMEOUT = Duration.seconds(5);
const MAX_WINDOWS_WALLPAPER_BYTES = 16 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 4;

const MACOS_DESKTOP_IMAGE_JXA = [
  'ObjC.import("AppKit");',
  "const screens = $.NSScreen.screens;",
  "const out = [];",
  "for (let i = 0; i < screens.count; i++) {",
  "  const s = screens.objectAtIndex(i);",
  "  const u = $.NSWorkspace.sharedWorkspace.desktopImageURLForScreen(s);",
  "  const f = s.frame;",
  "  out.push({ x: Number(f.origin.x), y: Number(f.origin.y), w: Number(f.size.width), h: Number(f.size.height), path: u ? String(u.path.js) : null });",
  "}",
  "JSON.stringify(out);",
].join(" ");

interface CachedWallpaper {
  readonly mimeType: string;
  readonly data: Uint8Array;
  readonly revision: string;
}

const wallpaperCache = new Map<string, CachedWallpaper>();

function rememberWallpaper(key: string, entry: CachedWallpaper): CachedWallpaper {
  if (wallpaperCache.size >= MAX_CACHE_ENTRIES && !wallpaperCache.has(key)) {
    const oldest = wallpaperCache.keys().next().value;
    if (oldest !== undefined) wallpaperCache.delete(oldest);
  }
  wallpaperCache.set(key, entry);
  return entry;
}

export interface DisplayBoundsLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function resolveWindowDisplaySpace(
  windowBounds: DisplayBoundsLike,
  displays: ReadonlyArray<{ readonly bounds: DisplayBoundsLike }>,
): DesktopWindowDisplaySpace {
  let best = displays[0]?.bounds ?? {
    x: 0,
    y: 0,
    width: Math.max(windowBounds.width, 1440),
    height: Math.max(windowBounds.height, 900),
  };
  let bestArea = -1;
  for (const { bounds } of displays) {
    const overlapWidth = Math.max(
      0,
      Math.min(windowBounds.x + windowBounds.width, bounds.x + bounds.width) -
        Math.max(windowBounds.x, bounds.x),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(windowBounds.y + windowBounds.height, bounds.y + bounds.height) -
        Math.max(windowBounds.y, bounds.y),
    );
    const area = overlapWidth * overlapHeight;
    if (area > bestArea) {
      bestArea = area;
      best = bounds;
    }
  }
  return {
    offsetX: windowBounds.x - best.x,
    offsetY: windowBounds.y - best.y,
    displayWidth: best.width,
    displayHeight: best.height,
    displayKey: `${best.x},${best.y},${best.width}x${best.height}`,
  };
}

function concatBytes(chunks: Iterable<Uint8Array>): Uint8Array {
  const list = Array.from(chunks);
  const total = list.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of list) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const runCaptureStdout = (command: string, args: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const handle = yield* spawner.spawn(
        ChildProcess.make(command, args, {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          killSignal: "SIGTERM",
          forceKillAfter: Duration.seconds(1),
        }),
      );
      const [stdoutChunks, , exitCode] = yield* Effect.all(
        [Stream.runCollect(handle.stdout), Stream.runCollect(handle.stderr), handle.exitCode],
        { concurrency: "unbounded" },
      );
      if ((exitCode as unknown as number) !== 0) return null;
      return new TextDecoder().decode(concatBytes(stdoutChunks)).trim();
    }),
  ).pipe(
    Effect.timeoutOption(WALLPAPER_PROBE_TIMEOUT),
    Effect.map(Option.getOrNull),
    Effect.orElseSucceed(() => null),
  );

function sniffImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.byteLength >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  return null;
}

const MacosScreenWallpaperSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  w: Schema.Number,
  h: Schema.Number,
  path: Schema.NullOr(Schema.String),
});
const decodeMacosScreenWallpapers = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(MacosScreenWallpaperSchema)),
);

const readMacosWallpaper = Effect.fn("desktop.wallpaper.macos")(function* (
  space: DesktopWindowDisplaySpace,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rawJson = yield* runCaptureStdout("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    MACOS_DESKTOP_IMAGE_JXA,
  ]);
  if (!rawJson) return null;
  const decoded = decodeMacosScreenWallpapers(rawJson);
  if (Option.isNone(decoded)) return null;
  const screens = decoded.value;
  const matching =
    screens.find(
      (entry) =>
        entry.path !== null && entry.w === space.displayWidth && entry.h === space.displayHeight,
    ) ?? screens.find((entry) => entry.path !== null);
  const sourcePath = matching?.path ?? null;
  if (!sourcePath) return null;

  const stat = yield* fileSystem.stat(sourcePath).pipe(Effect.orElseSucceed(() => null));
  if (!stat) return null;
  const mtimePart = Option.isSome(stat.mtime) ? String(stat.mtime.value.getTime()) : "0";
  const cacheKey = `${sourcePath}:${mtimePart}:${String(stat.size)}`;
  const cached = wallpaperCache.get(cacheKey);
  if (cached) {
    return { ...cached, space } satisfies DesktopWallpaperRead;
  }

  // Convert HEIC/TIFF/5K wallpapers into a compact 512px JPEG via macOS hardware ImageIO (`sips`).
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const tempDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-wallpaper-" });
      const outPath = path.join(tempDir, "wallpaper.jpg");
      const converted = yield* runCaptureStdout("/usr/bin/sips", [
        "-Z",
        "512",
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        "78",
        sourcePath,
        "--out",
        outPath,
      ]);
      if (converted === null) return null;
      const data = yield* fileSystem.readFile(outPath);
      if (data.byteLength === 0) return null;
      const entry = rememberWallpaper(cacheKey, {
        mimeType: "image/jpeg",
        data,
        revision: cacheKey,
      });
      return { ...entry, space } satisfies DesktopWallpaperRead;
    }),
  ).pipe(Effect.orElseSucceed(() => null));
});

const readWindowsWallpaper = Effect.fn("desktop.wallpaper.windows")(function* (
  space: DesktopWindowDisplaySpace,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const env = yield* HostProcess.Environment;
  const appData = env.APPDATA;
  if (!appData) return null;
  const wallpaperPath = path.join(appData, "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
  const stat = yield* fileSystem.stat(wallpaperPath).pipe(Effect.orElseSucceed(() => null));
  if (!stat || Number(stat.size) <= 0 || Number(stat.size) > MAX_WINDOWS_WALLPAPER_BYTES) {
    return null;
  }
  const mtimePart = Option.isSome(stat.mtime) ? String(stat.mtime.value.getTime()) : "0";
  const cacheKey = `${wallpaperPath}:${mtimePart}:${String(stat.size)}`;
  const cached = wallpaperCache.get(cacheKey);
  if (cached) {
    return { ...cached, space } satisfies DesktopWallpaperRead;
  }
  const data = yield* fileSystem.readFile(wallpaperPath).pipe(Effect.orElseSucceed(() => null));
  if (!data) return null;
  const mimeType = sniffImageMimeType(data);
  if (!mimeType) return null;
  const entry = rememberWallpaper(cacheKey, {
    mimeType,
    data,
    revision: cacheKey,
  });
  return { ...entry, space } satisfies DesktopWallpaperRead;
});

export const readDesktopWallpaperForPlatform = Effect.fn("desktop.wallpaper.read")(function* (
  platform: NodeJS.Platform,
  space: DesktopWindowDisplaySpace,
) {
  if (platform === "darwin") return yield* readMacosWallpaper(space);
  if (platform === "win32") return yield* readWindowsWallpaper(space);
  return null;
});
