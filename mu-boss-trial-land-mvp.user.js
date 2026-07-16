// ==UserScript==
// @name         全民红月 - 四风平原+试炼之地 BOSS MVP
// @namespace    codex.mu.trial-land-boss-mvp
// @version      0.1.7
// @description  四风平原 + 试炼之地 BOSS 自动化。跨地图调度，自动进出试炼之地打 BOSS，打完返回四风平原挂机。
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

    if (window.__muTrialLandBossMvp) return;

    const STORAGE_KEY = 'mu_trial_land_boss_mvp_v1';
    const TICK_MS = 1000;
    const ARRIVAL_THRESHOLD = 3;
    const CONFIG_DEFAULTS = Object.freeze({
      enabled: false,
      dryRun: true,
      ownerName: '普尔赫达',
      preWaitSeconds: 90,
      ownerObserveSeconds: 10,
      contestedCooldownMs: 5 * 60 * 1000,
      arrivalStallMs: 15 * 1000,
      travelTimeoutMs: 180 * 1000,
      farmTargetName: '1400级怪物',
      rateRecheckIntervalMs: 15 * 60 * 1000,
      trialPriorityWindowMs: 60 * 1000,
      trialBossFallbackAttempts: 3,
    });
    const MAX_LOGS = 200;
    const TARGETS = Object.freeze([
      Object.freeze({ id: 'ao-left', name: '傲之煞', mapName: '四风平原', coordinate: '77,145' }),
      Object.freeze({ id: 'ao-right', name: '傲之煞', mapName: '四风平原', coordinate: '182,164' }),
      Object.freeze({ id: 'angry-ao', name: '愤怒傲之煞', mapName: '四风平原', coordinate: '179,79' }),
      Object.freeze({ id: 'rage-ao', name: '狂暴傲之煞', mapName: '四风平原', coordinate: '82,88' }),
      Object.freeze({ id: 'lobster-1', name: '龙虾战士', mapName: '试炼之地1', coordinate: '146,127', layer: 1 }),
      Object.freeze({ id: 'lobster-2', name: '邪恶龙虾战士', mapName: '试炼之地1', coordinate: '79,68', layer: 1 }),
      Object.freeze({ id: 'lobster-3', name: '咆哮龙虾战士', mapName: '试炼之地1', coordinate: '122,33', layer: 1 }),
    ]);
    const TARGET_TABLE = TARGETS;
    const KNOWN_MAP_NAMES = ['四风平原', '试炼之地1', '勇者大陆'];
    const FOUR_WINDS_BOSS_NAMES = ['傲之煞', '愤怒傲之煞', '狂暴傲之煞'];
    const TRIAL_BOSS_NAMES = ['龙虾战士', '邪恶龙虾战士', '咆哮龙虾战士'];

    const state = {
      enabled: false,
      dryRun: true,
      phase: 'SYNC',
      currentTargetId: '',
      currentAction: null,
      targets: TARGETS.map(createTargetState),
      logs: [],
      config: normalizeConfig(readJson(STORAGE_KEY, CONFIG_DEFAULTS)),
      paused: false,
      pauseReason: '',
      lastSnapshot: null,
      lastIntent: null,
      currentIntent: null,
      ownerObservation: null,
      tickId: null,
      farmTargetMissing: false,
      navigationContext: null,
      lastError: null,
      lastActionAt: 0,
      lastZSentAt: 0,
      farmArrivedAt: 0,
      farmArrivedCoord: '',
      farmLastSeenFarmingAt: 0,
      holdStartedAt: 0,
      lastCheckedAt: {},
      lastMapScanAt: 0,
      mapScanContext: null,
      rateCheck: { phase: 'idle', targetMap: '', startedAt: 0, lastActionAt: 0 },
      rateResults: {},
      enterTrialContext: null,
      exitTrialContext: null,
      teleportContext: null,
      trialTaskbarFailCount: 0,
      zKeySentAt: 0,
      zKeyRetryCount: 0,
      arrivalConfirmedAt: 0,
    };
    syncRuntimeFlags();

    window.__muTrialLandBossMvp = {
      start() {
        state.config.enabled = true;
        state.config.dryRun = false;
        syncRuntimeFlags();
        persist();
        appendLog('started', { dryRun: state.dryRun });
        return getStatus();
      },
      toggle() {
        if (state.config.enabled && !state.dryRun) {
          state.config.enabled = false;
          state.config.dryRun = true;
          syncRuntimeFlags();
          persist();
          resetAllContexts();
          releaseLockedTarget();
          appendLog('toggled_off', {});
        } else {
          state.config.enabled = true;
          state.config.dryRun = false;
          syncRuntimeFlags();
          persist();
          appendLog('toggled_on', {});
        }
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
    setupKeyboardToggle();

    function resetAllContexts() {
      state.rateCheck = { phase: 'idle', targetMap: '', startedAt: 0, lastActionAt: 0 };
      state.rateResults = {};
      state.farmArrivedAt = 0;
      state.farmArrivedCoord = '';
      state.farmLastSeenFarmingAt = 0;
      state.holdStartedAt = 0;
      state.lastCheckedAt = {};
      state.lastMapScanAt = 0;
      state.mapScanContext = null;
      state.navigationContext = null;
      state.enterTrialContext = null;
      state.exitTrialContext = null;
      state.teleportContext = null;
      state.trialTaskbarFailCount = 0;
      state.zKeySentAt = 0;
      state.zKeyRetryCount = 0;
      state.arrivalConfirmedAt = 0;
    }

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
        state.lastError = { at: Date.now(), message: error && error.message ? error.message : String(error) };
        appendLog('tick_error', { message: error && error.message ? error.message : String(error) });
        return null;
      }
    }

    function readSnapshot() {
      const gRoot = root();
      const nodes = gRoot ? collectNodes(gRoot) : [];
      const snapshot = {
        at: Date.now(),
        overlay: readOverlay(),
        scene: scanScene(nodes),
        mapPanel: scanMapPanel(nodes),
        combat: scanCombat(nodes),
        bossChallengePanel: scanBossChallengePanel(nodes),
        autoBattle: scanAutoBattle(nodes),
        trialTaskbar: scanTrialTaskbar(nodes),
        fguiReady: Boolean(gRoot),
      };
      const farmTargetMissing = snapshot.mapPanel.open && !snapshot.mapPanel.farmTarget;
      if (farmTargetMissing && !state.farmTargetMissing) {
        appendLog('farm_target_missing', { reason: snapshot.mapPanel.farmTargetReason });
      }
      state.farmTargetMissing = farmTargetMissing;
      state.lastSnapshot = snapshot;
      return clone(snapshot);
    }

    function reconcileTargets(snapshot) {
      const now = Number(snapshot && snapshot.at) || Date.now();
      const records = snapshot && snapshot.overlay && Array.isArray(snapshot.overlay.records)
        ? snapshot.overlay.records
        : [];
      const previousById = new Map(state.targets.map((target) => [target.id, target]));
      state.targets = TARGETS.map((definition) => {
        const previous = previousById.get(definition.id) || createTargetState(definition);
        const target = { ...createTargetState(definition), ...clone(previous), ...definition };
        const matchingRecord = selectMatchingRecord(records, target);
        if (matchingRecord) {
          const refreshAt = validRefreshAt(matchingRecord.refreshAt);
          if (refreshAt !== null) {
            target.refreshAt = refreshAt;
            target.lastRefreshAt = refreshAt;
            target.lastRecordAt = validRecordAt(matchingRecord.observedAt, now);
          } else {
            target.refreshAt = null;
            target.lastRefreshAt = null;
            target.lastRecordAt = validRecordAt(matchingRecord.observedAt, now);
          }
       } else {
         // No matching overlay record — preserve refreshAt from previous state
         // (may have been set by executeTravelTrialBoss from taskbar countdown).
         // Only clear if there was no previous value.
         if (!validRefreshAt(target.refreshAt)) {
           target.refreshAt = null;
           target.lastRefreshAt = null;
         }
         target.lastRecordAt = 0;
       }
        target.status = targetStatus(target, now);
        return target;
      });
      return clone(state.targets);
    }

    // --- chooseIntent: cross-map scheduling ---

    function chooseIntent(snapshot) {
      let intent;
      if (!state.config.enabled) {
        resetOwnerObservation();
        intent = makeIntent('disabled', null, 'config disabled', 'none', 1);
      } else if (state.paused) {
        resetOwnerObservation();
        intent = makeIntent('safe_wait', state.currentTargetId || null, state.pauseReason || 'paused', 'none', 1);
      } else if (!snapshot || !snapshot.fguiReady || !snapshot.overlay || !snapshot.overlay.available) {
        resetOwnerObservation();
        intent = makeIntent('sync', null, 'runtime unavailable', 'none', 0);
      } else if (state.enterTrialContext) {
        intent = makeIntent('enter_trial', state.enterTrialContext.selectedBossId || null,
          'entering trial land: ' + state.enterTrialContext.phase, 'enter_trial', 0.95);
      } else if (state.exitTrialContext) {
        intent = makeIntent('exit_trial', null,
          'exiting trial land: ' + state.exitTrialContext.phase, 'exit_trial', 0.95);
     } else if (state.teleportContext) {
       intent = makeIntent('teleport_four_winds', null,
         'teleporting to four winds: ' + state.teleportContext.phase, 'teleport_four_winds', 0.95);
     } else if (needRateCheck(snapshot) && !getRateResult((snapshot.scene || {}).mapName)) {
       // First-time rate check must run before any boss selection
       resetOwnerObservation();
       intent = makeIntent('check_rate', null, 'initial boss rate check', 'check_boss_rate', 0.96);
     } else if (hasLockedValidTarget(snapshot)) {
       intent = intentForLockedTarget(snapshot);
     } else {
        const mapName = (snapshot.scene || {}).mapName || '';
        if (mapName === '试炼之地1') {
          intent = chooseTrialIntent(snapshot);
        } else if (mapName === '勇者大陆') {
          intent = makeIntent('teleport_four_winds', null, 'at brave continent', 'teleport_four_winds', 0.85);
        } else if (mapName === '四风平原') {
          intent = chooseFourWindsIntent(snapshot);
        } else {
          intent = makeIntent('teleport_four_winds', null, 'unknown map - safe fallback', 'teleport_four_winds', 0.8);
        }
      }

      // Rate check — lowest priority
      if (!intent || intent.type === 'safe_wait' || intent.type === 'disabled' || intent.type === 'sync') {
        if (needRateCheck(snapshot)) {
          resetOwnerObservation();
          intent = makeIntent('check_rate', null, 'boss rate check due', 'check_boss_rate', 0.5);
      } else if (isMapRateLow((snapshot.scene || {}).mapName)) {
          resetOwnerObservation();
          releaseLockedTarget();
          if (isAlreadyFarming(snapshot)) {
            intent = makeIntent('safe_wait', null, 'boss rate low - already farming', 'none', 0.5);
          } else {
            intent = makeIntent('travel_farm', null, 'boss rate low - farming only', 'click_farm_target', 0.5);
          }
        }
      }

      return applyIntent(intent);
    }

    function chooseTrialIntent(snapshot) {
      const now = Number(snapshot.at) || Date.now();
      const attackable = getAttackableTargets('试炼之地1', now);
      if (!attackable.length) {
        return makeIntent('exit_trial', null, 'no trial boss - exiting', 'exit_trial', 0.85);
      }
      const candidate = selectTrialTarget(snapshot, attackable);
      if (!candidate) {
        return makeIntent('exit_trial', null, 'no selectable trial boss', 'exit_trial', 0.8);
      }
      return intentForTarget(candidate, snapshot);
    }

    function chooseFourWindsIntent(snapshot) {
      if (shouldPrioritizeTrial(snapshot)) {
        return makeIntent('enter_trial', null, 'trial boss prioritized', 'enter_trial', 0.92);
      }
      // When four winds boss rate is low, skip four winds boss selection — only farm + trial land
      if (isMapRateLow('四风平原')) {
        resetOwnerObservation();
        if (isAlreadyFarming(snapshot)) {
          return makeIntent('safe_wait', null, 'boss rate low - already farming', 'none', 0.8);
        }
        return makeIntent('travel_farm', null, 'boss rate low - farming only', 'click_farm_target', 0.8);
      }
      if (needMapScan(snapshot)) {
        resetOwnerObservation();
        return makeIntent('scan_map', null, 'scanning map for boss refresh timers', 'open_map_scan', 0.85);
      }
      const candidate = selectHighestPriorityTarget(snapshot);
      if (candidate) {
        return intentForTarget(candidate, snapshot);
      }
      resetOwnerObservation();
      if (isAlreadyFarming(snapshot)) {
        return makeIntent('safe_wait', null, 'no boss work - already farming', 'none', 0.8);
      }
      return makeIntent('travel_farm', null, 'no boss work', 'click_farm_target', 0.8);
    }

    function selectTrialTarget(snapshot, attackable) {
      const now = Number(snapshot.at) || Date.now();
      const visible = attackable.filter((t) => isVisibleAndAttackable(t, snapshot));
      if (visible.length) return visible[0];
      // Prefer targets with known refreshAt -- pick the one that refreshes earliest
      const knownTimer = attackable
        .filter((t) => validRefreshAt(t.refreshAt) !== null)
        .sort((a, b) => Number(a.refreshAt) - Number(b.refreshAt));
      if (knownTimer.length) return knownTimer[0];
      // Fall back to targets with unknown refreshAt (no overlay record yet)
      return attackable[0] || null;
    }

   function getAttackableTargets(mapName, now) {
     if (isMapRateLow(mapName)) return [];
     return state.targets.filter((t) => {
        if (t.mapName !== mapName) return false;
        if (isCooling(t, now)) return false;
        const status = targetStatus(t, now);
        return status === 'READY' || status === 'READY_UNKNOWN_TIMER' || status === 'PREPARE';
      });
    }

   function shouldPrioritizeTrial(snapshot) {
     const now = Number(snapshot.at) || Date.now();
     const trialAttackable = getAttackableTargets('试炼之地1', now);
     const fourWindsAttackable = getAttackableTargets('四风平原', now);
     if (!trialAttackable.length) return false;
     if (!fourWindsAttackable.length) return true;
     // When four winds boss rate is low, always prioritize trial land
     if (isMapRateLow('四风平原')) return true;
     // Trial land has READY or READY_UNKNOWN_TIMER bosses — available now, always prioritize
     const trialHasReady = trialAttackable.some((t) => {
       const st = targetStatus(t, now);
       return st === 'READY' || st === 'READY_UNKNOWN_TIMER';
     });
    if (trialHasReady) return true;
    // Trial land has PREPARE bosses (within pre-wait window) — need travel time, prioritize
    const trialHasPrepare = trialAttackable.some((t) => {
      const st = targetStatus(t, now);
      return st === 'PREPARE';
    });
    if (trialHasPrepare) {
      // Defer only if four winds also has a PREPARE boss refreshing sooner
      const fourWindsPrepare = fourWindsAttackable.filter((t) =>
        targetStatus(t, now) === 'PREPARE');
      if (!fourWindsPrepare.length) return true;
      const trialEarliestPrepare = Math.min(...trialAttackable
        .filter((t) => targetStatus(t, now) === 'PREPARE')
        .map((t) => Number(t.refreshAt)));
      const fourWindsEarliestPrepare = Math.min(...fourWindsPrepare
        .map((t) => Number(t.refreshAt)));
      return trialEarliestPrepare <= fourWindsEarliestPrepare;
    }
    // Both sides have only PREPARE bosses — compare refresh times
    const trialEarliest = Math.min(...trialAttackable.map((t) => Number(t.refreshAt) || now));
    const fourWindsEarliest = Math.min(...fourWindsAttackable.map((t) => Number(t.refreshAt) || now));
    const diff = Math.abs(trialEarliest - fourWindsEarliest);
    if (diff <= state.config.trialPriorityWindowMs) return true;
    return trialEarliest <= fourWindsEarliest;
   }

    // --- Target state & matching ---

    function createTargetState(target) {
      return {
        ...target,
        refreshAt: null,
        lastRefreshAt: null,
        lastRecordAt: 0,
        cooldownUntil: 0,
        cooldownRefreshAt: null,
        status: 'UNKNOWN',
      };
    }

    function recordMatchesTarget(record, target) {
      if (!record || !target) return false;
      if (cleanText(record.mapName) !== target.mapName) return false;
      if (cleanText(record.bossName) !== target.name) return false;
     const rawCoordinate = cleanText(record.bossCoordinate);
     // Trial land records may lack bossCoordinate — match by name + mapName only.
     if (!rawCoordinate) return true;
     const coordinate = normalizeCoordinate(rawCoordinate);
      if (!coordinate || !target.coordinate) return true;
      // Fuzzy match: overlay coordinate may differ by a few tiles from the definition
      return chebyshevDistance(coordinate, target.coordinate) <= 3;
   }

    function selectMatchingRecord(records, target) {
      return records
        .filter((record) => recordMatchesTarget(record, target))
        .sort((left, right) => {
          const coordinateDelta = Number(Boolean(normalizeCoordinate(right.bossCoordinate)))
            - Number(Boolean(normalizeCoordinate(left.bossCoordinate)));
          if (coordinateDelta) return coordinateDelta;
          return validRecordAt(right.observedAt, 0) - validRecordAt(left.observedAt, 0);
        })[0] || null;
    }

    function validRefreshAt(value) {
      const refreshAt = Number(value);
      return Number.isFinite(refreshAt) && refreshAt > 0 ? refreshAt : null;
    }

    function validRecordAt(value, fallback) {
      const recordAt = Number(value);
      return Number.isFinite(recordAt) && recordAt > 0 ? recordAt : fallback;
    }

    function clearCooldown(target) {
      target.cooldownUntil = 0;
      target.cooldownRefreshAt = null;
    }

    function isCooling(target, now) {
      return Boolean(target && Number(target.cooldownUntil) > now);
    }

    function markContested(target, now) {
      if (!target) return;
      const contestedAt = Number(now) || Date.now();
      target.cooldownUntil = contestedAt + state.config.contestedCooldownMs;
      target.cooldownRefreshAt = validRefreshAt(target.refreshAt);
      target.status = 'COOLING';
      state.currentTargetId = '';
      state.currentAction = null;
    }

    function targetStatus(target, now) {
      if (isCooling(target, now)) return 'COOLING';
      const refreshAt = validRefreshAt(target && target.refreshAt);
      if (refreshAt === null) return 'READY_UNKNOWN_TIMER';
      if (refreshAt <= now) return 'READY';
      if (refreshAt - now <= state.config.preWaitSeconds * 1000) return 'PREPARE';
      return 'WAITING_REFRESH';
    }

    function targetById(id) {
      return state.targets.find((target) => target.id === id) || null;
    }

    // --- Intent helpers ---

    function makeIntent(type, targetId, reason, action, confidence) {
      return {
        type,
        targetId: targetId || null,
        reason: cleanText(reason),
        action: action || 'none',
        confidence: clampNumber(confidence, 0, 1, 0),
      };
    }

    function applyIntent(intent) {
      const next = clone(intent);
      const previousTargetId = state.currentTargetId;
      if (next.targetId) state.currentTargetId = next.targetId;
      else if (next.type !== 'safe_wait' && next.type !== 'enter_trial'
        && next.type !== 'exit_trial' && next.type !== 'teleport_four_winds') state.currentTargetId = '';
      // target 切换时清空到达相关派生状态。
      // 否则击杀 BOSS A 后切到 BOSS B 时,executeTravelTrialBoss 会误用 A 的
      // arrivalConfirmedAt,在 line 1171 提前 return,跳过任务栏点击导致角色卡死。
      if (state.currentTargetId && state.currentTargetId !== previousTargetId) {
        state.arrivalConfirmedAt = 0;
        state.zKeySentAt = 0;
        state.zKeyRetryCount = 0;
        state.holdStartedAt = 0;
      }
      state.currentAction = next.action === 'none' ? null : next.action;
      state.phase = next.type.toUpperCase();
      if (!isLockingIntent() && state.navigationContext) {
        appendLog('nav_context_cleared', { reason: 'intent not locking: ' + next.type, navKind: state.navigationContext.kind });
        state.navigationContext = null;
      }
      state.lastIntent = next;
      state.currentIntent = next;
      return clone(next);
    }

    function hasLockedValidTarget(snapshot) {
      const target = targetById(state.currentTargetId);
      const now = Number(snapshot.at) || Date.now();
      if (!isLockingIntent()) return false;
      if (state.currentIntent.type === 'travel_farm') return false;
      if (state.currentAction === 'navigation_failed' || !isLockTargetEligible(target, now)) {
        releaseLockedTarget();
        return false;
      }
      if (state.currentIntent.type === 'engage' || state.currentIntent.type === 'observe_owner') {
        if (!target || isCooling(target, now)) {
          releaseLockedTarget();
          return false;
        }
        return true;
      }
      return !findVisibleAttackableTarget(snapshot, target.id);
    }

    function isLockingIntent() {
      return state.currentIntent
        && (state.currentIntent.type === 'travel_boss'
          || state.currentIntent.type === 'travel_farm'
          || state.currentIntent.type === 'travel_trial_boss'
          || state.currentIntent.type === 'hold'
          || state.currentIntent.type === 'engage'
          || state.currentIntent.type === 'observe_owner'
          || state.currentIntent.type === 'enter_trial'
          || state.currentIntent.type === 'exit_trial'
          || state.currentIntent.type === 'teleport_four_winds');
    }

    function isLockTargetEligible(target, now) {
      const definition = target && TARGETS.find((item) => item.id === target.id);
      const allowedStatuses = ['READY_UNKNOWN_TIMER', 'READY', 'PREPARE'];
      return Boolean(definition
        && definition.name === target.name
        && !isCooling(target, now)
        && allowedStatuses.includes(target.status));
    }

    function releaseLockedTarget() {
      state.currentTargetId = '';
      state.currentAction = null;
      state.currentIntent = null;
    }

    function findVisibleAttackableTarget(snapshot, excludedTargetId) {
      return state.targets.find((target) => target.id !== excludedTargetId
        && !isCooling(target, Number(snapshot.at) || Date.now())
        && isVisibleAndAttackable(target, snapshot)) || null;
    }

    function selectHighestPriorityTarget(snapshot) {
      const now = Number(snapshot.at) || Date.now();
      const lockedTarget = targetById(state.currentTargetId);
      const visibleInterrupt = lockedTarget && isLockingIntent()
        ? findVisibleAttackableTarget(snapshot, lockedTarget.id)
        : null;
      if (visibleInterrupt) return visibleInterrupt;
      const eligible = state.targets.filter((target) =>
        target.mapName === '四风平原' && !isCooling(target, now) && !isMapRateLow(target.mapName));
      // 1. Visible and attackable bosses
      const visible = eligible.filter((target) => isVisibleAndAttackable(target, snapshot));
     if (visible.length) return visible[0];
     // 2. Bosses refreshing within pre-wait window (farm <90s to refresh)
     const soonToRefresh = eligible
       .filter((target) => {
         const refreshAt = validRefreshAt(target.refreshAt);
         return refreshAt !== null && refreshAt > now && refreshAt - now <= state.config.preWaitSeconds * 1000;
       })
       .sort((left, right) => Number(left.refreshAt) - Number(right.refreshAt));
     if (soonToRefresh.length) return soonToRefresh[0];
     // 3. Already refreshed bosses (refreshAt <= now) — go fight them
     const ready = eligible.filter((target) => {
       const refreshAt = validRefreshAt(target.refreshAt);
       return refreshAt !== null && refreshAt <= now;
     });
     if (ready.length) return ready[0];
     // 4. Lowest priority: targets with unknown refresh time (need to walk there to get timer)
     const RECHECK_COOLDOWN_MS = 3 * 60 * 1000;
     const unknown = eligible.filter((target) => {
       if (validRefreshAt(target.refreshAt) !== null) return false;
       const lastChecked = Number(state.lastCheckedAt[target.id]) || 0;
       return now - lastChecked > RECHECK_COOLDOWN_MS;
     });
     if (unknown.length) return unknown[0];
     return null;
    }

    function isVisibleAndAttackable(target, snapshot) {
      const combat = snapshot && snapshot.combat;
      if (!combat || cleanText(combat.targetName) !== target.name) return false;
      if (!hasVisibleHpBar(combat) || Number(combat.hpPercent) === 0) return false;
      const scene = snapshot.scene || {};
      return !scene.mapName || scene.mapName === target.mapName;
    }

    function intentForLockedTarget(snapshot) {
      const target = targetById(state.currentTargetId);
      return target
        ? intentForTarget(target, snapshot)
        : makeIntent('sync', null, 'locked target missing', 'none', 0);
    }

    function intentForTarget(target, snapshot) {
      if (observeContestedOwner(target, snapshot)) {
        return makeIntent('safe_wait', null, 'boss contested cooldown', 'none', 0.95);
      }
      if (isVisibleAndAttackable(target, snapshot)) {
        const ownerName = cleanText(snapshot.combat && snapshot.combat.ownerName);
        if (ownerName && ownerName !== state.config.ownerName) {
          return makeIntent('observe_owner', target.id, 'visible boss owned by another player', 'observe_owner', 0.95);
        }
        return makeIntent('engage', target.id, 'visible boss is attackable', 'ensure_auto_battle', 1);
      }
      const isTrialTarget = target.mapName === '试炼之地1';
      const travelIntentType = isTrialTarget ? 'travel_trial_boss' : 'travel_boss';
      const travelAction = isTrialTarget ? 'click_trial_taskbar' : 'click_boss_target';
      if (target.coordinate !== 'TBD' && isAtTarget(target, snapshot)) {
        const now = Number(snapshot.at) || Date.now();
        if (target.status === 'READY_UNKNOWN_TIMER') {
          if (!state.holdStartedAt) state.holdStartedAt = now;
          const HOLD_UNKNOWN_TIMEOUT_MS = 60 * 1000;
          if (now - state.holdStartedAt > HOLD_UNKNOWN_TIMEOUT_MS) {
            appendLog('hold_timeout_unknown', { targetId: target.id, elapsedMs: now - state.holdStartedAt });
            state.lastCheckedAt[target.id] = now;
            releaseLockedTarget();
            state.holdStartedAt = 0;
            return makeIntent('safe_wait', null, 'hold timeout - boss not refreshing', 'none', 0.7);
          }
        } else {
          state.holdStartedAt = 0;
        }
        return makeIntent('hold', target.id, 'at boss coordinate', 'hold_position', 0.95);
      }
      if (target.status === 'READY_UNKNOWN_TIMER') {
        return makeIntent(travelIntentType, target.id, 'unknown refresh timer', travelAction, 0.9);
      }
      if (target.status === 'READY') {
        return makeIntent(travelIntentType, target.id, 'boss refresh time reached', travelAction, 0.9);
      }
      return makeIntent(travelIntentType, target.id, 'refresh within pre-wait window', travelAction, 0.85);
    }

    function observeContestedOwner(target, snapshot) {
      const combat = snapshot && snapshot.combat;
      const ownerName = cleanText(combat && combat.ownerName);
      const isForeignOwner = Boolean(combat
        && cleanText(combat.targetName) === target.name
        && hasVisibleHpBar(combat)
        && ownerName
        && ownerName !== state.config.ownerName);
      if (!isForeignOwner) {
        resetOwnerObservation();
        return false;
      }
      const now = Number(snapshot.at) || Date.now();
      if (!state.ownerObservation || state.ownerObservation.targetId !== target.id) {
        state.ownerObservation = { targetId: target.id, observedAt: now };
        return false;
      }
      if (now - state.ownerObservation.observedAt < state.config.ownerObserveSeconds * 1000) return false;
      resetOwnerObservation();
      markContested(target, now);
      return true;
    }

    function resetOwnerObservation() {
      state.ownerObservation = null;
    }

    function hasVisibleHpBar(combat) {
      const hpPercent = combat && combat.hpPercent;
      return hpPercent !== null
        && hpPercent !== undefined
        && hpPercent !== ''
        && Number.isFinite(Number(hpPercent));
    }

    function isAtTarget(target, snapshot) {
      const scene = snapshot && snapshot.scene;
      if (!scene || scene.mapName !== target.mapName || !scene.coordinate) return false;
      return chebyshevDistance(scene.coordinate, target.coordinate) <= ARRIVAL_THRESHOLD;
    }

   function chebyshevDistance(coordA, coordB) {
     const a = coordA.split(',').map(Number);
     const b = coordB.split(',').map(Number);
     if (a.length < 2 || b.length < 2 || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return Infinity;
     return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
   }

   function parseCountdownMs(text) {
     const s = cleanText(text);
     let totalMs = 0;
     let matched = false;
     const hourMatch = s.match(/(\d+)\s*小时/);
     const minMatch = s.match(/(\d+)\s*分/);
     const secMatch = s.match(/(\d+)\s*秒/);
     if (hourMatch) { totalMs += parseInt(hourMatch[1], 10) * 3600 * 1000; matched = true; }
     if (minMatch) { totalMs += parseInt(minMatch[1], 10) * 60 * 1000; matched = true; }
     if (secMatch) { totalMs += parseInt(secMatch[1], 10) * 1000; matched = true; }
     if (!matched) {
       const m = s.match(/(\d{1,2}):([0-5]\d)/);
       if (m) { totalMs = (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000; matched = true; }
     }
     return matched ? totalMs : 0;
   }

    function isAlreadyFarming(snapshot) {
      if (!state.farmArrivedAt || !state.farmArrivedCoord) return false;
      if (state.navigationContext) return false;
      const autoBattle = snapshot && snapshot.autoBattle;
      if (autoBattle && autoBattle.enabled) {
        state.farmLastSeenFarmingAt = Date.now();
        return true;
      }
      if (state.farmLastSeenFarmingAt && Date.now() - state.farmLastSeenFarmingAt < 60000) return true;
      if (Date.now() - state.farmArrivedAt < 15000) return true;
      if (snapshot && snapshot.mapPanel && snapshot.mapPanel.open) return false;
      const coord = snapshot && snapshot.scene && snapshot.scene.coordinate;
      if (!coord) return true;
      return chebyshevDistance(coord, state.farmArrivedCoord) <= ARRIVAL_THRESHOLD;
    }

    // --- executeIntent dispatch ---

    function executeIntent(intent, snapshot) {
      if (!intent) return null;
      state.currentAction = intent.action || intent.type;
      const now = Date.now();

      if (intent.action === 'none' || intent.type === 'sync' || intent.type === 'disabled' || intent.type === 'safe_wait') {
        appendLog('intent_' + intent.type, { reason: intent.reason, targetId: intent.targetId });
        return clone(intent);
      }

      if (now - state.lastActionAt < 500) {
        appendLog('action_throttled', { msSinceLast: now - state.lastActionAt });
        return clone(intent);
      }

      let result;
      switch (intent.type) {
        case 'travel_boss': result = executeTravel(intent, snapshot, 'boss'); break;
        case 'travel_farm': result = executeTravel(intent, snapshot, 'farm'); break;
        case 'travel_trial_boss': result = executeTravelTrialBoss(intent, snapshot); break;
        case 'hold': result = executeHold(intent, snapshot); break;
        case 'engage': result = executeEngage(intent, snapshot); break;
        case 'observe_owner': result = executeObserveOwner(intent, snapshot); break;
        case 'check_rate': result = executeCheckRate(intent, snapshot); break;
        case 'scan_map': result = executeScanMap(intent, snapshot); break;
        case 'enter_trial': result = executeEnterTrial(intent, snapshot); break;
        case 'exit_trial': result = executeExitTrial(intent, snapshot); break;
        case 'teleport_four_winds': result = executeTeleportFourWinds(intent, snapshot); break;
        case 'contested': result = { ok: true, reason: 'contested_cooldown_active' }; break;
        default:
          appendLog('intent_unknown', { type: intent.type });
          return clone(intent);
      }

      state.lastActionAt = now;
      if (result && result.ok) {
        appendLog('action_executed', { type: intent.type, method: result.method || '', reason: result.reason || '' });
      } else {
        appendLog('action_blocked', { type: intent.type, reason: result ? result.reason : 'unknown' });
        state.lastError = { at: now, message: result ? result.reason : 'unknown', type: intent.type };
      }
      return clone(intent);
    }

    // --- Navigation (travel_boss / travel_farm) ---

   function executeTravel(intent, snapshot, kind) {
     const now = Date.now();
     const targetKey = intent.targetId || 'farm';
     let navCtx = state.navigationContext;
     const isSameNav = navCtx && navCtx.kind === kind && navCtx.targetId === targetKey;

     // Close any blocking panels before attempting map navigation
     if (snapshot.bossChallengePanel && snapshot.bossChallengePanel.open) {
       closePanelIfExists('Instance_BossUI');
       return { ok: true, reason: 'closing_blocking_panel' };
     }

     // 提前建立 navigationContext 以便跟踪 mapOpenedAt(地图渲染等待窗口)。
     // 原逻辑只在找到 targetRow 后才建 context,导致地图已开但行未渲染时
     // 没有 5s 计时基准,卡死在 boss_row_not_found 循环里直到游戏自身刷新。
     if (!isSameNav) {
       state.navigationContext = {
         kind,
         targetId: targetKey,
         startedAt: now,
         lastCoordinate: '',
         lastCoordinateAt: 0,
         clicked: false,
         retried: false,
         mapOpenedAt: 0,
         reopenClicked: false,
       };
       navCtx = state.navigationContext;
     }

     if (!snapshot.mapPanel.open) {
       if (navCtx.clicked) {
         return checkNavProgress(navCtx, snapshot, intent, kind, now);
       }
       return clickOpenMapButton(snapshot);
     }

     // 地图已开 — 记录首次打开时间(用于行渲染超时判定)
     if (!navCtx.mapOpenedAt) navCtx.mapOpenedAt = now;

     let targetRow;
     if (kind === 'boss') {
       const target = targetById(intent.targetId);
       if (!target) return { ok: false, reason: 'boss_target_missing' };
       targetRow = snapshot.mapPanel.bossTargets.find((row) => row.name === target.name);
       if (!targetRow || targetRow.targetId !== intent.targetId) {
         targetRow = snapshot.mapPanel.bossTargets.find((row) => row.targetId === intent.targetId);
       }
       if (!targetRow) {
         return handleMapRowNotRendered(navCtx, kind, targetKey, 'boss_row_not_found', now);
       }
     } else {
       targetRow = snapshot.mapPanel.farmTarget;
       if (!targetRow) {
         return handleMapRowNotRendered(navCtx, kind, targetKey, 'farm_target_missing', now);
       }
     }

     // 行已找到 — 重置 reopenClicked,下次卡住可再次重开地图
     navCtx.reopenClicked = false;

     if (navCtx.clicked) {
       if (navCtx.closeClicked) {
         return { ok: true, reason: 'waiting_map_close' };
       }
       return closeMapPanel(snapshot);
     }

     const fresh = readSnapshot();
     if (!fresh.mapPanel.open) return { ok: false, reason: 'map_panel_closed' };
     const freshRow = findNodeByPathSummary(fresh.mapPanel, targetRow.sourcePath, targetKey);
     if (!freshRow) return { ok: false, reason: 'target_row_vanished' };

     const node = findNodeByPath(root(), targetRow.sourcePath);
     if (!node) return { ok: false, reason: 'target_node_not_found' };
     if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'target_node_hidden' };
     const action = activateNode(node);
     if (!action.ok) return { ok: false, reason: action.reason };
     navCtx.clicked = true;
     appendLog('nav_target_clicked', { kind, targetId: targetKey, method: action.method });
     return { ok: true, method: action.method, reason: kind + '_row_clicked' };
   }

   // 地图已开但目标行未渲染时的兜底:5s 内等待,5s 后关地图重开一次,
   // 仍失败则放弃目标让 chooseIntent 选其他目标。
   // 间歇性卡死场景:大地图打开是异步的,mapPanel.open === true 但 List_right
   // 里的 RightLift 行还没渲染完成 → bossTargets 为空 → 原逻辑每 tick 返回
   // boss_row_not_found 但永远不关地图也不超时 → 角色站死直到游戏自身刷新。
   function handleMapRowNotRendered(navCtx, kind, targetKey, reason, now) {
     const RENDER_WAIT_MS = 5000;
     if (!navCtx.mapOpenedAt) navCtx.mapOpenedAt = now;

     if (now - navCtx.mapOpenedAt < RENDER_WAIT_MS) {
       return { ok: true, reason: 'waiting_for_rows_render' };
     }

     if (!navCtx.reopenClicked) {
       // 用 closePanelIfExists 而非 closeMapPanel — 后者依赖 btnClose 节点,
       // 而卡住场景下 btnClose 可能和行一起没渲染。closePanelIfExists 有
       // hideImmediately/removeFromParent 兜底,强制移除面板。
       const closeResult = closePanelIfExists('MapDetialWnd');
       navCtx.reopenClicked = true;
       navCtx.mapOpenedAt = 0;
       appendLog('map_reopen_for_retry', { kind, targetId: targetKey, reason, closeReason: closeResult.reason });
       return { ok: true, reason: 'map_reopen_for_retry' };
     }

     appendLog('travel_give_up', { kind, targetId: targetKey, reason: 'row_render_timeout' });
     state.navigationContext = null;
     releaseLockedTarget();
     return { ok: false, reason: 'target_row_render_timeout' };
   }

    function checkNavProgress(navCtx, snapshot, intent, kind, now) {
      if (now - navCtx.startedAt > state.config.travelTimeoutMs) {
        if (navCtx.retried) {
          appendLog('navigation_failed', { kind, targetId: intent.targetId, elapsed: now - navCtx.startedAt });
          state.navigationContext = null;
          state.currentTargetId = '';
          state.currentAction = 'navigation_failed';
          return { ok: false, reason: 'navigation_timeout' };
        }
        navCtx.retried = true;
        navCtx.startedAt = now;
        navCtx.lastCoordinate = '';
        navCtx.lastCoordinateAt = 0;
        navCtx.clicked = false;
        navCtx.closeClicked = false;
        navCtx.mapOpenedAt = 0;
        navCtx.reopenClicked = false;
        appendLog('navigation_retry', { kind, targetId: intent.targetId });
        return { ok: true, reason: 'retry_pending' };
      }

      const currentCoord = snapshot.scene.coordinate || '';
      if (!currentCoord) return { ok: true, reason: 'navigating' };

      const moved = currentCoord !== navCtx.lastCoordinate;
      if (moved) {
        navCtx.lastCoordinate = currentCoord;
        navCtx.lastCoordinateAt = now;
      }

      if (kind === 'boss' && intent.targetId) {
        const target = targetById(intent.targetId);
        if (target && target.coordinate !== 'TBD'
          && chebyshevDistance(currentCoord, target.coordinate) <= ARRIVAL_THRESHOLD) {
          appendLog('navigation_arrived', { kind, targetId: intent.targetId, coordinate: currentCoord, targetCoordinate: target.coordinate });
          state.arrivalConfirmedAt = now;
          state.navigationContext = null;
          return { ok: true, reason: 'arrived' };
        }
      }

      if (kind === 'farm' && !moved && now - navCtx.lastCoordinateAt > 5000) {
        appendLog('navigation_arrived', { kind: 'farm', targetId: 'farm', coordinate: currentCoord });
        state.farmArrivedAt = now;
        state.farmArrivedCoord = currentCoord;
        state.arrivalConfirmedAt = now;
        state.navigationContext = null;
        return { ok: true, reason: 'arrived' };
      }

      if (!moved && now - navCtx.lastCoordinateAt > state.config.arrivalStallMs) {
        if (!navCtx.retried) {
          navCtx.retried = true;
          navCtx.startedAt = now;
          navCtx.clicked = false;
          navCtx.closeClicked = false;
          navCtx.mapOpenedAt = 0;
          navCtx.reopenClicked = false;
          appendLog('navigation_retry_stall', { kind, targetId: intent.targetId, coordinate: currentCoord });
          return { ok: true, reason: 'retry_pending' };
        }
        appendLog('navigation_failed_stall', { kind, targetId: intent.targetId });
        state.navigationContext = null;
        state.currentTargetId = '';
        state.currentAction = 'navigation_failed';
        return { ok: false, reason: 'coordinate_stall_timeout' };
      }

      return { ok: true, reason: 'navigating' };
    }

    function closeMapPanel(snapshot) {
      if (!snapshot.mapPanel.closeButton) return { ok: false, reason: 'no_close_button' };
      const fresh = readSnapshot();
      if (!fresh.mapPanel.closeButton) return { ok: false, reason: 'close_button_vanished' };
      const node = findNodeByPath(root(), fresh.mapPanel.closeButton.sourcePath);
      if (!node) return { ok: false, reason: 'close_node_not_found' };
      if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'close_node_hidden' };
      const action = activateNode(node);
      if (!action.ok) return { ok: false, reason: action.reason };
      if (state.navigationContext) state.navigationContext.closeClicked = true;
      return { ok: true, method: action.method, reason: 'map_closed' };
    }

    function findNodeByPathSummary(mapPanel, sourcePath, targetId) {
      if (!sourcePath) return null;
      const all = [...(mapPanel.bossTargets || []), mapPanel.farmTarget].filter(Boolean);
      return all.find((row) => row.sourcePath === sourcePath) || null;
    }

    function clickOpenMapButton(snapshot) {
      if (!snapshot.mapPanel.openButton) return { ok: false, reason: 'no_map_open_button' };
      const fresh = readSnapshot();
      if (!fresh.mapPanel.openButton) return { ok: false, reason: 'map_open_button_vanished' };
      const node = findNodeByPath(root(), fresh.mapPanel.openButton.sourcePath);
      if (!node) return { ok: false, reason: 'map_open_node_not_found' };
      if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'map_open_node_hidden' };
      const action = activateNode(node);
      if (!action.ok) return { ok: false, reason: action.reason };
      return { ok: true, method: action.method, reason: 'map_opened' };
    }

    // --- enter_trial: open challenge panel -> switch tab -> select boss -> click enter ---

    function executeEnterTrial(intent, snapshot) {
      const now = Date.now();
      if (!state.enterTrialContext) {
        state.enterTrialContext = {
          phase: 'closing_panels',
          startedAt: now,
          selectedBossId: null,
          lastActionAt: 0,
        };
        appendLog('enter_trial_start', {});
      }

      const ctx = state.enterTrialContext;

      // Total timeout: 60s
      if (now - ctx.startedAt > 60 * 1000) {
        appendLog('enter_trial_timeout', { phase: ctx.phase, elapsed: now - ctx.startedAt });
        closePanelIfExists('Instance_BossUI');
        closePanelIfExists('MapDetialWnd');
        state.enterTrialContext = null;
        releaseLockedTarget();
        return { ok: false, reason: 'enter_trial_timeout' };
      }

      const MIN_ACTION_GAP = 800;
      if (now - ctx.lastActionAt < MIN_ACTION_GAP) {
        return { ok: true, reason: 'enter_trial_throttled' };
      }

      const panel = snapshot.bossChallengePanel;

      switch (ctx.phase) {
        case 'closing_panels': {
          // Close any open panels first (single-panel constraint)
          const closeResult = closePanelIfExists('MapDetialWnd');
          closePanelIfExists('Instance_BossUI');
          ctx.phase = 'opening';
          ctx.lastActionAt = now;
          appendLog('enter_trial_panels_closed', { reason: closeResult.reason });
          return { ok: true, reason: 'panels_closed' };
        }

        case 'opening': {
          if (panel && panel.open) {
            ctx.phase = 'select_tab';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'panel_already_open' };
          }
          if (snapshot.mapPanel && snapshot.mapPanel.open) {
            ctx.phase = 'closing_panels';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'need_close_map_first' };
          }
          const btn = panel && panel.openButton;
          if (!btn) return { ok: false, reason: 'no_boss_challenge_button' };
          const fresh = readSnapshot();
          const freshBtn = fresh.bossChallengePanel && fresh.bossChallengePanel.openButton;
          if (!freshBtn) return { ok: false, reason: 'open_button_vanished' };
          const node = findNodeByPath(root(), freshBtn.sourcePath);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'open_node_unavailable' };
          const action = activateNode(node);
          if (!action.ok) return { ok: false, reason: action.reason };
          ctx.lastActionAt = now;
          ctx.phase = 'waiting_for_open';
          appendLog('enter_trial_opened_panel', { method: action.method });
          return { ok: true, method: action.method, reason: 'panel_opening' };
        }

        case 'waiting_for_open': {
          if (panel && panel.open) {
            ctx.phase = 'select_tab';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'panel_opened' };
          }
          if (now - ctx.lastActionAt > 3000) {
            ctx.phase = 'opening';
            ctx.lastActionAt = now;
            appendLog('enter_trial_panel_open_retry', {});
            return { ok: true, reason: 'panel_open_timeout_retry' };
          }
          return { ok: true, reason: 'waiting_for_panel_open' };
        }

        case 'select_tab': {
          if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
          if (panel.selectedTab === '试炼之地') {
            ctx.phase = 'select_boss';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'tab_already_selected' };
          }
          const tab = panel.tabs.find((t) => t.text === '试炼之地');
          if (!tab) return { ok: false, reason: 'trial_tab_not_found' };
          const fresh = readSnapshot();
          const freshPanel = fresh.bossChallengePanel;
          if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
          const freshTab = freshPanel.tabs.find((t) => t.text === '试炼之地');
          if (!freshTab) return { ok: false, reason: 'tab_vanished' };
          const node = findNodeByPath(root(), freshTab.sourcePath);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'tab_node_unavailable' };
          const action = activateNode(node);
          if (!action.ok) return { ok: false, reason: action.reason };
          ctx.lastActionAt = now;
          appendLog('enter_trial_selected_tab', { method: action.method });
          return { ok: true, method: action.method, reason: 'tab_selected' };
        }

        case 'select_boss': {
          if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
          // Select the earliest-refresh attackable trial boss
          const now2 = Date.now();
          const attackable = getAttackableTargets('试炼之地1', now2);
          if (!attackable.length) {
            appendLog('enter_trial_no_attackable', {});
            state.enterTrialContext = null;
            return { ok: false, reason: 'no_attackable_trial_boss' };
          }
          const candidate = selectTrialTarget(snapshot, attackable);
          if (!candidate) return { ok: false, reason: 'no_selectable_trial_boss' };
          ctx.selectedBossId = candidate.id;

          const bossRow = panel.bossRows.find((r) => r.name === candidate.name);
          if (!bossRow) return { ok: false, reason: 'trial_boss_row_not_found' };
          const fresh = readSnapshot();
          const freshPanel = fresh.bossChallengePanel;
          if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
          const freshRow = freshPanel.bossRows.find((r) => r.name === candidate.name);
          if (!freshRow) return { ok: false, reason: 'boss_row_vanished' };
          const node = findNodeByPath(root(), freshRow.sourcePath);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'boss_row_node_unavailable' };
          const action = activateNode(node);
          if (!action.ok) return { ok: false, reason: action.reason };
          ctx.lastActionAt = now;
          appendLog('enter_trial_selected_boss', { bossName: candidate.name });
          ctx.phase = 'click_enter';
          return { ok: true, method: action.method, reason: 'boss_selected' };
        }

        case 'click_enter': {
          if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
          // Find the enter button (BtnBossMore package)
          const enterButtons = panel.enterButtons || [];
          if (!enterButtons.length) {
            // Fallback: look for visible nodes with text matching trial land layer
            appendLog('enter_trial_no_enter_button', {});
            ctx.phase = 'waiting';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'no_enter_button_proceed_to_wait' };
          }
          // Prefer button with text containing "试炼之地1" (exact layer match)
          const enterBtn = enterButtons.find((b) => /试炼之地1/.test(b.text))
            || enterButtons.find((b) => /试炼之地|进入|前往|挑战/.test(b.text))
            || enterButtons[0];
          const fresh = readSnapshot();
          const freshPanel = fresh.bossChallengePanel;
          if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
          const freshBtn = (freshPanel.enterButtons || []).find((b) => b.sourcePath === enterBtn.sourcePath);
          if (!freshBtn) return { ok: false, reason: 'enter_button_vanished' };
          const node = findNodeByPath(root(), freshBtn.sourcePath);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'enter_node_unavailable' };
          const action = activateNode(node);
          if (!action.ok) return { ok: false, reason: action.reason };
          ctx.lastActionAt = now;
          appendLog('enter_trial_clicked_enter', { text: enterBtn.text, method: action.method });
          ctx.phase = 'waiting';
          return { ok: true, method: action.method, reason: 'enter_clicked' };
        }

        case 'waiting': {
          // Wait for scene.mapName to become 试炼之地1
          const mapName = (snapshot.scene || {}).mapName || '';
         if (mapName === '试炼之地1') {
           appendLog('enter_trial_arrived', { mapName });
            closePanelIfExists('Instance_BossUI');
           state.enterTrialContext = null;
            state.currentTargetId = ctx.selectedBossId || '';
            state.arrivalConfirmedAt = 0;
            state.zKeyRetryCount = 0;
            return { ok: true, reason: 'arrived_trial_land' };
          }
          // Panel should auto-close after teleport
          if (panel && panel.open && now - ctx.lastActionAt > 3000) {
            // Panel still open, might need to wait more
            return { ok: true, reason: 'waiting_for_teleport' };
          }
          return { ok: true, reason: 'waiting_for_teleport' };
        }

        default:
          state.enterTrialContext = null;
          return { ok: false, reason: 'unknown_enter_trial_phase' };
      }
    }

    // --- travel_trial_boss: navigate via taskbar entry + Z key safety net ---

   function executeTravelTrialBoss(intent, snapshot) {
     const now = Date.now();
     const target = targetById(intent.targetId);
     if (!target) return { ok: false, reason: 'trial_boss_target_missing' };

     // If already arrived and Z key handled, let chooseIntent transition to engage/hold
     // Close any blocking panels before scanning taskbar (single-panel constraint)
     if (snapshot.bossChallengePanel && snapshot.bossChallengePanel.open) {
       closePanelIfExists('Instance_BossUI');
       return { ok: true, reason: 'closing_blocking_panel' };
     }

     // 大地图打开时试炼之地左侧任务栏(bossinfoitem 节点)被遮挡、
     // effectiveVisible=false,scanTrialTaskbar 返回空数组。不主动关地图
     // 会走 3 次 fallback 才退到 executeTravel,浪费 tick 且走错恢复路径。
     if (snapshot.mapPanel && snapshot.mapPanel.open) {
       closePanelIfExists('MapDetialWnd');
       return { ok: true, reason: 'closing_map_panel' };
     }

     if (state.arrivalConfirmedAt) {
        const zResult = ensureZKey(snapshot);
        if (zResult.ok) {
          return { ok: true, reason: 'arrived_z_checked' };
        }
        // Z key failed but don't block — continue to engage
        return { ok: true, reason: 'arrived_z_failed_nonblocking' };
      }

      // Scan trial taskbar
      const taskbar = snapshot.trialTaskbar || [];
      const isLiveBossStatus = taskbar.length > 0 && taskbar[0].isLiveStatus === true;

      if (!taskbar.length || isLiveBossStatus) {
        // If boss is visible and attackable, we might already be at the boss
        if (isVisibleAndAttackable(target, snapshot)) {
          state.arrivalConfirmedAt = now;
          state.trialTaskbarFailCount = 0;
          return { ok: true, reason: 'boss_visible_in_combat' };
        }

        if (isLiveBossStatus) {
          // Taskbar showing damage list (in combat), not a failure
          state.trialTaskbarFailCount = 0;
          return { ok: true, reason: 'taskbar_in_combat_mode' };
        }

        state.trialTaskbarFailCount++;
        if (state.trialTaskbarFailCount >= state.config.trialBossFallbackAttempts) {
          appendLog('trial_taskbar_fallback_map', { failCount: state.trialTaskbarFailCount });
          // Fallback to M key map navigation
          if (target.coordinate !== 'TBD') {
            return executeTravel(intent, snapshot, 'boss');
          }
          return { ok: false, reason: 'trial_taskbar_empty_no_coords' };
        }
        return { ok: true, reason: 'trial_taskbar_empty_retry' };
      }

      // Find matching taskbar entry
      const entry = taskbar.find((e) => e.bossName === target.name);
      if (!entry) {
        state.trialTaskbarFailCount++;
        if (state.trialTaskbarFailCount >= state.config.trialBossFallbackAttempts) {
          appendLog('trial_taskbar_entry_not_found_fallback', { targetName: target.name });
          if (target.coordinate !== 'TBD') {
            return executeTravel(intent, snapshot, 'boss');
          }
          return { ok: false, reason: 'trial_taskbar_entry_not_found_no_coords' };
        }
        return { ok: true, reason: 'trial_taskbar_entry_not_found_retry' };
      }

     // Taskbar 在 cooling 倒计时阶段也允许点击导航(游戏行为:点击 cooling
     // entry 会寻路到 BOSS 坐标,不必等 BOSS 真正刷新)。先同步 refreshAt 让
     // chooseIntent 跟踪实际倒计时,然后 fall through 到下面的点击逻辑。
     if (entry.status === 'cooling') {
       const parsedMs = parseCountdownMs(entry.desText);
       if (parsedMs > 0) {
         target.refreshAt = Date.now() + parsedMs;
         appendLog('trial_boss_cooling_update', { name: target.name, desText: entry.desText, refreshAt: target.refreshAt });
       }
       // 不 return —— 让下面的 navCtx 建立与点击逻辑执行。
       // 不再硬设 target.status = 'WAITING_REFRESH':reconcileTargets 下 tick
       // 会用 targetStatus() 基于 refreshAt 自然重算(<90s 内为 PREPARE),
       // 硬设 WAITING_REFRESH 会与 isLockTargetEligible 的 allowedStatuses 冲突。
     }

      // Set up navigation context
      if (!state.navigationContext || state.navigationContext.kind !== 'trial_boss'
        || state.navigationContext.targetId !== intent.targetId) {
        state.navigationContext = {
          kind: 'trial_boss',
          targetId: intent.targetId,
          startedAt: now,
          lastCoordinate: snapshot.scene.coordinate || '',
          lastCoordinateAt: now,
          clicked: false,
          retried: false,
        };
      }

      const navCtx = state.navigationContext;

      if (!navCtx.clicked) {
        const gRoot = root();
        const node = findNodeByPath(gRoot, entry.sourcePath);
        if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'taskbar_node_unavailable' };
        const action = activateNode(node);
        if (!action.ok) return { ok: false, reason: action.reason };
        navCtx.clicked = true;
        navCtx.lastCoordinate = snapshot.scene.coordinate || '';
        navCtx.lastCoordinateAt = now;
        state.trialTaskbarFailCount = 0;
        appendLog('trial_taskbar_clicked', { bossName: target.name, method: action.method });
        return { ok: true, method: action.method, reason: 'taskbar_entry_clicked' };
      }

      // Already clicked — check arrival by coordinate stability
      const currentCoord = snapshot.scene.coordinate || '';
      if (!currentCoord) return { ok: true, reason: 'navigating_no_coord' };

      const moved = currentCoord !== navCtx.lastCoordinate;
      if (moved) {
        navCtx.lastCoordinate = currentCoord;
        navCtx.lastCoordinateAt = now;
      }

      // Coordinate stable for 5s AND close to target → arrived
      // 5s 窗口过滤寻路中途避障的短暂停顿;距离校验防止稳定停在中途被误判到达,
      // 否则角色会停在离 BOSS 3-5 格处,ensureZKey 开挂后打不到 BOSS,
      // 状态机重选 intent 再次进入 travel_trial_boss 再次误判 → 周期性停顿。
      if (!moved && now - navCtx.lastCoordinateAt > 5000) {
        if (target.coordinate !== 'TBD'
          && chebyshevDistance(currentCoord, target.coordinate) > ARRIVAL_THRESHOLD) {
          return { ok: true, reason: 'navigating_stable_but_far' };
        }
        state.arrivalConfirmedAt = now;
        state.navigationContext = null;
        appendLog('trial_nav_arrived', { coordinate: currentCoord });
        const zResult = ensureZKey(snapshot);
        return { ok: true, reason: 'arrived', zKey: zResult.reason };
      }

      // Timeout check
      if (now - navCtx.startedAt > state.config.travelTimeoutMs) {
        if (!navCtx.retried) {
          navCtx.retried = true;
          navCtx.startedAt = now;
          navCtx.clicked = false;
          navCtx.lastCoordinate = '';
          navCtx.lastCoordinateAt = 0;
          appendLog('trial_nav_retry_timeout', { targetId: intent.targetId });
          return { ok: true, reason: 'retry_pending' };
        }
        appendLog('trial_nav_failed_timeout', { targetId: intent.targetId });
        state.navigationContext = null;
        state.currentTargetId = '';
        state.currentAction = 'navigation_failed';
        return { ok: false, reason: 'trial_navigation_timeout' };
      }

      // Stall check
      if (!moved && now - navCtx.lastCoordinateAt > state.config.arrivalStallMs) {
        if (!navCtx.retried) {
          navCtx.retried = true;
          navCtx.startedAt = now;
          navCtx.clicked = false;
          appendLog('trial_nav_retry_stall', { coordinate: currentCoord });
          return { ok: true, reason: 'retry_pending' };
        }
        appendLog('trial_nav_failed_stall', {});
        state.navigationContext = null;
        state.currentTargetId = '';
        state.currentAction = 'navigation_failed';
        return { ok: false, reason: 'coordinate_stall_timeout' };
      }

      return { ok: true, reason: 'navigating' };
    }

    // --- exit_trial: click exit button -> confirm popup -> wait for brave continent ---

    function executeExitTrial(intent, snapshot) {
      const now = Date.now();
      if (!state.exitTrialContext) {
        state.exitTrialContext = {
          phase: 'closing_panels',
          startedAt: now,
          lastActionAt: 0,
          retried: false,
        };
        appendLog('exit_trial_start', {});
      }

      const ctx = state.exitTrialContext;

      // Total timeout: 30s
      if (now - ctx.startedAt > 30 * 1000) {
        if (!ctx.retried) {
          ctx.retried = true;
          ctx.phase = 'closing_panels';
          ctx.startedAt = now;
          ctx.lastActionAt = 0;
          appendLog('exit_trial_retry_timeout', {});
          return { ok: true, reason: 'retry_pending' };
        }
        appendLog('exit_trial_failed_timeout', {});
        state.exitTrialContext = null;
        return { ok: false, reason: 'exit_trial_timeout' };
      }

      const mapName = (snapshot.scene || {}).mapName || '';
      if (mapName !== '试炼之地1') {
        // Already exited
        appendLog('exit_trial_done', { mapName });
        state.exitTrialContext = null;
        return { ok: true, reason: 'exited_trial_land' };
      }

      const MIN_ACTION_GAP = 800;
      if (now - ctx.lastActionAt < MIN_ACTION_GAP) {
        return { ok: true, reason: 'exit_trial_throttled' };
      }

      const gRoot = root();
      const nodes = gRoot ? collectNodes(gRoot) : [];

      switch (ctx.phase) {
        case 'closing_panels': {
          // Close any open panels first (single-panel constraint)
          const closeResult = closePanelIfExists('Instance_BossUI');
          closePanelIfExists('MapDetialWnd');
          ctx.phase = 'waiting_for_close';
          ctx.lastActionAt = now;
          appendLog('exit_trial_panels_closed', { reason: closeResult.reason });
          return { ok: true, reason: 'panels_closing' };
        }

        case 'waiting_for_close': {
          // 面板关闭是异步的,btnExit 在场景 UI(Damage list)内,
          // BOSS 面板/大地图未关完时 effectiveVisible=false 会导致 click_exit
          // 返回 exit_button_not_found。等待两者都关闭后再进 click_exit。
          const bossOpen = snapshot.bossChallengePanel && snapshot.bossChallengePanel.open;
          const mapOpen = snapshot.mapPanel && snapshot.mapPanel.open;
          if (!bossOpen && !mapOpen) {
            ctx.phase = 'click_exit';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'panels_closed' };
          }
          if (now - ctx.lastActionAt > 3000) {
            ctx.phase = 'closing_panels';
            ctx.lastActionAt = now;
            appendLog('exit_trial_close_retry', {});
            return { ok: true, reason: 'close_retry' };
          }
          return { ok: true, reason: 'waiting_for_panels_close' };
        }

        case 'click_exit': {
          // Exit button is btnExit (pkgName 'btnLeave') inside Damage list, visible in trial land.
          const exitNode = nodes.find((item) =>
            item.effectiveVisible && item.name === 'btnExit'
            && /Damage list/i.test(item.path))
            || nodes.find((item) =>
            item.effectiveVisible && /退出/.test(item.contentText))
            || nodes.find((item) =>
            item.effectiveVisible && /btnExit|btn_exit|exitBtn/i.test(item.name));
          if (!exitNode) return { ok: false, reason: 'exit_button_not_found' };
          const node = findNodeByPath(gRoot, exitNode.path);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'exit_node_unavailable' };
          const action = activateNode(node);
          if (!action.ok) return { ok: false, reason: action.reason };
          ctx.lastActionAt = now;
          ctx.phase = 'confirm';
          appendLog('exit_trial_clicked_exit', { method: action.method });
          return { ok: true, method: action.method, reason: 'exit_clicked' };
        }

        case 'confirm': {
          // AlertWnd popup: call its rightCallback directly.
          // FairyGUI AlertWnd buttons don't respond to displayObject.event/fireClick;
          // the callback is stored in params.rightCallback (right button = '确定').
          const alertNode = nodes.find((item) =>
            item.effectiveVisible && item.name === 'AlertWnd');
          if (!alertNode) {
            // Popup not yet appeared — retry clicking exit after 3s
            if (now - ctx.lastActionAt > 3000) {
              ctx.phase = 'click_exit';
              ctx.lastActionAt = now;
              appendLog('exit_trial_popup_timeout_retry', {});
              return { ok: true, reason: 'popup_not_found_retry' };
            }
            return { ok: true, reason: 'waiting_for_popup' };
          }
          const alertObj = findNodeByPath(gRoot, alertNode.path);
          if (!alertObj || !nodeIsEffectivelyVisible(alertObj)) {
            return { ok: false, reason: 'alert_node_unavailable' };
          }
          // Call rightCallback (确定) then hideImmediately to close popup
          try {
            const params = alertObj.params;
            if (params && typeof params.rightCallback === 'function') {
              params.rightCallback();
            } else if (params && typeof params.leftCallback === 'function') {
              params.leftCallback();
            }
            if (typeof alertObj.hideImmediately === 'function') {
              alertObj.hideImmediately();
            }
          } catch (error) {
            return { ok: false, reason: 'alert_callback_error: ' + (error && error.message ? error.message : String(error)) };
          }
          ctx.lastActionAt = now;
          ctx.phase = 'waiting';
          appendLog('exit_trial_confirmed', { method: 'params.rightCallback + hideImmediately' });
          return { ok: true, method: 'params.rightCallback', reason: 'confirmed' };
        }

        case 'waiting': {
          // Wait for mapName to change from 试炼之地1
          if (mapName !== '试炼之地1') {
            appendLog('exit_trial_arrived', { mapName });
            state.exitTrialContext = null;
            return { ok: true, reason: 'exited' };
          }
          return { ok: true, reason: 'waiting_for_exit' };
        }

        default:
          state.exitTrialContext = null;
          return { ok: false, reason: 'unknown_exit_phase' };
      }
    }

    // --- teleport_four_winds: open map -> click four winds -> close -> wait ---

    function executeTeleportFourWinds(intent, snapshot) {
      const now = Date.now();
      if (!state.teleportContext) {
        state.teleportContext = {
          phase: 'opening_map',
          startedAt: now,
          lastActionAt: 0,
        };
        appendLog('teleport_start', {});
      }

      const ctx = state.teleportContext;

      // Total timeout: 60s
      if (now - ctx.startedAt > 60 * 1000) {
        appendLog('teleport_timeout', { phase: ctx.phase, elapsed: now - ctx.startedAt });
        closePanelIfExists('MapDetialWnd');
        state.teleportContext = null;
        return { ok: false, reason: 'teleport_timeout' };
      }

      const MIN_ACTION_GAP = 800;
      if (now - ctx.lastActionAt < MIN_ACTION_GAP) {
        return { ok: true, reason: 'teleport_throttled' };
      }

      const mapName = (snapshot.scene || {}).mapName || '';
      if (mapName === '四风平原') {
        appendLog('teleport_arrived', { mapName });
        state.teleportContext = null;
        state.farmArrivedAt = 0;
        state.farmArrivedCoord = '';
        return { ok: true, reason: 'arrived_four_winds' };
      }

      switch (ctx.phase) {
        case 'opening_map': {
          // 先关闭其他面板(单面板约束)。BOSS 面板关闭是异步的,
          // 若同 tick 内调用 clickOpenMapButton,btn_map 会被 BOSS 面板遮挡
          // 导致 map_open_button_vanished。先关闭,等下一 tick 验证后再开地图。
          const bossOpen = snapshot.bossChallengePanel && snapshot.bossChallengePanel.open;
          if (bossOpen) {
            closePanelIfExists('Instance_BossUI');
            ctx.phase = 'waiting_for_close';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'closing_blocking_panel' };
          }
          if (snapshot.mapPanel && snapshot.mapPanel.open) {
            ctx.phase = 'select_map';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'map_already_open' };
          }
          const result = clickOpenMapButton(snapshot);
          if (result.ok) {
            ctx.lastActionAt = now;
            ctx.phase = 'select_map';
            appendLog('teleport_opened_map', { method: result.method });
          }
          return result;
        }

        case 'waiting_for_close': {
          // 等待 BOSS 面板真正关闭后再进 opening_map 开地图。
          const bossOpen = snapshot.bossChallengePanel && snapshot.bossChallengePanel.open;
          if (!bossOpen) {
            ctx.phase = 'opening_map';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'panel_closed' };
          }
          if (now - ctx.lastActionAt > 3000) {
            ctx.phase = 'opening_map';
            ctx.lastActionAt = now;
            appendLog('teleport_close_retry', {});
            return { ok: true, reason: 'close_retry' };
          }
          return { ok: true, reason: 'waiting_for_panel_close' };
        }

        case 'select_map': {
          if (!snapshot.mapPanel.open) {
            ctx.phase = 'opening_map';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'map_closed_retry' };
          }
          // Find 四风平原 in the left-side map list
          const mapEntries = snapshot.mapPanel.mapEntries || [];
          const fourWindsEntry = mapEntries.find((e) => cleanText(e.name) === '四风平原'
            || /四风平原/.test(e.name));
          if (!fourWindsEntry) {
            appendLog('teleport_four_winds_not_in_list', { entries: mapEntries.map((e) => e.name) });
            return { ok: false, reason: 'four_winds_not_in_map_list' };
          }
          const fresh = readSnapshot();
          if (!fresh.mapPanel.open) {
            ctx.phase = 'opening_map';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'map_closed_retry' };
          }
          const freshEntry = (fresh.mapPanel.mapEntries || []).find((e) => e.sourcePath === fourWindsEntry.sourcePath);
          if (!freshEntry) return { ok: false, reason: 'map_entry_vanished' };
          const gRoot = root();
          const node = findNodeByPath(gRoot, freshEntry.sourcePath);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'map_entry_node_unavailable' };
          // CDP verified: clicking leftlist bigBtn opens a List_tree sub-popup
          // The actual teleport requires a second click on the sub-popup item.
          // Find bigBtn child of the leftitem entry for more precise clicking.
          const bigBtn = findBigBtnChild(gRoot, node);
          const clickTarget = bigBtn || node;
          const action = activateNode(clickTarget);
          if (!action.ok) return { ok: false, reason: action.reason };
          ctx.lastActionAt = now;
          ctx.phase = 'select_submap';
          appendLog('teleport_clicked_four_winds', { method: action.method });
          return { ok: true, method: action.method, reason: 'four_winds_clicked' };
        }

        case 'select_submap': {
          // CDP verified: after clicking leftlist item, a List_tree sub-popup appears.
          // List_tree is under the same MapDetialWnd frame, containing smallitemBtn items
          // with title children (e.g. '四风平原', '会员年1层 钻石7星').
          // Click the item whose title matches '四风平原' to trigger teleport.
          const gRoot = root();
          const allNodes = gRoot ? collectNodes(gRoot) : [];
          const listTree = allNodes.find((item) =>
            item.effectiveVisible && item.name === 'List_tree');
          if (!listTree) {
            // Sub-popup not yet appeared — retry after 3s, fall back to closing_map
            if (now - ctx.lastActionAt > 3000) {
              ctx.phase = 'closing_map';
              ctx.lastActionAt = now;
              appendLog('teleport_submap_timeout', {});
              return { ok: true, reason: 'submap_not_found_retry' };
            }
            return { ok: true, reason: 'waiting_for_submap' };
          }
          // Find the item under List_tree with title '四风平原'
          const treeChildren = allNodes.filter((item) =>
            item.effectiveVisible && item.path !== listTree.path
            && item.path.startsWith(listTree.path + '/')
            && item.packageName === 'smallitemBtn');
          const fourWindsSubItem = treeChildren.find((row) => {
            const kids = descendantsOf(allNodes, row).filter((item) => item.path !== row.path);
            const titleNode = kids.find((item) => item.name === 'title' && item.contentText);
            return titleNode && /四风平原/.test(cleanText(titleNode.contentText));
          });
          if (!fourWindsSubItem) return { ok: false, reason: 'submap_four_winds_not_found' };
          const subNode = findNodeByPath(gRoot, fourWindsSubItem.path);
          if (!subNode || !nodeIsEffectivelyVisible(subNode)) return { ok: false, reason: 'submap_node_unavailable' };
          const action = activateNode(subNode);
          if (!action.ok) return { ok: false, reason: action.reason };
          ctx.lastActionAt = now;
          ctx.phase = 'closing_map';
          appendLog('teleport_clicked_submap', { method: action.method });
          return { ok: true, method: action.method, reason: 'submap_clicked' };
        }

        case 'closing_map': {
          if (!snapshot.mapPanel.open) {
            ctx.phase = 'waiting';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'map_closed_proceed' };
          }
          const result = closePanelIfExists('MapDetialWnd');
          ctx.lastActionAt = now;
          ctx.phase = 'waiting';
          appendLog('teleport_closing_map', { reason: result.reason });
          return { ok: true, reason: 'map_closed' };
        }

        case 'waiting': {
          if (mapName === '四风平原') {
            appendLog('teleport_arrived', { mapName });
            state.teleportContext = null;
            state.farmArrivedAt = 0;
            state.farmArrivedCoord = '';
            return { ok: true, reason: 'arrived' };
          }
          return { ok: true, reason: 'waiting_for_teleport' };
        }

        default:
          state.teleportContext = null;
          return { ok: false, reason: 'unknown_teleport_phase' };
      }
    }

   // --- Z key safety net ---

 function ensureZKey(snapshot) {
   const now = Date.now();
   const autoBattle = snapshot.autoBattle;

   if (autoBattle && autoBattle.enabled) {
     state.zKeyRetryCount = 0;
     return { ok: true, reason: 'auto_battle_enabled' };
   }

   if (!state.arrivalConfirmedAt) return { ok: true, reason: 'not_arrived_yet' };

   // Reduce initial delay: when character is blocked by other players and can't
   // reach the exact BOSS coordinate, the game's built-in auto-activation won't
   // trigger, so waiting 3s is pointless. 1.5s is enough for the edge case where
   // the character does reach the exact coordinate and the game auto-activates.
   if (now - state.arrivalConfirmedAt < 1500) return { ok: true, reason: 'waiting_post_arrival' };

   // No hard retry limit — reset counter after 15s cooldown so the script keeps
   // trying. This handles: Z key fails initially (no targets nearby) → BOSS spawns
   // later → retry count was exhausted → script never re-activates auto-battle.
   if (state.zKeySentAt && now - state.zKeySentAt > 15000) {
     state.zKeyRetryCount = 0;
   }

   // 5s throttle (was 2s): Z key is a toggle. After sending Z, the game needs
   // time to update the autoBattle UI (AutoStatusItem). If we re-send too fast
   // while the snapshot hasn't caught up, we risk toggling auto-battle back off.
   if (now - state.zKeySentAt < 5000) return { ok: true, reason: 'z_key_throttled' };

    // Send Z key via Laya stage event system (CDP verified 2026-07-14).
    // fireClick(), vm.onBtnAttack(), and DOM KeyboardEvent do NOT work.
    // Only directly calling the Laya stage keydown listener triggers the toggle.
    if (toggleAutoFight()) {
      state.zKeySentAt = now;
      state.zKeyRetryCount++;
      appendLog('z_key_sent', { method: 'laya_keydown', retry: state.zKeyRetryCount });
      return { ok: true, method: 'laya_keydown', reason: 'z_key_sent' };
    }

    state.zKeyRetryCount++;
    return { ok: true, reason: 'z_key_pending' };
  }

    // toggleAutoFight: send Z key via Laya stage keydown event (CDP verified 2026-07-14)
    function toggleAutoFight() {
      try {
        if (typeof Laya === 'undefined' || !Laya.stage || !Laya.stage._events || !Laya.stage._events.keydown) return false;
        const ev = new Laya.Event();
        ev.type = Laya.Event.KEYDOWN;
        ev.keyCode = 90;
        ev.nativeEvent = { keyCode: 90, key: 'z', code: 'KeyZ', preventDefault: function(){}, stopPropagation: function(){} };
        ev.target = Laya.stage;
        ev.currentTarget = Laya.stage;
        // keydown can be a single listener object (M class) or an array of listeners
        const kd = Laya.stage._events.keydown;
        const listener = Array.isArray(kd) ? kd[0] : kd;
        if (!listener || !listener.method || !listener.caller) return false;
        listener.method.call(listener.caller, ev);
        return true;
      } catch (e) {
        appendLog('toggle_auto_fight_error', { error: e.message });
        return false;
      }
    }

    // isAutoFightOn: read autoFightState controller selectedIndex (CDP verified 2026-07-14)
    // selectedIndex 0 = manual (off), 2 = auto (on)
    function isAutoFightOn() {
      try {
        const gRoot = root();
        if (!gRoot || typeof gRoot.getChildAt !== 'function') return false;
        const mainWnd = gRoot.getChildAt(0);
        if (!mainWnd || !mainWnd.mMainBottom) return false;
        const state = mainWnd.mMainBottom.autoFightState;
        return !!state && state.selectedIndex === 2;
      } catch (_) {
        return false;
      }
    }

   // --- Hold / Engage with Z key safety net ---

    function executeHold(intent, snapshot) {
      const target = targetById(intent.targetId);
      if (!target) return { ok: false, reason: 'hold_target_missing' };
     if (!isAtTarget(target, snapshot)) {
       return { ok: false, reason: 'not_at_coordinate' };
     }
      // If arrival was never confirmed (e.g. character reached the target
      // during BOSS cooling phase via game's own pathing, skipping the
      // navigation arrival logic), set it now so ensureZKey doesn't bail.
      if (!state.arrivalConfirmedAt) {
        state.arrivalConfirmedAt = Date.now();
      }
      // At target: ensure auto-battle is on (Z key safety net)
      const result = ensureAutoBattle(snapshot);
      if (!result.ok && result.reason === 'auto_battle_state_unknown') {
        appendLog('auto_battle_state_unknown', { targetId: intent.targetId, coordinate: snapshot.scene.coordinate });
      }
      return result;
    }

    function executeEngage(intent, snapshot) {
      const result = ensureAutoBattle(snapshot);
      if (!result.ok && result.reason === 'auto_battle_state_unknown') {
        appendLog('auto_battle_state_unknown', { targetId: intent.targetId });
      }
      return result;
    }

    function ensureAutoBattle(snapshot) {
      // If auto-battle is confirmed on, no action needed.
      if (snapshot.autoBattle && snapshot.autoBattle.enabled) {
        state.zKeyRetryCount = 0;
        return { ok: true, reason: 'already_enabled' };
      }
      // Auto-battle off or state unknown (UI not loaded / panel blocking) —
      // still try ensureZKey; it internally checks autoBattle.enabled before
      // sending, so this is safe even if the state read is wrong.
      const zResult = ensureZKey(snapshot);
      if (zResult.ok) {
        return { ok: true, reason: 'z_key_safety_net: ' + zResult.reason };
      }
    return { ok: true, reason: 'z_key_safety_net_failed: ' + zResult.reason };
  }

    function executeObserveOwner(intent, snapshot) {
      const target = targetById(intent.targetId);
      if (!target) return { ok: false, reason: 'observe_target_missing' };
      const combat = snapshot.combat;
      if (!combat || cleanText(combat.targetName) !== target.name) {
        resetOwnerObservation();
        return { ok: true, reason: 'boss_disappeared' };
      }
      if (!hasVisibleHpBar(combat)) {
        resetOwnerObservation();
        return { ok: true, reason: 'no_hp_bar' };
      }
      const ownerName = cleanText(combat.ownerName);
      const now = Number(snapshot.at) || Date.now();
      if (!ownerName || ownerName === state.config.ownerName) {
        resetOwnerObservation();
        return { ok: true, reason: 'owner_clear_or_self' };
      }
      if (!state.ownerObservation || state.ownerObservation.targetId !== target.id) {
        state.ownerObservation = { targetId: target.id, observedAt: now };
        appendLog('owner_observation_started', { targetId: target.id, ownerName });
        return { ok: true, reason: 'observing_owner' };
      }
      const elapsed = now - state.ownerObservation.observedAt;
      if (elapsed >= state.config.ownerObserveSeconds * 1000) {
        markContested(target, now);
        resetOwnerObservation();
        appendLog('owner_contested', { targetId: target.id, ownerName, elapsedMs: elapsed });
        return { ok: true, reason: 'contested_cooldown_set' };
      }
      return { ok: true, reason: 'observing_owner', elapsedSeconds: Math.floor(elapsed / 1000) };
    }

    // --- closePanelIfExists: universal panel close fallback ---

   function closePanelIfExists(panelName) {
     const gRoot = root();
     if (!gRoot) return { ok: true, reason: 'no_root' };
     const nodes = collectNodes(gRoot);
     const panelRoot = nodes.find((item) => item.effectiveVisible
       && (item.name === panelName || item.packageName === panelName || item.packageOwner === panelName));
     if (!panelRoot) return { ok: true, reason: 'already_closed' };
     const panelNodes = descendantsOf(nodes, panelRoot);
     const closeBtn = panelNodes.find((item) => item.effectiveVisible && item.name === 'btnClose');
     if (!closeBtn) {
       // Fallback: try hideImmediately / removeFromParent on the panel node itself
       const panelNode = findNodeByPath(gRoot, panelRoot.path);
       if (panelNode) {
         if (typeof panelNode.hideImmediately === 'function') {
           try { panelNode.hideImmediately(); return { ok: true, method: 'hideImmediately', reason: 'closed' }; } catch (_) {}
         }
         if (typeof panelNode.removeFromParent === 'function') {
           try { panelNode.removeFromParent(); return { ok: true, method: 'removeFromParent', reason: 'closed' }; } catch (_) {}
         }
       }
       return { ok: false, reason: 'close_button_missing' };
     }
     const node = findNodeByPath(gRoot, closeBtn.path);
     if (!node || !nodeIsEffectivelyVisible(node)) {
       const panelNode2 = findNodeByPath(gRoot, panelRoot.path);
       if (panelNode2) {
         if (typeof panelNode2.hideImmediately === 'function') {
           try { panelNode2.hideImmediately(); return { ok: true, method: 'hideImmediately', reason: 'closed' }; } catch (_) {}
         }
         if (typeof panelNode2.removeFromParent === 'function') {
           try { panelNode2.removeFromParent(); return { ok: true, method: 'removeFromParent', reason: 'closed' }; } catch (_) {}
         }
       }
       return { ok: false, reason: 'close_node_unavailable' };
     }
     const action = activateNode(node);
     if (!action.ok) {
       const panelNode3 = findNodeByPath(gRoot, panelRoot.path);
       if (panelNode3) {
         if (typeof panelNode3.hideImmediately === 'function') {
           try { panelNode3.hideImmediately(); return { ok: true, method: 'hideImmediately', reason: 'closed' }; } catch (_) {}
         }
         if (typeof panelNode3.removeFromParent === 'function') {
           try { panelNode3.removeFromParent(); return { ok: true, method: 'removeFromParent', reason: 'closed' }; } catch (_) {}
         }
       }
       return { ok: false, reason: 'close_failed', method: action.method };
     }
     return { ok: true, method: action.method, reason: 'closed' };
   }

    // --- Rate check (degraded) ---

    const RATE_URL_MAP = {
      'txt_bld': 'low',
      'txt_blz': 'medium',
      'txt_blg': 'high',
    };

    const RATE_CHECK_MAPS = {
      '四风平原': { tab: '野外BOSS', bossNames: FOUR_WINDS_BOSS_NAMES, mapMatch: '四风平原' },
      '试炼之地1': { tab: '试炼之地', bossNames: TRIAL_BOSS_NAMES, mapMatch: '试炼之地' },
    };

    // Rate resets at 8am UTC+8 daily (= midnight UTC).
    function nextRateResetTimestamp() {
      const now = Date.now();
      const utc8Ms = now + 8 * 3600 * 1000;
      const utc8Date = new Date(utc8Ms);
      const utcMidnight = Date.UTC(utc8Date.getUTCFullYear(), utc8Date.getUTCMonth(), utc8Date.getUTCDate());
      if (now >= utcMidnight) return utcMidnight + 24 * 3600 * 1000;
      return utcMidnight;
    }

    function getRateResult(mapName) {
      if (!mapName) return null;
      const r = state.rateResults[mapName];
      if (!r) return null;
      const now = Date.now();
      if (r.result === 'low') {
        if (r.skipUntil && now < r.skipUntil) return r;
        return null;
      }
      if (r.nextCheckAt && now < r.nextCheckAt) return r;
      return null;
    }

    function isMapRateLow(mapName) {
      const r = getRateResult(mapName);
      return r && r.result === 'low' ? true : false;
    }

   function needRateCheck(snapshot) {
     const now = Number(snapshot.at) || Date.now();
     const rc = state.rateCheck;
     if (rc.phase !== 'idle') return true;
     // Don't start rate check during navigation/teleport/enter/exit
     if (state.navigationContext) return false;
     if (state.mapScanContext) return false;
     if (state.enterTrialContext) return false;
     if (state.exitTrialContext) return false;
     if (state.teleportContext) return false;
     // Don't start during combat
     const autoBattle = snapshot && snapshot.autoBattle;
     if (autoBattle && autoBattle.enabled) return false;
     // Check rate for current map (四风平原 or 试炼之地1)
     const sceneMap = snapshot && snapshot.scene && snapshot.scene.mapName;
     if (!sceneMap || !RATE_CHECK_MAPS[sceneMap]) return false;
     return getRateResult(sceneMap) === null;
   }

    function markRateCheckDone(result, mapName) {
      const now = Date.now();
      state.rateCheck.phase = 'idle';
      state.rateCheck.targetMap = '';
      let nextCheckAt = 0;
      if (mapName) {
        nextCheckAt = result === 'low' ? nextRateResetTimestamp() : now + state.config.rateRecheckIntervalMs;
        state.rateResults[mapName] = {
          result: result,
          checkedAt: now,
          skipUntil: result === 'low' ? nextCheckAt : 0,
          nextCheckAt: nextCheckAt,
        };
      }
      if (result !== 'low') {
        state.farmArrivedAt = 0;
        state.farmArrivedCoord = '';
        state.farmLastSeenFarmingAt = 0;
      }
      appendLog('rate_check_done', { result, mapName, nextCheckAt });
    }

    function executeCheckRate(intent, snapshot) {
      const now = Date.now();
      const rc = state.rateCheck;
      const panel = snapshot.bossChallengePanel;

      if (rc.phase !== 'idle' && now - rc.startedAt > 60 * 1000) {
        appendLog('rate_check_timeout', { phase: rc.phase, elapsed: now - rc.startedAt });
        markRateCheckDone('unknown', rc.targetMap);
        return { ok: false, reason: 'rate_check_timeout' };
      }

      if (rc.phase === 'idle') {
        const sceneMap = (snapshot.scene || {}).mapName || '';
        rc.targetMap = sceneMap;
        rc.phase = 'closing_map';
        rc.startedAt = now;
        rc.lastActionAt = 0;
        appendLog('rate_check_start', { targetMap: sceneMap });
      }

      const MIN_ACTION_GAP = 800;
      if (now - rc.lastActionAt < MIN_ACTION_GAP) {
        return { ok: true, reason: 'rate_throttled' };
      }

      const rateMap = rc.targetMap ? RATE_CHECK_MAPS[rc.targetMap] : null;
      if (!rateMap) {
        appendLog('rate_check_no_map_config', { targetMap: rc.targetMap });
        markRateCheckDone('unknown', rc.targetMap);
        return { ok: false, reason: 'no_rate_check_map' };
      }

      switch (rc.phase) {
        case 'closing_map': {
          // Wait for map panel to actually close before proceeding (async close)
          const freshSnap = readSnapshot();
          if (!freshSnap.mapPanel.open) {
            rc.phase = 'opening';
            rc.lastActionAt = now;
            return { ok: true, reason: 'map_closed_proceed' };
          }
          const closeBtn = freshSnap.mapPanel.closeButton;
          if (!closeBtn) {
            closePanelIfExists('MapDetialWnd');
            rc.lastActionAt = now;
            return { ok: true, reason: 'map_close_attempted' };
          }
          const closeNode = findNodeByPath(root(), closeBtn.sourcePath);
          if (!closeNode || !nodeIsEffectivelyVisible(closeNode)) {
            closePanelIfExists('MapDetialWnd');
            rc.lastActionAt = now;
            return { ok: true, reason: 'map_close_fallback' };
          }
          const closeAction = activateNode(closeNode);
          rc.lastActionAt = now;
          appendLog('rate_check_closed_map', { method: closeAction.method });
          return { ok: true, reason: 'map_closing' };
        }

        case 'opening': {
          if (panel && panel.open) {
            rc.phase = 'select_tab';
            rc.lastActionAt = now;
            return { ok: true, reason: 'panel_already_open' };
          }
          if (snapshot.mapPanel && snapshot.mapPanel.open) {
            rc.phase = 'closing_map';
            rc.lastActionAt = now;
            return { ok: true, reason: 'need_close_map_first' };
          }
          const btn = panel && panel.openButton;
          if (!btn) return { ok: false, reason: 'no_boss_challenge_button' };
          const fresh = readSnapshot();
          const freshBtn = fresh.bossChallengePanel && fresh.bossChallengePanel.openButton;
          if (!freshBtn) return { ok: false, reason: 'open_button_vanished' };
          const node = findNodeByPath(root(), freshBtn.sourcePath);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'open_node_unavailable' };
          const action = activateNode(node);
          if (!action.ok) return { ok: false, reason: action.reason };
          rc.lastActionAt = now;
          // Stay in opening → transition to waiting_for_open to wait for panel
          rc.phase = 'waiting_for_open';
          appendLog('rate_check_opened_panel', { method: action.method });
          return { ok: true, method: action.method, reason: 'panel_opening' };
        }

        case 'waiting_for_open': {
          if (panel && panel.open) {
            rc.phase = 'select_tab';
            rc.lastActionAt = now;
            return { ok: true, reason: 'panel_opened' };
          }
          if (now - rc.lastActionAt > 3000) {
            // Panel didn't open in time — retry clicking
            rc.phase = 'opening';
            rc.lastActionAt = now;
            appendLog('rate_check_panel_open_retry', {});
            return { ok: true, reason: 'panel_open_timeout_retry' };
          }
          return { ok: true, reason: 'waiting_for_panel_open' };
        }

        case 'select_tab': {
          if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
          if (panel.selectedTab === rateMap.tab) {
            rc.phase = 'select_boss';
            rc.lastActionAt = now;
            return { ok: true, reason: 'tab_already_selected' };
          }
          const tab = panel.tabs.find((t) => t.text === rateMap.tab);
          if (!tab) return { ok: false, reason: 'target_tab_not_found:' + rateMap.tab };
          const fresh = readSnapshot();
          const freshPanel = fresh.bossChallengePanel;
          if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
          const freshTab = freshPanel.tabs.find((t) => t.text === rateMap.tab);
          if (!freshTab) return { ok: false, reason: 'tab_vanished' };
          const node = findNodeByPath(root(), freshTab.sourcePath);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'tab_node_unavailable' };
          const action = activateNode(node);
          if (!action.ok) return { ok: false, reason: action.reason };
          rc.lastActionAt = now;
          appendLog('rate_check_selected_tab', { method: action.method, tab: rateMap.tab });
          return { ok: true, method: action.method, reason: 'tab_selected' };
        }

        case 'select_boss': {
          if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
          if (panel.mapName.includes(rateMap.mapMatch)) {
            rc.phase = 'read_rate';
            rc.lastActionAt = now;
            return { ok: true, reason: 'map_already_target' };
          }
          const bossRow = panel.bossRows.find((r) => rateMap.bossNames.includes(r.name));
          if (!bossRow) return { ok: false, reason: 'target_boss_not_found' };
          const fresh = readSnapshot();
          const freshPanel = fresh.bossChallengePanel;
          if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
          const freshRow = freshPanel.bossRows.find((r) => r.name === bossRow.name);
          if (!freshRow) return { ok: false, reason: 'boss_row_vanished' };
          const node = findNodeByPath(root(), freshRow.sourcePath);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'boss_row_node_unavailable' };
          const action = activateNode(node);
          if (!action.ok) return { ok: false, reason: action.reason };
          rc.lastActionAt = now;
          appendLog('rate_check_selected_boss', { bossName: bossRow.name });
          return { ok: true, method: action.method, reason: 'boss_selected' };
        }

        case 'read_rate': {
          if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
          if (!panel.mapName.includes(rateMap.mapMatch)) {
            rc.phase = 'select_boss';
            rc.lastActionAt = now;
            return { ok: true, reason: 'map_not_target_retry' };
          }
          const rateUrl = panel.rateIconUrl || '';
          const rateKey = rateUrl.split('/').pop() || '';
          const rate = RATE_URL_MAP[rateKey] || null;
          if (!rate) {
            if (now - rc.startedAt > 10 * 1000) {
              markRateCheckDone('unknown', rc.targetMap);
              rc.phase = 'closing';
              rc.lastActionAt = now;
              return { ok: true, reason: 'rate_unknown_timeout' };
            }
            return { ok: true, reason: 'rate_not_ready' };
          }
          appendLog('rate_detected', { rate, url: rateUrl, mapName: rc.targetMap });
          markRateCheckDone(rate, rc.targetMap);
          rc.phase = 'closing';
          rc.lastActionAt = now;
          return { ok: true, reason: 'rate_read: ' + rate };
        }

        case 'closing': {
          // 等待面板真正关闭后再置 idle(异步关闭约束)。
          // closePanelIfExists 点击 btnClose 是异步,同 tick 内面板还没消失;
          // 若立即置 idle,下一 tick 其他状态机(needMapScan 等)会读到
          // bossChallengePanel.open === true,触发单面板冲突。
          if (!panel || !panel.open) {
            rc.phase = 'idle';
            rc.lastActionAt = now;
            return { ok: true, reason: 'panel_already_closed' };
          }
          const result = closePanelIfExists('Instance_BossUI');
          rc.lastActionAt = now;
          appendLog('rate_check_closed_panel', { reason: result.reason });
          // 保留在 closing 阶段,下一 tick 重新进入此 case 验证面板已关闭
          return { ok: true, reason: 'panel_closing' };
        }

        default:
          rc.phase = 'idle';
          return { ok: false, reason: 'unknown_rate_phase' };
      }
    }

    // --- Map scan ---

    const MAP_SCAN_COOLDOWN_MS = 60 * 1000;
    const MAP_SCAN_OPEN_WAIT_MS = 2000;

    function needMapScan(snapshot) {
      const now = Number(snapshot.at) || Date.now();
      if (state.mapScanContext) return true;
      if (state.navigationContext) return false;
      if (state.rateCheck.phase !== 'idle') return false;
      if (state.enterTrialContext || state.exitTrialContext || state.teleportContext) return false;
      const eligible = state.targets.filter((target) =>
        target.mapName === '四风平原' && !isCooling(target, now) && !isMapRateLow(target.mapName));
      if (!eligible.length) return false;
      const allUnknown = eligible.every((target) => validRefreshAt(target.refreshAt) === null);
      if (!allUnknown) return false;
      if (now - state.lastMapScanAt < MAP_SCAN_COOLDOWN_MS) return false;
      return true;
    }

    function executeScanMap(intent, snapshot) {
      const now = Date.now();
      const ctx = state.mapScanContext;

      if (!ctx) {
        state.mapScanContext = { startedAt: now, opened: false, closeClicked: false, openedAt: 0 };
        appendLog('map_scan_start', {});
      }

      const scan = state.mapScanContext;

      // 单面板守卫:BOSS 挑战面板打开时 btn_map 被遮挡,必须先关闭。
      // 这尤其会在 executeCheckRate.closing 刚把 rc.phase 置 idle 但 BOSS 面板
      // 还在异步关闭时发生 — needMapScan 只看 context 互斥,不检查面板状态。
      if (snapshot.bossChallengePanel && snapshot.bossChallengePanel.open) {
        closePanelIfExists('Instance_BossUI');
        return { ok: true, reason: 'closing_blocking_panel' };
      }

      if (!snapshot.mapPanel.open) {
        if (!scan.opened) {
          const result = clickOpenMapButton(snapshot);
          if (result.ok) {
            scan.opened = true;
            scan.openedAt = now;
            appendLog('map_scan_opened', { method: result.method });
          }
          return result;
        }
        appendLog('map_scan_complete', {});
        state.lastMapScanAt = now;
        state.mapScanContext = null;
        return { ok: true, reason: 'map_scan_done' };
      }

      if (scan.opened && !scan.closeClicked && now - scan.openedAt >= MAP_SCAN_OPEN_WAIT_MS) {
        const result = closeMapPanel(snapshot);
        if (result.ok) {
          scan.closeClicked = true;
          appendLog('map_scan_closing', {});
        }
        return result;
      }

      return { ok: true, reason: 'map_scan_waiting' };
    }

    // --- Scan functions ---

    // 子任务 1: 通用地图名识别
    function scanScene(nodes) {
      let mapName = '';
      // The mapName node in MiniMapPart has visible=false in some maps (e.g. trial land).
      // Like the overlay script, read it regardless of visibility when name === 'mapName'.
      const candidates = nodes
        .filter((item) => (item.effectiveVisible || item.name === 'mapName')
          && KNOWN_MAP_NAMES.includes(cleanText(item.contentText)))
        .sort((a, b) => {
          const aScore = (a.name === 'mapName' ? 1000 : 0) + (a.rect.x >= 900 && a.rect.y <= 130 ? 100 : 0);
          const bScore = (b.name === 'mapName' ? 1000 : 0) + (b.rect.x >= 900 && b.rect.y <= 130 ? 100 : 0);
          return bScore - aScore;
        });
      if (candidates.length) mapName = cleanText(candidates[0].contentText);
      // Fallback: pattern match for trial land variants
      if (!mapName) {
        const trial = nodes.find((item) => (item.effectiveVisible || item.name === 'mapName')
          && /^试炼之地\d*$/.test(cleanText(item.contentText)));
        if (trial) mapName = cleanText(trial.contentText);
      }
      const coordinate = nodes
        .filter((item) => item.effectiveVisible)
        .map((item) => normalizeCoordinate(item.contentText))
        .find(Boolean) || '';
      return { mapName, coordinate };
    }

    function scanMapPanel(nodes) {
      const openButton = nodes.find((item) => item.effectiveVisible && item.name === 'btn_map');
      const panelRoot = nodes.find((item) => item.effectiveVisible && (item.packageName === 'MapDetialWnd' || item.packageOwner === 'MapDetialWnd'));
      if (!panelRoot) {
        return {
          open: false,
          mapName: '',
          openButton: buttonSummaryWithPath(openButton),
          closeButton: null,
          bossTargets: [],
          farmTarget: null,
          farmTargetReason: 'farm_target_missing',
          mapEntries: [],
        };
      }

      const panelNodes = descendantsOf(nodes, panelRoot);
      const mapNameNode = panelNodes.find((item) => item.name === 'labline' && item.contentText);
      const closeButton = panelNodes.find((item) => item.effectiveVisible && item.name === 'btnClose');
      const list = panelNodes.find((item) => item.effectiveVisible && item.name === 'List_right');
      const rows = list
        ? panelNodes
          .filter((item) => item.effectiveVisible && item.path !== list.path && item.path.startsWith(list.path + '/') && item.packageName === 'RightLift')
          .sort((left, right) => left.rect.y - right.rect.y)
        : [];
      const bossTargets = rows
        .map((row) => mapRowSummary(panelNodes, row))
        .filter((row) => TARGET_TABLE.some((target) => target.name === row.name));
      const nameCounts = {};
      bossTargets.forEach((row) => {
        const sameName = TARGET_TABLE.filter((t) => t.name === row.name);
        const idx = nameCounts[row.name] || 0;
        if (idx < sameName.length) {
          row.targetId = sameName[idx].id;
          row.coordinate = sameName[idx].coordinate;
        }
        nameCounts[row.name] = idx + 1;
      });
      const farmRow = rows.find((row) => {
        const children = descendantsOf(panelNodes, row);
        const titleNode = children.find((item) => item.name === 'n0' && cleanText(item.contentText) === state.config.farmTargetName);
        return Boolean(titleNode);
      });

      // 子任务 5: Scan left-side map list for teleport
      // CDP verified: left list node name is 'leftlist' (lowercase), items are unnamed with pkgName 'leftitem'
      // Each item has a 'bigBtn' child with a 'title' child containing the map name text.
      const leftList = panelNodes.find((item) => item.effectiveVisible
        && (item.name === 'leftlist' || item.name === 'List_left'));
      const leftRows = leftList
        ? panelNodes
          .filter((item) => item.effectiveVisible
            && item.path !== leftList.path
            && item.path.startsWith(leftList.path + '/')
            && (item.packageName === 'leftitem' || item.packageName === 'LeftItem'))
          .sort((a, b) => a.rect.y - b.rect.y)
        : [];
      const mapEntries = leftRows.map((row) => {
        const children = descendantsOf(panelNodes, row).filter((item) => item.path !== row.path);
        // 'bigBtn' > 'title' contains the map name (e.g. '四风平原（3转）')
        const nameNode = children.find((item) => item.name === 'title' && item.contentText)
          || children.find((item) => item.contentText);
        return {
          name: nameNode ? cleanText(nameNode.contentText) : '',
          sourcePath: row.path,
          rect: row.rect,
        };
      }).filter((entry) => entry.name);

      return {
        open: true,
        mapName: mapNameNode ? cleanText(mapNameNode.contentText) : '',
        openButton: buttonSummaryWithPath(openButton),
        closeButton: buttonSummaryWithPath(closeButton),
        bossTargets,
        farmTarget: farmRow ? mapRowSummary(panelNodes, farmRow) : null,
        farmTargetReason: farmRow ? '' : 'farm_target_missing',
        mapEntries,
      };
    }

    function mapRowSummary(nodes, row) {
      const children = descendantsOf(nodes, row).filter((item) => item.path !== row.path);
      const nameNode = children.find((item) => item.name === 'n16' && item.contentText)
        || children.find((item) => item.name === 'n0' && item.contentText);
      return { name: nameNode ? cleanText(nameNode.contentText) : '', sourcePath: row.path, rect: row.rect };
    }

    function descendantsOf(nodes, rootNode) {
      if (!rootNode || !rootNode.path) return [];
      return nodes.filter((item) => item.path === rootNode.path || (item.path && item.path.startsWith(rootNode.path + '/')));
    }

    function buttonSummaryWithPath(item) {
      return item ? { text: item.contentText, rect: item.rect, sourcePath: item.path } : null;
    }

    function scanCombat(nodes) {
      const target = nodes.find((item) => item.effectiveVisible && /Lv\s*\d+/i.test(item.text) && TARGET_TABLE.some((entry) => item.text.includes(entry.name)));
      if (!target) return { targetName: '', targetLevel: 0, hpPercent: null, ownerName: '' };
      const level = target.text.match(/Lv\s*(\d+)/i);
      const targetName = TARGET_TABLE
        .map((entry) => entry.name)
        .sort((left, right) => right.length - left.length)
        .find((name) => target.text.includes(name)) || '';
      const parentPath = target.path.replace(/\/[^/]+$/, '');
      const pctNode = nodes.find((item) => item.path.startsWith(parentPath + '/')
        && item.name === 'percentText' && item.effectiveVisible);
      const hp = pctNode ? pctNode.text.match(/(\d+)%/) : null;
      const afterName = target.text.replace(/.*Lv\s*\d+/i, '').replace(targetName, '').trim();
      const owner = afterName && afterName !== state.config.ownerName ? afterName.split(/\s+/)[0] : '';
      return {
        targetName,
        targetLevel: level ? Number(level[1]) : 0,
        hpPercent: hp ? Number(hp[1]) : null,
        ownerName: owner ? cleanText(owner) : '',
     };
  }

  function scanAutoBattle(nodes) {
    // CDP verified 2026-07-14: AutoStatusItem count is unreliable (stays 0
    // even when auto-battle is on). Use autoFightState controller selectedIndex
    // instead: 0 = manual (off), 2 = auto (on).
    const on = isAutoFightOn();
    return { known: true, enabled: on };
  }

    // 子任务 4: scanTrialTaskbar — scan left taskbar BOSS entries
    function scanTrialTaskbar(nodes) {
      // Boss entries are bossinfoitem package nodes inside Damage list/n21[1]/?[i].
      // Each has nameTxt (boss name), posTxt (coordinate), desTxt (status/countdown).
      const entries = [];
      for (const item of nodes) {
        if (!item.effectiveVisible) continue;
        if (item.packageName !== 'bossinfoitem') continue;
        if (!/compLeftTop.*activityInfoCom.*Damage list/i.test(item.path)) continue;

        const gRoot = root();
        const node = findNodeByPath(gRoot, item.path);
        if (!node) continue;

        let nameText = '';
        let posText = '';
        let desText = '';
        const count = Number(node.numChildren) || 0;
        for (let i = 0; i < count; i++) {
          const child = node.getChildAt(i);
          if (!child || child.visible === false || child.internalVisible === false) continue;
          const childName = cleanText(child.name);
          if (childName === 'nameTxt') {
            nameText = cleanText(child.text || child.title || '');
          } else if (childName === 'desTxt') {
            desText = cleanText(child.text || child.title || '');
          } else if (childName === 'posTxt') {
            posText = cleanText(child.text || child.title || '');
          }
        }

        if (!nameText) continue;

        // Match BOSS name against TARGETS
        const bossName = TRIAL_BOSS_NAMES
          .slice().sort((a, b) => b.length - a.length)
          .find((name) => nameText.includes(name) || nameText === name) || '';

        if (!bossName) continue;

        // Determine status from desText
        const isLiveStatus = /待击杀|已刷新|伤害|排名|排行|第[一二三四五六七八九十\d]+名|输出|玩家|挑战/.test(desText);
        const isCooling = /\d{1,2}:[0-5]\d|\d+小时|\d+分|\d+秒|刷新|复活/.test(desText);

        entries.push({
          bossName,
          nameText,
          desText,
          posText,
          sourcePath: item.path,
          status: isLiveStatus ? 'live' : isCooling ? 'cooling' : 'attackable',
         isLiveStatus,
       });
     }
     return entries;
   }

    // --- Utility functions (copied from mu-boss-four-winds-mvp.user.js, adapted) ---

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
        farmTargetName: cleanText(source.farmTargetName) || CONFIG_DEFAULTS.farmTargetName,
        rateRecheckIntervalMs: clampNumber(source.rateRecheckIntervalMs, 60 * 1000, 60 * 60 * 1000, CONFIG_DEFAULTS.rateRecheckIntervalMs),
        trialPriorityWindowMs: clampNumber(source.trialPriorityWindowMs, 0, 10 * 60 * 1000, CONFIG_DEFAULTS.trialPriorityWindowMs),
        trialBossFallbackAttempts: clampNumber(source.trialBossFallbackAttempts, 1, 10, CONFIG_DEFAULTS.trialBossFallbackAttempts),
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
        ownerObserveSeconds: state.ownerObservation ? Math.floor((Date.now() - state.ownerObservation.observedAt) / 1000) : 0,
        targets: state.targets,
        logs: state.logs.slice(-100),
        paused: state.paused,
        pauseReason: state.pauseReason,
        config: state.config,
        lastError: state.lastError,
        navigationContext: clone(state.navigationContext),
        enterTrialContext: clone(state.enterTrialContext),
        exitTrialContext: clone(state.exitTrialContext),
        teleportContext: clone(state.teleportContext),
        trialTaskbarFailCount: state.trialTaskbarFailCount,
        zKeySentAt: state.zKeySentAt,
        zKeyRetryCount: state.zKeyRetryCount,
        arrivalConfirmedAt: state.arrivalConfirmedAt,
        currentIntent: clone(state.currentIntent),
        rateCheck: clone(state.rateCheck),
        rateResults: clone(state.rateResults),
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
        .replace(/\[\/?[^\]]*\]/g, '')
        .replace(/&[a-z]+;/g, ' ')
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

    function root() {
      return window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
    }

    function readOverlay() {
      try {
        const overlay = window.__muBossRespawnOverlay;
        if (!overlay || typeof overlay.getRecords !== 'function') return { available: false, records: [] };
        const records = overlay.getRecords();
        return { available: true, records: Array.isArray(records) ? clone(records) : [] };
      } catch (_) {
        return { available: false, records: [] };
      }
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
        walkNodes(child, visit, (depth || 0) + 1, (path || 'root') + '/' + childName + '[' + index + ']', effectiveVisible);
      }
    }

    function summarizeNode(node, effectiveVisible) {
      const pkg = packageInfo(node);
      return {
        name: cleanText(node.name),
        text: cleanText([node.text, node.title, node.name].filter(Boolean).join(' ')),
        contentText: cleanText(node.text || node.title || ''),
        visible: node.visible !== false && node.internalVisible !== false,
        internalVisible: node.internalVisible !== false,
        effectiveVisible: effectiveVisible !== false,
        selected: node.selected === true,
        rect: getRect(node),
        packageName: pkg.name,
        packageOwner: pkg.owner,
        url: node._url || '',
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
      } catch (_) {
        // 读取布局失败时退回节点本地几何信息。
      }
      return { x: node.x || 0, y: node.y || 0, w: node.width || 0, h: node.height || 0 };
    }

    function findNodeByPath(rootNode, path) {
      if (!rootNode || !path || (path !== 'root' && !path.startsWith('root/'))) return null;
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

    // Find the 'bigBtn' child of a leftlist entry node (CDP verified structure).
    function findBigBtnChild(gRoot, entryNode) {
      if (!entryNode || typeof entryNode.getChildAt !== 'function') return null;
      try {
        const count = Number(entryNode.numChildren) || 0;
        for (let i = 0; i < count; i += 1) {
          const child = entryNode.getChildAt(i);
          if (child && child.name === 'bigBtn') return child;
        }
      } catch (_) {}
      return null;
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
      return { ok: false, reason: 'no supported click method' };
    }

    function normalizeCoordinate(value) {
      const match = cleanText(value).match(/^(?:坐标[:：]?\s*)?\(?([0-9]{1,3})\s*,\s*([0-9]{1,3})\)?$/);
      return match ? match[1] + ',' + match[2] : '';
    }

    // --- BOSS challenge panel scanner (with enterButtons for trial land entry) ---

    function scanBossChallengePanel(nodes) {
      const openButton = nodes.find((item) => item.effectiveVisible && item.name === 'btnBigBoss');
      const panelRoot = nodes.find((item) => item.effectiveVisible
        && (item.name === 'Instance_BossUI' || item.packageName === 'Instance_BossUI' || item.packageOwner === 'Instance_BossUI'));
      if (!panelRoot) {
        return { open: false, openButton: buttonSummaryWithPath(openButton) };
      }
      const panelNodes = descendantsOf(nodes, panelRoot);
      const close = panelNodes.find((item) => item.effectiveVisible && item.name === 'btnClose');
      const tabs = panelNodes
        .filter((item) => item.effectiveVisible && /野外BOSS|福利BOSS|首饰BOSS|试炼之地|苦难炼狱/.test(item.contentText))
        .map((item) => ({ text: item.contentText, selected: item.selected === true, rect: item.rect, sourcePath: item.path }));
      const selectedTab = tabs.find((t) => t.selected) || null;
      const bossRows = panelNodes
        .filter((item) => item.effectiveVisible && item.packageName === 'BtnBoss')
        .map((row) => {
          const children = descendantsOf(panelNodes, row).filter((item) => item.path !== row.path);
          const nameNode = children.find((item) => item.name === 'lab_name' && item.contentText);
          return {
            name: nameNode ? cleanText(nameNode.contentText) : '',
            rect: row.rect,
            sourcePath: row.path,
          };
        })
        .filter((row) => row.name);
      // Scan enter buttons (BtnBossMore) — text is in lab_mapName child,
      // e.g. "试炼之地1 (150,197)" includes map name + teleport coordinate.
      const enterButtons = panelNodes
        .filter((item) => item.effectiveVisible && item.packageName === 'BtnBossMore')
        .map((row) => {
          const children = descendantsOf(panelNodes, row).filter((item) => item.path !== row.path);
          const mapNameNode = children.find((item) => item.name === 'lab_mapName' && item.contentText);
          const titleNode = mapNameNode || children.find((item) => item.contentText);
          return {
            text: titleNode ? cleanText(titleNode.contentText) : '',
            rect: row.rect,
            sourcePath: row.path,
          };
        })
        .filter((btn) => btn.text);
      const mapNameNode = panelNodes.find((item) => item.effectiveVisible && item.name === 'lab_mapName' && item.contentText);
      const mapName = mapNameNode ? cleanText(mapNameNode.contentText) : '';
      const rateIcon = panelNodes.find((item) => item.effectiveVisible && item.name === 'BaolvIcon0');
      const rateIconUrl = rateIcon ? rateIcon.url : '';
      return {
        open: true,
        openButton: buttonSummaryWithPath(openButton),
        closeButton: buttonSummaryWithPath(close),
        selectedTab: selectedTab ? selectedTab.text : '',
        tabs,
        bossRows,
        enterButtons,
        mapName,
        rateIconUrl,
      };
    }

    // --- Keyboard toggle ---

    function setupKeyboardToggle() {
      if (window.__muBossToggleKeyBound) return;
      window.__muBossToggleKeyBound = true;
      window.addEventListener('keydown', function (e) {
        if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
          e.preventDefault();
          e.stopPropagation();
          if (window.__muTrialLandBossMvp && typeof window.__muTrialLandBossMvp.toggle === 'function') {
            var st = window.__muTrialLandBossMvp.toggle();
            showToast(st && st.enabled ? 'BOSS脚本 已开启' : 'BOSS脚本 已关闭');
          }
        }
      }, true);
    }

    function showToast(text) {
      var layer = document.createElement('div');
      layer.textContent = text;
      layer.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);z-index:99999;'
        + 'padding:18px 48px;border-radius:12px;font-size:28px;font-weight:bold;color:#fff;'
        + 'background:rgba(0,0,0,0.7);pointer-events:none;opacity:0;transition:opacity 0.3s ease;'
        + 'text-shadow:0 2px 4px rgba(0,0,0,0.5);font-family:sans-serif;letter-spacing:2px;';
      document.body.appendChild(layer);
      requestAnimationFrame(function () { layer.style.opacity = '1'; });
      setTimeout(function () {
        layer.style.opacity = '0';
        setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 400);
      }, 1500);
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
