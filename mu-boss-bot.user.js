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
    const DAILY_KEY = 'mu_boss_bot_daily_v1';
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
      daily: normalizeDaily(readJson(DAILY_KEY, null)),
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
      ensureDailyState();
      return clone({ ...state.status, dayKey: state.daily.dayKey, daily: state.daily });
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

    function plan(snapshot) {
      state.status.planCount += 1;
      state.status.lastPlanAt = Date.now();
      const source = snapshot || state.lastSnapshot || scan();
      const nextIntent = chooseIntent(source, state.config);
      state.lastPlan = {
        at: state.status.lastPlanAt,
        state: state.status.paused ? 'PAUSED' : 'PLAN',
        intent: nextIntent,
        snapshot: clone(source),
      };
      state.status.currentIntent = clone(state.lastPlan.intent);
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
      const limitedMatches = [];
      targets.forEach((target) => {
        entries.forEach((entry) => {
          if (namesMatch(entry.name, target.name)) {
            if (dailyLimitReached(target)) {
              limitedMatches.push({ target, entry, score: target.priority });
            } else {
              matches.push({ target, entry, score: target.priority });
            }
          }
        });
      });
      if (!matches.length && limitedMatches.length) {
        limitedMatches.sort((a, b) => b.score - a.score);
        return intent('disabled', 'daily limit reached', limitedMatches[0].target, 1);
      }
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
      return null;
    }

    function chooseWarriorTask(snapshot, config) {
      if (!config.warriorTask.enabled) return null;
      if (warriorTaskDailyLimitReached(config.warriorTask)) return null;
      const entries = snapshot.leftPanel && snapshot.leftPanel.warriorTaskEntries ? snapshot.leftPanel.warriorTaskEntries : [];
      const task = entries.find((entry) => entry.star === config.warriorTask.requiredStar);
      if (!task) return null;
      return {
        ...intent('warrior_task', 'three-star warrior boss task available', null, 0.75),
        task,
      };
    }

    function chooseAutoCandidate(snapshot) {
      const rows = snapshot.bossPanel && snapshot.bossPanel.rows ? snapshot.bossPanel.rows : [];
      const enterButtons = snapshot.bossPanel && snapshot.bossPanel.enterButtons ? snapshot.bossPanel.enterButtons : [];
      const confidence = snapshot.confidence && Number(snapshot.confidence.bossPanel);
      if (!snapshot.bossPanel || snapshot.bossPanel.open !== true || confidence < 0.5 || !rows[0] || !enterButtons[0]) return null;
      const row = rows[0];
      const enterButton = enterButtons.find((button) => /前往|挑战|进入|\d+只/.test(button.text)) || enterButtons[0];
      return {
        ...intent('auto_candidate', 'panel candidate with enter evidence', { type: snapshot.bossPanel.selectedTab || '', name: row.name }, 0.6),
        row,
        enterButton,
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

    function exportLogs() {
      return clone(state.logs);
    }

    function clearLogs() {
      state.logs = [];
      writeJson(LOG_KEY, state.logs);
      return [];
    }

    function markManualResult(event) {
      const payload = clone(event || {});
      if (payload.type === 'boss_killed' && payload.target) {
        recordDailyKill(payload.target);
      }
      if (payload.type === 'warrior_task_submitted') {
        recordWarriorTaskSubmitted();
      }
      appendLog('manual_result', { event: payload });
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
      const tabs = nodes
        .filter((item) => /野外BOSS|福利BOSS|首饰BOSS|试炼之地|苦难炼狱/.test(item.contentText))
        .map((item) => ({ text: item.contentText, rect: item.rect }));
      const rows = nodes
        .filter((item) => /推荐防御|推荐攻击|特殊掉落/.test(item.text))
        .map((item) => ({ name: extractBossName(item.text), text: item.text, rect: item.rect }))
        .filter((row) => row.name);
      const requirements = nodes
        .filter((item) => /开启等级|推荐防御|推荐攻击|翅膀|套装|需要/.test(item.contentText))
        .map((item) => ({ text: item.contentText, rect: item.rect }));
      const enterButtons = nodes
        .filter((item) => /前往|挑战|进入|\(\d+,\d+\)|\d+只/.test(item.contentText))
        .filter((item) => !/挑战\s*BOSS|当前爆率/.test(item.text))
        .map((item) => ({ text: item.contentText, rect: item.rect }));
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
      if (!cfg.defaults || typeof cfg.defaults !== 'object' || Array.isArray(cfg.defaults)) cfg.defaults = clone(base.defaults);
      if (!cfg.warriorTask || typeof cfg.warriorTask !== 'object' || Array.isArray(cfg.warriorTask)) cfg.warriorTask = clone(base.warriorTask);
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

    function recordWarriorTaskSubmitted() {
      ensureDailyState();
      state.daily.counts.warriorTask = (Number(state.daily.counts.warriorTask) || 0) + 1;
      writeJson(DAILY_KEY, state.daily);
    }

    function targetKey(target) {
      return `${cleanText(target.type) || '未分类'}::${cleanText(target.name)}`;
    }

    function dailyLimitReached(target) {
      ensureDailyState();
      const count = Number(state.daily.counts[targetKey(target)]) || 0;
      return target.dailyLimit >= 0 && count >= target.dailyLimit;
    }

    function warriorTaskDailyLimitReached(warriorTask) {
      ensureDailyState();
      const count = Number(state.daily.counts.warriorTask) || 0;
      return warriorTask.dailyLimit >= 0 && count >= warriorTask.dailyLimit;
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
