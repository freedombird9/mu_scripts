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
    });
    const MAX_LOGS = 200;
    const TARGETS = Object.freeze([
      Object.freeze({ id: 'ao-left', name: '傲之煞', mapName: '四风平原', coordinate: '77,145' }),
      Object.freeze({ id: 'ao-right', name: '傲之煞', mapName: '四风平原', coordinate: '182,164' }),
      Object.freeze({ id: 'angry-ao', name: '愤怒傲之煞', mapName: '四风平原', coordinate: '179,79' }),
      Object.freeze({ id: 'rage-ao', name: '狂暴傲之煞', mapName: '四风平原', coordinate: '82,88' }),
    ]);
    const TARGET_TABLE = TARGETS;

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
        autoBattle: scanAutoBattle(nodes),
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
        const previousRefreshAt = validRefreshAt(target.refreshAt);

        if (matchingRecord) {
          const refreshAt = validRefreshAt(matchingRecord.refreshAt);
          if (refreshAt !== null) {
            if (refreshIdentity(previousRefreshAt) !== refreshIdentity(refreshAt)) clearCooldown(target);
            target.refreshAt = refreshAt;
            target.lastRefreshAt = refreshAt;
            target.lastRecordAt = validRecordAt(matchingRecord.observedAt, now);
          } else {
            target.refreshAt = null;
            target.lastRefreshAt = null;
            target.lastRecordAt = validRecordAt(matchingRecord.observedAt, now);
          }
        } else {
          target.refreshAt = null;
          target.lastRefreshAt = null;
          target.lastRecordAt = 0;
        }

        target.status = targetStatus(target, now);
        return target;
      });
      return clone(state.targets);
    }

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
      } else if (hasLockedValidTarget(snapshot)) {
        intent = intentForLockedTarget(snapshot);
      } else {
        const candidate = selectHighestPriorityTarget(snapshot);
        if (candidate) {
          intent = intentForTarget(candidate, snapshot);
        } else {
          resetOwnerObservation();
          intent = makeIntent('travel_farm', null, 'no boss work', 'click_farm_target', 0.8);
        }
      }
      return applyIntent(intent);
    }

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
      if (!rawCoordinate) return true;
      const coordinate = normalizeCoordinate(rawCoordinate);
      return coordinate !== '' && coordinate === target.coordinate;
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
      return Boolean(target
        && Number(target.cooldownUntil) > now
        && refreshIdentity(target.cooldownRefreshAt) === refreshIdentity(target.refreshAt));
    }

    function refreshIdentity(value) {
      const refreshAt = validRefreshAt(value);
      return refreshAt === null ? 'unknown' : String(refreshAt);
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
      if (next.targetId) state.currentTargetId = next.targetId;
      else if (next.type !== 'safe_wait') state.currentTargetId = '';
      state.currentAction = next.action === 'none' ? null : next.action;
      state.phase = next.type.toUpperCase();
      state.lastIntent = next;
      state.currentIntent = next;
      return clone(next);
    }

   function hasLockedValidTarget(snapshot) {
     const target = targetById(state.currentTargetId);
     const now = Number(snapshot.at) || Date.now();
     if (!isLockingIntent()) return false;
     if (state.currentAction === 'navigation_failed' || !isLockTargetEligible(target, now)) {
       releaseLockedTarget();
       return false;
     }
     // During engage/observe_owner, never interrupt for another visible BOSS.
     // Plan: only visible BOSSes can interrupt a *holding* target, not an engaged one.
      // Also relax the status check: even if overlay updated the refresh timer mid-fight,
      // we should finish the current combat before switching.
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
          || state.currentIntent.type === 'hold'
          || state.currentIntent.type === 'engage'
          || state.currentIntent.type === 'observe_owner');
   }

    function isLockTargetEligible(target, now) {
      const definition = target && TARGETS.find((item) => item.id === target.id);
      const allowedStatuses = ['READY_UNKNOWN_TIMER', 'READY', 'PREPARE'];
      return Boolean(definition
        && definition.name === target.name
        && definition.coordinate === target.coordinate
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

      const eligible = state.targets.filter((target) => !isCooling(target, now));
      const unknown = eligible.filter((target) => validRefreshAt(target.refreshAt) === null);
      if (unknown.length) return unknown[0];
      const visible = eligible.filter((target) => isVisibleAndAttackable(target, snapshot));
      if (visible.length) return visible[0];
      return eligible
        .filter((target) => {
          const refreshAt = validRefreshAt(target.refreshAt);
          return refreshAt !== null && refreshAt > now && refreshAt - now <= state.config.preWaitSeconds * 1000;
        })
        .sort((left, right) => Number(left.refreshAt) - Number(right.refreshAt))[0] || null;
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
      if (isAtTarget(target, snapshot)) {
        return makeIntent('hold', target.id, 'at boss coordinate', 'hold_position', 0.95);
      }
      if (target.status === 'READY_UNKNOWN_TIMER') {
        return makeIntent('travel_boss', target.id, 'unknown refresh timer', 'click_boss_target', 0.9);
      }
      if (target.status === 'READY') {
        return makeIntent('travel_boss', target.id, 'boss refresh time reached', 'click_boss_target', 0.9);
      }
      return makeIntent('travel_boss', target.id, 'refresh within pre-wait window', 'click_boss_target', 0.85);
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

    function executeIntent(intent, snapshot) {
      if (!intent) return null;
      state.currentAction = intent.action || intent.type;
      const now = Date.now();

      // Rate-limit: at most one action per tick, minimum 500ms between clicks.
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
        case 'hold': result = executeHold(intent, snapshot); break;
        case 'engage': result = executeEngage(intent, snapshot); break;
        case 'observe_owner': result = executeObserveOwner(intent, snapshot); break;
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
     const navCtx = state.navigationContext;
     const isSameNav = navCtx && navCtx.kind === kind && navCtx.targetId === targetKey;

     // Phase 1: map closed. Open it, or monitor progress if already clicked.
     if (!snapshot.mapPanel.open) {
       if (isSameNav && navCtx.clicked) {
         return checkNavProgress(navCtx, snapshot, intent, kind, now);
       }
       return clickOpenMapButton(snapshot);
     }

     // Phase 2: map open. Find target row.
     let targetRow;
     if (kind === 'boss') {
       const target = targetById(intent.targetId);
       if (!target) return { ok: false, reason: 'boss_target_missing' };
      targetRow = snapshot.mapPanel.bossTargets.find((row) => row.name === target.name);
      if (!targetRow || targetRow.targetId !== intent.targetId) {
        targetRow = snapshot.mapPanel.bossTargets.find((row) => row.targetId === intent.targetId);
      }
      if (!targetRow) return { ok: false, reason: 'boss_row_not_found' };
     } else {
       targetRow = snapshot.mapPanel.farmTarget;
       if (!targetRow) return { ok: false, reason: 'farm_target_missing' };
     }

    // Phase 3: already clicked - close map so coordinates become visible.
     if (isSameNav && navCtx.clicked) {
       if (navCtx.closeClicked) {
         // Already clicked close — wait for map to actually close.
         return { ok: true, reason: 'waiting_map_close' };
       }
       return closeMapPanel(snapshot);
     }

     // Phase 4: first time - click target row.
     const fresh = readSnapshot();
     if (!fresh.mapPanel.open) return { ok: false, reason: 'map_panel_closed' };
     const freshRow = findNodeByPathSummary(fresh.mapPanel, targetRow.sourcePath, targetKey);
     if (!freshRow) return { ok: false, reason: 'target_row_vanished' };

     if (!isSameNav) {
       state.navigationContext = {
         kind,
         targetId: targetKey,
         startedAt: now,
         lastCoordinate: '',
         lastCoordinateAt: 0,
         clicked: false,
         retried: false,
       };
     }

     const node = findNodeByPath(root(), targetRow.sourcePath);
     if (!node) return { ok: false, reason: 'target_node_not_found' };
     if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'target_node_hidden' };
     const action = activateNode(node);
     if (!action.ok) return { ok: false, reason: action.reason };
     state.navigationContext.clicked = true;
     appendLog('nav_target_clicked', { kind, targetId: targetKey, method: action.method });
     return { ok: true, method: action.method, reason: kind + '_row_clicked' };
   }

   function checkNavProgress(navCtx, snapshot, intent, kind, now) {
     // Total timeout check.
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
      appendLog('navigation_retry', { kind, targetId: intent.targetId });
      return { ok: true, reason: 'retry_pending' };
    }

    // Coordinate stall check (only when coordinate is available).
    const currentCoord = snapshot.scene.coordinate || '';
    if (!currentCoord) return { ok: true, reason: 'navigating' };

    // Update coordinate tracking if moved.
    const moved = currentCoord !== navCtx.lastCoordinate;
    if (moved) {
      navCtx.lastCoordinate = currentCoord;
      navCtx.lastCoordinateAt = now;
    }

    // Boss: check arrival by Chebyshev distance.
    if (kind === 'boss' && intent.targetId) {
      const target = targetById(intent.targetId);
      if (target && chebyshevDistance(currentCoord, target.coordinate) <= ARRIVAL_THRESHOLD) {
        appendLog('navigation_arrived', { kind, targetId: intent.targetId, coordinate: currentCoord, targetCoordinate: target.coordinate });
        state.navigationContext = null;
        return { ok: true, reason: 'arrived' };
      }
    }

    // Farming: if coordinate stable for 5s, consider arrived (game auto-starts farming).
    if (kind === 'farm' && !moved && now - navCtx.lastCoordinateAt > 5000) {
      appendLog('navigation_arrived', { kind: 'farm', targetId: 'farm', coordinate: currentCoord });
      state.navigationContext = null;
      return { ok: true, reason: 'arrived' };
    }

    // Stall check: coordinate unchanged beyond arrivalStallMs.
    if (!moved && now - navCtx.lastCoordinateAt > state.config.arrivalStallMs) {
      if (!navCtx.retried) {
        navCtx.retried = true;
        navCtx.startedAt = now;
        navCtx.clicked = false;
        navCtx.closeClicked = false;
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

    // --- Hold position + Z safety gate ---

    function executeHold(intent, snapshot) {
      const target = targetById(intent.targetId);
      if (!target) return { ok: false, reason: 'hold_target_missing' };

      // Check if we've arrived at target coordinate.
      if (!isAtTarget(target, snapshot)) {
        // Not there yet — delegate to travel on next tick.
        return { ok: false, reason: 'not_at_coordinate' };
      }

      // At target coordinate: try to enable auto-battle.
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
     // The game auto-enables farming when the character arrives at a map-clicked destination.
     // Do NOT send Z key — it's a toggle and could turn off the game's auto-farming.
     // Just report the current auto-battle state for logging purposes.
     if (!snapshot.autoBattle || !snapshot.autoBattle.known) {
       return { ok: false, reason: 'auto_battle_state_unknown' };
     }
     return { ok: true, reason: snapshot.autoBattle.enabled ? 'already_enabled' : 'waiting_for_game_auto' };
   }

    // --- Owner observation ---

    function executeObserveOwner(intent, snapshot) {
      const target = targetById(intent.targetId);
      if (!target) return { ok: false, reason: 'observe_target_missing' };

      const combat = snapshot.combat;
      if (!combat || cleanText(combat.targetName) !== target.name) {
        // Boss disappeared — reset observation.
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

      // Foreign owner: start or continue observation.
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
        ownerObserveSeconds: state.ownerObservation ? Math.floor((Date.now() - state.ownerObservation.observedAt) / 1000) : 0,
        targets: state.targets,
        logs: state.logs.slice(-100),
        paused: state.paused,
        pauseReason: state.pauseReason,
        config: state.config,
        lastError: state.lastError,
        navigationContext: clone(state.navigationContext),
        currentIntent: clone(state.currentIntent),
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
        walkNodes(child, visit, (depth || 0) + 1, `${path || 'root'}/${childName}[${index}]`, effectiveVisible);
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

    // Task 2 不会调用此函数；它只保留给后续经显式审批的执行步骤使用。
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

    function scanScene(nodes) {
      const map = nodes.find((item) => item.effectiveVisible && cleanText(item.contentText) === '四风平原');
      const coordinate = nodes
        .filter((item) => item.effectiveVisible)
        .map((item) => normalizeCoordinate(item.contentText))
        .find(Boolean) || '';
      return { mapName: map ? '四风平原' : '', coordinate };
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
        };
      }

      const panelNodes = descendantsOf(nodes, panelRoot);
      const mapNameNode = panelNodes.find((item) => item.name === 'labline' && item.contentText);
      const closeButton = panelNodes.find((item) => item.effectiveVisible && item.name === 'btnClose');
      const list = panelNodes.find((item) => item.effectiveVisible && item.name === 'List_right');
      const rows = list
        ? panelNodes
          .filter((item) => item.effectiveVisible && item.path !== list.path && item.path.startsWith(`${list.path}/`) && item.packageName === 'RightLift')
          .sort((left, right) => left.rect.y - right.rect.y)
        : [];
     const bossTargets = rows
       .map((row) => mapRowSummary(panelNodes, row))
       .filter((row) => TARGET_TABLE.some((target) => target.name === row.name));
     // Assign targetId by matching name + order to disambiguate same-name bosses.
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
        const title = children.find((item) => item.name === 'n0' && cleanText(item.contentText) === '1350级怪物');
        return Boolean(title);
      });

      return {
        open: true,
        mapName: mapNameNode ? cleanText(mapNameNode.contentText) : '',
        openButton: buttonSummaryWithPath(openButton),
        closeButton: buttonSummaryWithPath(closeButton),
        bossTargets,
        farmTarget: farmRow ? mapRowSummary(panelNodes, farmRow) : null,
        farmTargetReason: farmRow ? '' : 'farm_target_missing',
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
      return nodes.filter((item) => item.path === rootNode.path || (item.path && item.path.startsWith(`${rootNode.path}/`)));
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
      // HP percent is in a sibling percentText node, not in nameText.
      const parentPath = target.path.replace(/\/[^/]+$/, '');
      const pctNode = nodes.find((item) => item.path.startsWith(parentPath + '/')
        && item.name === 'percentText' && item.effectiveVisible);
      const hp = pctNode ? pctNode.text.match(/(\d+)%/) : null;
      // Owner name appears in nameText after BOSS name with no prefix.
      // e.g. "Lv1500 狂暴傲之煞 普尔赫达" -> owner = "普尔赫达"
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
  // Detect auto-battle via autoFightDataTip > dataList > AutoStatusItem children.
  // When Z (auto-fight) is active, the dataList contains visible AutoStatusItem nodes
  // showing exp/damage stats. When inactive, the list is empty or the tip is hidden.
  const tip = nodes.find((item) => item.name === 'autoFightDataTip' && item.effectiveVisible);
  if (!tip) return { known: false, enabled: false };
  const tipPrefix = tip.path + '/';
  const dataList = nodes.find((item) => item.path === tipPrefix + 'dataList[0]' && item.effectiveVisible);
  if (!dataList) return { known: true, enabled: false, sourcePath: tip.path };
  const listPrefix = dataList.path + '/';
  const statusItems = nodes.filter((item) =>
    item.path !== dataList.path
    && item.path.startsWith(listPrefix)
    && item.effectiveVisible
    && item.packageName === 'AutoStatusItem'
  );
  return {
    known: true,
    enabled: statusItems.length > 0,
    sourcePath: tip.path,
  };
}

function normalizeCoordinate(value) {
      const match = cleanText(value).match(/^(?:坐标[:：]?\s*)?\(?([0-9]{1,3})\s*,\s*([0-9]{1,3})\)?$/);
      return match ? `${match[1]},${match[2]}` : '';
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
