# MU BOSS Bot Phase 0-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable MU BOSS Bot runtime with Sensor Core dry-run, Planner dry-run, structured logs, and Agent API, without real gameplay actions.

**Architecture:** Add a new Tampermonkey userscript, `mu-boss-bot.user.js`, that runs in the game iframe and exposes `window.__muBossBot`. Internally it is modular: config/store/logging, Sensor Core, Planner, and a dry-run state machine. This plan deliberately does not depend on `mu-boss-automation-observer.user.js`, though fake UI patterns from its tests can be reused.

**Tech Stack:** Tampermonkey userscript, browser DOM/FairyGUI runtime inspection, localStorage, Node `vm` tests with fake UI nodes.

---

## Scope

This plan implements Phase 0 and Phase 1 from [2026-07-06-mu-boss-bot-design.md](../specs/2026-07-06-mu-boss-bot-design.md):

- Sensor Core dry-run.
- Planner dry-run.
- Config and status API.
- Structured in-page logs.
- State machine that plans intents but does not click, press keys, enter maps, submit tasks, or patch the bundle.

Out of scope for this plan:

- Real Executor actions.
- Bundle patching.
- Network/WebSocket protocol inspection.
- Sidecar service.
- Full auto BOSS fight loop.

## File Structure

- Create: `mu-boss-bot.user.js`
  - New userscript runtime.
  - Owns `window.__muBossBot`.
  - Contains focused internal modules: config/store/logging, node walking, Sensor Core, Planner, dry-run state machine.
  - Must not modify game state except its own DOM-free API object and localStorage keys.

- Create: `tests/mu-boss-bot.test.js`
  - Node `vm` tests with fake FairyGUI nodes.
  - Verifies config API, Sensor snapshots, Planner decisions, daily reset logic, dry-run state machine, and no real action execution.

- Check only: `docs/superpowers/specs/2026-07-06-mu-boss-bot-design.md`
  - Source of requirements.

## Public API Contract

The script must expose:

```js
window.__muBossBot.getStatus()
window.__muBossBot.getConfig()
window.__muBossBot.setConfig(patch)
window.__muBossBot.pause(reason)
window.__muBossBot.resume()
window.__muBossBot.scan()
window.__muBossBot.plan()
window.__muBossBot.tick()
window.__muBossBot.exportLogs()
window.__muBossBot.clearLogs()
window.__muBossBot.markManualResult(event)
```

`tick()` must not execute real gameplay actions in this plan. It may append `intent_planned` log records and update status.

## Task 1: Test Harness and API Smoke Test

**Files:**
- Create: `tests/mu-boss-bot.test.js`
- Create in Task 2: `mu-boss-bot.user.js`

- [ ] **Step 1: Write the failing test harness**

Add `tests/mu-boss-bot.test.js` with this initial content:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scriptPath = path.resolve(__dirname, '..', 'mu-boss-bot.user.js');

class FakeNode {
  constructor({
    name = '',
    text = '',
    title = '',
    icon = '',
    packageItem = null,
    x = 0,
    y = 0,
    w = 80,
    h = 30,
    visible = true,
  } = {}) {
    this.name = name;
    this.text = text;
    this.title = title;
    this.icon = icon;
    this.packageItem = packageItem;
    this.x = x;
    this.y = y;
    this.width = w;
    this.height = h;
    this.visible = visible;
    this.internalVisible = true;
    this.children = [];
    this.parent = null;
  }

  get numChildren() {
    return this.children.length;
  }

  add(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  getChildAt(index) {
    return this.children[index];
  }

  localToGlobalRect() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };
  }
}

function buildEmptyRoot() {
  return new FakeNode({ name: 'GRoot', w: 1280, h: 720 });
}

function makeStorage(seed = {}) {
  return {
    data: { ...seed },
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
    },
    setItem(key, value) {
      this.data[key] = String(value);
    },
    removeItem(key) {
      delete this.data[key];
    },
  };
}

function loadUserscript(root = buildEmptyRoot(), storage = makeStorage(), now = 1783339200000) {
  const documentElement = new FakeNode({ name: 'documentElement' });
  const sandbox = {
    location: { href: 'https://cdn.qj2h5.jiuxiaokj.cn/mu2h5/h5-data/mu-release/index.html' },
    console,
    Date: class extends Date {
      constructor(...args) {
        if (args.length) return super(...args);
        return new global.Date(now);
      }

      static now() {
        return now;
      }

      static parse(value) {
        return global.Date.parse(value);
      }

      static UTC(...args) {
        return global.Date.UTC(...args);
      }
    },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout(fn) { return fn(); },
    clearTimeout() {},
    window: {
      fgui: { GRoot: { inst: root } },
      localStorage: storage,
    },
    document: {
      createElement(tagName) {
        return {
          tagName: tagName.toUpperCase(),
          style: {},
          dataset: {},
          textContent: '',
          appendChild() {},
          remove() {},
          addEventListener() {},
        };
      },
      getElementById() {
        return null;
      },
      documentElement,
      head: documentElement,
      body: documentElement,
    },
  };

  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.setInterval = sandbox.setInterval;
  sandbox.window.clearInterval = sandbox.clearInterval;
  sandbox.window.setTimeout = sandbox.setTimeout;
  sandbox.window.clearTimeout = sandbox.clearTimeout;
  documentElement.appendChild = (script) => {
    vm.runInContext(script.textContent, sandbox, { filename: 'injected-mu-boss-bot.js' });
    return script;
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), sandbox, { filename: scriptPath });
  return { api: sandbox.window.__muBossBot, storage, sandbox };
}

