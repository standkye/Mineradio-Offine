const path = require('path');

const DEFAULT_WALLPAPER_STATE = Object.freeze({
  enabled: false,
  title: 'Mineradio',
  artist: '',
  cover: '',
  playing: false,
  preset: 0,
  opacity: 1,
  frameRate: 30,
  colors: Object.freeze({
    primary: '#d6f8ff',
    secondary: '#9cffdf',
    highlight: '#fff0b8',
    glow: '#9cffdf',
  }),
});

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeWallpaperFrameRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 30;
  if (numeric <= 26) return 24;
  if (numeric <= 45) return 30;
  return 60;
}

function normalizeHexColor(value, fallback) {
  let color = String(value || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    color = '#' + color.charAt(1) + color.charAt(1)
      + color.charAt(2) + color.charAt(2)
      + color.charAt(3) + color.charAt(3);
  }
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
}

function normalizeWallpaperState(previous, payload, enabledOverride) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const current = previous && typeof previous === 'object' ? previous : DEFAULT_WALLPAPER_STATE;
  const currentColors = current.colors && typeof current.colors === 'object'
    ? current.colors
    : DEFAULT_WALLPAPER_STATE.colors;
  const sourceColors = source.colors && typeof source.colors === 'object' ? source.colors : {};
  const enabled = typeof enabledOverride === 'boolean'
    ? enabledOverride
    : Object.prototype.hasOwnProperty.call(source, 'enabled')
      ? source.enabled === true
      : current.enabled === true;
  return {
    enabled,
    title: String(Object.prototype.hasOwnProperty.call(source, 'title') ? source.title : current.title || 'Mineradio').slice(0, 512),
    artist: String(Object.prototype.hasOwnProperty.call(source, 'artist') ? source.artist : current.artist || '').slice(0, 512),
    cover: String(Object.prototype.hasOwnProperty.call(source, 'cover') ? source.cover : current.cover || ''),
    playing: Object.prototype.hasOwnProperty.call(source, 'playing') ? source.playing === true : current.playing === true,
    preset: Math.round(clampNumber(
      Object.prototype.hasOwnProperty.call(source, 'preset') ? source.preset : current.preset,
      0,
      32,
      0
    )),
    opacity: clampNumber(
      Object.prototype.hasOwnProperty.call(source, 'opacity') ? source.opacity : current.opacity,
      0.35,
      1,
      1
    ),
    frameRate: normalizeWallpaperFrameRate(
      Object.prototype.hasOwnProperty.call(source, 'frameRate') ? source.frameRate : current.frameRate
    ),
    colors: {
      primary: normalizeHexColor(sourceColors.primary || currentColors.primary, DEFAULT_WALLPAPER_STATE.colors.primary),
      secondary: normalizeHexColor(sourceColors.secondary || currentColors.secondary, DEFAULT_WALLPAPER_STATE.colors.secondary),
      highlight: normalizeHexColor(sourceColors.highlight || currentColors.highlight, DEFAULT_WALLPAPER_STATE.colors.highlight),
      glow: normalizeHexColor(sourceColors.glow || currentColors.glow, DEFAULT_WALLPAPER_STATE.colors.glow),
    },
  };
}

function nativeWindowHandleDecimal(win) {
  const handle = win.getNativeWindowHandle();
  if (!Buffer.isBuffer(handle) || handle.length < 4) throw new Error('WALLPAPER_NATIVE_HANDLE_INVALID');
  if (handle.length >= 8 && (process.arch === 'x64' || process.arch === 'arm64')) {
    return handle.readBigUInt64LE(0).toString();
  }
  return String(handle.readUInt32LE(0));
}

