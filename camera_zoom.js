// ==UserScript==
// @name         MU Camera Zoom
// @namespace    local.mu.camera.zoom
// @version      0.2.0
// @description  Widen the MU H5 main camera FOV locally. Default 1.25x, with Mac Option hotkeys.
// @match        *://602.com/game/show/*
// @match        *://cdn.qj2h5.jiuxiaokj.cn/mu2h5/h5-data/mu-release/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  if (!isGameFrame(page.location)) {
    return;
  }

  const MARKER = '__MU_CAMERA_ZOOM__';
  const STORAGE_SCALE_KEY = 'mu_camera_zoom_scale';
  const STORAGE_ENABLED_KEY = 'mu_camera_zoom_enabled';
  const STORAGE_VERSION_KEY = 'mu_camera_zoom_version';
  const SCRIPT_VERSION = '0.2.0';
  const DEFAULT_SCALE = 1.25;
  const MIN_SCALE = 1;
  const MAX_SCALE = 1.35;
  const MIN_FOV = 35;
  const MAX_FOV = 78;
  const STEP = 0.05;

  const migrated = migrateStoredSettings();

  const state = {
    enabled: migrated.enabled,
    scale: migrated.scale,
    camera: null,
    baseFieldOfView: 0,
    lastAppliedFieldOfView: 0,
    lastHintAt: 0,
    frameId: 0,
    scanCooldownUntil: 0,
    status: {
      version: SCRIPT_VERSION,
      loadedAt: new Date().toISOString(),
      enabled: true,
      scale: DEFAULT_SCALE,
      defaultScale: DEFAULT_SCALE,
      hotkeys: [
        'Alt + = / Option + =: zoom out',
        'Alt + - / Option + -: zoom in',
        'Alt + 0 / Option + 0: reset to 1.25x',
        'Alt + Shift + 0 / Option + Shift + 0: disable and restore',
      ],
      layaReady: false,
      camerasSeen: 0,
      activeCameraPath: '',
      activeCameraScore: 0,
      activeCameraReason: '',
      applyCount: 0,
      restoreCount: 0,
      rescanCount: 0,
      hotkeyCount: 0,
      lastReason: migrated.reason,
      lastError: '',
      lastAppliedAt: 0,
      baseFieldOfView: 0,
      lastAppliedFieldOfView: 0,
    },
  };

  state.status.enabled = state.enabled;
  state.status.scale = state.scale;

  installHelper();
  installHotkeys();
  scheduleLoop();

  function isGameFrame(locationLike) {
    return locationLike.hostname === 'cdn.qj2h5.jiuxiaokj.cn'
      && locationLike.pathname.includes('/mu2h5/h5-data/mu-release/');
  }

  function installHelper() {
    page[MARKER] = {
      version: state.status.version,
      status: state.status,
      get enabled() {
        return state.enabled;
      },
      setEnabled(value) {
        setEnabled(Boolean(value), 'setEnabled');
      },
      get scale() {
        return state.scale;
      },
      setScale(value) {
        setScale(value, 'setScale');
      },
      reset() {
        setEnabled(true, 'reset');
        setScale(DEFAULT_SCALE, 'reset');
      },
      restore() {
        restoreCamera();
      },
      rescan() {
        clearCamera('manual rescan');
        scanAndApply(true);
      },
    };
  }

  function installHotkeys() {
    page.addEventListener('keydown', (event) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (!event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.code === 'Equal') {
        event.preventDefault();
        state.status.hotkeyCount += 1;
        setEnabled(true, 'Alt + =');
        setScale(state.scale + STEP, 'Alt + =');
        showHint(`视角 ${formatScale(state.scale)}`);
        return;
      }

      if (event.code === 'Minus') {
        event.preventDefault();
        state.status.hotkeyCount += 1;
        setEnabled(true, 'Alt + -');
        setScale(state.scale - STEP, 'Alt + -');
        showHint(`视角 ${formatScale(state.scale)}`);
        return;
      }

      if (event.code === 'Digit0' && event.shiftKey) {
        event.preventDefault();
        state.status.hotkeyCount += 1;
        setEnabled(false, 'Alt + Shift + 0');
        showHint('视角修改：关闭');
        return;
      }

      if (event.code === 'Digit0') {
        event.preventDefault();
        state.status.hotkeyCount += 1;
        setEnabled(true, 'Alt + 0');
        setScale(DEFAULT_SCALE, 'Alt + 0');
        showHint(`视角 ${formatScale(state.scale)}`);
      }
    }, true);
  }

  function scheduleLoop() {
    const tick = () => {
      scanAndApply(false);
      state.frameId = page.requestAnimationFrame(tick);
    };

    state.frameId = page.requestAnimationFrame(tick);
  }

  function scanAndApply(forceScan) {
    try {
      state.status.layaReady = Boolean(page.Laya && page.Laya.stage && page.Laya.Camera);
      if (!state.status.layaReady) {
        state.status.lastReason = 'waiting for Laya';
        return;
      }

      if (forceScan || !isUsableCamera(state.camera) || Date.now() >= state.scanCooldownUntil) {
        const best = findBestCamera();
        state.scanCooldownUntil = Date.now() + 1200;
        if (best && best.camera !== state.camera) {
          restoreCamera();
          state.camera = best.camera;
          state.status.activeCameraPath = best.path;
          state.status.activeCameraScore = best.score;
          state.status.activeCameraReason = best.reason;
          state.status.rescanCount += 1;
          state.baseFieldOfView = normalizeBaseFieldOfView(best.camera.fieldOfView);
          state.lastAppliedFieldOfView = 0;
          state.status.baseFieldOfView = state.baseFieldOfView;
          state.status.lastAppliedFieldOfView = 0;
        }
      }

      if (!state.enabled) {
        restoreCamera();
        return;
      }

      applyCameraZoom();
    } catch (error) {
      state.status.lastError = String(error && (error.stack || error.message) || error);
    }
  }

  function findBestCamera() {
    const candidates = [];
    traverse(page.Laya.stage, (node) => {
      if (!isCamera(node)) {
        return;
      }

      const path = getPath(node);
      const viewportAreaRatio = getViewportAreaRatio(node);
      const scored = scoreCamera(node, path, viewportAreaRatio);
      candidates.push({
        camera: node,
        path,
        viewportAreaRatio,
        score: scored.score,
        accepted: scored.accepted,
        reason: scored.reason,
      });
    });

    state.status.camerasSeen = candidates.length;
    candidates.sort((a, b) => b.score - a.score);
    return candidates.find((candidate) => candidate.accepted) || null;
  }

  function traverse(node, visit, depth) {
    if (!node || depth > 40) {
      return;
    }

    visit(node);
    const count = Number(node.numChildren) || 0;
    for (let index = 0; index < count; index += 1) {
      traverse(node.getChildAt(index), visit, (depth || 0) + 1);
    }
  }

  function isCamera(node) {
    if (!node) {
      return false;
    }

    try {
      if (page.Laya && page.Laya.Camera && node instanceof page.Laya.Camera) {
        return true;
      }
    } catch (error) {
      // Cross-context instanceof can fail under userscript sandboxes.
    }

    return typeof node === 'object'
      && 'fieldOfView' in node
      && 'nearPlane' in node
      && 'farPlane' in node
      && node.transform
      && node.transform.localPosition;
  }

  function scoreCamera(camera, path, viewportAreaRatio) {
    if (camera.orthographic) {
      return { accepted: false, score: -Infinity, reason: 'orthographic camera' };
    }

    if (camera.active === false || camera.activeInHierarchy === false) {
      return { accepted: false, score: -Infinity, reason: 'inactive camera' };
    }

    let score = 0;
    if (/MainCamera/i.test(path)) {
      score += 100;
    }

    if (/camera/i.test(path)) {
      score += 20;
    }

    if (viewportAreaRatio >= 0.7) {
      score += 40;
    } else if (viewportAreaRatio >= 0.25) {
      score += 15;
    }

    if (typeof camera.fieldOfView === 'number' && camera.fieldOfView > 10 && camera.fieldOfView < 120) {
      score += 10;
    }

    if (camera.clearFlag !== undefined && camera.clearFlag !== null) {
      score += 5;
    }

    return { accepted: score > 0, score, reason: 'ok' };
  }

  function applyCameraZoom() {
    const camera = state.camera;
    if (!isUsableCamera(camera)) {
      return;
    }

    if (!Number.isFinite(Number(camera.fieldOfView))) {
      state.status.lastReason = 'camera fieldOfView unavailable';
      return;
    }

    if (!state.baseFieldOfView || Math.abs(Number(camera.fieldOfView) - state.lastAppliedFieldOfView) > 0.5) {
      state.baseFieldOfView = normalizeBaseFieldOfView(camera.fieldOfView);
      state.status.baseFieldOfView = state.baseFieldOfView;
    }

    const nextFieldOfView = computeZoomedFieldOfView(state.baseFieldOfView, state.scale);
    camera.fieldOfView = nextFieldOfView;
    state.lastAppliedFieldOfView = nextFieldOfView;
    state.status.lastAppliedFieldOfView = nextFieldOfView;
    state.status.applyCount += 1;
    state.status.lastAppliedAt = Date.now();
    state.status.lastReason = 'camera FOV zoom applied';
  }

  function restoreCamera() {
    if (!isUsableCamera(state.camera) || !state.baseFieldOfView) {
      return;
    }

    state.camera.fieldOfView = state.baseFieldOfView;
    state.status.restoreCount += 1;
    state.status.lastReason = 'camera restored';
    state.lastAppliedFieldOfView = 0;
    state.status.lastAppliedFieldOfView = 0;
  }

  function clearCamera(reason) {
    restoreCamera();
    state.camera = null;
    state.baseFieldOfView = 0;
    state.lastAppliedFieldOfView = 0;
    state.status.activeCameraPath = '';
    state.status.activeCameraScore = 0;
    state.status.activeCameraReason = '';
    state.status.baseFieldOfView = 0;
    state.status.lastAppliedFieldOfView = 0;
    state.status.lastReason = reason;
  }

  function isUsableCamera(camera) {
    return Boolean(camera && camera.destroyed !== true);
  }

  function normalizeBaseFieldOfView(fieldOfView) {
    const value = Number(fieldOfView);
    if (!Number.isFinite(value) || value <= 0) {
      return 50;
    }

    return Math.max(MIN_FOV, Math.min(MAX_FOV, Math.round(value * 100) / 100));
  }

  function computeZoomedFieldOfView(baseFieldOfView, scale) {
    const base = normalizeBaseFieldOfView(baseFieldOfView);
    const normalizedScale = Number(scale) || 1;
    return Math.max(MIN_FOV, Math.min(MAX_FOV, Math.round(base * normalizedScale * 100) / 100));
  }

  function getPath(node) {
    const parts = [];
    let current = node;
    for (let depth = 0; current && depth < 16; depth += 1) {
      parts.push(current.name || (current.constructor && current.constructor.name) || '(unnamed)');
      current = current.parent;
    }
    return parts.reverse().join('/');
  }

  function getViewportAreaRatio(camera) {
    const viewport = camera.viewport;
    if (!viewport) {
      return 1;
    }

    const width = Number(viewport.width) || 0;
    const height = Number(viewport.height) || 0;
    const stageWidth = Number(page.Laya && page.Laya.stage && page.Laya.stage.width) || width || 1;
    const stageHeight = Number(page.Laya && page.Laya.stage && page.Laya.stage.height) || height || 1;
    return Math.max(0, Math.min(1, (width * height) / Math.max(1, stageWidth * stageHeight)));
  }

  function setEnabled(value, reason) {
    state.enabled = Boolean(value);
    state.status.enabled = state.enabled;
    writeBool(STORAGE_ENABLED_KEY, state.enabled);
    state.status.lastReason = reason;

    if (!state.enabled) {
      restoreCamera();
    }
  }

  function setScale(value, reason) {
    state.scale = clampScale(value);
    state.status.scale = state.scale;
    writeNumber(STORAGE_SCALE_KEY, state.scale);
    state.status.lastReason = reason;
  }

  function clampScale(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return DEFAULT_SCALE;
    }

    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round(number * 100) / 100));
  }

  function roundPosition(position) {
    return {
      x: Math.round(position.x * 1000) / 1000,
      y: Math.round(position.y * 1000) / 1000,
      z: Math.round(position.z * 1000) / 1000,
    };
  }

  function formatScale(scale) {
    return `${Math.round(scale * 100)}%`;
  }

  function isEditableTarget(target) {
    if (!target) {
      return false;
    }

    const tag = (target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  function migrateStoredSettings() {
    const storedVersion = readString(STORAGE_VERSION_KEY, '');
    if (storedVersion !== SCRIPT_VERSION) {
      writeBool(STORAGE_ENABLED_KEY, true);
      writeNumber(STORAGE_SCALE_KEY, DEFAULT_SCALE);
      writeString(STORAGE_VERSION_KEY, SCRIPT_VERSION);
      return {
        enabled: true,
        scale: DEFAULT_SCALE,
        reason: `settings migrated from ${storedVersion || 'none'} to ${SCRIPT_VERSION}`,
      };
    }

    return {
      enabled: readBool(STORAGE_ENABLED_KEY, true),
      scale: clampScale(readNumber(STORAGE_SCALE_KEY, DEFAULT_SCALE)),
      reason: 'stored settings loaded',
    };
  }

  function showHint(message) {
    const now = Date.now();
    if (now - state.lastHintAt < 300) {
      return;
    }
    state.lastHintAt = now;

    let hint = page.document.getElementById('mu-camera-zoom-hint');
    if (!hint) {
      hint = page.document.createElement('div');
      hint.id = 'mu-camera-zoom-hint';
      hint.style.cssText = [
        'position:fixed',
        'left:50%',
        'top:18%',
        'transform:translateX(-50%)',
        'z-index:2147483647',
        'padding:8px 12px',
        'border-radius:4px',
        'background:rgba(0,0,0,0.72)',
        'color:#fff',
        'font:14px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
        'pointer-events:none',
      ].join(';');
      page.document.documentElement.appendChild(hint);
    }

    hint.textContent = message;
    hint.style.opacity = '1';
    page.clearTimeout(hint.__muCameraZoomTimer);
    hint.__muCameraZoomTimer = page.setTimeout(() => {
      hint.style.opacity = '0';
    }, 1200);
  }

  function readBool(key, fallback) {
    try {
      const value = page.localStorage.getItem(key);
      if (value === null) {
        return fallback;
      }
      return value === 'true';
    } catch (error) {
      return fallback;
    }
  }

  function readString(key, fallback) {
    try {
      const value = page.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function writeBool(key, value) {
    try {
      page.localStorage.setItem(key, value ? 'true' : 'false');
    } catch (error) {
      // Ignore storage failures; runtime state still works for the current page.
    }
  }

  function writeString(key, value) {
    try {
      page.localStorage.setItem(key, String(value));
    } catch (error) {
      // Ignore storage failures; runtime state still works for the current page.
    }
  }

  function readNumber(key, fallback) {
    try {
      const value = Number(page.localStorage.getItem(key));
      return Number.isFinite(value) ? value : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeNumber(key, value) {
    try {
      page.localStorage.setItem(key, String(value));
    } catch (error) {
      // Ignore storage failures; runtime state still works for the current page.
    }
  }
}());