function testPublicApiExists() {
  const { api } = loadUserscript();
  assert(api, 'expected window.__muBossBot to exist');
  [
    'getStatus',
    'getConfig',
    'setConfig',
    'pause',
    'resume',
    'scan',
    'plan',
    'tick',
    'exportLogs',
    'clearLogs',
    'markManualResult',
  ].forEach((name) => assert.strictEqual(typeof api[name], 'function', `${name} should be a function`));
  const status = api.getStatus();
  assert.strictEqual(status.state, 'SYNC');
  assert.strictEqual(status.mode, 'dry-run');
}

function run() {
  testPublicApiExists();
  console.log('mu-boss-bot tests passed');
}

run();
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: FAIL with an `ENOENT` error because `mu-boss-bot.user.js` does not exist yet.

## Task 2: Minimal Userscript Runtime and Config API

**Files:**
- Create: `mu-boss-bot.user.js`
- Modify: `tests/mu-boss-bot.test.js`

- [ ] **Step 1: Create the minimal userscript**

Create `mu-boss-bot.user.js`:

```js
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
```

- [ ] **Step 2: Run API test**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: PASS with `mu-boss-bot tests passed`.

- [ ] **Step 3: Add config/log tests**

Append these functions before `run()` in `tests/mu-boss-bot.test.js`, and call them from `run()` after `testPublicApiExists()`:

```js
function testConfigNormalizationAndLogs() {
  const { api, storage } = loadUserscript();
  const config = api.setConfig({
    enabled: true,
    dryRun: false,
    defaults: { preWaitSeconds: 9999 },
    targets: [
      { type: '福利BOSS', name: '愤怒闪电巨人', priority: 2000, dailyLimit: 2 },
      { type: '福利BOSS', name: '', priority: 1 },
    ],
    fallbackFarmSpots: [
      { name: '挂机点A', map: '', coordinate: '', priority: 5 },
      { name: '挂机点B', map: '四风平原', coordinate: '100,120', priority: 10 },
    ],
  });

  assert.strictEqual(config.enabled, true);
  assert.strictEqual(config.dryRun, false);
  assert.strictEqual(config.defaults.preWaitSeconds, 600);
  assert.strictEqual(config.targets.length, 1);
  assert.strictEqual(config.targets[0].priority, 999);
  assert.strictEqual(config.fallbackFarmSpots.length, 2);
  assert(storage.getItem('mu_boss_bot_config_v1'), 'config should be persisted');

  const logs = api.exportLogs();
  assert(logs.some((entry) => entry.type === 'config_updated'), 'config update should be logged');
  assert.strictEqual(api.clearLogs().length, 0);
}

function testPauseResumeAndManualResult() {
  const { api } = loadUserscript();
  api.pause('user playing');
  assert.strictEqual(api.getStatus().state, 'PAUSED');
  assert.strictEqual(api.getStatus().paused, true);
  assert.strictEqual(api.getStatus().pauseReason, 'user playing');

  api.markManualResult({ type: 'user_killed_boss', target: '傲之煞' });
  assert(api.exportLogs().some((entry) => entry.type === 'manual_result'));

  api.resume();
  assert.strictEqual(api.getStatus().state, 'SYNC');
  assert.strictEqual(api.getStatus().paused, false);
}
```

Update `run()`:

```js
function run() {
  testPublicApiExists();
  testConfigNormalizationAndLogs();
  testPauseResumeAndManualResult();
  console.log('mu-boss-bot tests passed');
}
```

