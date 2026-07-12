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
      tickId: null,
      farmTargetMissing: false,
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
        intent = makeIntent('disabled', null, 'config disabled', 'none', 1);
      } else if (state.paused) {
        intent = makeIntent('safe_wait', state.currentTargetId || null, state.pauseReason || 'paused', 'none', 1);
      } else if (!snapshot || !snapshot.fguiReady || !snapshot.overlay || !snapshot.overlay.available) {
        intent = makeIntent('sync', null, 'runtime unavailable', 'none', 0);
      } else if (hasLockedValidTarget(snapshot)) {
        intent = intentForLockedTarget(snapshot);
      } else {
        const candidate = selectHighestPriorityTarget(snapshot);
        intent = candidate
          ? intentForTarget(candidate, snapshot)
          : makeIntent('travel_farm', null, 'no boss work', 'click_farm_target', 0.8);
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
      const coordinate = normalizeCoordinate(record.bossCoordinate);
      return !coordinate || coordinate === target.coordinate;
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
      if (!target || isCooling(target, Number(snapshot.at) || Date.now()) || !isLockingIntent()) return false;
      return !findVisibleAttackableTarget(snapshot, target.id);
    }

    function isLockingIntent() {
      return state.currentIntent
        && (state.currentIntent.type === 'travel_boss' || state.currentIntent.type === 'hold');
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
      if (Number(combat.hpPercent) === 0) return false;
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

    function isAtTarget(target, snapshot) {
      const scene = snapshot && snapshot.scene;
      return Boolean(scene && scene.mapName === target.mapName && scene.coordinate === target.coordinate);
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
      const hp = target.text.match(/(\d+)%/);
      const owner = target.text.match(/归属[:：]?\s*([^\s]+)/);
      const targetName = TARGET_TABLE
        .map((entry) => entry.name)
        .sort((left, right) => right.length - left.length)
        .find((name) => target.text.includes(name)) || '';
      return {
        targetName,
        targetLevel: level ? Number(level[1]) : 0,
        hpPercent: hp ? Number(hp[1]) : null,
        ownerName: owner ? cleanText(owner[1]) : '',
      };
    }

    function scanAutoBattle(nodes) {
      const candidates = nodes.filter((item) => item.effectiveVisible && /^(?:自动)?挂机(?:中|已开启|开启|已关闭|关闭)?$/.test(cleanText(item.contentText)));
      const active = candidates.find((item) => /中|开启/.test(item.contentText) || item.selected === true);
      if (active) return { known: true, enabled: true, sourcePath: active.path };
      const inactive = candidates.find((item) => /关闭/.test(item.contentText));
      if (inactive) return { known: true, enabled: false, sourcePath: inactive.path };
      return { known: false, enabled: false };
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
