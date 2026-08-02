'use strict';

// Mineradio-upgrade 的 Wallpaper Engine + 完整桌面模式主进程桥接层。
// 从 Mineradio-main (v2.1.0) 的 desktop/main.js 中抽取并适配：
// - WallpaperEngineLibrary：扫描本机 Steam Wallpaper Engine 库、读取项目、自定义协议
// - WallpaperEngineRuntime：启动场景窗口、DWM 表面、玻璃采样、图标分层、指针转发
// - FullDesktopModeRuntime：把主窗口挂到桌面 WorkerW、图标形状避让、共存交互
// 主进程只需 registerScheme + createBridge + installWindow + installProtocol + dispose。

const path = require('path');
const { execFile } = require('child_process');
const {
  app, ipcMain, globalShortcut, dialog, shell, session, screen,
} = require('electron');
const {
  WallpaperEngineLibrary,
  registerWallpaperEngineScheme,
} = require('./wallpaper-engine-library');
const { WallpaperEngineRuntime } = require('./wallpaper-engine-runtime');
const { FullDesktopModeRuntime } = require('./full-desktop-mode-runtime');
const { nativeWindowHandleDecimal } = require('./wallpaper-mode-runtime');

const WALLPAPER_ENGINE_CAPTURE_GRANT_MS = 12000;
const WALLPAPER_ENGINE_CAPTURE_PREPARE_TIMEOUT_MS = 9000;
const WALLPAPER_ENGINE_MAX_CAPTURE_FPS = 240;
const WALLPAPER_ENGINE_HOST_RESUME_TIMEOUT_MS = 30000;
const LOCAL_APP_PERMISSION_ALLOWLIST = new Set(['speaker-selection', 'pointerLock', 'pointer-lock']);

function startupDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 真实探测当前进程是否以管理员权限运行。
// 不传这个探测时，WallpaperEngineRuntime 会默认把所有控制命令走
// “桌面壳代理”慢通道（且容易与自动恢复/切换产生竞态），
// 源项目里通过 systemMemory.probeProcessElevation 提供真实值。
function probeProcessElevation() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    const script =
      '$p=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent();' +
      '($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) | ConvertTo-Json -Compress';
    execFile('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
    ], { timeout: 10000, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      const text = String(stdout || '').trim();
      resolve(text === 'true' || text === 'True');
    });
  });
}