- [ ] **Step 4: Run config/log tests**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add mu-boss-bot.user.js tests/mu-boss-bot.test.js
git commit -m "Add MU boss bot dry-run runtime"
```

Expected: commit succeeds with the new userscript and test file.

## Task 3: Sensor Core UI Snapshot

**Files:**
- Modify: `mu-boss-bot.user.js`
- Modify: `tests/mu-boss-bot.test.js`

- [ ] **Step 1: Add fake scene builders and failing Sensor test**

Add these helpers before the tests in `tests/mu-boss-bot.test.js`:

```js
function buildSensorScene() {
  const root = buildEmptyRoot();
  root.add(new FakeNode({ name: 'mapName', text: '试炼之地1', x: 1040, y: 64, w: 160, h: 30 }));
  root.add(new FakeNode({ name: 'coord', text: '(146,127)', x: 1110, y: 205, w: 100, h: 24 }));
  root.add(new FakeNode({ name: 'auto', text: '自动攻击', x: 580, y: 680, w: 120, h: 30 }));

  const bossPanel = root.add(new FakeNode({ name: 'bossPanel', text: '挑战BOSS 当前爆率:高', x: 120, y: 120, w: 980, h: 560 }));
  bossPanel.add(new FakeNode({ name: 'tabTrial', text: '试炼之地', x: 530, y: 180, w: 120, h: 35 }));
  bossPanel.add(new FakeNode({ name: 'row1', text: '邪恶龙虾战士 推荐防御:36199 推荐攻击:11632', x: 150, y: 360, w: 260, h: 70 }));
  bossPanel.add(new FakeNode({ name: 'enter1', text: '试炼之地1 (79,68) 1只', x: 410, y: 560, w: 210, h: 40 }));

  const left = root.add(new FakeNode({ name: 'leftTaskPanel', text: '任务', x: 0, y: 80, w: 320, h: 260 }));
  left.add(new FakeNode({ name: 'bossLine1', text: '邪恶龙虾战士 坐标79,68 待击杀', x: 55, y: 120, w: 260, h: 45 }));
  left.add(new FakeNode({ name: 'bossLine2', text: '咆哮龙虾战士 坐标121,33 剩余刷新时间01分30秒', x: 55, y: 175, w: 260, h: 45 }));
  left.add(new FakeNode({ name: 'warriorLine', text: '勇士任务 BOSS悬赏3星 傲之煞 0/1 完成次数:1/4', x: 55, y: 230, w: 300, h: 45 }));

  const taskPanel = root.add(new FakeNode({ name: 'taskPanel', text: '任务面板 BOSS悬赏 3星 领取 提交', x: 340, y: 100, w: 520, h: 500 }));
  taskPanel.add(new FakeNode({ name: 'threeStar', text: '3星 BOSS 傲之煞', x: 380, y: 180, w: 220, h: 40 }));
  taskPanel.add(new FakeNode({ name: 'accept', text: '领取', x: 700, y: 520, w: 90, h: 36 }));
  taskPanel.add(new FakeNode({ name: 'submit', text: '提交', x: 800, y: 520, w: 90, h: 36 }));

  root.add(new FakeNode({ name: 'targetHp', text: 'Lv1200 邪恶龙虾战士 88% 归属:普尔赫达', x: 400, y: 70, w: 420, h: 40 }));
  return root;
}
```

Add this test and call it from `run()`:

```js
function testSensorSnapshotFromUi() {
  const { api } = loadUserscript(buildSensorScene());
  const snapshot = api.scan();

  assert.strictEqual(snapshot.scene.mapName, '试炼之地1');
  assert.strictEqual(snapshot.scene.coordinates, '146,127');
  assert.strictEqual(snapshot.scene.autoBattleState, 'auto');

  assert.strictEqual(snapshot.bossPanel.open, true);
  assert(snapshot.bossPanel.tabs.some((tab) => tab.text === '试炼之地'));
  assert(snapshot.bossPanel.rows.some((row) => row.name === '邪恶龙虾战士'));
  assert(snapshot.bossPanel.enterButtons.some((button) => button.text.includes('试炼之地1')));

  assert(snapshot.leftPanel.bossEntries.some((entry) => entry.name === '邪恶龙虾战士' && entry.state === 'ready'));
  assert(snapshot.leftPanel.bossEntries.some((entry) => entry.name === '咆哮龙虾战士' && entry.refreshInSeconds === 90));
  assert.strictEqual(snapshot.leftPanel.warriorTaskEntries[0].star, 3);

  assert.strictEqual(snapshot.taskPanel.open, true);
  assert.strictEqual(snapshot.taskPanel.selectedTask.star, 3);
  assert.strictEqual(snapshot.taskPanel.acceptButton.text, '领取');
  assert.strictEqual(snapshot.taskPanel.submitButton.text, '提交');

  assert.strictEqual(snapshot.combat.targetName, '邪恶龙虾战士');
  assert.strictEqual(snapshot.combat.hpPercent, 88);
  assert.strictEqual(snapshot.combat.ownerName, '普尔赫达');
  assert(snapshot.confidence.scene > 0.5);
  assert(snapshot.confidence.bossPanel > 0.5);
}
```

- [ ] **Step 2: Run Sensor test to verify it fails**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: FAIL because `scan()` still returns the empty snapshot.

- [ ] **Step 3: Implement UI node walking and Sensor parsing**

In `mu-boss-bot.user.js`, replace `scan()` and add helper functions near `emptySnapshot()`:

```js
    function root() {
      return window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
    }

    function scan() {
      state.status.scanCount += 1;
      state.status.lastScanAt = Date.now();
      const gRoot = root();
      if (!gRoot) {
        state.lastSnapshot = emptySnapshot();
        state.lastSnapshot.reason = 'waiting for fgui';
        return clone(state.lastSnapshot);
      }
      const nodes = collectNodes(gRoot);
      state.lastSnapshot = {
        at: Date.now(),
        scene: scanScene(nodes),
        player: scanPlayer(nodes),
        bossPanel: scanBossPanel(nodes),
        leftPanel: scanLeftPanel(nodes),
        taskPanel: scanTaskPanel(nodes),
        combat: scanCombat(nodes),
        timers: { knownRespawns: scanRespawns(nodes), resetTimes: resetTimes() },
        confidence: {},
      };
      state.lastSnapshot.confidence = computeConfidence(state.lastSnapshot);
      return clone(state.lastSnapshot);
    }

    function collectNodes(gRoot) {
      const nodes = [];
      walk(gRoot, (node, depth) => {
        const item = summarizeNode(node);
        item.depth = depth;
        nodes.push(item);
      });
      return nodes;
    }

    function walk(node, visit, depth) {
      if (!node || depth > 16) return;
      visit(node, depth || 0);
      const count = Number(node.numChildren) || 0;
      for (let index = 0; index < count; index += 1) {
        walk(node.getChildAt(index), visit, (depth || 0) + 1);
      }
    }

    function summarizeNode(node) {
      const text = cleanText([node.text, node.title, node.name].filter(Boolean).join(' '));
      const rect = getRect(node);
      return {
        name: cleanText(node.name),
        text,
        contentText: cleanText(node.text || node.title || ''),
        visible: node.visible !== false && node.internalVisible !== false,
        rect,
      };
    }

    function getRect(node) {
      try {
        if (typeof node.localToGlobalRect === 'function') {
          const rect = node.localToGlobalRect(0, 0, node.width || 0, node.height || 0);
          return { x: rect.x || 0, y: rect.y || 0, w: rect.width || 0, h: rect.height || 0 };
        }
      } catch (error) {
        return { x: node.x || 0, y: node.y || 0, w: node.width || 0, h: node.height || 0 };
      }
      return { x: node.x || 0, y: node.y || 0, w: node.width || 0, h: node.height || 0 };
    }

    function scanScene(nodes) {
      const map = nodes
        .filter((item) => item.visible && /^[\u4e00-\u9fa5A-Za-z0-9]+$/.test(item.contentText) && /试炼|福利|野外|平原|大陆|炼狱|秘境/.test(item.contentText))
        .sort((a, b) => scoreMap(b) - scoreMap(a))[0];
      const coord = nodes.find((item) => /\(?\d{1,3},\d{1,3}\)?/.test(item.contentText));
      const auto = nodes.find((item) => /自动攻击|自动寻路|手动攻击/.test(item.contentText));
      return {
        mapName: map ? map.contentText : '',
        coordinates: coord ? normalizeCoordinate(coord.contentText) : '',
        isMoving: Boolean(auto && /自动寻路/.test(auto.contentText)),
        autoBattleState: auto && /自动攻击/.test(auto.contentText) ? 'auto' : 'unknown',
      };
    }

    function scoreMap(item) {
      let score = 0;
      if (item.rect.x >= 900 && item.rect.y <= 130) score += 100;
      if (/试炼|福利|野外|秘境|平原/.test(item.contentText)) score += 20;
      return score;
    }

    function scanPlayer(nodes) {
      const level = nodes.find((item) => /\d+转\d+级|\d+级/.test(item.contentText));
      return { name: '', levelText: level ? level.contentText : '', rebirth: null, combatPower: null, inventoryHints: {} };
    }

    function scanBossPanel(nodes) {
      const open = nodes.some((item) => /挑战\s*BOSS|当前爆率/.test(item.text));
      const tabs = nodes.filter((item) => /野外BOSS|福利BOSS|首饰BOSS|试炼之地|苦难炼狱/.test(item.contentText)).map((item) => ({ text: item.contentText, rect: item.rect }));
      const rows = nodes.filter((item) => /推荐防御|推荐攻击|特殊掉落/.test(item.text)).map((item) => ({ name: extractBossName(item.text), text: item.text, rect: item.rect })).filter((row) => row.name);
      const requirements = nodes.filter((item) => /开启等级|推荐防御|推荐攻击|翅膀|套装|需要/.test(item.contentText)).map((item) => ({ text: item.contentText, rect: item.rect }));
      const enterButtons = nodes.filter((item) => /前往|挑战|进入|\(\d+,\d+\)|\d+只/.test(item.contentText)).map((item) => ({ text: item.contentText, rect: item.rect }));
      return { open, selectedTab: tabs[0] ? tabs[0].text : '', tabs, rows, requirements, enterButtons };
    }

    function scanLeftPanel(nodes) {
      const bossEntries = nodes
        .filter((item) => /(坐标|剩余刷新时间|待击杀)/.test(item.text) && extractBossName(item.text))
        .map((item) => {
          const seconds = parseRefreshSeconds(item.text);
          return {
            name: extractBossName(item.text),
            text: item.text,
            coordinate: normalizeCoordinate(item.text),
            state: /待击杀|已刷新/.test(item.text) ? 'ready' : seconds != null ? 'cooldown' : 'unknown',
            refreshInSeconds: seconds,
            rect: item.rect,
          };
        });
      const warriorTaskEntries = nodes
        .filter((item) => /勇士任务|BOSS悬赏|完成次数/.test(item.text))
        .map((item) => ({ text: item.text, star: parseStar(item.text), progressText: parseProgressText(item.text), rect: item.rect }));
      return { bossEntries, warriorTaskEntries };
    }

    function scanTaskPanel(nodes) {
      const panelOpen = nodes.some((item) => /任务面板|BOSS悬赏|领取|提交/.test(item.text));
      const taskItems = nodes.filter((item) => /(\d+)星.*BOSS|BOSS.*(\d+)星/.test(item.text));
      const selectedTask = taskItems.length ? { text: taskItems[0].text, star: parseStar(taskItems[0].text), rect: taskItems[0].rect } : null;
      const accept = nodes.find((item) => item.contentText === '领取');
      const submit = nodes.find((item) => item.contentText === '提交');
      return {
        open: panelOpen,
        selectedTask,
        starFilters: taskItems.map((item) => ({ text: item.text, star: parseStar(item.text), rect: item.rect })),
        acceptButton: accept ? { text: accept.contentText, rect: accept.rect } : null,
        submitButton: submit ? { text: submit.contentText, rect: submit.rect } : null,
      };
    }

    function scanCombat(nodes) {
      const target = nodes.find((item) => /Lv\s*\d+/.test(item.text) && extractBossName(item.text));
      if (!target) return { targetName: '', targetLevel: 0, hpPercent: null, ownerName: '', damageBoard: [], confidence: 0 };
      const level = target.text.match(/Lv\s*(\d+)/i);
      const hp = target.text.match(/(\d+)%/);
      const owner = target.text.match(/归属[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9_]+)/);
      return {
        targetName: extractBossName(target.text),
        targetLevel: level ? Number(level[1]) : 0,
        hpPercent: hp ? Number(hp[1]) : null,
        ownerName: owner ? owner[1] : '',
        damageBoard: [],
        confidence: 0.8,
      };
    }

    function scanRespawns(nodes) {
      return nodes
        .filter((item) => /剩余刷新时间/.test(item.text) && extractBossName(item.text))
        .map((item) => ({ name: extractBossName(item.text), refreshInSeconds: parseRefreshSeconds(item.text), source: 'ui' }));
    }

    function computeConfidence(snapshot) {
      return {
        scene: snapshot.scene.mapName ? 0.8 : 0,
        bossPanel: snapshot.bossPanel.open ? 0.8 : 0,
        leftPanel: snapshot.leftPanel.bossEntries.length ? 0.8 : 0,
        taskPanel: snapshot.taskPanel.open ? 0.8 : 0,
        combat: snapshot.combat.targetName ? snapshot.combat.confidence : 0,
      };
    }

    function extractBossName(text) {
      const names = ['愤怒闪电巨人', '深渊咒怨魔王', '邪恶龙虾战士', '咆哮龙虾战士', '龙虾战士', '傲之煞', '闪电巨人', '火焰巨人', '幽灵巨人'];
      return names.find((name) => cleanText(text).includes(name)) || '';
    }

    function parseRefreshSeconds(text) {
      const value = cleanText(text);
      const match = value.match(/剩余刷新时间(?:(\d+)时)?(?:(\d+)分)?(?:(\d+)秒)?/);
      if (!match) return null;
      return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
    }

    function parseStar(text) {
      const match = cleanText(text).match(/(\d+)星/);
      return match ? Number(match[1]) : null;
    }

    function parseProgressText(text) {
      const match = cleanText(text).match(/\d+\/\d+/);
      return match ? match[0] : '';
    }

    function normalizeCoordinate(text) {
      const match = cleanText(text).match(/(\d{1,3}),\s*(\d{1,3})/);
      return match ? `${match[1]},${match[2]}` : '';
    }
