// ==UserScript==
// @name         全民红月 - BOSS Bot Dry Run
// @namespace    codex.mu.boss.bot
// @version      0.1.0
// @description  MU H5 BOSS Bot Phase 0-1 dry-run runtime. Scans, plans, and logs without executing gameplay actions.
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

    const VERSION = '0.1.0';
    const CONFIG_KEY = 'mu_boss_bot_config_v1';
    const LOG_KEY = 'mu_boss_bot_logs_v1';
    const MAX_LOGS = 500;

    const state = {
      status: {
        version: VERSION,
        state: 'SYNC',
        mode: 'dry-run',
        paused: false,
        pauseReason: '',
        scanCount: 0,
        planCount: 0,
        tickCount: 0,
        lastScanAt: 0,
        lastPlanAt: 0,
        lastTickAt: 0,
        lastError: '',
        currentIntent: null,
      },
      config: normalizeConfig(readJson(CONFIG_KEY, defaultConfig())),
      lastSnapshot: null,
      lastPlan: null,
      logs: normalizeLogs(readJson(LOG_KEY, [])),
    };

    window.__muBossBot = {
      version: VERSION,
      getStatus,
      getConfig,
      setConfig,
      pause,
      resume,
      scan,
      plan,
      tick,
      exportLogs,
      clearLogs,
      markManualResult,
    };

    function defaultConfig() {
      return {
        enabled: false,
        dryRun: true,
        timezone: 'Asia/Shanghai',
        bossResetHour: 8,
        warriorResetHour: 0,
        defaults: {
          preWaitSeconds: 90,
          engageKey: 'KeyZ',
          actionConfirmTimeoutMs: 8000,
          scanIntervalMs: 1000,
          maxConsecutiveContestedLoss: 3,
          contestedCooldownMinutes: 30,
        },
        targets: [],
        fallbackFarmSpots: [],
        warriorTask: {
          enabled: true,
          dailyLimit: 4,
          interruptibleByBoss: true,
          requiredStar: 3,
          taskType: 'BOSS',
        },
      };
    }

    function getStatus() {
      return clone(state.status);
    }

    function getConfig() {
      return clone(state.config);
    }

    function setConfig(patch) {
      state.config = normalizeConfig(deepMerge(state.config, patch || {}));
      writeJson(CONFIG_KEY, state.config);
      appendLog('config_updated', { patch: clone(patch || {}) });
      return getConfig();
    }

    function pause(reason) {
      state.status.paused = true;
      state.status.state = 'PAUSED';
      state.status.pauseReason = cleanText(reason) || 'manual';
      appendLog('paused_needs_decision', { reason: state.status.pauseReason });
      return getStatus();
    }

    function resume() {
      state.status.paused = false;
      state.status.pauseReason = '';
      state.status.state = 'SYNC';
      appendLog('state_transition', { to: 'SYNC', reason: 'resume' });
      return getStatus();
    }

    function scan() {
      state.status.scanCount += 1;
      state.status.lastScanAt = Date.now();
      state.lastSnapshot = emptySnapshot();
      return clone(state.lastSnapshot);
    }

    function plan(snapshot) {
      state.status.planCount += 1;
      state.status.lastPlanAt = Date.now();
      state.lastPlan = {
        at: state.status.lastPlanAt,
        state: state.status.paused ? 'PAUSED' : 'PLAN',
        intent: {
          type: state.status.paused ? 'pause' : 'observe',
          reason: state.status.paused ? state.status.pauseReason : 'no actionable signal',
          target: null,
          confidence: 1,
          dryRun: true,
        },
        snapshot: clone(snapshot || state.lastSnapshot || emptySnapshot()),
      };
      state.status.currentIntent = clone(state.lastPlan.intent);
      return clone(state.lastPlan);
    }

    function tick() {
      state.status.tickCount += 1;
      state.status.lastTickAt = Date.now();
      const snapshot = scan();
      const nextPlan = plan(snapshot);
      appendLog('intent_planned', { intent: nextPlan.intent });
      return {
        status: getStatus(),
        snapshot,
        plan: nextPlan,
      };
    }

    function exportLogs() {
      return clone(state.logs);
    }

    function clearLogs() {
      state.logs = [];
      writeJson(LOG_KEY, state.logs);
      return [];
    }

    function markManualResult(event) {
      appendLog('manual_result', { event: clone(event || {}) });
      return exportLogs();
    }

    function emptySnapshot() {
      return {
        at: Date.now(),
        scene: { mapName: '', coordinates: '', isMoving: false, autoBattleState: 'unknown' },
        player: { name: '', levelText: '', rebirth: null, combatPower: null, inventoryHints: {} },
        bossPanel: { open: false, selectedTab: '', tabs: [], rows: [], requirements: [], enterButtons: [] },
        leftPanel: { bossEntries: [], warriorTaskEntries: [] },
        taskPanel: { open: false, selectedTask: null, starFilters: [], acceptButton: null, submitButton: null },
        combat: { targetName: '', targetLevel: 0, hpPercent: null, ownerName: '', damageBoard: [], confidence: 0 },
        timers: { knownRespawns: [], resetTimes: resetTimes() },
        confidence: { scene: 0, bossPanel: 0, leftPanel: 0, taskPanel: 0, combat: 0 },
      };
    }

    function resetTimes() {
      return {
        dayKey: utc8DateKey(Date.now()),
        bossResetHour: state && state.config ? state.config.bossResetHour : 8,
        warriorResetHour: state && state.config ? state.config.warriorResetHour : 0,
      };
    }

    function normalizeConfig(input) {
      const base = defaultConfig();
      const cfg = deepMerge(base, input && typeof input === 'object' ? input : {});
      cfg.enabled = Boolean(cfg.enabled);
      cfg.dryRun = cfg.dryRun !== false;
      cfg.timezone = 'Asia/Shanghai';
      cfg.bossResetHour = clampInteger(cfg.bossResetHour, 0, 23, 8);
      cfg.warriorResetHour = clampInteger(cfg.warriorResetHour, 0, 23, 0);
      cfg.defaults.preWaitSeconds = clampInteger(cfg.defaults.preWaitSeconds, 0, 600, 90);
      cfg.defaults.scanIntervalMs = clampInteger(cfg.defaults.scanIntervalMs, 250, 10000, 1000);
      cfg.defaults.actionConfirmTimeoutMs = clampInteger(cfg.defaults.actionConfirmTimeoutMs, 1000, 60000, 8000);
      cfg.defaults.maxConsecutiveContestedLoss = clampInteger(cfg.defaults.maxConsecutiveContestedLoss, 0, 50, 3);
      cfg.defaults.contestedCooldownMinutes = clampInteger(cfg.defaults.contestedCooldownMinutes, 0, 1440, 30);
      cfg.targets = Array.isArray(cfg.targets) ? cfg.targets.map(normalizeTarget).filter(Boolean) : [];
      cfg.fallbackFarmSpots = Array.isArray(cfg.fallbackFarmSpots) ? cfg.fallbackFarmSpots.map(normalizeFarmSpot).filter(Boolean) : [];
      cfg.warriorTask.enabled = cfg.warriorTask.enabled !== false;
      cfg.warriorTask.dailyLimit = clampInteger(cfg.warriorTask.dailyLimit, 0, 20, 4);
      cfg.warriorTask.requiredStar = clampInteger(cfg.warriorTask.requiredStar, 1, 10, 3);
      cfg.warriorTask.taskType = cleanText(cfg.warriorTask.taskType) || 'BOSS';
      return cfg;
    }

    function normalizeTarget(target) {
      if (!target || typeof target !== 'object') return null;
      const name = cleanText(target.name);
      if (!name) return null;
      return {
        type: cleanText(target.type),
        name,
        enabled: target.enabled !== false,
        priority: clampInteger(target.priority, -999, 999, 0),
        dailyLimit: clampInteger(target.dailyLimit, 0, 999, 1),
        preWaitSeconds: clampInteger(target.preWaitSeconds, 0, 600, 90),
        allowAutoCandidateFallback: Boolean(target.allowAutoCandidateFallback),
        abandonPolicy: {
          enabled: !target.abandonPolicy || target.abandonPolicy.enabled !== false,
          minObserveSeconds: clampInteger(target.abandonPolicy && target.abandonPolicy.minObserveSeconds, 0, 300, 15),
          minDamageRatio: clampNumber(target.abandonPolicy && target.abandonPolicy.minDamageRatio, 0, 1, 0.5),
        },
      };
    }

    function normalizeFarmSpot(spot) {
      if (!spot || typeof spot !== 'object') return null;
      return {
        name: cleanText(spot.name) || '默认挂机点',
        map: cleanText(spot.map),
        coordinate: cleanText(spot.coordinate),
        priority: clampInteger(spot.priority, -999, 999, 0),
      };
    }

    function appendLog(type, details) {
      const entry = {
        at: Date.now(),
        dayKey: utc8DateKey(Date.now()),
        state: state.status.state,
        type,
        ...(details || {}),
      };
      state.logs.push(entry);
      if (state.logs.length > MAX_LOGS) state.logs = state.logs.slice(state.logs.length - MAX_LOGS);
      writeJson(LOG_KEY, state.logs);
      return entry;
    }

    function normalizeLogs(value) {
      return Array.isArray(value) ? value.slice(-MAX_LOGS) : [];
    }

    function readJson(key, fallback) {
      try {
        const raw = window.localStorage && window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : clone(fallback);
      } catch (error) {
        return clone(fallback);
      }
    }

    function writeJson(key, value) {
      try {
        if (window.localStorage) window.localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        state.status.lastError = error && error.message ? error.message : String(error);
      }
    }

    function utc8DateKey(ms) {
      const date = new Date(ms + 8 * 60 * 60 * 1000);
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    function deepMerge(base, patch) {
      const out = clone(base);
      Object.keys(patch || {}).forEach((key) => {
        const value = patch[key];
        if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
          out[key] = deepMerge(out[key], value);
        } else {
          out[key] = clone(value);
        }
      });
      return out;
    }

    function cleanText(value) {
      return String(value == null ? '' : value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }

    function clampInteger(value, min, max, fallback) {
      const number = Math.floor(Number(value));
      if (!Number.isFinite(number)) return fallback;
      return Math.max(min, Math.min(max, number));
    }

    function clampNumber(value, min, max, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return Math.max(min, Math.min(max, number));
    }

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }
  };

  function isGameFrame(loc) {
    return loc.hostname === 'cdn.qj2h5.jiuxiaokj.cn' && loc.pathname.includes('/mu2h5/');
  }

  if (!isGameFrame(location)) return;

  const script = document.createElement('script');
  script.textContent = `(${injected})();`;
  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();
})();