function createWallpaperEngineBridge(options = {}) {
  const getMainWindow = typeof options.getMainWindow === 'function' ? options.getMainWindow : () => null;
  const sendWindowState = typeof options.sendWindowState === 'function' ? options.sendWindowState : () => {};
  const desktopCapturer = options.desktopCapturer;
  const userDataPath = String(options.userDataPath || app.getPath('userData'));
  const nativeTempPath = path.join(userDataPath, 'native-helper-temp');

  const wallpaperEngineLibrary = new WallpaperEngineLibrary({ userDataPath });
  const wallpaperEngineRuntime = new WallpaperEngineRuntime({
    library: wallpaperEngineLibrary,
    desktopCapturer,
    nativeTempPath,
    hostElevationProbe: probeProcessElevation,
  });

  let wallpaperEngineCaptureSourceId = '';
  let wallpaperEngineCaptureGrant = null;
  let wallpaperEngineCaptureOperation = 0;
  let wallpaperEngineCapturePreparationOperation = 0;
  let wallpaperEngineGlassCaptureOperation = 0;
  let wallpaperEngineHostBoundsRestartTimer = null;
  let wallpaperEngineHostBoundsRestartPending = false;
  let wallpaperEngineHostBoundsStopPromise = null;
  let wallpaperEngineHostBoundsOperation = 0;
  let wallpaperEngineHostBoundsFollowupReason = '';
  let wallpaperEngineHostVisibilitySuspended = false;
  let wallpaperEngineHostVisibilityResumePending = false;
  let wallpaperEngineHostVisibilityResumeTimer = null;
  let wallpaperEngineHostVisibilityOperation = 0;
  let wallpaperEngineHostVisibilityStopPromise = null;
  let fullDesktopModeHostVisibilityTransitionDepth = 0;
  let wallpaperEngineDesktopIconLayeringQueue = Promise.resolve(true);
  let fullDesktopEnableOperation = 0;
  let fullDesktopEnablePending = false;
  let fullDesktopEscapeExitPending = false;
  let fullDesktopEscapeRegistered = false;
  let appQuitting = false;

  const fullDesktopModeRuntime = new FullDesktopModeRuntime({
    screen,
    platform: process.platform,
    execFileImpl: execFile,
    nativeTempPath,
    beforePassive: ({ win, reason }) => prepareWallpaperEngineProjectPreviewBeforeDesktopEmbedding(win, reason),
    requestReconcile: (reason) => reconcileFullDesktopMode(reason),
    onStatus: (status) => broadcastDesktopWallpaperStatus(status),
  });

  function mainWindow() {
    return getMainWindow();
  }

  function isLocalAppUrl(value) {
    try {
      const u = new URL(String(value || ''));
      return u.protocol === 'http:' && u.hostname === '127.0.0.1'
        && Number(u.port || 0) === Number(process.env.PORT || 0);
    } catch (_) {
      return false;
    }
  }

  function isTrustedMainWindowIpc(event) {
    try {
      const win = mainWindow();
      if (!event || !event.sender || !win || win.isDestroyed()) return false;
      if (event.sender !== win.webContents || event.sender.isDestroyed()) return false;
      if (event.senderFrame && event.senderFrame.parent) return false;
      const sourceUrl = (event.senderFrame && event.senderFrame.url) || event.sender.getURL();
      const u = new URL(String(sourceUrl || ''));
      if (!isLocalAppUrl(u.href)) return false;
      const pathname = path.posix.normalize(u.pathname || '/');
      return pathname === '/' || pathname === '/index.html';
    } catch (_) {
      return false;
    }
  }

  function isTrustedWallpaperEngineIpc(event) {
    return isTrustedMainWindowIpc(event);
  }

  function broadcastDesktopWallpaperStatus(status) {
    const win = mainWindow();
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
    win.webContents.send('mineradio-wallpaper-runtime-state', {
      ...(status || fullDesktopModeRuntime.getStatus('broadcast')),
      recoveryTrayAvailable: false,
      escapeShortcutRegistered: fullDesktopEscapeRegistered === true,
    });
  }

  function wallpaperEngineProvidesDesktopBackdrop() {
    const status = wallpaperEngineRuntime.getStatus();
    return !!(status && status.active === true
      && status.captureMode === 'dwm-thumbnail'
      && status.dwmSurfaceReady === true
      && status.dwmSurfaceActive === true
      && Number(status.dwmSurfaceWindowId) > 0);
  }

  function wallpaperEngineTargetFps(display, requestedFps) {
    const displayFrequency = Math.max(24, Math.min(
      WALLPAPER_ENGINE_MAX_CAPTURE_FPS,
      Math.round(Number(display && display.displayFrequency) || 60)
    ));
    const requested = Number(requestedFps);
    if (!Number.isFinite(requested) || requested <= 0) return displayFrequency;
    return Math.max(24, Math.min(displayFrequency, WALLPAPER_ENGINE_MAX_CAPTURE_FPS, Math.round(requested)));
  }

  function wallpaperEngineHostCornerRadius(win) {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return 0;
    const bounds = win.getContentBounds();
    const display = screen.getDisplayMatching(bounds);
    const scaleFactor = Math.max(1, Number(display && display.scaleFactor) || 1);
    return Math.max(0, Math.round(34 * scaleFactor));
  }

  function wallpaperEnginePhysicalContentBounds(win, fallback = {}) {
    const bounds = win && !win.isDestroyed()
      ? win.getContentBounds()
      : {
        x: Number(fallback.x) || 0,
        y: Number(fallback.y) || 0,
        width: Number(fallback.width) || 1280,
        height: Number(fallback.height) || 720,
      };
    const display = screen.getDisplayMatching(bounds);
    const scaleFactor = Math.max(1, Number(display && display.scaleFactor) || 1);
    if (win && !win.isDestroyed() && typeof screen.dipToScreenRect === 'function') {
      try {
        const physicalRect = screen.dipToScreenRect(win, bounds);
        if (physicalRect && Number(physicalRect.width) > 0 && Number(physicalRect.height) > 0) {
          return {
            bounds,
            display,
            scaleFactor,
            x: Math.round(Number(physicalRect.x) || 0),
            y: Math.round(Number(physicalRect.y) || 0),
            width: Math.max(1, Math.round(Number(physicalRect.width) || 1)),
            height: Math.max(1, Math.round(Number(physicalRect.height) || 1)),
          };
        }
      } catch (_) { }
    }
    const dipOrigin = { x: Number(bounds.x) || 0, y: Number(bounds.y) || 0 };
    const dipEnd = {
      x: dipOrigin.x + Math.max(1, Number(bounds.width) || Number(fallback.width) || 1280),
      y: dipOrigin.y + Math.max(1, Number(bounds.height) || Number(fallback.height) || 720),
    };
    const physicalOrigin = typeof screen.dipToScreenPoint === 'function'
      ? screen.dipToScreenPoint(dipOrigin)
      : { x: Math.round(dipOrigin.x * scaleFactor), y: Math.round(dipOrigin.y * scaleFactor) };
    const physicalEnd = typeof screen.dipToScreenPoint === 'function'
      ? screen.dipToScreenPoint(dipEnd)
      : { x: Math.round(dipEnd.x * scaleFactor), y: Math.round(dipEnd.y * scaleFactor) };
    return {
      bounds,
      display,
      scaleFactor,
      x: Number.isFinite(Number(physicalOrigin.x)) ? Number(physicalOrigin.x) : 0,
      y: Number.isFinite(Number(physicalOrigin.y)) ? Number(physicalOrigin.y) : 0,
      width: Math.max(1, Math.abs(Math.round(Number(physicalEnd.x) - Number(physicalOrigin.x)))
        || Math.round((Number(bounds.width) || 1280) * scaleFactor)),
      height: Math.max(1, Math.abs(Math.round(Number(physicalEnd.y) - Number(physicalOrigin.y)))
        || Math.round((Number(bounds.height) || 720) * scaleFactor)),
    };
  }

  function clearWallpaperEngineCaptureGrant(sessionId = '') {
    const expectedSessionId = String(sessionId || '');
    if (expectedSessionId && !wallpaperEngineCaptureGrant) return false;
    if (expectedSessionId && wallpaperEngineCaptureGrant.sessionId !== expectedSessionId) return false;
    if (!wallpaperEngineCaptureGrant) return false;
    if (wallpaperEngineCapturePreparationOperation === wallpaperEngineCaptureGrant.operation) {
      wallpaperEngineCapturePreparationOperation = 0;
    }
    wallpaperEngineCaptureGrant = null;
    wallpaperEngineCaptureSourceId = '';
    return true;
  }

  function createWallpaperEngineCaptureGrant(result, operation, grantOptions = {}) {
    const sessionId = String(result && result.sessionId || '');
    const sourceId = String(result && result.sourceId || '');
    if (!/^[a-f0-9]{24}$/i.test(sessionId) || !sourceId) {
      clearWallpaperEngineCaptureGrant();
      return null;
    }
    wallpaperEngineCaptureSourceId = sourceId;
    wallpaperEngineCaptureGrant = {
      sessionId,
      sourceId,
      operation: Number(operation) || 0,
      kind: grantOptions.kind === 'dwm-glass' ? 'dwm-glass' : 'scene',
      captureSource: grantOptions.captureSource || null,
      expiresAt: Date.now() + WALLPAPER_ENGINE_CAPTURE_GRANT_MS,
      requestStarted: false,
    };
    return wallpaperEngineCaptureGrant;
  }

  function getWallpaperEngineCaptureGrant() {
    const grant = wallpaperEngineCaptureGrant;
    if (!grant) return null;
    const active = wallpaperEngineRuntime.getStatus();
    if (Date.now() > grant.expiresAt || !active || !active.active || active.sessionId !== grant.sessionId) {
      clearWallpaperEngineCaptureGrant(grant.sessionId);
      return null;
    }
    return grant;
  }

  function isTrustedWallpaperEngineDisplayCapturePermission(webContents, origin, details) {
    try {
      const win = mainWindow();
      if (!webContents || !win || win.isDestroyed() || webContents !== win.webContents || webContents.isDestroyed()) return false;
      if (!isLocalAppUrl(origin)) return false;
      if (details && details.isMainFrame === false) return false;
      const grant = getWallpaperEngineCaptureGrant();
      return !!grant && wallpaperEngineCaptureSourceId === grant.sourceId;
    } catch (_) {
      return false;
    }
  }

  function isTrustedWallpaperEnginePreparationMediaPermission(webContents, origin, details) {
    const grant = getWallpaperEngineCaptureGrant();
    if (!grant || wallpaperEngineCapturePreparationOperation !== grant.operation) return false;
    const mediaType = String(details && details.mediaType || '').toLowerCase();
    const mediaTypes = details && Array.isArray(details.mediaTypes)
      ? details.mediaTypes.map((value) => String(value || '').toLowerCase()).filter(Boolean)
      : [];
    if (mediaType.includes('audio') || mediaTypes.some((value) => value.includes('audio'))) return false;
    if (mediaType && !mediaType.includes('video')) return false;
    if (mediaTypes.length && !mediaTypes.every((value) => value.includes('video'))) return false;
    return isTrustedWallpaperEngineDisplayCapturePermission(webContents, origin, details);
  }

  async function prepareWallpaperEngineRendererGlassCapture(sessionId, fps, sourceId) {
    const win = mainWindow();
    if (!win || win.isDestroyed() || !/^[a-f0-9]{24}$/i.test(String(sessionId || ''))) {
      return { ok: false, error: 'WALLPAPER_GLASS_CAPTURE_RENDERER_UNAVAILABLE' };
    }
    const safeSessionId = String(sessionId);
    const safeFps = Math.max(24, Math.min(60, Number(fps) || 60));
    const safeSourceId = /^window:\d+:\d+$/.test(String(sourceId || '')) ? String(sourceId) : '';
    const grant = getWallpaperEngineCaptureGrant();
    if (!grant || grant.kind !== 'dwm-glass' || grant.sessionId !== safeSessionId || grant.sourceId !== safeSourceId) {
      return { ok: false, error: 'WALLPAPER_GLASS_CAPTURE_GRANT_MISSING' };
    }
    const script = `(() => {
      const prepare = window.__mineradioPrepareWallpaperEngineGlassCapture;
      if (typeof prepare !== 'function') return { ok: false, error: 'WALLPAPER_GLASS_CAPTURE_PREPARE_HANDLER_MISSING' };
      return Promise.resolve(prepare(${JSON.stringify(safeSessionId)}, ${safeFps}, ${JSON.stringify(safeSourceId)}))
        .then((value) => value && typeof value === 'object' ? value : { ok: false, error: 'WALLPAPER_GLASS_CAPTURE_PREPARE_RESULT_INVALID' })
        .catch((error) => ({ ok: false, error: String(error && (error.message || error.name) || error || 'WALLPAPER_GLASS_CAPTURE_PREPARE_FAILED').slice(0, 500) }));
    })()`;
    let timeout;
    try {
      wallpaperEngineCapturePreparationOperation = grant.operation;
      const result = await Promise.race([
        win.webContents.executeJavaScript(script, true),
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve({ ok: false, error: 'WALLPAPER_GLASS_CAPTURE_PREPARE_TIMEOUT' }), WALLPAPER_ENGINE_CAPTURE_PREPARE_TIMEOUT_MS);
        }),
      ]);
      return result && typeof result === 'object'
        ? { ok: result.ok === true, error: String(result.error || '').slice(0, 500) }
        : { ok: false, error: 'WALLPAPER_GLASS_CAPTURE_PREPARE_RESULT_INVALID' };
    } catch (error) {
      return { ok: false, error: String(error && (error.message || error.name) || error || 'WALLPAPER_GLASS_CAPTURE_PREPARE_FAILED').slice(0, 500) };
    } finally {
      if (wallpaperEngineCapturePreparationOperation === grant.operation) wallpaperEngineCapturePreparationOperation = 0;
      if (timeout) clearTimeout(timeout);
    }
  }

  async function prepareWallpaperEngineRendererHostBoundsFrame(sessionId, reason = 'bounds-changed') {
    const win = mainWindow();
    if (!win || win.isDestroyed() || !/^[a-f0-9]{24}$/i.test(String(sessionId || ''))) {
      return { ok: false, frozen: false, error: 'WALLPAPER_BOUNDS_FREEZE_RENDERER_UNAVAILABLE' };
    }
    const safeSessionId = String(sessionId);
    const safeReason = String(reason || 'bounds-changed').slice(0, 80);
    const script = `(() => {
      const prepare = window.__mineradioPrepareWallpaperEngineHostBoundsChange;
      if (typeof prepare !== 'function') return { ok: false, frozen: false, error: 'WALLPAPER_BOUNDS_FREEZE_HANDLER_MISSING' };
      try {
        const value = prepare(${JSON.stringify(safeSessionId)}, ${JSON.stringify(safeReason)});
        return value && typeof value === 'object'
          ? value
          : { ok: false, frozen: false, error: 'WALLPAPER_BOUNDS_FREEZE_RESULT_INVALID' };
      } catch (error) {
        return { ok: false, frozen: false, error: String(error && (error.message || error.name) || error || 'WALLPAPER_BOUNDS_FREEZE_FAILED').slice(0, 500) };
      }
    })()`;
    try {
      const result = await win.webContents.executeJavaScript(script, true);
      return result && typeof result === 'object'
        ? { ok: result.ok === true, frozen: result.frozen === true, error: String(result.error || '').slice(0, 500) }
        : { ok: false, frozen: false, error: 'WALLPAPER_BOUNDS_FREEZE_RESULT_INVALID' };
    } catch (error) {
      return { ok: false, frozen: false, error: String(error && (error.message || error.name) || error || 'WALLPAPER_BOUNDS_FREEZE_FAILED').slice(0, 500) };
    }
  }

  async function prepareWallpaperEngineRendererDesktopPreview(sessionId, reason = 'full-desktop-passive') {
    const win = mainWindow();
    const safeSessionId = String(sessionId || '');
    const safeReason = String(reason || 'full-desktop-passive').slice(0, 80);
    if (!win || win.isDestroyed() || (safeSessionId && !/^[a-f0-9]{24}$/i.test(safeSessionId))) {
      return { ok: false, preview: false, error: 'WALLPAPER_DESKTOP_PREVIEW_RENDERER_UNAVAILABLE' };
    }
    const script = `(() => {
      const prepare = window.__mineradioPrepareWallpaperEngineDesktopPreview;
      if (typeof prepare !== 'function') {
        return { ok: false, preview: false, error: 'WALLPAPER_DESKTOP_PREVIEW_HANDLER_MISSING' };
      }
      return Promise.resolve(prepare(${JSON.stringify(safeSessionId)}, ${JSON.stringify(safeReason)}))
        .then((value) => value && typeof value === 'object'
          ? value
          : { ok: false, preview: false, error: 'WALLPAPER_DESKTOP_PREVIEW_RESULT_INVALID' })
        .catch((error) => ({
          ok: false,
          preview: false,
          error: String(error && (error.message || error.name) || error || 'WALLPAPER_DESKTOP_PREVIEW_FAILED').slice(0, 500)
        }));
    })()`;
    try {
      const result = await win.webContents.executeJavaScript(script, true);
      return result && typeof result === 'object'
        ? {
          ok: result.ok === true,
          preview: result.preview === true,
          selectedEngine: result.selectedEngine === true,
          skipped: result.skipped === true,
          error: String(result.error || '').slice(0, 500),
        }
        : { ok: false, preview: false, error: 'WALLPAPER_DESKTOP_PREVIEW_RESULT_INVALID' };
    } catch (error) {
      return {
        ok: false,
        preview: false,
        error: String(error && (error.message || error.name) || error || 'WALLPAPER_DESKTOP_PREVIEW_FAILED').slice(0, 500),
      };
    }
  }

  function waitForWallpaperEngineHelperExit(child, timeoutMs = 2200) {
    if (!child || child.exitCode !== null || child.signalCode != null) return Promise.resolve(true);
    if (typeof child.once !== 'function') return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (exited) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (typeof child.removeListener === 'function') {
          child.removeListener('exit', onExit);
          child.removeListener('close', onExit);
        }
        resolve(exited === true);
      };
      const onExit = () => finish(true);
      child.once('exit', onExit);
      child.once('close', onExit);
      timer = setTimeout(() => finish(false), Math.max(600, Number(timeoutMs) || 2200));
    });
  }

  async function prepareWallpaperEngineProjectPreviewBeforeDesktopEmbedding(win, reason = 'full-desktop-passive') {
    if (!win || win.isDestroyed() || appQuitting) {
      return { ok: false, error: 'FULL_DESKTOP_WALLPAPER_ENGINE_HOST_UNAVAILABLE' };
    }
    if (wallpaperEngineRuntime.pending) {
      return { ok: false, error: 'WALLPAPER_ENGINE_DESKTOP_TRANSITION_BUSY' };
    }
    const activeSession = wallpaperEngineRuntime.active || null;
    const sessionId = String(activeSession && activeSession.sessionId || '');
    if (activeSession && !/^[a-f0-9]{24}$/i.test(sessionId)) {
      return { ok: false, error: 'WALLPAPER_ENGINE_DESKTOP_SESSION_INVALID' };
    }
    wallpaperEngineHostVisibilitySuspended = true;
    wallpaperEngineHostVisibilityOperation += 1;
    finishWallpaperEngineVisibleHostResume(win);
    cancelWallpaperEngineHostBoundsRestart();
    wallpaperEngineCaptureOperation += 1;
    clearWallpaperEngineCaptureGrant();

    const prepared = await prepareWallpaperEngineRendererDesktopPreview(sessionId, reason);
    if (!prepared || prepared.ok !== true) {
      return {
        ok: false,
        error: String(prepared && prepared.error || 'WALLPAPER_DESKTOP_PREVIEW_UNAVAILABLE'),
      };
    }
    if (wallpaperEngineRuntime.pending
      || (activeSession && wallpaperEngineRuntime.active !== activeSession)
      || (!activeSession && wallpaperEngineRuntime.active)) {
      return { ok: false, error: 'WALLPAPER_ENGINE_DESKTOP_TRANSITION_BUSY' };
    }
    if (!activeSession) {
      return {
        ok: true,
        stopped: false,
        preview: prepared.preview === true,
        selectedEngine: prepared.selectedEngine === true,
      };
    }
    const helperProcess = activeSession.dwmSurfaceProcess || null;
    const helperExit = waitForWallpaperEngineHelperExit(helperProcess);
    const stopPromise = wallpaperEngineRuntime.stop(sessionId);
    wallpaperEngineHostVisibilityStopPromise = stopPromise;
    let stopped;
    try {
      stopped = await stopPromise;
    } catch (error) {
      return {
        ok: false,
        error: String(error && (error.message || error.name) || error || 'FULL_DESKTOP_WALLPAPER_ENGINE_SUSPEND_FAILED'),
      };
    }
    const helperExited = await helperExit;
    if (!stopped || stopped.stopped !== true || wallpaperEngineRuntime.active != null || wallpaperEngineRuntime.pending != null) {
      return {
        ok: false,
        error: String(stopped && stopped.reason || 'FULL_DESKTOP_WALLPAPER_ENGINE_SUSPEND_FAILED'),
      };
    }
    if (helperProcess && helperExited !== true) {
      return { ok: false, error: 'FULL_DESKTOP_WALLPAPER_ENGINE_HELPER_EXIT_TIMEOUT' };
    }
    return {
      ok: true,
      stopped: true,
      preview: prepared.preview === true,
      selectedEngine: prepared.selectedEngine === true,
    };
  }

  function cancelWallpaperEngineHostBoundsRestart() {
    if (wallpaperEngineHostBoundsRestartTimer) {
      clearTimeout(wallpaperEngineHostBoundsRestartTimer);
      wallpaperEngineHostBoundsRestartTimer = null;
    }
    wallpaperEngineHostBoundsRestartPending = false;
    wallpaperEngineHostBoundsStopPromise = null;
    wallpaperEngineHostBoundsFollowupReason = '';
    wallpaperEngineHostBoundsOperation += 1;
  }

  function stopWallpaperEngineRuntimeForRenderer(reason = '') {
    wallpaperEngineCaptureOperation += 1;
    cancelWallpaperEngineHostBoundsRestart();
    clearWallpaperEngineCaptureGrant();
    return wallpaperEngineRuntime.stop().catch((error) => {
      console.warn('[Wallpaper Engine] renderer cleanup failed:', reason || 'renderer-reset', error && error.message || error);
      return { ok: false, stopped: false, error: String(error && (error.message || error.name) || error || 'WALLPAPER_ENGINE_STOP_FAILED') };
    });
  }

  function setMainWindowBackgroundThrottling(win, enabled) {
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
    try {
      win.webContents.setBackgroundThrottling(enabled === true);
    } catch (_) { }
  }

  function finishWallpaperEngineVisibleHostResume(win) {
    wallpaperEngineHostVisibilityResumePending = false;
    if (wallpaperEngineHostVisibilityResumeTimer) {
      clearTimeout(wallpaperEngineHostVisibilityResumeTimer);
      wallpaperEngineHostVisibilityResumeTimer = null;
    }
    const desktopMode = fullDesktopModeRuntime.getStatus('wallpaper-engine-resume-finished');
    setMainWindowBackgroundThrottling(win, desktopMode.enabled === true ? false : true);
  }

  function suspendWallpaperEngineForHiddenHost(win, reason = 'hidden') {
    if (!win || win.isDestroyed()) return Promise.resolve({ ok: true, stopped: false });
    if (wallpaperEngineHostVisibilitySuspended) {
      return wallpaperEngineHostVisibilityStopPromise || Promise.resolve({ ok: true, stopped: true });
    }
    wallpaperEngineHostVisibilitySuspended = true;
    wallpaperEngineHostVisibilityOperation += 1;
    finishWallpaperEngineVisibleHostResume(win);
    cancelWallpaperEngineHostBoundsRestart();
    try {
      win.webContents.send('mineradio-wallpaper-engine-host-bounds-changed', {
        phase: 'prepare',
        reason: String(reason || 'hidden'),
      });
    } catch (_) { }
    wallpaperEngineHostVisibilityStopPromise = stopWallpaperEngineRuntimeForRenderer(`host-${reason || 'hidden'}`);
    return wallpaperEngineHostVisibilityStopPromise;
  }

  function resumeWallpaperEngineForVisibleHost(win, reason = 'visible') {
    const desktopMode = fullDesktopModeRuntime.getStatus('wallpaper-engine-visible-host');
    if (appQuitting || (desktopMode.enabled === true
      && (desktopMode.interactive !== true || desktopMode.phase !== 'interactive'))) return;
    if (!wallpaperEngineHostVisibilitySuspended) return;
    wallpaperEngineHostVisibilitySuspended = false;
    wallpaperEngineHostVisibilityResumePending = true;
    const visibilityOperation = ++wallpaperEngineHostVisibilityOperation;
    const forceVisibleHost = /^full-desktop-/i.test(String(reason || ''));
    setMainWindowBackgroundThrottling(win, false);
    if (wallpaperEngineHostVisibilityResumeTimer) clearTimeout(wallpaperEngineHostVisibilityResumeTimer);
    wallpaperEngineHostVisibilityResumeTimer = setTimeout(() => {
      finishWallpaperEngineVisibleHostResume(win);
    }, WALLPAPER_ENGINE_HOST_RESUME_TIMEOUT_MS);
    const notifyRestart = () => {
      if (wallpaperEngineHostVisibilityOperation !== visibilityOperation
        || wallpaperEngineHostVisibilitySuspended
        || !win
        || win.isDestroyed()
        || !win.isVisible()
        || win.isMinimized()) return;
      try {
        win.webContents.send('mineradio-wallpaper-engine-host-bounds-changed', {
          phase: 'restart',
          reason: String(reason || 'visible'),
          forceVisibleHost,
        });
      } catch (_) { }
    };
    const stopped = wallpaperEngineHostVisibilityStopPromise;
    Promise.resolve(stopped).catch(() => null).finally(() => {
      if (wallpaperEngineHostVisibilityStopPromise === stopped) wallpaperEngineHostVisibilityStopPromise = null;
      if (wallpaperEngineHostVisibilityOperation !== visibilityOperation || wallpaperEngineHostVisibilitySuspended) return;
      setTimeout(notifyRestart, 80);
      setTimeout(notifyRestart, 420);
      setTimeout(notifyRestart, 1100);
    });
  }

  function fullDesktopIconLayeringDesired(reason = '') {
    const status = fullDesktopModeRuntime.getStatus(reason || 'dwm-icon-layering');
    return status.enabled === true
      && status.interactive === true
      && status.coexisting === true
      && status.iconShapeActive === true;
  }

  function requestFullDesktopEscapeExit(reason = 'escape-key') {
    const status = fullDesktopModeRuntime.getStatus(`${reason}-request`);
    if (fullDesktopEscapeExitPending || (status.enabled !== true && fullDesktopEnablePending !== true)) return false;
    fullDesktopEscapeExitPending = true;
    fullDesktopEnableOperation += 1;
    fullDesktopEnablePending = false;
    const exitOperation = status.enabled === true
      ? disableFullDesktopMode(reason)
      : syncWallpaperEngineDesktopIconLayering(`${reason}-cancelled-enable`, false).then(() => ({
        ok: true,
        enabled: false,
        cancelled: true,
      }));
    Promise.resolve(exitOperation).catch((error) => {
      console.warn('[FullDesktopMode] Escape exit failed:', error && error.message || error);
    }).finally(() => {
      fullDesktopEscapeExitPending = false;
      syncFullDesktopEscapeShortcut(`${reason}-settled`);
    });
    return true;
  }

  function registerFullDesktopEscapeShortcut() {
    if (fullDesktopEscapeRegistered) return true;
    let registered = false;
    try {
      registered = globalShortcut.register('Escape', () => requestFullDesktopEscapeExit('escape-key'));
    } catch (_) {
      registered = false;
    }
    fullDesktopEscapeRegistered = registered === true;
    return fullDesktopEscapeRegistered;
  }

  function unregisterFullDesktopEscapeShortcut() {
    if (fullDesktopEscapeRegistered) {
      try { globalShortcut.unregister('Escape'); } catch (_) { }
    }
    fullDesktopEscapeRegistered = false;
  }

  function syncFullDesktopEscapeShortcut(reason = 'desktop-state') {
    const status = fullDesktopModeRuntime.getStatus(reason);
    if (status.enabled === true || fullDesktopEnablePending === true) registerFullDesktopEscapeShortcut();
    else unregisterFullDesktopEscapeShortcut();
  }

  function syncWallpaperEngineDesktopIconLayering(reason = 'desktop-state', desiredOverride) {
    const operation = async () => {
      const desired = typeof desiredOverride === 'boolean'
        ? desiredOverride
        : fullDesktopIconLayeringDesired(`${reason}-queued`);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const active = wallpaperEngineRuntime.getStatus();
        if (!active || active.active !== true || !active.sessionId
          || active.captureMode !== 'dwm-thumbnail') return true;
        try {
          const updated = await wallpaperEngineRuntime.updateDwmDesktopIconLayering(active.sessionId, desired);
          if (updated === true) return true;
        } catch (error) {
          console.warn('[FullDesktopMode] DWM desktop-icon layering sync failed:', reason, error && error.message || error);
        }
        if (attempt < 3) await startupDelay(70 + attempt * 55);
      }
      console.warn('[FullDesktopMode] DWM desktop-icon layering was not acknowledged:', reason, desired);
      return false;
    };
    wallpaperEngineDesktopIconLayeringQueue = wallpaperEngineDesktopIconLayeringQueue.then(operation, operation);
    return wallpaperEngineDesktopIconLayeringQueue;
  }

  function syncWallpaperEngineWithFullDesktopMode(win, reason = 'desktop-state') {
    if (!win || win.isDestroyed()) return;
    const desktopMode = fullDesktopModeRuntime.getStatus(reason);
    if (!appQuitting && (desktopMode.enabled !== true || desktopMode.interactive === true)) {
      resumeWallpaperEngineForVisibleHost(win, `full-desktop-${reason}`);
    }
    sendWindowState(win);
  }

  async function enableFullDesktopMode(win, enableOptions = {}) {
    const enableOperation = ++fullDesktopEnableOperation;
    fullDesktopEnablePending = true;
    registerFullDesktopEscapeShortcut();
    fullDesktopModeHostVisibilityTransitionDepth += 1;
    try {
      if (!enableOptions || enableOptions.interactive !== false) {
        await syncWallpaperEngineDesktopIconLayering('enable-coexist-preflight', true);
      }
      if (enableOperation !== fullDesktopEnableOperation || fullDesktopEnablePending !== true) {
        return { ok: false, enabled: false, cancelled: true, error: 'FULL_DESKTOP_ENABLE_CANCELLED' };
      }
      return await fullDesktopModeRuntime.enable(win, enableOptions);
    } finally {
      if (enableOperation === fullDesktopEnableOperation) fullDesktopEnablePending = false;
      await syncWallpaperEngineDesktopIconLayering('enable-settled').catch(() => false);
      fullDesktopModeHostVisibilityTransitionDepth = Math.max(0, fullDesktopModeHostVisibilityTransitionDepth - 1);
      syncWallpaperEngineWithFullDesktopMode(win, 'enable-settled');
      syncFullDesktopEscapeShortcut('enable-settled-escape');
    }
  }

  async function setFullDesktopModeInteractive(value, reason = 'interaction-changed') {
    fullDesktopModeHostVisibilityTransitionDepth += 1;
    try {
      if (value === true) await syncWallpaperEngineDesktopIconLayering(`${reason}-coexist-preflight`, true);
      return await fullDesktopModeRuntime.setInteractive(value, reason);
    } finally {
      await syncWallpaperEngineDesktopIconLayering(`${reason}-settled`).catch(() => false);
      fullDesktopModeHostVisibilityTransitionDepth = Math.max(0, fullDesktopModeHostVisibilityTransitionDepth - 1);
      syncWallpaperEngineWithFullDesktopMode(mainWindow(), `${reason}-settled`);
      syncFullDesktopEscapeShortcut(`${reason}-escape`);
    }
  }

  async function disableFullDesktopMode(reason = 'disabled') {
    fullDesktopEnableOperation += 1;
    fullDesktopEnablePending = false;
    fullDesktopModeHostVisibilityTransitionDepth += 1;
    try {
      return await fullDesktopModeRuntime.disable(reason);
    } finally {
      await syncWallpaperEngineDesktopIconLayering(`${reason}-settled`).catch(() => false);
      fullDesktopModeHostVisibilityTransitionDepth = Math.max(0, fullDesktopModeHostVisibilityTransitionDepth - 1);
      syncWallpaperEngineWithFullDesktopMode(mainWindow(), `${reason}-settled`);
      syncFullDesktopEscapeShortcut(`${reason}-escape`);
    }
  }

  async function reconcileFullDesktopMode(reason = 'display-change') {
    fullDesktopModeHostVisibilityTransitionDepth += 1;
    try {
      return await fullDesktopModeRuntime.reconcile(reason);
    } finally {
      await syncWallpaperEngineDesktopIconLayering(`${reason}-settled`).catch(() => false);
      fullDesktopModeHostVisibilityTransitionDepth = Math.max(0, fullDesktopModeHostVisibilityTransitionDepth - 1);
      syncWallpaperEngineWithFullDesktopMode(mainWindow(), `${reason}-settled`);
      syncFullDesktopEscapeShortcut(`${reason}-escape`);
    }
  }

  function scheduleWallpaperEngineHostBoundsRestart(win, reason = 'bounds-changed') {
    if (!win || win.isDestroyed()) return;
    const status = wallpaperEngineRuntime.getStatus();
    if (status && status.active === true && status.captureMode === 'dwm-thumbnail') return;
    if (!wallpaperEngineHostBoundsRestartPending && (!status || status.active !== true)) return;
    let job = wallpaperEngineHostBoundsStopPromise;
    if (job && job.started === true) {
      wallpaperEngineHostBoundsFollowupReason = String(reason || 'bounds-changed').slice(0, 80);
      return;
    }
    if (!job) {
      wallpaperEngineHostBoundsRestartPending = true;
      job = {
        boundsOperation: ++wallpaperEngineHostBoundsOperation,
        captureOperation: 0,
        sessionId: String(status && status.sessionId || ''),
        reason: String(reason || 'bounds-changed').slice(0, 80),
        started: false,
        promise: null,
      };
      wallpaperEngineHostBoundsStopPromise = job;
    } else {
      job.reason = String(reason || job.reason || 'bounds-changed').slice(0, 80);
    }
    if (wallpaperEngineHostBoundsRestartTimer) clearTimeout(wallpaperEngineHostBoundsRestartTimer);
    wallpaperEngineHostBoundsRestartTimer = setTimeout(() => {
      wallpaperEngineHostBoundsRestartTimer = null;
      if (wallpaperEngineHostBoundsStopPromise !== job || job.started === true) return;
      const currentBeforePrepare = wallpaperEngineRuntime.getStatus();
      if (!currentBeforePrepare || currentBeforePrepare.active !== true
        || String(currentBeforePrepare.sessionId || '') !== job.sessionId) {
        wallpaperEngineHostBoundsStopPromise = null;
        wallpaperEngineHostBoundsRestartPending = false;
        return;
      }
      job.started = true;
      job.captureOperation = ++wallpaperEngineCaptureOperation;
      clearWallpaperEngineCaptureGrant();
      job.promise = prepareWallpaperEngineRendererHostBoundsFrame(job.sessionId, job.reason)
        .then(async (prepared) => {
          const current = wallpaperEngineRuntime.getStatus();
          const stale = wallpaperEngineHostBoundsStopPromise !== job
            || wallpaperEngineHostBoundsOperation !== job.boundsOperation
            || wallpaperEngineCaptureOperation !== job.captureOperation
            || wallpaperEngineHostVisibilitySuspended
            || win.isDestroyed()
            || !current
            || current.active !== true
            || String(current.sessionId || '') !== job.sessionId;
          if (stale) {
            return {
              ok: false,
              stale: true,
              frozen: !!(prepared && prepared.frozen === true),
              stopped: false,
            };
          }
          if (!prepared || prepared.ok !== true || prepared.frozen !== true) {
            return {
              ok: false,
              frozen: false,
              stopped: false,
              error: String(prepared && prepared.error || 'WALLPAPER_BOUNDS_FREEZE_UNAVAILABLE'),
            };
          }
          try {
            const stopped = await wallpaperEngineRuntime.stop(job.sessionId);
            return { ok: true, frozen: true, stopped: !!(stopped && stopped.stopped), result: stopped };
          } catch (error) {
            return {
              ok: false,
              frozen: true,
              stopped: false,
              error: String(error && (error.message || error.name) || error || 'WALLPAPER_BOUNDS_RUNTIME_STOP_FAILED'),
            };
          }
        });
      Promise.resolve(job.promise).then((result) => {
        const ownsCurrentJob = wallpaperEngineHostBoundsStopPromise === job;
        const operationCurrent = wallpaperEngineHostBoundsOperation === job.boundsOperation
          && wallpaperEngineCaptureOperation === job.captureOperation;
        if (ownsCurrentJob) {
          wallpaperEngineHostBoundsStopPromise = null;
          wallpaperEngineHostBoundsRestartPending = false;
        }
        if (!result || result.frozen !== true) return;
        const recoveryOnly = !ownsCurrentJob || !operationCurrent || result.stale === true;
        setTimeout(() => {
          if (wallpaperEngineHostVisibilitySuspended
            || win.isDestroyed()
            || !win.isVisible()
            || win.isMinimized()) return;
          if (!recoveryOnly && (wallpaperEngineHostBoundsOperation !== job.boundsOperation
            || wallpaperEngineCaptureOperation !== job.captureOperation)) return;
          try {
            win.webContents.send('mineradio-wallpaper-engine-host-bounds-changed', {
              phase: 'restart',
              reason: recoveryOnly ? 'bounds-stale-recovery' : job.reason,
              forceVisibleHost: true,
            });
          } catch (_) { }
        }, 90);
      }).catch(() => {
        if (wallpaperEngineHostBoundsStopPromise === job) {
          wallpaperEngineHostBoundsStopPromise = null;
          wallpaperEngineHostBoundsRestartPending = false;
        }
      });
    }, 260);
  }

  function configureLocalAppPermissions() {
    const ses = session.defaultSession;
    if (!ses || ses._mineradioPermissionsConfigured) return;
    ses._mineradioPermissionsConfigured = true;
    ses.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      const origin = requestingOrigin || (details && details.requestingUrl)
        || (webContents && webContents.getURL && webContents.getURL()) || '';
      if (permission === 'display-capture') return isTrustedWallpaperEngineDisplayCapturePermission(webContents, origin, details);
      if (permission === 'media') return isTrustedWallpaperEnginePreparationMediaPermission(webContents, origin, details);
      return LOCAL_APP_PERMISSION_ALLOWLIST.has(permission) && isLocalAppUrl(origin);
    });
    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const origin = (details && (details.requestingUrl || details.securityOrigin))
        || (webContents && webContents.getURL && webContents.getURL()) || '';
      if (permission === 'display-capture') {
        callback(isTrustedWallpaperEngineDisplayCapturePermission(webContents, origin, details));
        return;
      }
      if (permission === 'media') {
        callback(isTrustedWallpaperEnginePreparationMediaPermission(webContents, origin, details));
        return;
      }
      callback(LOCAL_APP_PERMISSION_ALLOWLIST.has(permission) && isLocalAppUrl(origin));
    });
    ses.setDisplayMediaRequestHandler((request, callback) => {
      let replied = false;
      const reply = (value) => {
        if (replied) return;
        replied = true;
        callback(value || {});
      };
      Promise.resolve().then(async () => {
        const win = mainWindow();
        const frame = request && request.frame;
        const trustedFrame = !!(frame
          && win
          && !win.isDestroyed()
          && frame === win.webContents.mainFrame
          && !frame.parent
          && isLocalAppUrl(request.securityOrigin));
        const grant = getWallpaperEngineCaptureGrant();
        if (!trustedFrame || !request.videoRequested || request.audioRequested || !grant || grant.requestStarted) {
          reply({});
          return;
        }
        grant.requestStarted = true;
        if (grant.kind === 'dwm-glass') {
          const current = wallpaperEngineRuntime.getStatus();
          const source = grant.captureSource;
          const sourceMatch = /^window:(\d+):\d+$/.exec(String(source && source.id || ''));
          if (wallpaperEngineCaptureGrant !== grant
            || !current
            || current.active !== true
            || current.sessionId !== grant.sessionId
            || current.dwmGlassSurfaceReady !== true
            || current.dwmGlassSurfaceActive !== true
            || !sourceMatch
            || Number(sourceMatch[1]) !== Number(current.dwmGlassSurfaceWindowId)
            || String(source && source.name || '') !== 'Mineradio WE DWM Surface') {
            reply({});
            return;
          }
          reply({ video: source });
          return;
        }
        let refreshed = typeof wallpaperEngineRuntime.refreshActiveSource === 'function'
          ? await wallpaperEngineRuntime.refreshActiveSource(grant.sessionId, {
            timeoutMs: 1600,
            pollIntervalMs: 80,
            includeSource: true,
          })
          : wallpaperEngineRuntime.getStatus();
        let source = refreshed && refreshed.captureSource;
        if (wallpaperEngineCaptureGrant !== grant
          || !refreshed
          || refreshed.sessionId !== grant.sessionId
          || !refreshed.sourceId
          || !source
          || String(source.id || '') !== String(refreshed.sourceId)) {
          reply({});
          return;
        }
        if (refreshed.sourceWindowAligned !== true || String(refreshed.sourceId) !== String(grant.sourceId || '')) {
          await wallpaperEngineRuntime.embedActiveWindow(grant.sessionId, {
            hostWindowId: nativeWindowHandleDecimal(win),
            hostExecutable: process.execPath,
            cornerRadius: wallpaperEngineHostCornerRadius(win),
            desktopIconLayering: fullDesktopIconLayeringDesired('wallpaper-engine-source-refresh'),
          });
          refreshed = await wallpaperEngineRuntime.refreshActiveSource(grant.sessionId, {
            timeoutMs: 1600,
            pollIntervalMs: 80,
            includeSource: true,
          });
          source = refreshed && refreshed.captureSource;
        }
        if (wallpaperEngineCaptureGrant !== grant
          || !refreshed
          || refreshed.sessionId !== grant.sessionId
          || refreshed.sourceWindowAligned !== true
          || !source
          || String(source.id || '') !== String(refreshed.sourceId || '')) {
          reply({});
          return;
        }
        grant.sourceId = String(refreshed.sourceId);
        wallpaperEngineCaptureSourceId = grant.sourceId;
        reply({ video: source });
      }).catch(() => reply({}));
    });
  }

  function registerIpcHandlers() {
    ipcMain.handle('mineradio-wallpaper-engine-list', async (event, payload = {}) => {
      try {
        if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
        const snapshot = await wallpaperEngineLibrary.list({ force: payload && payload.force === true });
        const runtime = await wallpaperEngineRuntime.probe(payload && payload.force === true);
        return { ...snapshot, runtime };
      } catch (error) {
        return { ok: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_SCAN_FAILED' };
      }
    });

    ipcMain.handle('mineradio-wallpaper-engine-project-details', async (event, id) => {
      try {
        if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
        return await wallpaperEngineLibrary.getProjectDetails(String(id || ''));
      } catch (error) {
        return { ok: false, error: error.message || 'WALLPAPER_ENGINE_PROJECT_DETAILS_FAILED' };
      }
    });

    ipcMain.handle('mineradio-wallpaper-engine-open-project-details', async (event, payload = {}) => {
      try {
        if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
        const details = await wallpaperEngineLibrary.getProjectDetails(String(payload && payload.id || ''));
        const workshopId = String(details && details.workshopId || '');
        if (!/^\d{5,32}$/.test(workshopId)) {
          return { ok: false, error: 'WALLPAPER_ENGINE_WORKSHOP_DETAILS_UNAVAILABLE' };
        }
        const target = payload && payload.target === 'workshop' ? 'workshop' : 'we';
        let revealError = '';
        if (target === 'we') {
          try {
            await wallpaperEngineRuntime.revealWorkshop(workshopId);
            return { ok: true, opened: 'wallpaper-engine', workshopId };
          } catch (error) {
            revealError = error && (error.code || error.message) || 'WALLPAPER_ENGINE_REVEAL_FAILED';
          }
        }
        const steamUri = 'steam://url/CommunityFilePage/' + workshopId;
        try {
          await shell.openExternal(steamUri);
          return { ok: true, opened: 'steam-workshop', workshopId, fallback: target === 'we', revealError };
        } catch (_) {
          const webUrl = 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + workshopId;
          await shell.openExternal(webUrl);
          return { ok: true, opened: 'web-workshop', workshopId, fallback: target === 'we', revealError };
        }
      } catch (error) {
        return { ok: false, error: error.message || 'WALLPAPER_ENGINE_OPEN_PROJECT_DETAILS_FAILED' };
      }
    });

    ipcMain.handle('mineradio-wallpaper-engine-choose-directory', async (event) => {
      try {
        if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, canceled: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
        const options = {
          title: '识别并导入 Wallpaper Engine 项目',
          buttonLabel: '识别此目录',
          properties: ['openDirectory'],
        };
        const win = mainWindow();
        const result = win && !win.isDestroyed()
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: true, canceled: true };
        const snapshot = await wallpaperEngineLibrary.addManualRoot(result.filePaths[0]);
        const runtime = await wallpaperEngineRuntime.probe(false);
        return { ...snapshot, runtime, canceled: false };
      } catch (error) {
        return { ok: false, canceled: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_IMPORT_FAILED' };
      }
    });

    ipcMain.handle('mineradio-wallpaper-engine-choose-project-file', async (event) => {
      try {
        if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, canceled: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
        const options = {
          title: '选择 Wallpaper Engine 的 project.json 或场景包（.pkg/.pak）',
          buttonLabel: '导入此项目',
          properties: ['openFile'],
          filters: [
            { name: 'Wallpaper Engine 项目', extensions: ['pkg', 'pak', 'json'] },
          ],
        };
        const win = mainWindow();
        const result = win && !win.isDestroyed()
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: true, canceled: true };
        const selected = path.resolve(result.filePaths[0]);
        const snapshot = await wallpaperEngineLibrary.addManualProjectFile(selected);
        const runtime = await wallpaperEngineRuntime.probe(false);
        return { ...snapshot, runtime, canceled: false };
      } catch (error) {
        return { ok: false, canceled: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_IMPORT_PROJECT_FAILED' };
      }
    });

    ipcMain.handle('mineradio-wallpaper-engine-remove-directory', async (event, rootId) => {
      try {
        if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, projects: [], count: 0, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
        const snapshot = await wallpaperEngineLibrary.removeManualRoot(rootId);
        const runtime = await wallpaperEngineRuntime.probe(false);
        return { ...snapshot, runtime };
      } catch (error) {
        return { ok: false, projects: [], count: 0, error: error.message || 'WALLPAPER_ENGINE_REMOVE_ROOT_FAILED' };
      }
    });

    ipcMain.handle('mineradio-wallpaper-engine-runtime-status', async (event, payload = {}) => {
      try {
        if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, available: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
        const probe = await wallpaperEngineRuntime.probe(payload && payload.force === true);
        return { ...probe, ...wallpaperEngineRuntime.getStatus(), pending: wallpaperEngineRuntime.pending != null };
      } catch (error) {
        return { ok: false, available: false, error: error.message || 'WALLPAPER_ENGINE_RUNTIME_PROBE_FAILED' };
      }
    });

    ipcMain.handle('mineradio-wallpaper-engine-start-scene', async (event, payload = {}) => {
      let operation = 0;
      let startedSessionId = '';
      try {
        if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
        const win = mainWindow();
        operation = ++wallpaperEngineCaptureOperation;
        const desktopMode = fullDesktopModeRuntime.getStatus('wallpaper-engine-start-scene');
        if (wallpaperEngineHostVisibilitySuspended
          || (desktopMode.enabled === true
            && (desktopMode.interactive !== true || desktopMode.phase !== 'interactive'))) {
          return { ok: false, error: 'WALLPAPER_ENGINE_HOST_SUSPENDED' };
        }
        const physicalBounds = wallpaperEnginePhysicalContentBounds(win, payload);
        const display = physicalBounds.display;
        const targetFps = wallpaperEngineTargetFps(display, payload.fps);
        const hostCornerRadius = wallpaperEngineHostCornerRadius(win);
        const result = await wallpaperEngineRuntime.start(String(payload.id || ''), {
          width: Math.max(640, Math.min(7680, physicalBounds.width)),
          height: Math.max(360, Math.min(4320, physicalBounds.height)),
          fps: targetFps,
          x: physicalBounds.x,
          y: physicalBounds.y,
        });
        startedSessionId = String(result && result.sessionId || '');
        if (operation !== wallpaperEngineCaptureOperation) {
          await wallpaperEngineRuntime.stop(startedSessionId).catch(() => {});
          return { ok: false, error: 'WALLPAPER_ENGINE_START_SUPERSEDED', sessionId: startedSessionId };
        }
        let embedded;
        try {
          embedded = await wallpaperEngineRuntime.embedActiveWindow(startedSessionId, {
            hostWindowId: nativeWindowHandleDecimal(win),
            hostExecutable: process.execPath,
            cornerRadius: hostCornerRadius,
            desktopIconLayering: fullDesktopIconLayeringDesired('wallpaper-engine-embed'),
          });
        } catch (embeddingError) {
          clearWallpaperEngineCaptureGrant(startedSessionId);
          await wallpaperEngineRuntime.stop(startedSessionId).catch(() => {});
          return {
            ok: false,
            error: embeddingError && (embeddingError.code || embeddingError.message) || 'WALLPAPER_ENGINE_WINDOW_ISOLATION_FAILED',
            capturePrepared: false,
            sessionId: startedSessionId,
          };
        }
        if (operation !== wallpaperEngineCaptureOperation) {
          await wallpaperEngineRuntime.stop(startedSessionId).catch(() => {});
          return { ok: false, error: 'WALLPAPER_ENGINE_START_SUPERSEDED', sessionId: startedSessionId };
        }
        const grant = createWallpaperEngineCaptureGrant({ ...result, ...embedded }, operation);
        if (!grant) {
          await wallpaperEngineRuntime.stop(startedSessionId).catch(() => {});
          return { ok: false, error: 'WALLPAPER_ENGINE_CAPTURE_UNAVAILABLE', sessionId: startedSessionId };
        }
        const embeddedDesktop = fullDesktopModeRuntime.getStatus('wallpaper-engine-embed-finished');
        if (win && !win.isDestroyed() && embeddedDesktop.enabled !== true) {
          try { win.moveTop(); } catch (_) { }
          try { win.focus(); } catch (_) { }
        } else if (embeddedDesktop.enabled === true && embeddedDesktop.interactive === true) {
          fullDesktopModeRuntime.ensureIconLayerOrder().catch((error) => {
            console.warn('[FullDesktopMode] WE coexistence z-order refresh failed:', error && error.message || error);
          });
        }
        if (operation !== wallpaperEngineCaptureOperation) {
          clearWallpaperEngineCaptureGrant(grant.sessionId);
          await wallpaperEngineRuntime.stop(grant.sessionId).catch(() => {});
          return { ok: false, error: 'WALLPAPER_ENGINE_START_SUPERSEDED', sessionId: grant.sessionId };
        }
        return { ...result, ...embedded, capturePrepared: true, captureMode: 'dwm-thumbnail' };
      } catch (error) {
        if (startedSessionId) {
          clearWallpaperEngineCaptureGrant(startedSessionId);
          await wallpaperEngineRuntime.stop(startedSessionId).catch(() => {});
        } else if (wallpaperEngineCaptureGrant && wallpaperEngineCaptureGrant.operation === operation) {
          clearWallpaperEngineCaptureGrant();
        }
        return { ok: false, error: error.code || error.message || 'WALLPAPER_ENGINE_SCENE_START_FAILED', sessionId: startedSessionId };
      }
    });

    ipcMain.handle('mineradio-wallpaper-engine-capture-result', async (event, payload = {}) => {
      if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
      const sessionId = String(payload && payload.sessionId || '');
      if (!/^[a-f0-9]{24}$/i.test(sessionId)) return { ok: false, error: 'WALLPAPER_ENGINE_SESSION_INVALID' };
      const matched = clearWallpaperEngineCaptureGrant(sessionId);
      let confirmed = false;
      if (matched && payload && payload.ok === true && typeof wallpaperEngineRuntime.confirmCaptureReady === 'function') {
        confirmed = await wallpaperEngineRuntime.confirmCaptureReady(sessionId).catch(() => false);
      }
      if (matched && !confirmed) {
        wallpaperEngineHostBoundsFollowupReason = '';
        await wallpaperEngineRuntime.stop(sessionId).catch(() => {});
      }
      if (matched && confirmed && wallpaperEngineHostVisibilityResumePending) {
        finishWallpaperEngineVisibleHostResume(mainWindow());
      }
      if (matched && confirmed && wallpaperEngineHostBoundsFollowupReason) {
        const followupReason = wallpaperEngineHostBoundsFollowupReason;
        wallpaperEngineHostBoundsFollowupReason = '';
        setTimeout(() => {
          const win = mainWindow();
          if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
          scheduleWallpaperEngineHostBoundsRestart(win, followupReason);
        }, 90);
      }
      if (matched && confirmed) {
        syncWallpaperEngineDesktopIconLayering('wallpaper-engine-capture-ready').catch(() => {});
      }
      return {
        ok: matched && confirmed,
        accepted: matched,
        captureReady: confirmed,
        error: matched && !confirmed ? 'WALLPAPER_ENGINE_DWM_SURFACE_FAILED' : '',
      };
    });

    ipcMain.handle('mineradio-wallpaper-engine-prepare-glass-capture', async (event, payload = {}) => {
      if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
      const sessionId = String(payload && payload.sessionId || '');
      if (!/^[a-f0-9]{24}$/i.test(sessionId)) return { ok: false, error: 'WALLPAPER_ENGINE_SESSION_INVALID' };
      const win = mainWindow();
      if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()
        || wallpaperEngineHostVisibilitySuspended) {
        return { ok: false, error: 'WALLPAPER_GLASS_CAPTURE_HOST_HIDDEN' };
      }
      const captureOperation = wallpaperEngineCaptureOperation;
      const glassOperation = ++wallpaperEngineGlassCaptureOperation;
      try {
        const status = wallpaperEngineRuntime.getStatus();
        if (!status || status.active !== true || status.sessionId !== sessionId
          || status.captureMode !== 'dwm-thumbnail'
          || status.dwmGlassSurfaceReady !== true || status.dwmGlassSurfaceActive !== true) {
          return { ok: false, error: 'WALLPAPER_ENGINE_DWM_GLASS_SURFACE_UNAVAILABLE' };
        }
        const source = await wallpaperEngineRuntime.getDwmGlassCaptureSource(sessionId, {
          timeoutMs: 1800,
          pollIntervalMs: 60,
        });
        if (captureOperation !== wallpaperEngineCaptureOperation
          || glassOperation !== wallpaperEngineGlassCaptureOperation) {
          return { ok: false, error: 'WALLPAPER_ENGINE_START_SUPERSEDED' };
        }
        if (wallpaperEngineCaptureGrant && wallpaperEngineCaptureGrant.kind !== 'dwm-glass') {
          return { ok: false, error: 'WALLPAPER_GLASS_CAPTURE_GRANT_BUSY' };
        }
        clearWallpaperEngineCaptureGrant();
        const grant = createWallpaperEngineCaptureGrant({ sessionId, sourceId: source.id }, glassOperation, {
          kind: 'dwm-glass',
          captureSource: source,
        });
        if (!grant) return { ok: false, error: 'WALLPAPER_GLASS_CAPTURE_SOURCE_INVALID' };
        const prepared = await prepareWallpaperEngineRendererGlassCapture(sessionId, payload && payload.fps, source.id);
        const current = wallpaperEngineRuntime.getStatus();
        if (captureOperation !== wallpaperEngineCaptureOperation
          || glassOperation !== wallpaperEngineGlassCaptureOperation
          || !current || current.active !== true || current.sessionId !== sessionId) {
          return { ok: false, error: 'WALLPAPER_ENGINE_START_SUPERSEDED' };
        }
        return {
          ok: !!(prepared && prepared.ok === true),
          capturePrepared: !!(prepared && prepared.ok === true),
          captureMode: 'dwm-glass-svg-sampler',
          error: String(prepared && prepared.error || ''),
        };
      } catch (error) {
        return {
          ok: false,
          error: String(error && (error.code || error.message || error.name) || error || 'WALLPAPER_GLASS_CAPTURE_PREPARE_FAILED').slice(0, 500),
        };
      } finally {
        if (wallpaperEngineCaptureGrant
          && wallpaperEngineCaptureGrant.kind === 'dwm-glass'
          && wallpaperEngineCaptureGrant.operation === glassOperation) {
          clearWallpaperEngineCaptureGrant(sessionId);
        }
      }
    });

    ipcMain.handle('mineradio-wallpaper-engine-activate-dwm-surface', async (event, payload = {}) => {
      if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
      const sessionId = String(payload && payload.sessionId || '');
      if (!/^[a-f0-9]{24}$/i.test(sessionId)) return { ok: false, error: 'WALLPAPER_ENGINE_SESSION_INVALID' };
      try {
        const result = await wallpaperEngineRuntime.activateDwmSurface(sessionId);
        return {
          ok: !!(result && result.dwmSurfaceActive === true),
          active: !!(result && result.dwmSurfaceActive === true),
          captureMode: 'dwm-thumbnail',
          error: result && result.dwmSurfaceActive === true ? '' : 'WALLPAPER_ENGINE_DWM_SURFACE_FAILED',
        };
      } catch (error) {
        return { ok: false, active: false, error: String(error && (error.code || error.message) || error || 'WALLPAPER_ENGINE_DWM_SURFACE_FAILED') };
      }
    });

    ipcMain.on('mineradio-wallpaper-engine-glass-surface', (event, payload = {}) => {
      if (!isTrustedWallpaperEngineIpc(event) || typeof wallpaperEngineRuntime.updateGlassSurface !== 'function') return;
      const sessionId = String(payload && payload.sessionId || '');
      if (!/^[a-f0-9]{24}$/i.test(sessionId)) return;
      const win = mainWindow();
      if (payload.active === true && (!win
        || win.isDestroyed()
        || !win.isVisible()
        || win.isMinimized()
        || wallpaperEngineHostVisibilitySuspended)) return;
      try { wallpaperEngineRuntime.updateGlassSurface(sessionId, payload); } catch (_) { }
    });

    ipcMain.on('mineradio-wallpaper-engine-pointer-activity', (event, payload = {}) => {
      const win = mainWindow();
      if (!isTrustedWallpaperEngineIpc(event)
        || !win
        || win.isDestroyed()
        || !win.isVisible()
        || win.isMinimized()
        || wallpaperEngineHostVisibilitySuspended) return;
      const sessionId = String(payload && payload.sessionId || '');
      if (!/^[a-f0-9]{24}$/i.test(sessionId)) return;
      const rawXUnit = payload && payload.xUnit;
      const rawYUnit = payload && payload.yUnit;
      const xUnit = Math.round(rawXUnit);
      const yUnit = Math.round(rawYUnit);
      if (typeof rawXUnit !== 'number' || typeof rawYUnit !== 'number'
        || !Number.isFinite(xUnit) || !Number.isFinite(yUnit)
        || xUnit < 0 || xUnit > 65535 || yUnit < 0 || yUnit > 65535) return;
      const status = wallpaperEngineRuntime.getStatus();
      if (!status
        || status.active !== true
        || status.sourceWindowParked !== true
        || String(status.sessionId || '') !== sessionId
        || typeof wallpaperEngineRuntime.noteHostPointerActivity !== 'function') return;
      try {
        wallpaperEngineRuntime.noteHostPointerActivity({ sessionId, xUnit, yUnit });
      } catch (_) { }
    });

    ipcMain.handle('mineradio-wallpaper-engine-stop-scene', async (event, payload = {}) => {
      try {
        if (!isTrustedWallpaperEngineIpc(event)) return { ok: false, error: 'WALLPAPER_ENGINE_UNTRUSTED_CALLER' };
        const sessionId = String(payload.sessionId || '');
        const stopAll = payload && payload.all === true || !sessionId;
        if (stopAll) {
          wallpaperEngineCaptureOperation += 1;
          cancelWallpaperEngineHostBoundsRestart();
          clearWallpaperEngineCaptureGrant();
        }
        const result = await wallpaperEngineRuntime.stop(stopAll ? '' : sessionId);
        const current = wallpaperEngineRuntime.getStatus();
        if (!stopAll && (!current.active || (wallpaperEngineCaptureGrant && wallpaperEngineCaptureGrant.sessionId === sessionId))) {
          clearWallpaperEngineCaptureGrant(sessionId);
        }
        return result;
      } catch (error) {
        return { ok: false, error: error.code || error.message || 'WALLPAPER_ENGINE_SCENE_STOP_FAILED' };
      }
    });

    ipcMain.handle('mineradio-full-desktop-set-enabled', async (event, enabled, payload = {}) => {
      try {
        if (!isTrustedMainWindowIpc(event)) return { ok: false, enabled: false, error: 'FULL_DESKTOP_UNTRUSTED_SENDER' };
        const win = mainWindow();
        if (!win || win.isDestroyed()) return { ok: false, enabled: false, error: 'FULL_DESKTOP_WINDOW_UNAVAILABLE' };
        const status = fullDesktopModeRuntime.getStatus('renderer-set-enabled');
        if (enabled) {
          if (status.enabled === true) {
            return { ok: true, enabled: true, status: fullDesktopModeRuntime.getStatus('renderer-already-enabled') };
          }
          const result = await enableFullDesktopMode(win, {
            interactive: payload && payload.interactive !== false,
            reason: String(payload && payload.reason || 'renderer-enabled'),
          });
          const backdrop = result && result.ok === true && result.enabled === true
            ? {
              ok: true,
              enabled: true,
              active: true,
              kind: wallpaperEngineProvidesDesktopBackdrop() ? 'wallpaper-engine-dwm' : 'system-desktop',
            }
            : null;
          return { ...result, backdropReady: !!backdrop, backdrop };
        }
        return await disableFullDesktopMode('renderer-disabled');
      } catch (error) {
        return { ok: false, enabled: false, error: error.message || 'FULL_DESKTOP_FAILED', status: fullDesktopModeRuntime.getStatus('ipc-failed') };
      }
    });

    ipcMain.on('mineradio-full-desktop-icon-shields', (event, payload = {}) => {
      if (!isTrustedMainWindowIpc(event)) return;
      const rects = payload && payload.enabled === true && payload.interactive === true
        ? payload.rects
        : [];
      fullDesktopModeRuntime.updateIconShields(
        Array.isArray(rects) ? rects : [],
        payload && payload.viewport && typeof payload.viewport === 'object' ? payload.viewport : {}
      );
    });

    ipcMain.handle('mineradio-full-desktop-set-icons-visible', async (event, visible) => {
      if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'DESKTOP_MODE_UNTRUSTED_SENDER' };
      return fullDesktopModeRuntime.setDesktopIconsVisible(visible !== false, 'renderer-icons-visible');
    });

    ipcMain.handle('mineradio-full-desktop-set-software-lock', async (event, locked) => {
      if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'DESKTOP_MODE_UNTRUSTED_SENDER' };
      return fullDesktopModeRuntime.setSoftwareInteractionLocked(locked === true, 'renderer-software-lock');
    });

    ipcMain.handle('mineradio-full-desktop-request-keyboard-focus', async (event, reason) => {
      if (!isTrustedMainWindowIpc(event)) return { ok: false, error: 'UNTRUSTED_KEYBOARD_FOCUS_REQUEST' };
      const focusResult = fullDesktopModeRuntime.requestKeyboardFocus(
        `renderer-${String(reason || 'pointerdown').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 64)}`
      );
      if (focusResult && focusResult.ok) return focusResult;
      const win = getSenderWindowForEvent(event);
      if (!win || win.isDestroyed()) return { ok: false, focused: false, error: 'KEYBOARD_FOCUS_WINDOW_UNAVAILABLE' };
      try { win.focus(); } catch (_) { }
      try { win.webContents.focus(); } catch (_) { }
      return { ok: true, focused: true, mode: 'ordinary-window-refresh' };
    });

    ipcMain.on('mineradio-full-desktop-pointer-route', (event, payload = {}) => {
      if (!isTrustedMainWindowIpc(event)) return;
      fullDesktopModeRuntime.updatePointerRoute({
        overSoftwareUi: payload && payload.overSoftwareUi === true,
        overDesktopControls: payload && payload.overDesktopControls === true,
      }, 'renderer-pointer-route');
    });

    ipcMain.handle('mineradio-wallpaper-get-status', async (event) => {
      if (!isTrustedMainWindowIpc(event)) return { ok: false, enabled: false, error: 'WALLPAPER_UNTRUSTED_SENDER' };
      return {
        ok: true,
        status: {
          ...fullDesktopModeRuntime.getStatus('renderer-query'),
          recoveryTrayAvailable: false,
          escapeShortcutRegistered: fullDesktopEscapeRegistered === true,
        },
      };
    });
  }

  function getSenderWindowForEvent(event) {
    try {
      return require('electron').BrowserWindow.fromWebContents(event.sender);
    } catch (_) {
      return null;
    }
  }

  function installWindow(win) {
    if (!win || win._mineradioWallpaperEngineBridgeInstalled) return;
    win._mineradioWallpaperEngineBridgeInstalled = true;

    win.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      const u = new URL(String(url || 'http://127.0.0.1/'));
      const pathname = path.posix.normalize(u.pathname || '/');
      if (!(u.protocol === 'http:' && u.hostname === '127.0.0.1'
        && (pathname === '/' || pathname === '/index.html'))) return;
      stopWallpaperEngineRuntimeForRenderer('main-frame-navigation');
      disableFullDesktopMode('main-frame-navigation').catch(() => {});
    });

    win.webContents.once('destroyed', () => {
      stopWallpaperEngineRuntimeForRenderer('webcontents-destroyed');
      disableFullDesktopMode('webcontents-destroyed').catch(() => {});
    });

    win.webContents.on('render-process-gone', () => {
      Promise.allSettled([
        stopWallpaperEngineRuntimeForRenderer('render-process-gone'),
        disableFullDesktopMode('main-renderer-gone'),
      ]);
    });

    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape')
        && fullDesktopModeRuntime.getStatus('escape-key-input').enabled === true) {
        event.preventDefault();
        requestFullDesktopEscapeExit('escape-key');
      }
    });

    win.on('minimize', () => {
      if (fullDesktopModeHostVisibilityTransitionDepth <= 0) suspendWallpaperEngineForHiddenHost(win, 'minimize');
    });
    win.on('restore', () => {
      if (fullDesktopModeHostVisibilityTransitionDepth <= 0) resumeWallpaperEngineForVisibleHost(win, 'restore');
    });
    win.on('show', () => {
      if (fullDesktopModeHostVisibilityTransitionDepth > 0) return;
      resumeWallpaperEngineForVisibleHost(win, 'show');
    });
    win.on('hide', () => {
      if (fullDesktopModeHostVisibilityTransitionDepth > 0) return;
      suspendWallpaperEngineForHiddenHost(win, 'hide');
    });
    win.on('move', () => {
      scheduleWallpaperEngineHostBoundsRestart(win, 'move');
    });
    win.on('resize', () => {
      scheduleWallpaperEngineHostBoundsRestart(win, 'resize');
    });
    win.on('enter-full-screen', () => {
      setTimeout(() => scheduleWallpaperEngineHostBoundsRestart(win, 'enter-full-screen'), 40);
    });
    win.on('leave-full-screen', () => {
      setTimeout(() => {
        scheduleWallpaperEngineHostBoundsRestart(win, 'leave-full-screen');
      }, 50);
    });
    win.on('enter-html-full-screen', () => {
      setTimeout(() => scheduleWallpaperEngineHostBoundsRestart(win, 'enter-html-full-screen'), 40);
    });
    win.on('leave-html-full-screen', () => {
      setTimeout(() => {
        scheduleWallpaperEngineHostBoundsRestart(win, 'leave-html-full-screen');
      }, 50);
    });
    win.on('closed', () => {
      cancelWallpaperEngineHostBoundsRestart();
      fullDesktopModeHostVisibilityTransitionDepth = 0;
      wallpaperEngineHostVisibilitySuspended = false;
      wallpaperEngineHostVisibilityOperation += 1;
      wallpaperEngineHostVisibilityStopPromise = null;
      finishWallpaperEngineVisibleHostResume(win);
      stopWallpaperEngineRuntimeForRenderer('main-window-closed');
      disableFullDesktopMode('main-window-closed').catch(() => {});
    });
  }

  async function installProtocol(protocol) {
    try {
      await wallpaperEngineLibrary.installProtocol(protocol);
    } catch (error) {
      console.warn('[Wallpaper Engine] local media protocol unavailable:', error && error.message || error);
    }
  }

  async function dispose() {
    appQuitting = true;
    clearWallpaperEngineCaptureGrant();
    unregisterFullDesktopEscapeShortcut();
    const fullDesktopResult = await fullDesktopModeRuntime.dispose('app-before-quit').catch((error) => ({
      ok: false,
      error: error && error.message || error,
    }));
    if (!fullDesktopResult || fullDesktopResult.ok !== true) {
      console.warn('[FullDesktopMode] dispose incomplete:', fullDesktopResult && (fullDesktopResult.error || fullDesktopResult.lastError) || 'unknown');
    }
    await wallpaperEngineRuntime.dispose().catch((error) => {
      console.warn('[Wallpaper Engine] dispose failed:', error && error.message || error);
    });
    try { wallpaperEngineLibrary.dispose(); } catch (_) { }
    return { ok: true };
  }

  configureLocalAppPermissions();
  registerIpcHandlers();

  return {
    installProtocol,
    installWindow,
    dispose,
    setEnabled: async (enabled, payload = {}) => {
      const win = mainWindow();
      if (!win || win.isDestroyed()) return { ok: false, enabled: false, error: 'FULL_DESKTOP_WINDOW_UNAVAILABLE' };
      const status = fullDesktopModeRuntime.getStatus('bridge-set-enabled');
      if (enabled) {
        if (status.enabled === true) {
          return { ok: true, enabled: true, status: fullDesktopModeRuntime.getStatus('bridge-already-enabled') };
        }
        return await enableFullDesktopMode(win, {
          interactive: payload && payload.interactive !== false,
          reason: String(payload && payload.reason || 'bridge-enabled'),
        });
      }
      return await disableFullDesktopMode(String(payload && payload.reason || 'bridge-disabled'));
    },
    setInteractive: async (value, reason = 'bridge-interaction') => {
      return setFullDesktopModeInteractive(value === true, String(reason || 'bridge-interaction'));
    },
    reconcile: async (reason = 'bridge-display-change') => {
      return reconcileFullDesktopMode(String(reason || 'display-change'));
    },
    isFullDesktopEnabled: () => fullDesktopModeRuntime.getStatus('bridge-query').enabled === true,
    isFullDesktopInteractive: () => {
      const status = fullDesktopModeRuntime.getStatus('bridge-query');
      return status.enabled === true && status.interactive === true;
    },
  };
}

module.exports = {
  createWallpaperEngineBridge,
  registerWallpaperEngineScheme,
};
