// ==UserScript==
// @name         全民红月 - 四风平原 BOSS MVP
// @namespace    codex.mu.four-winds-boss-mvp
// @version      0.1.0
// @description  四风平原 BOSS 自动化 MVP 骨架。默认仅干跑，必须从控制台显式 start() 才会允许执行。
// @author       Codex
// @match        https://www.602.com/game/show/*
// @match        https://client.qj2h5.jiuxiaokj.cn/mu2h5/*
// @match        https://cdn.qj2h5.jiuxiaokj.cn/mu2h5/*
// @match        https://*.jiuxiaokj.cn/mu2h5/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const injected = function () {
    'use strict';

    if (window.__muFourWindsBossMvp) return;

    const STORAGE_KEY = 'mu_four_winds_boss_mvp_v1';
    const TICK_MS = 1000;
    const CONFIG_DEFAULTS = Object.freeze({
      enabled: false,
      dryRun: true,
      ownerName: '普尔赫达',
      preWaitSeconds: 90,
      ownerObserveSeconds: 10,
      contestedCooldownMs: 5 * 60 * 1000,
      arrivalStallMs: 15 * 1000,
      travelTimeoutMs: 180 * 1000,
    });
    const MAX_LOGS = 200;
    const TARGET_TABLE = Object.freeze([
      Object.freeze({ id: 'ao-left', name: '傲之煞', mapName: '四风平原', coordinate: '77,145' }),
      Object.freeze({ id: 'ao-right', name: '傲之煞', mapName: '四风平原', coordinate: '182,164' }),
      Object.freeze({ id: 'angry-ao', name: '愤怒傲之煞', mapName: '四风平原', coordinate: '179,79' }),
      Object.freeze({ id: 'rage-ao', name: '狂暴傲之煞', mapName: '四风平原', coordinate: '82,88' }),
    ]);

    const state = {
      enabled: false,
      dryRun: true,
      phase: 'SYNC',
      currentTargetId: '',
      currentAction: null,
      targets: TARGET_TABLE,
      logs: [],
      config: normalizeConfig(readJson(STORAGE_KEY, CONFIG_DEFAULTS)),
      paused: false,
      pauseReason: '',
      lastSnapshot: null,
      lastIntent: null,
      tickId: null,
    };
    syncRuntimeFlags();

    window.__muFourWindsBossMvp = {
      start() {
        state.config.enabled = true;
        state.config.dryRun = false;
        syncRuntimeFlags();
        persist();
        appendLog('started', { dryRun: state.dryRun });
        return getStatus();
      },
      pause(reason) {
        state.paused = true;
        state.pauseReason = cleanText(reason) || 'manual';
        state.phase = 'PAUSED';
        appendLog('paused', { reason: state.pauseReason });
        return getStatus();
      },
      resume() {
        state.paused = false;
        state.phase = 'SYNC';
        state.pauseReason = '';
        appendLog('resumed', {});
        return getStatus();
      },
      status: getStatus,
      setConfig(patch) {
        state.config = normalizeConfig({ ...state.config, ...(patch || {}) });
        syncRuntimeFlags();
        persist();
        appendLog('config_updated', { patch: clone(patch || {}) });
        return getStatus();
      },
      scanNow: readSnapshot,
    };

    scheduleTick();

    function scheduleTick() {
      if (state.tickId !== null) return;
      state.tickId = window.setInterval(tick, TICK_MS);
    }

    function tick() {
      try {
        const snapshot = readSnapshot();
        reconcileTargets(snapshot);
        const intent = chooseIntent(snapshot);
        if (state.enabled && !state.dryRun && !state.paused) {
          return executeIntent(intent, snapshot);
        }
        return intent;
      } catch (error) {
        appendLog('tick_error', { message: error && error.message ? error.message : String(error) });
        return null;
      }
    }

    function readSnapshot() {
      const snapshot = {
        at: Date.now(),
        gameReady: Boolean(window.fgui),
        targets: clone(TARGET_TABLE),
      };
      state.lastSnapshot = snapshot;
      return clone(snapshot);
    }

    function reconcileTargets(snapshot) {
      const knownTargets = snapshot && Array.isArray(snapshot.targets) ? snapshot.targets : TARGET_TABLE;
      state.targets = knownTargets.map((target) => clone(target));
      return clone(state.targets);
    }

    function chooseIntent(snapshot) {
      const intent = {
        type: 'WAIT',
        reason: snapshot && snapshot.gameReady ? 'target_table_empty' : 'waiting_for_fgui',
      };
      state.currentTargetId = '';
      state.currentAction = null;
      state.phase = state.paused ? 'PAUSED' : 'SYNC';
      state.lastIntent = intent;
      return clone(intent);
    }

    function executeIntent(intent) {
      state.currentAction = intent ? intent.type : null;
      appendLog('intent_deferred', {
        intent: clone(intent),
        reason: 'execution_not_implemented_in_task_1',
      });
      return clone(intent);
    }

    function persist() {
      writeJson(STORAGE_KEY, state.config);
    }

    function syncRuntimeFlags() {
      state.enabled = state.config.enabled;
      state.dryRun = state.config.dryRun;
    }

    function normalizeConfig(input) {
      const source = input && typeof input === 'object' ? input : {};
      return {
        enabled: Boolean(source.enabled),
        dryRun: source.dryRun !== false,
        ownerName: cleanText(source.ownerName) || CONFIG_DEFAULTS.ownerName,
        preWaitSeconds: clampNumber(source.preWaitSeconds, 0, 3600, CONFIG_DEFAULTS.preWaitSeconds),
        ownerObserveSeconds: clampNumber(source.ownerObserveSeconds, 0, 3600, CONFIG_DEFAULTS.ownerObserveSeconds),
        contestedCooldownMs: clampNumber(source.contestedCooldownMs, 0, 24 * 60 * 60 * 1000, CONFIG_DEFAULTS.contestedCooldownMs),
        arrivalStallMs: clampNumber(source.arrivalStallMs, 0, 60 * 60 * 1000, CONFIG_DEFAULTS.arrivalStallMs),
        travelTimeoutMs: clampNumber(source.travelTimeoutMs, 0, 24 * 60 * 60 * 1000, CONFIG_DEFAULTS.travelTimeoutMs),
      };
    }

    function appendLog(type, details) {
      state.logs.push({
        at: Date.now(),
        type: cleanText(type) || 'event',
        details: clone(details || {}),
      });
      if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
    }

    function getStatus() {
      return clone({
        enabled: state.enabled,
        dryRun: state.dryRun,
        phase: state.phase,
        currentTargetId: state.currentTargetId,
        currentAction: state.currentAction,
        targets: state.targets,
        logs: state.logs,
        paused: state.paused,
        pauseReason: state.pauseReason,
        config: state.config,
        lastSnapshot: state.lastSnapshot,
        lastIntent: state.lastIntent,
      });
    }

    function readJson(key, fallback) {
      try {
        const raw = window.localStorage && window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : clone(fallback);
      } catch (_) {
        return clone(fallback);
      }
    }

    function writeJson(key, value) {
      try {
        if (window.localStorage) window.localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {
        // localStorage 不可用时保持仅运行时状态。
      }
    }

    function cleanText(value) {
      return String(value == null ? '' : value)
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function clampNumber(value, min, max, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return Math.max(min, Math.min(max, number));
    }

    function clone(value) {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    }
  };

  function inject(fn) {
    const script = document.createElement('script');
    script.textContent = '(' + fn.toString() + ')();';
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  function isGameContext() {
    return window.top !== window || Boolean(window.fgui);
  }

  if (isGameContext()) inject(injected);
})();
