// ==UserScript==
// @name         全民红月 - BOSS Bot Dry Run
// @namespace    codex.mu.boss.bot
// @version      0.1.0
// @description  MU H5 BOSS Bot Phase 0-1 runtime. Scans and plans by default; optional guarded actions are disabled unless explicitly enabled.
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
        nextActionAllowedAt: 0,
      },
      config: normalizeConfig(readJson(CONFIG_KEY, defaultConfig())),
      daily: normalizeDaily(readJson(DAILY_KEY, null)),
      lastSnapshot: null,
      lastPlan: null,
      pendingBossHouseMap: '',
      pendingBossPointTarget: null,
      pendingBossPointNavigation: null,
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
        actions: {
          enabled: false,
          cooldownMs: 8000,
        },
        targets: [],
        fallbackFarmSpots: [],
        respawnNameHints: [
          { mapName: '幻术秘境3', coordinate: '195,150', name: '闪电巨人', radius: 3 },
        ],
        warriorTask: {
          enabled: true,
          dailyLimit: 4,
          interruptibleByBoss: true,
          requiredStar: 3,
          taskType: 'BOSS',
        },
        eligibility: {
          blockedMapPatterns: ['会员秘境', '会员\\d+层'],
          blockedTargetMaps: [],
        },
      };
    }

    function getStatus() {
      ensureDailyState();
      return clone({ ...state.status, mode: currentMode(), dayKey: state.daily.dayKey, daily: state.daily });
    }

    function currentMode() {
      return state.config && state.config.actions && state.config.actions.enabled && state.config.dryRun === false ? 'actions-enabled' : 'dry-run';
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
      const scene = scanScene(nodes);
      const combat = scanCombat(nodes);
      state.lastSnapshot = {
        at: Date.now(),
        scene,
        player: scanPlayer(nodes),
        bossPanel: scanBossPanel(nodes),
        bossHousePanel: scanBossHousePanel(nodes),
        mapPanel: scanMapPanel(nodes),
        leftPanel: scanLeftPanel(nodes),
        warriorTaskPanel: scanWarriorTaskPanel(nodes),
        taskPanel: scanTaskPanel(nodes),
        combat,
        timers: { knownRespawns: scanRespawns(nodes, scene, combat), resetTimes: resetTimes() },
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
      nextIntent.dryRun = state.config.dryRun !== false;
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

      const pendingPointNavigation = choosePendingBossPointNavigation(snapshot);
      if (pendingPointNavigation) return pendingPointNavigation;

      const bossHouse = chooseBossHouseTeleport(snapshot, config);
      if (bossHouse) return bossHouse;

      const pendingPointTarget = choosePendingBossPointTarget(snapshot);
      if (pendingPointTarget) return pendingPointTarget;

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

    function choosePendingBossPointNavigation(snapshot) {
      const pending = state.pendingBossPointNavigation;
      if (!pending || !pending.targetName) return null;
      const elapsedMs = Date.now() - Number(pending.startedAt || 0);
      if (elapsedMs < 30000) {
        if (snapshot.mapPanel && snapshot.mapPanel.open && snapshot.mapPanel.closeButton) {
          return {
            ...intent('close_map_after_navigation', 'close map after boss point click', pending.target || null, 0.8),
            targetName: pending.targetName,
            closeButton: snapshot.mapPanel.closeButton,
            startedAt: pending.startedAt,
            elapsedMs,
          };
        }
        return {
          ...intent('wait_arrive_boss_point', 'waiting for boss point navigation', pending.target || null, 0.75),
          targetName: pending.targetName,
          startedAt: pending.startedAt,
          elapsedMs,
        };
      }
      state.pendingBossPointNavigation = null;
      return null;
    }

    function choosePendingBossPointTarget(snapshot) {
      const pending = state.pendingBossPointTarget;
      if (!pending || !pending.target || !pending.mapName) return null;
      if (cleanText(snapshot.scene && snapshot.scene.mapName) !== cleanText(pending.mapName)) return null;
      return chooseBossPointNavigation(snapshot, pending.target, pending.row || null, {
        map: pending.mapName,
        coordinate: pending.coordinate || '',
        text: pending.entranceText || pending.mapName,
      });
    }

    function chooseBossHouseTeleport(snapshot, config) {
      const panel = snapshot.bossHousePanel;
      if (!panel || panel.open !== true) return null;
      const targets = config.targets.filter((target) => target.enabled);
      if (!targets.length && !state.pendingBossHouseMap) return null;
      const desiredMap = cleanText(state.pendingBossHouseMap || panel.selectedMap);
      const selected = panel.maps.find((item) => item.selected) || null;
      const desired = desiredMap ? panel.maps.find((item) => item.name === desiredMap) : selected;
      if (desired && !desired.selected) {
        return {
          ...intent('select_boss_house_map', 'boss house target map is not selected', targets[0] || null, 0.85),
          desiredMap: desired.name,
          mapRow: desired,
        };
      }
      if (panel.enterButton && (desired || selected)) {
        return {
          ...intent('enter_boss_house_map', 'boss house target map selected', targets[0] || null, 0.9),
          desiredMap: desired ? desired.name : selected.name,
          selectedMap: selected ? selected.name : '',
          enterButton: panel.enterButton,
        };
      }
      return {
        ...intent('boss_house_blocked', 'boss house target map unavailable', targets[0] || null, 0.5),
        desiredMap,
        maps: panel.maps,
      };
    }

    function chooseConfiguredBoss(snapshot, config) {
      const entries = snapshot.leftPanel && snapshot.leftPanel.bossEntries ? snapshot.leftPanel.bossEntries : [];
      const targets = config.targets.filter((target) => target.enabled);
      const panelChoice = chooseConfiguredBossFromPanel(snapshot, config, targets);
      const matches = [];
      const limitedMatches = [];
      targets.forEach((target) => {
        entries.forEach((entry) => {
          if (targetNameMatches(target, entry.name)) {
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
      if (!matches.length) return panelChoice;
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
      return panelChoice;
    }

    function chooseConfiguredBossFromPanel(snapshot, config, targets) {
      const panel = snapshot.bossPanel;
      if (!panel || panel.open !== true || !panel.rows || !panel.rows.length || !targets.length) return null;
      const selectedTab = cleanText(panel.selectedTab);
      const matches = [];
      targets.forEach((target) => {
        if (target.type && selectedTab && cleanText(target.type) !== selectedTab) return;
        (panel.rows || []).forEach((row, index) => {
          if (targetNameMatches(target, row.name)) matches.push({ target, row, index, score: target.priority });
        });
      });
      if (!matches.length) return null;
      matches.sort((a, b) => b.score - a.score || b.index - a.index);
      const match = matches[0];
      if (dailyLimitReached(match.target)) return intent('disabled', 'daily limit reached', match.target, 1);
      if (panel.selectedBossName && !targetNameMatches(match.target, panel.selectedBossName)) {
        return {
          ...intent('select_boss_row', 'configured boss row is not selected', match.target, 0.82),
          row: match.row,
          selectedBossName: panel.selectedBossName,
        };
      }
      const entrances = (panel.enterButtons || []).map((button) => annotateEntranceForTarget(button, match.target));
      const eligible = entrances.find((button) => !button.blockedReason);
      if (eligible) {
        if (entranceDestinationReached(snapshot.scene, eligible)) {
          const mapIntent = chooseBossPointNavigation(snapshot, match.target, match.row, eligible);
          if (mapIntent) return mapIntent;
          return {
            ...intent('wait_spawn', 'already at boss entrance destination', match.target, 0.85),
            row: match.row,
            enterButton: eligible,
          };
        }
        return {
          ...intent('prepare_boss', 'configured boss panel candidate', match.target, 0.85),
          row: match.row,
          enterButton: eligible,
        };
      }
      return {
        ...intent('configured_boss_blocked', 'configured boss has no eligible entrance', match.target, 0.8),
        row: match.row,
        blockedEntrances: entrances.map((button) => ({
          ...button,
          blockedReason: button.blockedReason || 'unknown eligibility',
        })),
      };
    }

    function chooseBossPointNavigation(snapshot, target, row, entrance) {
      const panel = snapshot.mapPanel;
      if (!panel || panel.open !== true) {
        if (snapshot.bossPanel && snapshot.bossPanel.open && snapshot.bossPanel.closeButton) {
          return {
            ...intent('close_boss_panel_for_map', 'close boss panel before opening map', target, 0.8),
            row,
            enterButton: entrance,
            closeButton: snapshot.bossPanel.closeButton,
          };
        }
        return {
          ...intent('open_world_map', 'open map to navigate to boss point', target, 0.8),
          row,
          enterButton: entrance,
        };
      }
      const bossTarget = panel.bossTargets.find((item) => targetNameMatches(target, item.name));
      if (!bossTarget) {
        return {
          ...intent('map_boss_target_missing', 'boss target not found on map', target, 0.4),
          row,
          enterButton: entrance,
          mapPanel: panel,
        };
      }
      return {
        ...intent('navigate_to_boss_point', 'click boss target on map', target, 0.9),
        row,
        enterButton: entrance,
        mapTarget: bossTarget,
      };
    }

    function entranceDestinationReached(scene, entrance) {
      if (!scene || !entrance || !entrance.map) return false;
      if (cleanText(scene.mapName) !== cleanText(entrance.map)) return false;
      return true;
    }

    function chooseWarriorTask(snapshot, config) {
      if (!config.warriorTask.enabled) return null;
      if (warriorTaskDailyLimitReached(config.warriorTask)) return null;
      const panel = snapshot.warriorTaskPanel;
      if (panel && panel.open && panel.cards && panel.cards.length) {
        const reward = panel.cards.find((card) => card.state === 'reward_ready');
        if (reward) {
          return {
            ...intent('warrior_task_claim_reward', 'warrior task reward ready', null, 0.9),
            task: reward,
          };
        }
        const accepted = panel.cards.find((card) => card.state === 'accepted');
        if (accepted) {
          return {
            ...intent('warrior_task_go', 'warrior task accepted', null, 0.85),
            task: accepted,
          };
        }
        const available = panel.cards.find((card) => card.state === 'available' && card.star === config.warriorTask.requiredStar);
        if (available) {
          return {
            ...intent('warrior_task_accept', 'required-star warrior task available', null, 0.8),
            task: available,
          };
        }
      }
      const entries = snapshot.leftPanel && snapshot.leftPanel.warriorTaskEntries ? snapshot.leftPanel.warriorTaskEntries : [];
      const task = entries.find((entry) => entry.star === config.warriorTask.requiredStar);
      if (!task) return null;
      return {
        ...intent('warrior_task', 'three-star warrior boss task available', null, 0.75),
        task,
      };
    }

    function chooseAutoCandidate(snapshot, config) {
      if (config && config.targets && config.targets.some((target) => target.enabled)) return null;
      const rows = snapshot.bossPanel && snapshot.bossPanel.rows ? snapshot.bossPanel.rows : [];
      const enterButtons = snapshot.bossPanel && snapshot.bossPanel.enterButtons ? snapshot.bossPanel.enterButtons : [];
      const confidence = snapshot.confidence && Number(snapshot.confidence.bossPanel);
      if (!snapshot.bossPanel || snapshot.bossPanel.open !== true || !Number.isFinite(confidence) || confidence < 0.5 || !rows[0] || !enterButtons[0]) return null;
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

    function targetNameMatches(target, candidateName) {
      const left = cleanText(candidateName);
      const right = cleanText(target && target.name);
      if (!left || !right) return false;
      if (target && target.matchMode === 'contains') return namesMatch(left, right);
      return left === right;
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
      const executed = executePlan(nextPlan);
      return {
        status: getStatus(),
        snapshot,
        plan: nextPlan,
        executed,
      };
    }

    function executePlan(currentPlan) {
      const intentValue = currentPlan && currentPlan.intent ? currentPlan.intent : {};
      if (!state.config.actions.enabled) return [executionSkipped('actions disabled', intentValue)];
      if (state.config.dryRun !== false) return [executionSkipped('dryRun enabled', intentValue)];
      if (state.status.paused) return [executionSkipped('paused', intentValue)];
      if (state.status.nextActionAllowedAt && Date.now() < state.status.nextActionAllowedAt) {
        return [executionSkipped('action cooldown', intentValue)];
      }
      if (intentValue.type === 'select_boss_row') return [executeSelectBossRow(intentValue)];
      if (intentValue.type === 'select_boss_house_map') return [executeSelectBossHouseMap(intentValue)];
      if (intentValue.type === 'enter_boss_house_map') return [executeEnterBossHouseMap(intentValue)];
      if (intentValue.type === 'close_boss_panel_for_map') return [executeCloseBossPanelForMap(intentValue)];
      if (intentValue.type === 'close_map_after_navigation') return [executeCloseMapAfterNavigation(intentValue)];
      if (intentValue.type === 'open_world_map') return [executeOpenWorldMap(intentValue)];
      if (intentValue.type === 'navigate_to_boss_point') return [executeNavigateToBossPoint(intentValue)];
      if (intentValue.type === 'wait_arrive_boss_point') return [executionSkipped('waiting for arrival', intentValue)];
      if (intentValue.type !== 'prepare_boss') return [executionSkipped('unsupported intent', intentValue)];
      return [executePrepareBoss(intentValue)];
    }

    function executionSkipped(reason, intentValue) {
      const event = {
        type: 'skipped',
        reason,
        intentType: intentValue && intentValue.type ? intentValue.type : '',
        dryRun: state.config.dryRun !== false,
      };
      appendLog('action_skipped', event);
      return event;
    }

    function executePrepareBoss(intentValue) {
      const verification = verifyPrepareBossIntent(intentValue);
      if (!verification.ok) {
        const event = {
          type: 'blocked',
          reason: verification.reason,
          intentType: intentValue.type,
          dryRun: false,
        };
        appendLog('action_blocked', event);
        return event;
      }
      const action = activateNode(verification.node);
      if (!action.ok) {
        const event = {
          type: 'failed',
          reason: action.reason,
          intentType: intentValue.type,
          target: intentValue.target,
          enterButton: intentValue.enterButton,
          dryRun: false,
        };
        appendLog('action_failed', event);
        return event;
      }
      state.status.nextActionAllowedAt = Date.now() + state.config.actions.cooldownMs;
      state.status.state = 'TRAVEL_TO_BOSS';
      state.pendingBossHouseMap = cleanText(intentValue.enterButton && intentValue.enterButton.map);
      state.pendingBossPointTarget = {
        target: intentValue.target,
        row: intentValue.row || null,
        mapName: cleanText(intentValue.enterButton && intentValue.enterButton.map),
        coordinate: cleanText(intentValue.enterButton && intentValue.enterButton.coordinate),
        entranceText: cleanText(intentValue.enterButton && intentValue.enterButton.text),
      };
      const event = {
        type: 'clicked_enter_button',
        method: action.method,
        intentType: intentValue.type,
        target: intentValue.target,
        enterButton: intentValue.enterButton,
        dryRun: false,
        nextActionAllowedAt: state.status.nextActionAllowedAt,
      };
      appendLog('action_executed', event);
      return event;
    }

    function executeSelectBossHouseMap(intentValue) {
      const verification = verifySelectBossHouseMapIntent(intentValue);
      if (!verification.ok) {
        const event = {
          type: 'blocked',
          reason: verification.reason,
          intentType: intentValue.type,
          dryRun: false,
        };
        appendLog('action_blocked', event);
        return event;
      }
      const action = activateNode(verification.node);
      if (!action.ok) {
        const event = {
          type: 'failed',
          reason: action.reason,
          intentType: intentValue.type,
          desiredMap: intentValue.desiredMap,
          dryRun: false,
        };
        appendLog('action_failed', event);
        return event;
      }
      state.status.nextActionAllowedAt = Date.now() + state.config.actions.cooldownMs;
      state.status.state = 'SELECT_BOSS_HOUSE_MAP';
      const event = {
        type: 'selected_boss_house_map',
        method: action.method,
        intentType: intentValue.type,
        desiredMap: intentValue.desiredMap,
        dryRun: false,
        nextActionAllowedAt: state.status.nextActionAllowedAt,
      };
      appendLog('action_executed', event);
      return event;
    }

    function executeEnterBossHouseMap(intentValue) {
      const verification = verifyEnterBossHouseMapIntent(intentValue);
      if (!verification.ok) {
        const event = {
          type: 'blocked',
          reason: verification.reason,
          intentType: intentValue.type,
          dryRun: false,
        };
        appendLog('action_blocked', event);
        return event;
      }
      const action = activateNode(verification.node);
      if (!action.ok) {
        const event = {
          type: 'failed',
          reason: action.reason,
          intentType: intentValue.type,
          desiredMap: intentValue.desiredMap,
          dryRun: false,
        };
        appendLog('action_failed', event);
        return event;
      }
      state.status.nextActionAllowedAt = Date.now() + state.config.actions.cooldownMs;
      state.status.state = 'ENTER_BOSS_HOUSE_MAP';
      state.pendingBossHouseMap = '';
      const event = {
        type: 'entered_boss_house_map',
        method: action.method,
        intentType: intentValue.type,
        desiredMap: intentValue.desiredMap,
        selectedMap: intentValue.selectedMap,
        dryRun: false,
        nextActionAllowedAt: state.status.nextActionAllowedAt,
      };
      appendLog('action_executed', event);
      return event;
    }

    function executeOpenWorldMap(intentValue) {
      const verification = verifyOpenWorldMapIntent(intentValue);
      if (!verification.ok) {
        const event = {
          type: 'blocked',
          reason: verification.reason,
          intentType: intentValue.type,
          dryRun: false,
        };
        appendLog('action_blocked', event);
        return event;
      }
      const action = activateNode(verification.node);
      if (!action.ok) {
        const event = {
          type: 'failed',
          reason: action.reason,
          intentType: intentValue.type,
          dryRun: false,
        };
        appendLog('action_failed', event);
        return event;
      }
      state.status.nextActionAllowedAt = Date.now() + state.config.actions.cooldownMs;
      state.status.state = 'OPEN_WORLD_MAP';
      const event = {
        type: 'opened_world_map',
        method: action.method,
        intentType: intentValue.type,
        dryRun: false,
        nextActionAllowedAt: state.status.nextActionAllowedAt,
      };
      appendLog('action_executed', event);
      return event;
    }

    function executeCloseBossPanelForMap(intentValue) {
      const verification = verifyCloseBossPanelForMapIntent(intentValue);
      if (!verification.ok) {
        const event = {
          type: 'blocked',
          reason: verification.reason,
          intentType: intentValue.type,
          dryRun: false,
        };
        appendLog('action_blocked', event);
        return event;
      }
      const action = activateNode(verification.node);
      if (!action.ok) {
        const event = {
          type: 'failed',
          reason: action.reason,
          intentType: intentValue.type,
          dryRun: false,
        };
        appendLog('action_failed', event);
        return event;
      }
      state.status.nextActionAllowedAt = Date.now() + state.config.actions.cooldownMs;
      state.status.state = 'CLOSE_BOSS_PANEL_FOR_MAP';
      state.pendingBossPointTarget = {
        target: intentValue.target,
        row: intentValue.row || null,
        mapName: cleanText(intentValue.enterButton && intentValue.enterButton.map),
        coordinate: cleanText(intentValue.enterButton && intentValue.enterButton.coordinate),
        entranceText: cleanText(intentValue.enterButton && intentValue.enterButton.text),
      };
      const event = {
        type: 'closed_boss_panel_for_map',
        method: action.method,
        intentType: intentValue.type,
        dryRun: false,
        nextActionAllowedAt: state.status.nextActionAllowedAt,
      };
      appendLog('action_executed', event);
      return event;
    }

    function executeNavigateToBossPoint(intentValue) {
      const verification = verifyNavigateToBossPointIntent(intentValue);
      if (!verification.ok) {
        const event = {
          type: 'blocked',
          reason: verification.reason,
          intentType: intentValue.type,
          dryRun: false,
        };
        appendLog('action_blocked', event);
        return event;
      }
      const action = activateNode(verification.node);
      if (!action.ok) {
        const event = {
          type: 'failed',
          reason: action.reason,
          intentType: intentValue.type,
          target: intentValue.target,
          mapTarget: intentValue.mapTarget,
          dryRun: false,
        };
        appendLog('action_failed', event);
        return event;
      }
      state.pendingBossPointNavigation = {
        targetName: intentValue.mapTarget.name,
        target: intentValue.target,
        startedAt: Date.now(),
      };
      state.pendingBossPointTarget = null;
      state.status.nextActionAllowedAt = Date.now() + state.config.actions.cooldownMs;
      state.status.state = 'WAIT_ARRIVE_BOSS_POINT';
      const event = {
        type: 'clicked_map_boss_target',
        method: action.method,
        intentType: intentValue.type,
        target: intentValue.target,
        mapTarget: intentValue.mapTarget,
        dryRun: false,
        nextActionAllowedAt: state.status.nextActionAllowedAt,
      };
      appendLog('action_executed', event);
      return event;
    }

    function executeCloseMapAfterNavigation(intentValue) {
      const verification = verifyCloseMapAfterNavigationIntent(intentValue);
      if (!verification.ok) {
        const event = {
          type: 'blocked',
          reason: verification.reason,
          intentType: intentValue.type,
          dryRun: false,
        };
        appendLog('action_blocked', event);
        return event;
      }
      const action = activateNode(verification.node);
      if (!action.ok) {
        const event = {
          type: 'failed',
          reason: action.reason,
          intentType: intentValue.type,
          dryRun: false,
        };
        appendLog('action_failed', event);
        return event;
      }
      state.status.nextActionAllowedAt = Date.now() + state.config.actions.cooldownMs;
      state.status.state = 'WAIT_ARRIVE_BOSS_POINT';
      const event = {
        type: 'closed_map_after_navigation',
        method: action.method,
        intentType: intentValue.type,
        targetName: intentValue.targetName,
        dryRun: false,
        nextActionAllowedAt: state.status.nextActionAllowedAt,
      };
      appendLog('action_executed', event);
      return event;
    }

    function executeSelectBossRow(intentValue) {
      const verification = verifySelectBossRowIntent(intentValue);
      if (!verification.ok) {
        const event = {
          type: 'blocked',
          reason: verification.reason,
          intentType: intentValue.type,
          dryRun: false,
        };
        appendLog('action_blocked', event);
        return event;
      }
      const action = activateNode(verification.node);
      if (!action.ok) {
        const event = {
          type: 'failed',
          reason: action.reason,
          intentType: intentValue.type,
          target: intentValue.target,
          row: intentValue.row,
          dryRun: false,
        };
        appendLog('action_failed', event);
        return event;
      }
      state.status.nextActionAllowedAt = Date.now() + state.config.actions.cooldownMs;
      state.status.state = 'SELECT_BOSS_ROW';
      const event = {
        type: 'selected_boss_row',
        method: action.method,
        intentType: intentValue.type,
        target: intentValue.target,
        row: intentValue.row,
        dryRun: false,
        nextActionAllowedAt: state.status.nextActionAllowedAt,
      };
      appendLog('action_executed', event);
      return event;
    }

    function verifySelectBossRowIntent(intentValue) {
      if (!intentValue || intentValue.type !== 'select_boss_row') return { ok: false, reason: 'not select_boss_row intent' };
      if (!intentValue.target || !intentValue.target.name) return { ok: false, reason: 'missing target' };
      if (!intentValue.row || !intentValue.row.sourcePath) return { ok: false, reason: 'missing row path' };
      const freshSnapshot = scan();
      const freshPlan = plan(freshSnapshot);
      const freshIntent = freshPlan.intent || {};
      if (freshIntent.type !== 'select_boss_row') return { ok: false, reason: `fresh intent changed: ${freshIntent.type || 'unknown'}` };
      if (!targetNameMatches(intentValue.target, freshIntent.target && freshIntent.target.name)) return { ok: false, reason: 'target changed' };
      if (!freshIntent.row || freshIntent.row.sourcePath !== intentValue.row.sourcePath) return { ok: false, reason: 'row changed' };
      const node = findNodeByPath(root(), freshIntent.row.sourcePath);
      if (!node) return { ok: false, reason: 'row node not found' };
      if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'row node hidden' };
      return { ok: true, node, intent: freshIntent };
    }

    function verifyPrepareBossIntent(intentValue) {
      if (!intentValue || intentValue.type !== 'prepare_boss') return { ok: false, reason: 'not prepare_boss intent' };
      if (!intentValue.target || !intentValue.target.name) return { ok: false, reason: 'missing target' };
      if (!intentValue.enterButton || !intentValue.enterButton.sourcePath) return { ok: false, reason: 'missing enter button path' };
      const freshSnapshot = scan();
      const freshPlan = plan(freshSnapshot);
      const freshIntent = freshPlan.intent || {};
      if (freshIntent.type !== 'prepare_boss') return { ok: false, reason: `fresh intent changed: ${freshIntent.type || 'unknown'}` };
      if (!targetNameMatches(intentValue.target, freshIntent.target && freshIntent.target.name)) return { ok: false, reason: 'target changed' };
      if (!freshIntent.row || !targetNameMatches(intentValue.target, freshIntent.row.name)) return { ok: false, reason: 'row no longer matches target' };
      if (!freshIntent.enterButton || freshIntent.enterButton.sourcePath !== intentValue.enterButton.sourcePath) return { ok: false, reason: 'enter button changed' };
      if (freshIntent.enterButton.blockedReason) return { ok: false, reason: freshIntent.enterButton.blockedReason };
      const node = findNodeByPath(root(), freshIntent.enterButton.sourcePath);
      if (!node) return { ok: false, reason: 'enter button node not found' };
      if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'enter button node hidden' };
      return { ok: true, node, intent: freshIntent };
    }

    function verifySelectBossHouseMapIntent(intentValue) {
      if (!intentValue || intentValue.type !== 'select_boss_house_map') return { ok: false, reason: 'not select_boss_house_map intent' };
      if (!intentValue.mapRow || !intentValue.mapRow.sourcePath) return { ok: false, reason: 'missing map row path' };
      const freshSnapshot = scan();
      const freshPlan = plan(freshSnapshot);
      const freshIntent = freshPlan.intent || {};
      if (freshIntent.type !== 'select_boss_house_map') return { ok: false, reason: `fresh intent changed: ${freshIntent.type || 'unknown'}` };
      if (!freshIntent.mapRow || freshIntent.mapRow.sourcePath !== intentValue.mapRow.sourcePath) return { ok: false, reason: 'map row changed' };
      const node = findNodeByPath(root(), freshIntent.mapRow.sourcePath);
      if (!node) return { ok: false, reason: 'map row node not found' };
      if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'map row node hidden' };
      return { ok: true, node, intent: freshIntent };
    }

    function verifyEnterBossHouseMapIntent(intentValue) {
      if (!intentValue || intentValue.type !== 'enter_boss_house_map') return { ok: false, reason: 'not enter_boss_house_map intent' };
      if (!intentValue.enterButton || !intentValue.enterButton.sourcePath) return { ok: false, reason: 'missing enter button path' };
      const freshSnapshot = scan();
      const freshPlan = plan(freshSnapshot);
      const freshIntent = freshPlan.intent || {};
      if (freshIntent.type !== 'enter_boss_house_map') return { ok: false, reason: `fresh intent changed: ${freshIntent.type || 'unknown'}` };
      if (!freshIntent.enterButton || freshIntent.enterButton.sourcePath !== intentValue.enterButton.sourcePath) return { ok: false, reason: 'enter button changed' };
      const node = findNodeByPath(root(), freshIntent.enterButton.sourcePath);
      if (!node) return { ok: false, reason: 'boss house enter node not found' };
      if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'boss house enter node hidden' };
      return { ok: true, node, intent: freshIntent };
    }

    function verifyOpenWorldMapIntent(intentValue) {
      if (!intentValue || intentValue.type !== 'open_world_map') return { ok: false, reason: 'not open_world_map intent' };
      const freshSnapshot = scan();
      const freshPlan = plan(freshSnapshot);
      const freshIntent = freshPlan.intent || {};
      if (freshIntent.type !== 'open_world_map') return { ok: false, reason: `fresh intent changed: ${freshIntent.type || 'unknown'}` };
      const button = freshSnapshot.mapPanel && freshSnapshot.mapPanel.openButton;
      if (!button || !button.sourcePath) return { ok: false, reason: 'map open button not found' };
      const node = findNodeByPath(root(), button.sourcePath);
      if (!node) return { ok: false, reason: 'map open button node not found' };
      if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'map open button node hidden' };
      return { ok: true, node, intent: freshIntent };
    }

    function verifyCloseBossPanelForMapIntent(intentValue) {
      if (!intentValue || intentValue.type !== 'close_boss_panel_for_map') return { ok: false, reason: 'not close_boss_panel_for_map intent' };
      if (!intentValue.closeButton || !intentValue.closeButton.sourcePath) return { ok: false, reason: 'missing close button path' };
      const freshSnapshot = scan();
      const freshPlan = plan(freshSnapshot);
      const freshIntent = freshPlan.intent || {};
      if (freshIntent.type !== 'close_boss_panel_for_map') return { ok: false, reason: `fresh intent changed: ${freshIntent.type || 'unknown'}` };
      if (!freshIntent.closeButton || freshIntent.closeButton.sourcePath !== intentValue.closeButton.sourcePath) return { ok: false, reason: 'close button changed' };
      const node = findNodeByPath(root(), freshIntent.closeButton.sourcePath);
      if (!node) return { ok: false, reason: 'close button node not found' };
      if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'close button node hidden' };
      return { ok: true, node, intent: freshIntent };
    }

    function verifyNavigateToBossPointIntent(intentValue) {
      if (!intentValue || intentValue.type !== 'navigate_to_boss_point') return { ok: false, reason: 'not navigate_to_boss_point intent' };
      if (!intentValue.mapTarget || !intentValue.mapTarget.sourcePath) return { ok: false, reason: 'missing map target path' };
      const freshSnapshot = scan();
      const freshPlan = plan(freshSnapshot);
      const freshIntent = freshPlan.intent || {};
      if (freshIntent.type !== 'navigate_to_boss_point') return { ok: false, reason: `fresh intent changed: ${freshIntent.type || 'unknown'}` };
      if (!freshIntent.mapTarget || freshIntent.mapTarget.sourcePath !== intentValue.mapTarget.sourcePath) return { ok: false, reason: 'map target changed' };
      const node = findNodeByPath(root(), freshIntent.mapTarget.sourcePath);
      if (!node) return { ok: false, reason: 'map target node not found' };
      if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'map target node hidden' };
      return { ok: true, node, intent: freshIntent };
    }

    function verifyCloseMapAfterNavigationIntent(intentValue) {
      if (!intentValue || intentValue.type !== 'close_map_after_navigation') return { ok: false, reason: 'not close_map_after_navigation intent' };
      if (!intentValue.closeButton || !intentValue.closeButton.sourcePath) return { ok: false, reason: 'missing map close button path' };
      const freshSnapshot = scan();
      const freshPlan = plan(freshSnapshot);
      const freshIntent = freshPlan.intent || {};
      if (freshIntent.type !== 'close_map_after_navigation') return { ok: false, reason: `fresh intent changed: ${freshIntent.type || 'unknown'}` };
      if (!freshIntent.closeButton || freshIntent.closeButton.sourcePath !== intentValue.closeButton.sourcePath) return { ok: false, reason: 'map close button changed' };
      const node = findNodeByPath(root(), freshIntent.closeButton.sourcePath);
      if (!node) return { ok: false, reason: 'map close button node not found' };
      if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'map close button node hidden' };
      return { ok: true, node, intent: freshIntent };
    }

    function findNodeByPath(rootNode, path) {
      if (!rootNode || !path || path !== 'root' && !path.startsWith('root/')) return null;
      let node = rootNode;
      const parts = path.split('/').slice(1);
      for (let index = 0; index < parts.length; index += 1) {
        const match = parts[index].match(/\[(\d+)\]$/);
        if (!match || !node || typeof node.getChildAt !== 'function') return null;
        node = node.getChildAt(Number(match[1]));
      }
      return node || null;
    }

    function nodeIsEffectivelyVisible(node) {
      let current = node;
      while (current) {
        if (current.visible === false || current.internalVisible === false) return false;
        current = current.parent;
      }
      return true;
    }

    function activateNode(node) {
      if (!node) return { ok: false, reason: 'missing node' };
      try {
        if (node.displayObject && typeof node.displayObject.event === 'function' && window.Laya && window.Laya.Event && window.fgui && window.fgui.Events) {
          const event = window.fgui.Events.createEvent(window.Laya.Event.CLICK, node.displayObject);
          node.displayObject.event(window.Laya.Event.CLICK, event);
          return { ok: true, method: 'displayObject.event(click)' };
        }
        if (typeof node.fireClick === 'function') {
          node.fireClick(true);
          return { ok: true, method: 'fireClick' };
        }
      } catch (error) {
        return { ok: false, reason: error && error.message ? error.message : String(error) };
      }
      return { ok: false, reason: 'node.fireClick unavailable' };
    }

    function stateForIntent(type) {
      if (type === 'select_boss_row') return 'SELECT_BOSS_ROW';
      if (type === 'select_boss_house_map') return 'SELECT_BOSS_HOUSE_MAP';
      if (type === 'enter_boss_house_map') return 'ENTER_BOSS_HOUSE_MAP';
      if (type === 'close_boss_panel_for_map') return 'CLOSE_BOSS_PANEL_FOR_MAP';
      if (type === 'close_map_after_navigation') return 'WAIT_ARRIVE_BOSS_POINT';
      if (type === 'open_world_map') return 'OPEN_WORLD_MAP';
      if (type === 'navigate_to_boss_point' || type === 'wait_arrive_boss_point') return 'WAIT_ARRIVE_BOSS_POINT';
      if (type === 'prepare_boss' || type === 'auto_candidate') return 'PREPARE_BOSS';
      if (type === 'travel_to_boss') return 'TRAVEL_TO_BOSS';
      if (type === 'wait_spawn') return 'WAIT_SPAWN';
      if (type === 'warrior_task') return 'WARRIOR_TASK';
      if (type === 'farm_fallback') return 'FARM_FALLBACK';
      if (type === 'pause') return 'PAUSED';
      if (type === 'disabled') return 'DISABLED';
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
        bossPanel: { open: false, selectedTab: '', selectedBossName: '', tabs: [], rows: [], requirements: [], enterButtons: [], closeButton: null },
        bossHousePanel: { open: false, selectedMap: '', maps: [], enterButton: null },
        mapPanel: { open: false, mapName: '', openButton: null, closeButton: null, bossTargets: [] },
        leftPanel: { bossEntries: [], warriorTaskEntries: [] },
        warriorTaskPanel: { open: false, completed: null, limit: null, maxStar: null, cards: [], refreshButton: null, costText: '' },
        taskPanel: { open: false, selectedTask: null, starFilters: [], acceptButton: null, submitButton: null },
        combat: { targetName: '', targetLevel: 0, hpPercent: null, ownerName: '', damageBoard: [], confidence: 0 },
        timers: { knownRespawns: [], resetTimes: resetTimes() },
        confidence: { scene: 0, bossPanel: 0, bossHousePanel: 0, mapPanel: 0, leftPanel: 0, warriorTaskPanel: 0, taskPanel: 0, combat: 0 },
      };
    }

    function collectNodes(gRoot) {
      const nodes = [];
      walkNodes(gRoot, (node, depth, path, effectiveVisible) => {
        const item = summarizeNode(node, effectiveVisible);
        item.depth = depth;
        item.path = path;
        nodes.push(item);
      }, 0, 'root', true);
      return nodes;
    }

    function walkNodes(node, visit, depth, path, inheritedVisible) {
      if (!node || depth > 18) return;
      const selfVisible = node.visible !== false && node.internalVisible !== false;
      const effectiveVisible = inheritedVisible !== false && selfVisible;
      visit(node, depth || 0, path || 'root', effectiveVisible);
      const count = Number(node.numChildren) || 0;
      for (let index = 0; index < count; index += 1) {
        const child = node.getChildAt(index);
        const childName = cleanText(child && child.name) || '?';
        walkNodes(child, visit, (depth || 0) + 1, `${path || 'root'}/${childName}[${index}]`, effectiveVisible);
      }
    }

    function walk(node, visit, depth) {
      if (!node || depth > 16) return;
      visit(node, depth || 0);
      const count = Number(node.numChildren) || 0;
      for (let index = 0; index < count; index += 1) {
        walk(node.getChildAt(index), visit, (depth || 0) + 1);
      }
    }

    function summarizeNode(node, effectiveVisible) {
      const text = cleanText([node.text, node.title, node.name].filter(Boolean).join(' '));
      const rect = getRect(node);
      const pkg = packageInfo(node);
      return {
        name: cleanText(node.name),
        text,
        contentText: cleanText(node.text || node.title || ''),
        visible: node.visible !== false && node.internalVisible !== false,
        internalVisible: node.internalVisible !== false,
        effectiveVisible: effectiveVisible !== false,
        selected: node.selected === true,
        rect,
        packageName: pkg.name,
        packageOwner: pkg.owner,
      };
    }

    function packageInfo(node) {
      const item = node && node.packageItem;
      if (!item) return { name: '', owner: '' };
      return {
        name: cleanText(item.name),
        owner: cleanText(item.owner && item.owner.name ? item.owner.name : item.owner),
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
      const panelRoot = findBossPanelRoot(nodes);
      const panelNodes = panelRoot ? descendantsOf(nodes, panelRoot) : nodes;
      const open = Boolean(panelRoot) || nodes.some((item) => /挑战\s*BOSS|当前爆率/.test(item.text));
      if (!open) return { open: false, selectedTab: '', selectedBossName: '', tabs: [], rows: [], requirements: [], enterButtons: [], closeButton: null };
      const tabs = uniqueByText(panelNodes
        .filter((item) => item.effectiveVisible && /野外BOSS|福利BOSS|首饰BOSS|试炼之地|苦难炼狱/.test(item.contentText))
        .map((item) => ({ text: item.contentText, rect: item.rect, selected: item.selected === true })));
      const selectedTab = tabs.find((tab) => tab.selected) || tabs[0] || null;
      const rows = scanBossRows(panelNodes);
      const selectedBossName = scanSelectedBossName(panelNodes);
      const requirements = panelNodes
        .filter((item) => item.effectiveVisible && /开启等级|推荐防御|推荐攻击|翅膀|套装|需要/.test(item.contentText))
        .map((item) => ({ text: item.contentText, rect: item.rect }));
      const enterButtons = scanBossEnterButtons(panelNodes);
      const close = panelNodes.find((item) => item.name === 'btnClose' && item.effectiveVisible);
      return {
        open,
        selectedTab: selectedTab ? selectedTab.text : '',
        selectedBossName,
        tabs,
        rows,
        requirements,
        enterButtons,
        closeButton: close ? buttonSummaryWithPath(close) : null,
      };
    }

    function findBossPanelRoot(nodes) {
      return nodes.find((item) => item.effectiveVisible && (item.packageName === 'InstanceBossWnd' || item.packageOwner === 'InstanceBossWnd')) || null;
    }

    function scanBossHousePanel(nodes) {
      const panelRoot = nodes.find((item) => item.effectiveVisible && (item.packageName === 'InstanceBossHouseWnd' || item.packageOwner === 'InstanceBossHouseWnd'));
      if (!panelRoot) return { open: false, selectedMap: '', maps: [], enterButton: null };
      const panelNodes = descendantsOf(nodes, panelRoot);
      const list = panelNodes.find((item) => item.name === 'list');
      const maps = list
        ? panelNodes
          .filter((item) => item.path !== list.path && item.path && item.path.startsWith(`${list.path}/`) && item.packageName === 'Button1')
          .sort((a, b) => a.rect.y - b.rect.y)
          .map((row) => {
            const title = descendantsOf(panelNodes, row).find((item) => item.name === 'title' && item.contentText);
            return {
              name: title ? title.contentText : '',
              selected: row.selected === true,
              rect: row.rect,
              sourcePath: row.path,
            };
          })
          .filter((item) => item.name)
        : [];
      const selected = maps.find((item) => item.selected) || null;
      const enter = panelNodes.find((item) => item.name === 'btnEnter' && item.effectiveVisible);
      return {
        open: true,
        selectedMap: selected ? selected.name : '',
        maps,
        enterButton: enter ? { text: enter.contentText || '进入', rect: enter.rect, sourcePath: enter.path } : null,
      };
    }

    function scanMapPanel(nodes) {
      const openButton = nodes.find((item) => item.effectiveVisible && item.name === 'btn_map' && item.packageName === 'mapBtn');
      const panelRoot = nodes.find((item) => item.effectiveVisible && (item.packageName === 'MapDetialWnd' || item.packageOwner === 'MapDetialWnd'));
      if (!panelRoot) {
        return {
          open: false,
          mapName: '',
          openButton: openButton ? buttonSummaryWithPath(openButton) : null,
          closeButton: null,
          bossTargets: [],
        };
      }
      const panelNodes = descendantsOf(nodes, panelRoot);
      const mapNameNode = panelNodes.find((item) => item.name === 'labline' && item.contentText);
      const closeButton = panelNodes.find((item) => item.name === 'btnClose' && item.effectiveVisible);
      const bossTargets = scanMapBossTargets(panelNodes);
      return {
        open: true,
        mapName: mapNameNode ? mapNameNode.contentText : '',
        openButton: openButton ? buttonSummaryWithPath(openButton) : null,
        closeButton: closeButton ? buttonSummaryWithPath(closeButton) : null,
        bossTargets,
      };
    }

    function scanMapBossTargets(panelNodes) {
      const list = panelNodes.find((item) => item.name === 'List_right');
      if (!list) return [];
      return panelNodes
        .filter((item) => item.path !== list.path && item.path && item.path.startsWith(`${list.path}/`) && item.packageName === 'RightLift')
        .sort((a, b) => a.rect.y - b.rect.y)
        .map((row) => {
          const children = descendantsOf(panelNodes, row).filter((item) => item.path !== row.path);
          const nameNode = children.find((item) => item.name === 'n16' && item.contentText);
          return {
            name: nameNode ? cleanText(nameNode.contentText) : '',
            rect: row.rect,
            sourcePath: row.path,
          };
        })
        .filter((item) => item.name);
    }

    function descendantsOf(nodes, rootNode) {
      if (!rootNode || !rootNode.path) return nodes;
      return nodes.filter((item) => item.path === rootNode.path || (item.path && item.path.startsWith(`${rootNode.path}/`)));
    }

    function scanBossRows(nodes) {
      const componentRows = nodes
        .filter((item) => item.effectiveVisible && item.packageName === 'BtnBoss')
        .map((row) => {
          const children = descendantsOf(nodes, row).filter((item) => item.path !== row.path);
          const nameNode = children.find((item) => item.name === 'lab_name' && item.contentText);
          const levelNode = children.find((item) => item.name === 'lab_level' && item.contentText);
          const name = nameNode ? nameNode.contentText : '';
          const detail = levelNode ? levelNode.contentText : '';
          return {
            name,
            text: cleanText([name, detail].filter(Boolean).join(' ')),
            rect: row.rect,
            sourcePath: row.path,
          };
        })
        .filter((row) => row.name && row.text !== row.name);

      if (componentRows.length) return componentRows;

      return nodes
        .filter((item) => item.effectiveVisible && /推荐防御|推荐攻击|特殊掉落/.test(item.text))
        .map((item) => ({ name: extractBossName(item.text), text: item.text, rect: item.rect, sourcePath: item.path }))
        .filter((row) => row.name);
    }

    function scanSelectedBossName(nodes) {
      const selected = nodes.find((item) => item.effectiveVisible && /BossName$/.test(item.name) && item.contentText);
      if (selected) return selected.contentText;
      return nodes
        .filter((item) => item.effectiveVisible && item.contentText && item.rect.x >= 430 && item.rect.y >= 190 && item.rect.y <= 280)
        .map((item) => extractBossName(item.contentText))
        .find(Boolean) || '';
    }

    function scanBossEnterButtons(nodes) {
      const mapButtons = nodes
        .filter((item) => item.effectiveVisible && item.packageName === 'BtnBossMore')
        .map((button) => {
          const children = descendantsOf(nodes, button).filter((item) => item.path !== button.path);
          const text = cleanText(children.map((item) => item.contentText).filter(Boolean).join(' '));
          return entranceSummary(text, button.rect, button.path);
        })
        .filter((button) => button.text);

      if (mapButtons.length) return mapButtons;

      return nodes
        .filter((item) => item.effectiveVisible && /前往|挑战|进入|\(\d+,\d+\)|\d+只/.test(item.contentText))
        .filter((item) => !/挑战\s*BOSS|当前爆率/.test(item.text))
        .map((item) => entranceSummary(item.contentText, item.rect, item.path));
    }

    function entranceSummary(text, rect, sourcePath) {
      const value = cleanText(text);
      const countMatch = value.match(/(\d+)\s*只/);
      const coordinate = normalizeCoordinate(value);
      const map = cleanText(value
        .replace(/\(\s*\d{1,3}\s*,\s*\d{1,3}\s*\)/, '')
        .replace(/\d+\s*只.*$/, ''));
      const summary = {
        text: value,
        map,
        coordinate,
        count: countMatch ? Number(countMatch[1]) : null,
        blockedReason: blockedMapReason(map, state.config.eligibility),
        rect,
        sourcePath,
      };
      return summary;
    }

    function annotateEntranceForTarget(entrance, target) {
      const reason = entrance.blockedReason || blockedTargetMapReason(entrance.map, target, state.config.eligibility);
      return { ...entrance, blockedReason: reason };
    }

    function blockedMapReason(map, eligibility) {
      const pattern = (eligibility.blockedMapPatterns || []).find((item) => patternMatches(item, map));
      return pattern ? `blocked map pattern: ${pattern}` : '';
    }

    function blockedTargetMapReason(map, target, eligibility) {
      const rule = (eligibility.blockedTargetMaps || []).find((item) => {
        const typeMatches = !item.type || cleanText(item.type) === cleanText(target.type);
        const nameMatches = !item.name || namesMatch(item.name, target.name);
        return typeMatches && nameMatches && patternMatches(item.mapPattern, map);
      });
      return rule ? `blocked target map pattern: ${rule.mapPattern}` : '';
    }

    function patternMatches(pattern, value) {
      const text = cleanText(value);
      const source = cleanText(pattern);
      if (!source) return false;
      try {
        return new RegExp(source).test(text);
      } catch (error) {
        return text.includes(source);
      }
    }

    function uniqueByText(items) {
      const seen = {};
      return items.filter((item) => {
        if (seen[item.text]) return false;
        seen[item.text] = true;
        return true;
      });
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

    function scanWarriorTaskPanel(nodes) {
      const panelRoot = nodes.find((item) => item.visible && (item.packageName === 'StarTaskWnd' || item.packageOwner === 'StarTaskWnd'));
      if (!panelRoot) return { open: false, completed: null, limit: null, maxStar: null, cards: [], refreshButton: null, costText: '' };
      const panelNodes = descendantsOf(nodes, panelRoot);
      const taskList = panelNodes.find((item) => item.name === 'taskList');
      const cards = taskList
        ? panelNodes
          .filter((item) => item.depth === taskList.depth + 1 && item.path && item.path.startsWith(`${taskList.path}/`) && item.packageName === 'taskItem')
          .sort((a, b) => a.rect.x - b.rect.x)
          .map((card, index) => scanWarriorTaskCard(panelNodes, card, index))
          .filter((card) => card.name)
        : [];
      const progress = parseRatioText((panelNodes.find((item) => item.name === 'textFinishTime' && item.contentText) || {}).contentText);
      const costNode = panelNodes.find((item) => item.name === 'textTaskCost' && item.contentText);
      const refresh = panelNodes.find((item) => item.name === 'btnRefresh' && item.contentText);
      const maxStar = parseMaxStar(panelNodes) || cards.reduce((max, card) => Math.max(max, card.star || 0), 0) || null;
      return {
        open: true,
        completed: progress ? progress.current : null,
        limit: progress ? progress.total : null,
        maxStar,
        cards,
        refreshButton: refresh ? buttonSummary(refresh) : null,
        costText: costNode ? costNode.contentText : '',
      };
    }

    function scanWarriorTaskCard(panelNodes, card, index) {
      const children = descendantsOf(panelNodes, card).filter((item) => item.path !== card.path);
      const nameNode = children.find((item) => item.name === 'textName' && item.contentText);
      const mapNode = children.find((item) => item.name === 'textMapName' && item.contentText);
      const progressNode = children.find((item) => item.name === 'textTaskTarget' && item.contentText);
      const buttons = {
        accept: null,
        reward: null,
        go: null,
        abandon: null,
      };
      children
        .filter((item) => item.visible && /^btn/.test(item.name) && item.contentText)
        .forEach((button) => {
          if (button.name === 'btnAccept' && button.contentText === '领取奖励') buttons.reward = buttonSummary(button);
          if (button.name === 'btnAccept' && button.contentText === '领取任务') buttons.accept = buttonSummary(button);
          if (button.name === 'btnGo') buttons.go = buttonSummary(button);
          if (button.name === 'btnQuit') buttons.abandon = buttonSummary(button);
        });
      const progress = progressNode ? progressNode.contentText : '';
      const state = inferWarriorTaskState(progress, buttons);
      return {
        index,
        name: nameNode ? nameNode.contentText : '',
        map: mapNode ? cleanText(mapNode.contentText.replace(/^所在地图[:：]?/, '')) : '',
        progressText: progress,
        star: children.filter((item) => item.visible && item.packageName === 'ico_auctionStar_bright').length,
        state,
        rect: card.rect,
        buttons,
      };
    }

    function inferWarriorTaskState(progressText, buttons) {
      if (buttons.reward && progressText === '1/1') return 'reward_ready';
      if (buttons.go && buttons.abandon) return 'accepted';
      if (buttons.accept && progressText === '0/1') return 'available';
      return 'unknown';
    }

    function buttonSummary(item) {
      return { text: item.contentText, rect: item.rect };
    }

    function buttonSummaryWithPath(item) {
      return { text: item.contentText, rect: item.rect, sourcePath: item.path };
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

    function scanRespawns(nodes, scene, combat) {
      const observedAt = Date.now();
      return uniqueRespawns([
        ...scanDamageListRespawns(nodes, observedAt),
        ...scanSceneFloatingRespawns(scene, combat, observedAt),
        ...scanInlineRespawns(nodes, observedAt),
      ]).sort((a, b) => (a.refreshInSeconds || 0) - (b.refreshInSeconds || 0));
    }

    function scanDamageListRespawns(nodes, observedAt) {
      const damageRoot = nodes.find((item) => item.effectiveVisible && item.path && item.path.includes('Damage list'));
      const mapNode = damageRoot
        ? descendantsOf(nodes, damageRoot).find((item) => item.name === 'txtName' && item.contentText)
        : null;
      if (!damageRoot) return [];
      return nodes
        .filter((item) => item.effectiveVisible && item.packageName === 'bossinfoitem' && item.path && item.path.startsWith(`${damageRoot.path}/`))
        .map((row) => {
          const children = descendantsOf(nodes, row).filter((item) => item.path !== row.path);
          const nameNode = children.find((item) => item.name === 'nameTxt' && item.contentText);
          const posNode = children.find((item) => item.name === 'posTxt' && item.contentText);
          const descNode = children.find((item) => item.name === 'desTxt' && /剩余刷新时间/.test(item.contentText));
          const seconds = descNode ? parseRefreshSeconds(descNode.contentText) : null;
          if (!nameNode || seconds == null) return null;
          return respawnSummary({
            name: nameNode.contentText,
            text: descNode.contentText,
            coordinate: posNode ? normalizeCoordinate(posNode.contentText) : '',
            mapName: mapNode ? mapNode.contentText : '',
            refreshInSeconds: seconds,
            source: 'damage_list',
            sourcePath: row.path,
            observedAt,
          });
        })
        .filter(Boolean);
    }

    function scanSceneFloatingRespawns(scene, combat, observedAt) {
      const targetName = resolveSceneRespawnName(scene);
      if (!window.Laya || !Laya.stage) return [];
      const candidates = [];
      walkLayaNodes(Laya.stage, (node, path, effectiveVisible) => {
        if (!effectiveVisible || path.includes('MainWnd')) return;
        const text = cleanText([node.text, node._text, node.htmlText, node._htmlText].filter(Boolean).join(' '));
        const seconds = parseColonSeconds(text);
        if (seconds == null) return;
        candidates.push({
          text,
          seconds,
          path,
          rect: {
            x: Number(node.x) || 0,
            y: Number(node.y) || 0,
            w: Number(node.width) || 0,
            h: Number(node.height) || 0,
          },
        });
      }, 0, 'stage', true);
      if (!candidates.length) return [];
      candidates.sort((a, b) => Math.abs(a.rect.x - 480) + Math.abs(a.rect.y - 260) - (Math.abs(b.rect.x - 480) + Math.abs(b.rect.y - 260)));
      const item = candidates[0];
      return [respawnSummary({
        name: targetName.name,
        nameSource: targetName.source,
        text: item.text,
        coordinate: scene && scene.coordinates ? scene.coordinates : '',
        mapName: scene && scene.mapName ? scene.mapName : '',
        refreshInSeconds: item.seconds,
        source: 'scene_floating_text',
        sourcePath: item.path,
        observedAt,
      })];
    }

    function walkLayaNodes(node, visit, depth, path, inheritedVisible) {
      if (!node || depth > 18) return;
      const selfVisible = node.visible !== false && node.active !== false;
      const effectiveVisible = inheritedVisible !== false && selfVisible;
      visit(node, path || 'stage', effectiveVisible);
      const count = Number(node.numChildren) || 0;
      for (let index = 0; index < count; index += 1) {
        const child = node.getChildAt(index);
        const childName = cleanText(child && child.name) || '?';
        walkLayaNodes(child, visit, (depth || 0) + 1, `${path || 'stage'}/${childName}[${index}]`, effectiveVisible);
      }
    }

    function resolveSceneRespawnName(scene) {
      const sceneMap = cleanText(scene && scene.mapName);
      const scenePoint = parseCoordinatePair(scene && scene.coordinates);
      const hint = (state.config.respawnNameHints || []).find((item) => {
        if (cleanText(item.mapName) !== sceneMap) return false;
        const hintPoint = parseCoordinatePair(item.coordinate);
        if (!scenePoint || !hintPoint) return false;
        return chebyshevDistance(scenePoint, hintPoint) <= item.radius;
      });
      if (hint) return { name: hint.name, source: 'location_hint' };

      const pending = state.pendingBossPointTarget && state.pendingBossPointTarget.target
        ? state.pendingBossPointTarget.target
        : state.pendingBossPointNavigation && state.pendingBossPointNavigation.target
          ? state.pendingBossPointNavigation.target
          : null;
      if (pending && pending.name) return { name: pending.name, source: 'pending_target' };

      const enabledTargets = (state.config.targets || []).filter((target) => target.enabled);
      if (enabledTargets.length === 1) return { name: enabledTargets[0].name, source: 'single_configured_target' };

      return { name: '', source: 'unknown' };
    }

    function chebyshevDistance(left, right) {
      return Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));
    }

    function scanInlineRespawns(nodes, observedAt) {
      return nodes
        .filter((item) => /剩余刷新时间/.test(item.text) && extractBossName(item.text))
        .map((item) => respawnSummary({
          name: extractBossName(item.text),
          text: item.text,
          coordinate: normalizeCoordinate(item.text),
          mapName: '',
          refreshInSeconds: parseRefreshSeconds(item.text),
          source: 'ui',
          sourcePath: item.path,
          observedAt,
        }))
        .filter((item) => item.refreshInSeconds != null);
    }

    function respawnSummary(input) {
      const seconds = Number(input.refreshInSeconds);
      const refreshAt = Number.isFinite(seconds) ? input.observedAt + seconds * 1000 : null;
      return {
        name: cleanText(input.name),
        nameSource: cleanText(input.nameSource),
        text: cleanText(input.text),
        mapName: cleanText(input.mapName),
        coordinate: cleanText(input.coordinate),
        state: seconds > 0 ? 'cooldown' : 'ready',
        refreshInSeconds: Number.isFinite(seconds) ? seconds : null,
        observedAt: input.observedAt,
        refreshAt,
        refreshAtText: refreshAt ? formatLocalTime(refreshAt) : '',
        source: cleanText(input.source),
        sourcePath: cleanText(input.sourcePath),
      };
    }

    function uniqueRespawns(items) {
      const seen = {};
      return items.filter((item) => {
        const key = [item.source, item.mapName, item.name, item.coordinate, item.refreshInSeconds].join('|');
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    function computeConfidence(snapshot) {
      return {
        scene: snapshot.scene.mapName ? 0.8 : 0,
        bossPanel: snapshot.bossPanel.open ? 0.8 : 0,
        bossHousePanel: snapshot.bossHousePanel && snapshot.bossHousePanel.open ? 0.8 : 0,
        mapPanel: snapshot.mapPanel && snapshot.mapPanel.open ? 0.8 : snapshot.mapPanel && snapshot.mapPanel.openButton ? 0.4 : 0,
        leftPanel: snapshot.leftPanel.bossEntries.length ? 0.8 : 0,
        warriorTaskPanel: snapshot.warriorTaskPanel && snapshot.warriorTaskPanel.open ? 0.8 : 0,
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

    function parseColonSeconds(text) {
      const value = cleanText(text);
      const match = value.match(/^(\d{1,2}):([0-5]\d)(?:\s+\1:\2)?$/);
      if (!match) return null;
      return Number(match[1]) * 60 + Number(match[2]);
    }

    function formatLocalTime(timestamp) {
      try {
        return new Date(timestamp).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
      } catch (error) {
        return new Date(timestamp).toISOString();
      }
    }

    function parseStar(text) {
      const match = cleanText(text).match(/(\d+)星/);
      return match ? Number(match[1]) : null;
    }

    function parseProgressText(text) {
      const match = cleanText(text).match(/\d+\/\d+/);
      return match ? match[0] : '';
    }

    function parseRatioText(text) {
      const match = cleanText(text).match(/(\d+)\s*\/\s*(\d+)/);
      return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
    }

    function parseMaxStar(nodes) {
      const text = nodes.map((item) => item.contentText).find((value) => /最高可接取.+难度任务/.test(value));
      if (!text) return null;
      const match = text.match(/最高可接取(.+?)难度任务/);
      return match ? parseChineseNumber(match[1]) : null;
    }

    function parseChineseNumber(value) {
      const text = cleanText(value);
      const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      if (/^\d+$/.test(text)) return Number(text);
      return map[text] || null;
    }

    function normalizeCoordinate(text) {
      const match = cleanText(text).match(/(\d{1,3}),\s*(\d{1,3})/);
      return match ? `${match[1]},${match[2]}` : '';
    }

    function parseCoordinatePair(text) {
      const coordinate = normalizeCoordinate(text);
      if (!coordinate) return null;
      const parts = coordinate.split(',');
      return { x: Number(parts[0]), y: Number(parts[1]) };
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
      if (!cfg.actions || typeof cfg.actions !== 'object' || Array.isArray(cfg.actions)) cfg.actions = clone(base.actions);
      if (!cfg.warriorTask || typeof cfg.warriorTask !== 'object' || Array.isArray(cfg.warriorTask)) cfg.warriorTask = clone(base.warriorTask);
      if (!cfg.eligibility || typeof cfg.eligibility !== 'object' || Array.isArray(cfg.eligibility)) cfg.eligibility = clone(base.eligibility);
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
      cfg.actions.enabled = cfg.actions.enabled === true;
      cfg.actions.cooldownMs = clampInteger(cfg.actions.cooldownMs, 1000, 60000, 8000);
      cfg.targets = Array.isArray(cfg.targets) ? cfg.targets.map(normalizeTarget).filter(Boolean) : [];
      cfg.fallbackFarmSpots = Array.isArray(cfg.fallbackFarmSpots) ? cfg.fallbackFarmSpots.map(normalizeFarmSpot).filter(Boolean) : [];
      cfg.respawnNameHints = Array.isArray(cfg.respawnNameHints) ? cfg.respawnNameHints.map(normalizeRespawnNameHint).filter(Boolean) : clone(base.respawnNameHints);
      cfg.warriorTask.enabled = cfg.warriorTask.enabled !== false;
      cfg.warriorTask.dailyLimit = clampInteger(cfg.warriorTask.dailyLimit, 0, 20, 4);
      cfg.warriorTask.requiredStar = clampInteger(cfg.warriorTask.requiredStar, 1, 10, 3);
      cfg.warriorTask.taskType = cleanText(cfg.warriorTask.taskType) || 'BOSS';
      cfg.eligibility = normalizeEligibility(cfg.eligibility, base.eligibility);
      return cfg;
    }

    function normalizeEligibility(input, fallback) {
      const source = input && typeof input === 'object' && !Array.isArray(input) ? input : fallback;
      return {
        blockedMapPatterns: Array.isArray(source.blockedMapPatterns)
          ? source.blockedMapPatterns.map(cleanText).filter(Boolean)
          : clone(fallback.blockedMapPatterns),
        blockedTargetMaps: Array.isArray(source.blockedTargetMaps)
          ? source.blockedTargetMaps
            .map((item) => ({
              type: cleanText(item && item.type),
              name: cleanText(item && item.name),
              mapPattern: cleanText(item && item.mapPattern),
            }))
            .filter((item) => item.mapPattern)
          : clone(fallback.blockedTargetMaps),
      };
    }

    function normalizeTarget(target) {
      if (!target || typeof target !== 'object') return null;
      const name = cleanText(target.name);
      if (!name) return null;
      return {
        type: cleanText(target.type),
        name,
        matchMode: cleanText(target.matchMode) === 'contains' ? 'contains' : 'exact',
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

    function normalizeRespawnNameHint(hint) {
      if (!hint || typeof hint !== 'object') return null;
      const mapName = cleanText(hint.mapName || hint.map);
      const coordinate = normalizeCoordinate(hint.coordinate);
      const name = cleanText(hint.name);
      if (!mapName || !coordinate || !name) return null;
      return {
        mapName,
        coordinate,
        name,
        radius: clampInteger(hint.radius, 0, 20, 3),
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
      return String(value == null ? '' : value)
        .replace(/<[^>]+>/g, '')
        .replace(/\[\/?color(?:=[^\]]+)?\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
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