```

- [ ] **Step 4: Run Sensor tests**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add mu-boss-bot.user.js tests/mu-boss-bot.test.js
git commit -m "Add MU boss bot sensor dry run"
```

Expected: commit succeeds.

## Task 4: Planner Target Selection and Timing

**Files:**
- Modify: `mu-boss-bot.user.js`
- Modify: `tests/mu-boss-bot.test.js`

- [ ] **Step 1: Add failing Planner tests**

Append these tests and call them from `run()`:

```js
function testPlannerChoosesConfiguredReadyBoss() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [
      { type: '试炼之地', name: '咆哮龙虾战士', priority: 90, dailyLimit: 3, preWaitSeconds: 90 },
      { type: '试炼之地', name: '邪恶龙虾战士', priority: 10, dailyLimit: 3, preWaitSeconds: 90 },
    ],
  });
  const snapshot = api.scan();
  const plan = api.plan(snapshot);
  assert.strictEqual(plan.intent.type, 'prepare_boss');
  assert.strictEqual(plan.intent.target.name, '邪恶龙虾战士');
  assert.strictEqual(plan.intent.reason, 'configured boss ready');
}

function testPlannerPreWaitsConfiguredCooldownBoss() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [
      { type: '试炼之地', name: '咆哮龙虾战士', priority: 90, dailyLimit: 3, preWaitSeconds: 90 },
    ],
  });
  const snapshot = api.scan();
  const plan = api.plan(snapshot);
  assert.strictEqual(plan.intent.type, 'travel_to_boss');
  assert.strictEqual(plan.intent.target.name, '咆哮龙虾战士');
  assert.strictEqual(plan.intent.reason, 'within pre-wait window');
}

function testPlannerDoesNotFarmWithoutConfiguredSpot() {
  const { api } = loadUserscript(buildEmptyRoot());
  api.setConfig({ enabled: true, targets: [], fallbackFarmSpots: [{ name: 'empty', map: '', coordinate: '' }] });
  const plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'pause');
  assert.strictEqual(plan.intent.reason, 'no actionable target and no valid farm spot');
}

function testPlannerUsesValidFarmFallback() {
  const { api } = loadUserscript(buildEmptyRoot());
  api.setConfig({ enabled: true, targets: [], fallbackFarmSpots: [{ name: 'farm', map: '四风平原', coordinate: '100,120', priority: 1 }] });
  const plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'farm_fallback');
  assert.strictEqual(plan.intent.farmSpot.name, 'farm');
}
```