function workerWAttachScript(input) {
  const hwnd = String(input.hwnd || '');
  if (!/^\d+$/.test(hwnd)) throw new Error('WALLPAPER_NATIVE_HANDLE_INVALID');
  const x = Math.round(Number(input.x) || 0);
  const y = Math.round(Number(input.y) || 0);
  const width = Math.max(1, Math.round(Number(input.width) || 1));
  const height = Math.max(1, Math.round(Number(input.height) || 1));
  return `
$ErrorActionPreference = "Stop"
if (-not ("MineradioDesktopWallpaperNative" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MineradioDesktopWallpaperNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetParent(IntPtr child);
  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)] private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW", SetLastError=true)] private static extern IntPtr GetWindowLong32(IntPtr hWnd, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW", SetLastError=true)] private static extern IntPtr SetWindowLong32(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder value, int maxCount);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
  public static IntPtr FindWindowByClass(string className) { return FindWindow(className, null); }
  public static IntPtr FindWindowExByClass(IntPtr parent, IntPtr childAfter, string className) { return FindWindowEx(parent, childAfter, className, null); }
  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int index) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, index) : GetWindowLong32(hWnd, index); }
  public static IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value) { return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, index, value) : SetWindowLong32(hWnd, index, value); }
}
"@
}
$previousDpiContext = [IntPtr]::Zero
try { $previousDpiContext = [MineradioDesktopWallpaperNative]::SetThreadDpiAwarenessContext([IntPtr]::new([Int64]-4)) } catch { }
$progman = [MineradioDesktopWallpaperNative]::FindWindowByClass("Progman")
if ($progman -eq [IntPtr]::Zero) { throw "WALLPAPER_PROGMAN_NOT_FOUND" }
$sendResult = [IntPtr]::Zero
[MineradioDesktopWallpaperNative]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$sendResult) | Out-Null
$script:workerw = [IntPtr]::Zero
$callback = [MineradioDesktopWallpaperNative+EnumWindowsProc]{
  param([IntPtr]$top, [IntPtr]$state)
  $shellView = [MineradioDesktopWallpaperNative]::FindWindowExByClass($top, [IntPtr]::Zero, "SHELLDLL_DefView")
  if ($shellView -ne [IntPtr]::Zero) {
    $candidate = [MineradioDesktopWallpaperNative]::FindWindowExByClass([IntPtr]::Zero, $top, "WorkerW")
    if ($candidate -ne [IntPtr]::Zero) { $script:workerw = $candidate }
  }
  return $true
}
[MineradioDesktopWallpaperNative]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
if ($script:workerw -eq [IntPtr]::Zero) { throw "WALLPAPER_WORKERW_NOT_FOUND" }
$target = [IntPtr]::new([Int64]${hwnd})
if (-not [MineradioDesktopWallpaperNative]::IsWindow($target)) { throw "WALLPAPER_TARGET_NOT_FOUND" }
$GWL_STYLE = -16
$WS_POPUP = [Int64]0x80000000
$WS_CHILD = [Int64]0x40000000
$style = [MineradioDesktopWallpaperNative]::GetWindowLongPtr($target, $GWL_STYLE).ToInt64()
$childStyle = ($style -band (-bnot $WS_POPUP)) -bor $WS_CHILD
[MineradioDesktopWallpaperNative]::SetWindowLongPtr($target, $GWL_STYLE, [IntPtr]::new([Int64]$childStyle)) | Out-Null
$verifiedStyle = [MineradioDesktopWallpaperNative]::GetWindowLongPtr($target, $GWL_STYLE).ToInt64()
if (($verifiedStyle -band $WS_CHILD) -eq 0 -or ($verifiedStyle -band $WS_POPUP) -ne 0) { throw "WALLPAPER_CHILD_STYLE_FAILED" }
[MineradioDesktopWallpaperNative]::SetParent($target, $script:workerw) | Out-Null
$parent = [MineradioDesktopWallpaperNative]::GetParent($target)
if ($parent -ne $script:workerw) { throw "WALLPAPER_WORKERW_ATTACH_FAILED" }
$origin = New-Object MineradioDesktopWallpaperNative+POINT
$origin.X = ${x}
$origin.Y = ${y}
if (-not [MineradioDesktopWallpaperNative]::ScreenToClient($script:workerw, [ref]$origin)) { throw "WALLPAPER_WORKERW_BOUNDS_FAILED" }
$positioned = [MineradioDesktopWallpaperNative]::SetWindowPos($target, [IntPtr]::new([Int64]1), $origin.X, $origin.Y, ${width}, ${height}, 0x0030)
if (-not $positioned) { throw "WALLPAPER_WORKERW_POSITION_FAILED" }
$className = New-Object System.Text.StringBuilder 128
[MineradioDesktopWallpaperNative]::GetClassName($script:workerw, $className, $className.Capacity) | Out-Null
[pscustomobject]@{
  ok = $true
  targetWindowId = $target.ToInt64().ToString()
  parentWindowId = $parent.ToInt64().ToString()
  parentClassName = $className.ToString()
  x = ${x}
  y = ${y}
  width = ${width}
  height = ${height}
} | ConvertTo-Json -Compress
if ($previousDpiContext -ne [IntPtr]::Zero) {
  try { [MineradioDesktopWallpaperNative]::SetThreadDpiAwarenessContext($previousDpiContext) | Out-Null } catch { }
}
`;
}

function parseAttachOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && parsed.ok === true) return parsed;
    } catch (_) { }
  }
  throw new Error('WALLPAPER_WORKERW_ACK_INVALID');
}

function nativeAttachFailureMessage(error, stderr) {
  const diagnostic = String(stderr || error && error.message || 'WALLPAPER_WORKERW_ATTACH_FAILED');
  const code = diagnostic.match(/WALLPAPER_[A-Z0-9_]+/);
  return code ? code[0] : String(error && error.code || 'WALLPAPER_WORKERW_ATTACH_FAILED');
}

function attachWallpaperWindowToDesktop(options = {}) {
  const execFileImpl = options.execFileImpl;
  if (typeof execFileImpl !== 'function') return Promise.reject(new Error('WALLPAPER_EXEC_UNAVAILABLE'));
  let script;
  try {
    script = workerWAttachScript(options);
  } catch (error) {
    return Promise.reject(error);
  }
  const nativeTempPath = String(options.nativeTempPath || '').trim();
  const env = { ...process.env };
  if (nativeTempPath) {
    env.TEMP = nativeTempPath;
    env.TMP = nativeTempPath;
  }
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    let child = null;
    let settled = false;
    const cleanup = () => {
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', handleAbort);
    };
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const handleAbort = () => {
      if (settled) return;
      if (child && typeof child.kill === 'function') {
        try { child.kill(); } catch (_) { }
      }
      const failure = new Error('WALLPAPER_NATIVE_ATTACH_ABORTED');
      failure.code = 'WALLPAPER_NATIVE_ATTACH_ABORTED';
      finishReject(failure);
    };
    if (signal && signal.aborted) {
      handleAbort();
      return;
    }
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', handleAbort, { once: true });
    try {
      child = execFileImpl('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        windowsHide: true,
        timeout: Math.max(1000, Math.min(10000, Number(options.timeoutMs) || 5000)),
        maxBuffer: 128 * 1024,
        env,
      }, (error, stdout, stderr) => {
        if (settled) return;
        if (error) {
          const failure = new Error(nativeAttachFailureMessage(error, stderr));
          failure.code = failure.message;
          finishReject(failure);
          return;
        }
        try {
          const parsed = parseAttachOutput(stdout);
          settled = true;
          cleanup();
          resolve(parsed);
        } catch (parseError) {
          finishReject(parseError);
        }
      });
    } catch (error) {
      finishReject(error);
    }
  });
}


module.exports = {
  DEFAULT_WALLPAPER_STATE,
  attachWallpaperWindowToDesktop,
  nativeWindowHandleDecimal,
  normalizeWallpaperFrameRate,
  normalizeWallpaperState,
  workerWAttachScript,
};