- [ ] **Step 2: Run Planner tests to verify they fail**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: FAIL because `plan()` still returns `observe`.

- [ ] **Step 3: Implement Planner**

Replace `plan(snapshot)` in `mu-boss-bot.user.js` and add helper functions near it:

```js
    function plan(snapshot) {
      state.status.planCount += 1;
      state.status.lastPlanAt = Date.now();
      const source = snapshot || state.lastSnapshot || scan();
      const intent = chooseIntent(source, state.config);
      state.lastPlan = {
        at: state.status.lastPlanAt,
        state: state.status.paused ? 'PAUSED' : 'PLAN',
        intent,
        snapshot: clone(source),
      };
      state.status.currentIntent = clone(intent);
      return clone(state.lastPlan);
    }

    function chooseIntent(snapshot, config) {
      if (state.status.paused) return intent('pause', state.status.pauseReason || 'paused');
      if (!config.enabled) return intent('disabled', 'config disabled');

      const configured = chooseConfiguredBoss(snapshot, config);
      if (configured) return configured;

      const warrior = chooseWarriorTask(snapshot, config);
      if (warrior) return warrior;

      const autoCandidate = chooseAutoCandidate(snapshot, config);
      if (autoCandidate) return autoCandidate;

      const farm = chooseFarmSpot(config);
      if (farm) return { ...intent('farm_fallback', 'no boss candidate, use farm fallback'), farmSpot: farm };

      return intent('pause', 'no actionable target and no valid farm spot');
    }

    function chooseConfiguredBoss(snapshot, config) {
      const entries = snapshot.leftPanel && snapshot.leftPanel.bossEntries ? snapshot.leftPanel.bossEntries : [];
      const targets = config.targets.filter((target) => target.enabled);
      const matches = [];
      targets.forEach((target) => {
        entries.forEach((entry) => {
          if (namesMatch(entry.name, target.name)) {
            matches.push({ target, entry, score: target.priority });
          }
        });
      });
      if (!matches.length) return null;
      matches.sort((a, b) => b.score - a.score);
      const ready = matches.find((match) => match.entry.state === 'ready');
      if (ready) {
        return {
          ...intent('prepare_boss', 'configured boss ready', ready.target, 0.9),
          entry: ready.entry,
        };
      }
      const preWait = matches.find((match) => match.entry.refreshInSeconds != null && match.entry.refreshInSeconds <= match.target.preWaitSeconds);
      if (preWait) {
        return {
          ...intent('travel_to_boss', 'within pre-wait window', preWait.target, 0.85),
          entry: preWait.entry,
        };
      }
      const wait = matches[0];
      return {
        ...intent('wait_spawn', 'configured boss cooldown', wait.target, 0.8),
        entry: wait.entry,
      };
    }

    function chooseWarriorTask(snapshot, config) {
      if (!config.warriorTask.enabled) return null;
      const entries = snapshot.leftPanel && snapshot.leftPanel.warriorTaskEntries ? snapshot.leftPanel.warriorTaskEntries : [];
      const task = entries.find((entry) => entry.star === config.warriorTask.requiredStar);
      if (!task) return null;
      return {
        ...intent('warrior_task', 'three-star warrior boss task available', null, 0.75),
        task,
      };
    }

    function chooseAutoCandidate(snapshot, config) {
      const rows = snapshot.bossPanel && snapshot.bossPanel.rows ? snapshot.bossPanel.rows : [];
      if (!rows.length) return null;
      const row = rows[0];
      return {
        ...intent('auto_candidate', 'configured targets unavailable, panel candidate found', { type: snapshot.bossPanel.selectedTab || '', name: row.name }, 0.6),
        row,
      };
    }

    function chooseFarmSpot(config) {
      const spots = config.fallbackFarmSpots
        .filter((spot) => spot.map && spot.coordinate)
        .sort((a, b) => b.priority - a.priority);
      return spots[0] ? clone(spots[0]) : null;
    }

    function intent(type, reason, target, confidence) {
      return {
        type,
        reason,
        target: target ? clone(target) : null,
        confidence: confidence == null ? 1 : confidence,
        dryRun: true,
      };
    }

    function namesMatch(a, b) {
      const left = cleanText(a);
      const right = cleanText(b);
      return left === right || left.includes(right) || right.includes(left);
    }
```

- [ ] **Step 4: Run Planner tests**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add mu-boss-bot.user.js tests/mu-boss-bot.test.js
git commit -m "Add MU boss bot planner dry run"
```

Expected: commit succeeds.

## Task 5: Daily Counters and Reset Boundaries

**Files:**
- Modify: `mu-boss-bot.user.js`
- Modify: `tests/mu-boss-bot.test.js`

- [ ] **Step 1: Add failing daily-state tests**

Append these tests and call them from `run()`:

```js
function testDailyKeysUseUtc8() {
  const beforeReset = global.Date.parse('2026-07-05T15:59:00.000Z');
  const afterReset = global.Date.parse('2026-07-05T16:01:00.000Z');

  const first = loadUserscript(buildEmptyRoot(), makeStorage(), beforeReset).api;
  assert.strictEqual(first.getStatus().dayKey, '2026-07-05');

  const second = loadUserscript(buildEmptyRoot(), makeStorage(), afterReset).api;
  assert.strictEqual(second.getStatus().dayKey, '2026-07-06');
}

function testManualResultRecordsKillCount() {
  const { api } = loadUserscript();
  api.setConfig({
    enabled: true,
    targets: [{ type: '福利BOSS', name: '愤怒闪电巨人', priority: 10, dailyLimit: 1 }],
  });
  api.markManualResult({ type: 'boss_killed', target: { type: '福利BOSS', name: '愤怒闪电巨人' } });
  const status = api.getStatus();
  assert.strictEqual(status.daily.counts['福利BOSS::愤怒闪电巨人'], 1);

  const snapshot = api.scan();
  snapshot.leftPanel.bossEntries = [{ name: '愤怒闪电巨人', state: 'ready', refreshInSeconds: null }];
  const plan = api.plan(snapshot);
  assert.strictEqual(plan.intent.type, 'disabled');
  assert.strictEqual(plan.intent.reason, 'daily limit reached');
}
```

- [ ] **Step 2: Run daily-state tests to verify they fail**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: FAIL because status has no `dayKey` or `daily` object.

- [ ] **Step 3: Implement daily state**

In `mu-boss-bot.user.js`:

Add constants:

```js
    const DAILY_KEY = 'mu_boss_bot_daily_v1';
```

Add to `state`:

```js
      daily: normalizeDaily(readJson(DAILY_KEY, null)),
```

Update `getStatus()`:

```js
    function getStatus() {
      ensureDailyState();
      return clone({ ...state.status, dayKey: state.daily.dayKey, daily: state.daily });
    }
```

Update `markManualResult(event)`:

```js
    function markManualResult(event) {
      const payload = clone(event || {});
      if (payload.type === 'boss_killed' && payload.target) {
        recordDailyKill(payload.target);
      }
      appendLog('manual_result', { event: payload });
      return exportLogs();
    }
```

Add helpers:

```js
    function normalizeDaily(value) {
      const current = utc8DateKey(Date.now());
      if (!value || typeof value !== 'object' || value.dayKey !== current) {
        return { dayKey: current, counts: {}, contestedLosses: [] };
      }
      return {
        dayKey: current,
        counts: value.counts && typeof value.counts === 'object' ? value.counts : {},
        contestedLosses: Array.isArray(value.contestedLosses) ? value.contestedLosses : [],
      };
    }

    function ensureDailyState() {
      const current = utc8DateKey(Date.now());
      if (!state.daily || state.daily.dayKey !== current) {
        state.daily = { dayKey: current, counts: {}, contestedLosses: [] };
        writeJson(DAILY_KEY, state.daily);
        appendLog('state_transition', { to: state.status.state, reason: 'utc8 daily reset' });
      }
    }

    function recordDailyKill(target) {
      ensureDailyState();
      const key = targetKey(target);
      state.daily.counts[key] = (Number(state.daily.counts[key]) || 0) + 1;
      writeJson(DAILY_KEY, state.daily);
    }

    function targetKey(target) {
      return `${cleanText(target.type) || '未分类'}::${cleanText(target.name)}`;
    }

    function dailyLimitReached(target, config) {
      ensureDailyState();
      const count = Number(state.daily.counts[targetKey(target)]) || 0;
      return target.dailyLimit >= 0 && count >= target.dailyLimit;
    }
```

In `chooseConfiguredBoss()`, skip targets over limit:

```js
      const targets = config.targets.filter((target) => target.enabled);
```

Replace that line with:

```js
      const targets = config.targets.filter((target) => target.enabled);
      const limited = targets.find((target) => dailyLimitReached(target, config));
      const activeTargets = targets.filter((target) => !dailyLimitReached(target, config));
```

Then replace `targets.forEach((target) => {` with:

```js
      activeTargets.forEach((target) => {
```

After the loop, before `if (!matches.length) return null;`, add:

```js
      if (!matches.length && limited) return intent('disabled', 'daily limit reached', limited, 1);
```

- [ ] **Step 4: Run daily-state tests**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add mu-boss-bot.user.js tests/mu-boss-bot.test.js
git commit -m "Add MU boss bot daily counters"
```

Expected: commit succeeds.

## Task 6: Dry-Run State Machine and Intent Logging

**Files:**
- Modify: `mu-boss-bot.user.js`
- Modify: `tests/mu-boss-bot.test.js`

- [ ] **Step 1: Add failing dry-run tick tests**

Append these tests and call them from `run()`:

```js
function testTickLogsIntentWithoutExecutingActions() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [{ type: '试炼之地', name: '邪恶龙虾战士', priority: 10, dailyLimit: 3, preWaitSeconds: 90 }],
  });
  const result = api.tick();
  assert.strictEqual(result.status.currentIntent.type, 'prepare_boss');
  assert.strictEqual(result.executed.length, 0);
  assert(api.exportLogs().some((entry) => entry.type === 'intent_planned' && entry.intent.type === 'prepare_boss'));
}

function testPausedTickDoesNotPlanGameplayIntent() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [{ type: '试炼之地', name: '邪恶龙虾战士', priority: 10, dailyLimit: 3, preWaitSeconds: 90 }],
  });
  api.pause('manual takeover');
  const result = api.tick();
  assert.strictEqual(result.status.state, 'PAUSED');
  assert.strictEqual(result.status.currentIntent.type, 'pause');
  assert.strictEqual(result.executed.length, 0);
}
```

- [ ] **Step 2: Run tick tests to verify they fail**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: FAIL because `tick()` does not return `executed`.

- [ ] **Step 3: Implement dry-run state transitions**

Replace `tick()`:

```js
    function tick() {
      ensureDailyState();
      state.status.tickCount += 1;
      state.status.lastTickAt = Date.now();
      const previous = state.status.state;
      const snapshot = scan();
      const nextPlan = plan(snapshot);
      const nextState = stateForIntent(nextPlan.intent.type);
      state.status.state = state.status.paused ? 'PAUSED' : nextState;
      if (previous !== state.status.state) {
        appendLog('state_transition', { from: previous, to: state.status.state, reason: nextPlan.intent.reason });
      }
      appendLog('intent_planned', { intent: nextPlan.intent });
      return {
        status: getStatus(),
        snapshot,
        plan: nextPlan,
        executed: [],
      };
    }

    function stateForIntent(type) {
      if (type === 'prepare_boss' || type === 'auto_candidate') return 'PREPARE_BOSS';
      if (type === 'travel_to_boss') return 'TRAVEL_TO_BOSS';
      if (type === 'wait_spawn') return 'WAIT_SPAWN';
      if (type === 'warrior_task') return 'WARRIOR_TASK';
      if (type === 'farm_fallback') return 'FARM_FALLBACK';
      if (type === 'pause') return 'PAUSED';
      if (type === 'disabled') return 'PLAN';
      return 'PLAN';
    }
```

- [ ] **Step 4: Run dry-run tests**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add mu-boss-bot.user.js tests/mu-boss-bot.test.js
git commit -m "Add MU boss bot dry-run state machine"
```

Expected: commit succeeds.

## Task 7: Syntax and Regression Verification

**Files:**
- Check: `mu-boss-bot.user.js`
- Check: `tests/mu-boss-bot.test.js`
- Check: existing related tests

- [ ] **Step 1: Syntax check new userscript**

Run:

```bash
node --check mu-boss-bot.user.js
```

Expected: exits 0 with no syntax errors.

- [ ] **Step 2: Run new test suite**

Run:

```bash
node tests/mu-boss-bot.test.js
```

Expected: PASS with `mu-boss-bot tests passed`.

- [ ] **Step 3: Run existing related tests**

Run:

```bash
node tests/mu-boss-automation-observer.test.js
node tests/mu-boss-only-collapsed.test.js
node tests/mu-space-manual-attack.test.js
node tests/mu-left-top-buttons-compact.test.js
```

Expected: all commands exit 0.

- [ ] **Step 4: Confirm no bundle interception**

Run:

```bash
rg -n "appendChild|bundle-|Blob|createObjectURL|fetch\\(" mu-boss-bot.user.js
```

Expected: only the normal page injection `appendChild` appears. No `bundle-`, `Blob`, `createObjectURL`, or `fetch(` usage appears.

- [ ] **Step 5: Final commit if verification changed files**

If any small verification fixes were needed, run:

```bash
git add mu-boss-bot.user.js tests/mu-boss-bot.test.js
git commit -m "Verify MU boss bot dry-run runtime"
```

Expected: commit succeeds only if files changed. If no files changed, skip this commit.

## Self-Review

Spec coverage:

- Sensor Core dry-run: Tasks 3 and 7.
- Planner dry-run: Tasks 4, 5, and 6.
- Config and Agent API: Task 2.
- Structured logs: Tasks 2 and 6.
- UTC+8 daily reset and daily counts: Task 5.
- 90 second pre-wait: Task 4 uses `preWaitSeconds: 90` and default config clamps to 90.
- Fixed farm fallback safety: Task 4 prevents farming when map or coordinate is empty.
- No real gameplay actions: Tasks 1, 2, 6, and 7 verify dry-run and empty `executed`.
- Existing observer not required: new files only; no dependency on `mu-boss-automation-observer.user.js`.

This plan intentionally excludes real Executor actions, warrior task submit/accept clicking, random teleport use, and auto-attack keypress execution. Those capabilities require separate implementation plans after Sensor and Planner dry-run are verified in the live game.
