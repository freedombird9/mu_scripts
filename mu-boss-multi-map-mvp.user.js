// ==UserScript==
// @name         全民红月 - 多地图 BOSS 自动化 MVP
// @namespace    codex.mu.multi-map-boss-mvp
// @version      0.3.1
// @description  四风平原 + 试炼之地1 + 苦难炼狱2 模块化自动打 BOSS。地图可插拔扩展。
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

    if (window.__muMultiMapBossMvp) return;

    // --- Constants & state ---

    const STORAGE_KEY = 'mu_multi_map_boss_mvp_v1';
    const TICK_MS = 1000;
    const ARRIVAL_THRESHOLD = 3;
    const MAX_LOGS = 200;
    const KNOWN_MAP_NAMES = ['四风平原', '试炼之地1', '苦难炼狱2', '勇者大陆'];
    const CONFIG_DEFAULTS = Object.freeze({
      enabled: false,
      dryRun: true,
      ownerName: '普尔赫达',
      preWaitSeconds: 90,
      ownerObserveSeconds: 10,
      contestedCooldownMs: 5 * 60 * 1000,
      arrivalStallMs: 15 * 1000,
      travelTimeoutMs: 180 * 1000,
      farmTargetName: '1500级怪物',
      rateRecheckIntervalMs: 15 * 60 * 1000,
      trialPriorityWindowMs: 60 * 1000,
      enabledMaps: ['four_winds', 'trial_land', 'purgatory'],
      mapPriorities: { four_winds: 10, trial_land: 20, purgatory: 30 },
      enabledBosses: ['ao-left','ao-right','angry-ao','rage-ao','lobster-1','lobster-2','lobster-3','magic-crystal'],
      purgatoryMapChoice: '苦难炼狱2',
      instanceEmptyCooldownMs: 15 * 60 * 1000,
    });

    const fourWindsModule = Object.freeze({
      id: 'four_winds',
      mapName: '四风平原',
      type: 'wild',
      priority: 10,
      enabled: true,
      farmTarget: { name: '1500级怪物' },
      bossRowTab: '野外BOSS',
      bossRowScroll: null,
      enterButtonTog: null,
      enterButtonTextRegex: null,
      hasTaskbar: false,
      bosses: [
        { id: 'ao-left',   name: '傲之煞',       coordinate: '77,145' },
        { id: 'ao-right',  name: '傲之煞',       coordinate: '182,164' },
        { id: 'angry-ao',  name: '愤怒傲之煞',   coordinate: '179,79' },
        { id: 'rage-ao',   name: '狂暴傲之煞',   coordinate: '82,88' },
      ],
    });

    const trialLandModule = Object.freeze({
      id: 'trial_land',
      mapName: '试炼之地1',
      type: 'instance',
      priority: 20,
      enabled: true,
      farmTarget: null,
      bossRowTab: '试炼之地',
      bossRowScroll: 'privatelevelScroll',
      enterButtonTog: 'privatetog_mapName',
      enterButtonTextRegex: /^试炼之地1/,
      hasTaskbar: false,
      bosses: [
        { id: 'lobster-1', name: '龙虾战士',       coordinate: '146,127', layer: 1 },
        { id: 'lobster-2', name: '邪恶龙虾战士',   coordinate: '79,68',   layer: 1 },
        { id: 'lobster-3', name: '咆哮龙虾战士',   coordinate: '122,33',  layer: 1 },
      ],
    });

    const purgatoryModule = Object.freeze({
      id: 'purgatory',
      mapName: '苦难炼狱2',
      type: 'instance',
      priority: 30,
      enabled: true,
      farmTarget: null,
      bossRowTab: '苦难炼狱',
      bossRowScroll: 'wildlevelScroll',
      enterButtonTog: 'wildtog_mapName',
      enterButtonTextRegex: /^苦难炼狱2/,
      hasTaskbar: false,
      bosses: [
        // Task 0 项 2 探查:角色站墓碑旁亲自验证为 '149,101'(按钮上的 (126,95) 是按钮坐标,非 BOSS 坐标)
        { id: 'magic-crystal', name: '魔晶菲尼斯', coordinate: '149,101' },
      ],
    });

    const MAP_MODULES = [fourWindsModule, trialLandModule, purgatoryModule];

    // Derived from MAP_MODULES; needed by scanMapPanel and scanCombat to filter BOSS rows
    // by known names. (Equivalent to reference script L50 `const TARGET_TABLE = TARGETS;`.)
    // Note: this is computed once at injection time. If MAP_MODULES were ever mutated at
    // runtime (it is not — Task 3 freezes it), this would go stale. Keep this constraint.
    const TARGET_TABLE = MAP_MODULES.flatMap((m) => m.bosses.map((b) => ({ name: b.name, mapName: m.mapName })));

    const state = {
      enabled: false,
      dryRun: true,
      phase: 'SYNC',
      currentTargetId: '',
      currentAction: null,
      logs: [],
      config: null,
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
      rateCheck: { phase: 'idle', targetModuleId: '', startedAt: 0, lastActionAt: 0 },
      rateResults: {},
      enterInstanceCtx: null,
      exitInstanceCtx: null,
      teleportCtx: null,
      zKeySentAt: 0,
      zKeyRetryCount: 0,
      arrivalConfirmedAt: 0,
      currentModuleId: '',
      instanceCheckCooldown: {},
    };

    // --- Rate-check maps (Task 5) ---
    // 声明必须早于下方 rebuildRateCheckMaps() 调用,否则 const TDZ 会抛 ReferenceError。

    const RATE_URL_MAP = {
      'txt_bld': 'low',
      'txt_blz': 'medium',
      'txt_blg': 'high',
    };

    // Task 0 项 5 探查结论:BaolvIcon0 反映当前选中 BOSS 爆率(魔晶菲尼斯=txt_blg=high,傲之煞=txt_bld=low)
    // → PURGATORY_RATE_CHECK_ENABLED = true,苦难炼狱纳入爆率检查
    const PURGATORY_RATE_CHECK_ENABLED = true;

    // RATE_CHECK_MAPS 从 MAP_MODULES 动态生成;在 state.config 初始化后调用 rebuildRateCheckMaps()
    const RATE_CHECK_MAPS = {};

    function rebuildRateCheckMaps() {
      for (const key in RATE_CHECK_MAPS) delete RATE_CHECK_MAPS[key];
      for (const module of MAP_MODULES) {
        if (!isModuleEnabled(module)) continue;
        // 跳过 Task 0 决定不做爆率检查的模块
        if (module.id === 'purgatory' && !PURGATORY_RATE_CHECK_ENABLED) continue;
        RATE_CHECK_MAPS[module.mapName] = {
          tab: module.bossRowTab,
          bossNames: module.bosses.map((b) => b.name),
          mapMatch: module.mapName.replace(/\d+$/, ''),
          moduleId: module.id,
        };
      }
    }

    state.config = normalizeConfig(readJson(STORAGE_KEY, CONFIG_DEFAULTS));
    syncRuntimeFlags();  // re-sync after normalizeConfig
    rebuildRateCheckMaps();

    state.targets = MAP_MODULES.flatMap((module) =>
      module.bosses.map((boss) => createTargetState({
        ...boss,
        moduleId: module.id,
        mapName: module.mapName,
      }))
    );

    // --- Utility functions (copied from mu-boss-trial-land-mvp.user.js) ---

    function persist() {
      writeJson(STORAGE_KEY, state.config);
    }

    function syncRuntimeFlags() {
      state.enabled = state.config.enabled;
      state.dryRun = state.config.dryRun;
    }

    function appendLog(type, details) {
      state.logs.push({
        at: Date.now(),
        type: cleanText(type) || 'event',
        details: clone(details || {}),
      });
      if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
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

    // --- Config normalization (Task 2) ---

    function normalizeConfig(input) {
      const source = input && typeof input === 'object' ? input : {};
      const config = {
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
        enabledMaps: Array.isArray(source.enabledMaps) && source.enabledMaps.length
          ? source.enabledMaps.map(cleanText).filter(Boolean)
          : clone(CONFIG_DEFAULTS.enabledMaps),
        mapPriorities: normalizeMapPriorities(source.mapPriorities),
        enabledBosses: Array.isArray(source.enabledBosses) && source.enabledBosses.length
          ? source.enabledBosses.map(cleanText).filter(Boolean)
          : clone(CONFIG_DEFAULTS.enabledBosses),
        purgatoryMapChoice: cleanText(source.purgatoryMapChoice) || CONFIG_DEFAULTS.purgatoryMapChoice,
        instanceEmptyCooldownMs: clampNumber(source.instanceEmptyCooldownMs, 60 * 1000, 24 * 60 * 60 * 1000, CONFIG_DEFAULTS.instanceEmptyCooldownMs),
      };
      return config;
    }

    function normalizeMapPriorities(input) {
      const source = input && typeof input === 'object' ? input : {};
      const out = {};
      for (const module of MAP_MODULES) {
        const v = source[module.id];
        out[module.id] = (typeof v === 'number' && Number.isFinite(v)) ? v : module.priority;
      }
      return out;
    }

    // --- Status & context reset (Task 2) ---

    function getStatus() {
      return clone({
        enabled: state.enabled,
        dryRun: state.dryRun,
        phase: state.phase,
        currentTargetId: state.currentTargetId,
        currentAction: state.currentAction,
        currentModuleId: state.currentModuleId,
        ownerObserveSeconds: state.ownerObservation ? Math.floor((Date.now() - state.ownerObservation.observedAt) / 1000) : 0,
        targets: state.targets,
        logs: state.logs.slice(-100),
        paused: state.paused,
        pauseReason: state.pauseReason,
        config: state.config,
        lastError: state.lastError,
        navigationContext: clone(state.navigationContext),
        enterInstanceCtx: clone(state.enterInstanceCtx),
        exitInstanceCtx: clone(state.exitInstanceCtx),
        teleportCtx: clone(state.teleportCtx),
        mapScanContext: clone(state.mapScanContext),
        rateCheck: clone(state.rateCheck),
        rateResults: clone(state.rateResults),
        instanceCheckCooldown: clone(state.instanceCheckCooldown),
        zKeySentAt: state.zKeySentAt,
        zKeyRetryCount: state.zKeyRetryCount,
        arrivalConfirmedAt: state.arrivalConfirmedAt,
        currentIntent: clone(state.currentIntent),
      });
    }

    function resetAllContexts() {
      state.rateCheck = { phase: 'idle', targetModuleId: '', startedAt: 0, lastActionAt: 0 };
      state.rateResults = {};
      state.farmArrivedAt = 0;
      state.farmArrivedCoord = '';
      state.farmLastSeenFarmingAt = 0;
      state.holdStartedAt = 0;
      state.lastCheckedAt = {};
      state.lastMapScanAt = 0;
      state.mapScanContext = null;
      state.navigationContext = null;
      state.enterInstanceCtx = null;
      state.exitInstanceCtx = null;
      state.teleportCtx = null;
      state.currentModuleId = '';
      state.zKeySentAt = 0;
      state.zKeyRetryCount = 0;
      state.arrivalConfirmedAt = 0;
      state.instanceCheckCooldown = {};
    }

    // --- Keyboard toggle (Task 2) ---

    function setupKeyboardToggle() {
      if (window.__muMultiMapBossToggleKeyBound) return;
      window.__muMultiMapBossToggleKeyBound = true;
      window.addEventListener('keydown', function (e) {
        if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
          e.preventDefault();
          e.stopPropagation();
          if (window.__muMultiMapBossMvp && typeof window.__muMultiMapBossMvp.toggle === 'function') {
            const st = window.__muMultiMapBossMvp.toggle();
            showToast(st && st.enabled ? 'BOSS脚本 已开启' : 'BOSS脚本 已关闭');
          }
        }
      }, true);
    }

    // --- Scan functions ---

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

    // --- BOSS challenge panel scanner (with enterButtons for instance entry) ---

    function inferScrollName(path) {
      const parts = path.split('/');
      for (let i = parts.length - 1; i >= 0; i--) {
        const name = parts[i].replace(/\[\d+\]$/, '');
        if (/Scroll$/.test(name)) return name;
      }
      return '';
    }

    function inferTogName(path) {
      const parts = path.split('/');
      for (let i = parts.length - 1; i >= 0; i--) {
        const name = parts[i].replace(/\[\d+\]$/, '');
        if (/tog_mapName$/.test(name)) return name;
      }
      return '';
    }

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
            scrollName: inferScrollName(row.path),
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
            togName: inferTogName(row.path),
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

    // --- Snapshot & reconciliation (Task 4) ---

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
        fguiReady: Boolean(gRoot),
      };
      // 注:scanTrialTaskbar 已删除,不读
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
      state.targets = MAP_MODULES.flatMap((module) => {
        if (!state.config.enabledMaps.includes(module.id)) return [];
        return module.bosses.map((definition) => {
          const previous = previousById.get(definition.id) || createTargetState(definition);
          const target = { ...createTargetState(definition), ...clone(previous), ...definition, moduleId: module.id, mapName: module.mapName };
          const matchingRecord = selectMatchingRecord(records, target);
          if (matchingRecord) {
            const refreshAt = validRefreshAt(matchingRecord.refreshAt);
            if (refreshAt !== null) {
              target.refreshAt = refreshAt;
              target.lastRefreshAt = refreshAt;
              target.lastRecordAt = validRecordAt(matchingRecord.observedAt, now);
              // 有新 overlay 刷新记录 → 清除副本空场冷却(防折返解除条件)
              if (state.instanceCheckCooldown[module.id] && state.instanceCheckCooldown[module.id] > now) {
                delete state.instanceCheckCooldown[module.id];
                appendLog('instance_cooldown_lifted', { moduleId: module.id, reason: 'overlay got refresh record' });
              }
            } else {
              target.refreshAt = null;
              target.lastRefreshAt = null;
              target.lastRecordAt = validRecordAt(matchingRecord.observedAt, now);
            }
          } else {
            if (!validRefreshAt(target.refreshAt)) {
              target.refreshAt = null;
              target.lastRefreshAt = null;
            }
            target.lastRecordAt = 0;
          }
          target.status = targetStatus(target, now);
          return target;
        });
      });
      return clone(state.targets);
    }

    function recordMatchesTarget(record, target) {
      if (!record || !target) return false;
      if (cleanText(record.mapName) !== target.mapName) return false;
      if (cleanText(record.bossName) !== target.name) return false;
      const rawCoordinate = cleanText(record.bossCoordinate);
      if (!rawCoordinate) return true;
      const coordinate = normalizeCoordinate(rawCoordinate);
      if (!coordinate || !target.coordinate || target.coordinate === 'TBD') return true;
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

    function chebyshevDistance(coordA, coordB) {
      const a = String(coordA).split(',').map(Number);
      const b = String(coordB).split(',').map(Number);
      if (a.length < 2 || b.length < 2 || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return Infinity;
      return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    }

    function releaseLockedTarget() {
      state.currentTargetId = '';
      state.currentAction = null;
      state.currentIntent = null;
    }

    // --- Module helpers (Task 4) ---

    function moduleByMapName(mapName) {
      if (!mapName) return null;
      return MAP_MODULES.find((m) => m.mapName === mapName && state.config.enabledMaps.includes(m.id)) || null;
    }

    function moduleById(moduleId) {
      return MAP_MODULES.find((m) => m.id === moduleId) || null;
    }

    function effectiveModulePriority(module) {
      if (!module) return 0;
      const override = state.config.mapPriorities && state.config.mapPriorities[module.id];
      return (typeof override === 'number' && Number.isFinite(override)) ? override : module.priority;
    }

    function isModuleEnabled(module) {
      return Boolean(module && module.enabled && state.config.enabledMaps.includes(module.id));
    }

    function isBossEnabled(target) {
      return Boolean(target && state.config.enabledBosses.includes(target.id));
    }

    function setInstanceCheckCooldown(moduleId, until) {
      state.instanceCheckCooldown[moduleId] = until;
      appendLog('instance_cooldown_set', { moduleId, until });
    }

    function isInstanceInCooldown(moduleId, now) {
      const until = Number(state.instanceCheckCooldown[moduleId]) || 0;
      return until > now;
    }

    // --- API exposure (Task 2) ---

    window.__muMultiMapBossMvp = {
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
      scanNow: readSnapshot,  // Task 4 implements readSnapshot; hoisting lets it resolve
      getModule(moduleId) {
        const m = MAP_MODULES.find(m => m.id === moduleId);
        return m ? clone(m) : null;
      },
      getTargets() {
        return clone(state.targets);
      },
      resetInstanceCooldown(moduleId) {
        if (moduleId && state.instanceCheckCooldown[moduleId]) {
          delete state.instanceCheckCooldown[moduleId];
          appendLog('instance_cooldown_reset', { moduleId });
        } else if (!moduleId) {
          state.instanceCheckCooldown = {};
          appendLog('instance_cooldown_reset_all', {});
        }
        return getStatus();
      },
    };

    function nextRateResetTimestamp() {
      const now = Date.now();
      const utc8Ms = now + 8 * 3600 * 1000;
      const utc8Date = new Date(utc8Ms);
      // UTC+8 凌晨 8am 重置 = UTC 0am 重置
      const utcMidnight = Date.UTC(utc8Date.getUTCFullYear(), utc8Date.getUTCMonth(), utc8Date.getUTCDate());
      return utcMidnight + 24 * 3600 * 1000;
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
      // Task 6 完整实现,这里占位返回 false
      return false;
    }

    function needMapScan(snapshot, module) {
      // Task 6 完整实现,这里占位返回 false
      return false;
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

    // --- Intent helpers (Task 5) ---

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
      else if (next.type !== 'safe_wait' && next.type !== 'enter_instance'
        && next.type !== 'exit_instance' && next.type !== 'teleport_to_module'
        && next.type !== 'scan_map') state.currentTargetId = '';
      if (state.currentTargetId && state.currentTargetId !== previousTargetId) {
        state.arrivalConfirmedAt = 0;
        state.zKeySentAt = 0;
        state.zKeyRetryCount = 0;
        state.holdStartedAt = 0;
      }
      state.currentAction = next.action === 'none' ? null : next.action;
      state.phase = next.type.toUpperCase();
      if (!isLockingIntent() && state.navigationContext) {
        appendLog('nav_context_cleared', { reason: 'intent not locking: ' + next.type });
        state.navigationContext = null;
      }
      state.lastIntent = next;
      state.currentIntent = next;
      return clone(next);
    }

    function isLockingIntent() {
      return state.currentIntent
        && (state.currentIntent.type === 'travel_boss'
          || state.currentIntent.type === 'travel_farm'
          || state.currentIntent.type === 'hold'
          || state.currentIntent.type === 'engage'
          || state.currentIntent.type === 'observe_owner'
          || state.currentIntent.type === 'enter_instance'
          || state.currentIntent.type === 'exit_instance'
          || state.currentIntent.type === 'teleport_to_module');
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

    function isLockTargetEligible(target, now) {
      if (!target) return false;
      const definition = MAP_MODULES.flatMap((m) => m.bosses).find((item) => item.id === target.id);
      const allowedStatuses = ['READY_UNKNOWN_TIMER', 'READY', 'PREPARE'];
      return Boolean(definition
        && definition.name === target.name
        && !isCooling(target, now)
        && allowedStatuses.includes(target.status));
    }

    function findVisibleAttackableTarget(snapshot, excludedTargetId) {
      return state.targets.find((target) => target.id !== excludedTargetId
        && !isCooling(target, Number(snapshot.at) || Date.now())
        && isVisibleAndAttackable(target, snapshot)) || null;
    }

    function isVisibleAndAttackable(target, snapshot) {
      const combat = snapshot && snapshot.combat;
      if (!combat || cleanText(combat.targetName) !== target.name) return false;
      if (!hasVisibleHpBar(combat) || Number(combat.hpPercent) === 0) return false;
      const scene = snapshot.scene || {};
      return !scene.mapName || scene.mapName === target.mapName;
    }

    function isAtTarget(target, snapshot) {
      const scene = snapshot && snapshot.scene;
      if (!scene || scene.mapName !== target.mapName || !scene.coordinate) return false;
      if (target.coordinate === 'TBD') return false;
      return chebyshevDistance(scene.coordinate, target.coordinate) <= ARRIVAL_THRESHOLD;
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

    // --- Intent selection (Task 5) ---

    function intentForTarget(target, module, snapshot) {
      if (!target) return makeIntent('sync', null, 'target missing', 'none', 0);
      // 1. 被他人占据 → 观察
      if (observeContestedOwner(target, snapshot)) {
        return makeIntent('safe_wait', null, 'boss contested cooldown', 'none', 0.95);
      }
      // 2. 在视野内可攻击
      if (isVisibleAndAttackable(target, snapshot)) {
        const ownerName = cleanText(snapshot.combat && snapshot.combat.ownerName);
        if (ownerName && ownerName !== state.config.ownerName) {
          return makeIntent('observe_owner', target.id, 'visible boss owned by another player', 'observe_owner', 0.95);
        }
        return makeIntent('engage', target.id, 'visible boss is attackable', 'ensure_auto_battle', 1);
      }
      // 3. 已到坐标 → hold
      if (isAtTarget(target, snapshot)) {
        if (target.status === 'READY_UNKNOWN_TIMER') {
          if (!state.holdStartedAt) state.holdStartedAt = Number(snapshot.at) || Date.now();
          const HOLD_UNKNOWN_TIMEOUT_MS = 60 * 1000;
          const now = Number(snapshot.at) || Date.now();
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
      // 4. 副本模块且当前不在该副本内 → enter_instance
      if (module.type === 'instance' && (snapshot.scene && snapshot.scene.mapName) !== module.mapName) {
        state.currentModuleId = module.id;
        return makeIntent('enter_instance', null, module.id + ' has boss, need enter', 'enter_instance', 0.95);
      }
      // 5. 已在正确地图但未到坐标 → travel_boss
      return makeIntent('travel_boss', target.id, 'go to boss coord', 'click_boss_target', 0.9);
    }

    function intentForLockedTarget(snapshot) {
      const target = targetById(state.currentTargetId);
      if (!target) return makeIntent('sync', null, 'locked target missing', 'none', 0);
      const module = moduleById(target.moduleId);
      if (!module) return makeIntent('sync', null, 'module missing', 'none', 0);
      return intentForTarget(target, module, snapshot);
    }

    function shouldEnterInstance(module, snapshot, now) {
      if (!isModuleEnabled(module)) return false;
      if (module.type !== 'instance') return false;
      if (isInstanceInCooldown(module.id, now)) return false;
      // 已在该副本内不算"应进入"(由 chooseInstanceIntent 处理)
      if (snapshot.scene && snapshot.scene.mapName === module.mapName) return false;
      // 至少有 1 个可打 BOSS
      const attackable = getAttackableTargets(module, now);
      if (!attackable.length) return false;
      // 爆率非 low(若该模块纳入爆率检查)
      if (RATE_CHECK_MAPS[module.mapName] && isMapRateLow(module.mapName)) return false;
      // 不在另一个 instance ctx 内
      if (state.enterInstanceCtx || state.exitInstanceCtx) return false;
      return true;
    }

    function shouldPrioritizeInstance(module, snapshot, now) {
      if (!isModuleEnabled(module) || module.type !== 'instance') return false;
      if (isInstanceInCooldown(module.id, now)) return false;
      const attackable = getAttackableTargets(module, now);
      if (!attackable.length) return false;
      return attackable.some((t) => {
        const st = targetStatus(t, now);
        return st === 'READY' || st === 'READY_UNKNOWN_TIMER';
      });
    }

    function getAttackableTargets(module, now) {
      if (!module) return [];
      if (isMapRateLow(module.mapName)) return [];
      if (!isModuleEnabled(module)) return [];
      return state.targets.filter((t) => {
        if (t.moduleId !== module.id) return false;
        if (!isBossEnabled(t)) return false;
        if (isCooling(t, now)) return false;
        const status = targetStatus(t, now);
        return status === 'READY' || status === 'READY_UNKNOWN_TIMER' || status === 'PREPARE';
      });
    }

    function selectInstanceTarget(attackable, snapshot) {
      const now = Number(snapshot.at) || Date.now();
      const visible = attackable.filter((t) => isVisibleAndAttackable(t, snapshot));
      if (visible.length) return visible[0];
      const knownTimer = attackable
        .filter((t) => validRefreshAt(t.refreshAt) !== null)
        .sort((a, b) => Number(a.refreshAt) - Number(b.refreshAt));
      if (knownTimer.length) return knownTimer[0];
      return attackable[0] || null;
    }

    function selectHighestPriorityTarget(snapshot, module) {
      const now = Number(snapshot.at) || Date.now();
      if (!module) return null;
      const lockedTarget = targetById(state.currentTargetId);
      const visibleInterrupt = lockedTarget && isLockingIntent()
        ? findVisibleAttackableTarget(snapshot, lockedTarget.id)
        : null;
      if (visibleInterrupt) return visibleInterrupt;
      const eligible = state.targets.filter((target) =>
        target.moduleId === module.id
        && isBossEnabled(target)
        && !isCooling(target, now)
        && !isMapRateLow(module.mapName));
      const visible = eligible.filter((target) => isVisibleAndAttackable(target, snapshot));
      if (visible.length) return visible[0];
      const soonToRefresh = eligible
        .filter((target) => {
          const refreshAt = validRefreshAt(target.refreshAt);
          return refreshAt !== null && refreshAt > now && refreshAt - now <= state.config.preWaitSeconds * 1000;
        })
        .sort((left, right) => Number(left.refreshAt) - Number(right.refreshAt));
      if (soonToRefresh.length) return soonToRefresh[0];
      const ready = eligible.filter((target) => {
        const refreshAt = validRefreshAt(target.refreshAt);
        return refreshAt !== null && refreshAt <= now;
      });
      if (ready.length) return ready[0];
      const RECHECK_COOLDOWN_MS = 3 * 60 * 1000;
      const unknown = eligible.filter((target) => {
        if (validRefreshAt(target.refreshAt) !== null) return false;
        const lastChecked = Number(state.lastCheckedAt[target.id]) || 0;
        return now - lastChecked > RECHECK_COOLDOWN_MS;
      });
      if (unknown.length) return unknown[0];
      return null;
    }

    function chooseInstanceIntent(snapshot, module) {
      const now = Number(snapshot.at) || Date.now();
      const attackable = getAttackableTargets(module, now);
      if (attackable.length) {
        const target = selectInstanceTarget(attackable, snapshot);
        return intentForTarget(target, module, snapshot);
      }
      // 本副本 BOSS 状态未知 → 先 scan 判空
      if (needMapScan(snapshot, module)) {
        return makeIntent('scan_map', null, 'scan instance for boss presence', 'open_map_scan', 0.85);
      }
      // scan 后确认无 BOSS → 写副本空场冷却 + 退出
      setInstanceCheckCooldown(module.id, now + state.config.instanceEmptyCooldownMs);
      return makeIntent('exit_instance', null, 'no boss in instance, cooldown set', 'exit_instance', 0.85);
    }

    function chooseWildIntent(snapshot, module) {
      const now = Number(snapshot.at) || Date.now();
      // 优先:实例模块可进
      const instances = MAP_MODULES
        .filter((m) => m.type === 'instance' && isModuleEnabled(m))
        .sort((a, b) => effectiveModulePriority(b) - effectiveModulePriority(a));
      for (const instModule of instances) {
        if (shouldEnterInstance(instModule, snapshot, now)) {
          state.currentModuleId = instModule.id;
          return makeIntent('enter_instance', null, instModule.id + ' has boss', 'enter_instance', 0.92);
        }
      }
      // 本野外地图 BOSS
      if (!isMapRateLow(module.mapName)) {
        const candidate = selectHighestPriorityTarget(snapshot, module);
        if (candidate) return intentForTarget(candidate, module, snapshot);
      }
      // farming
      resetOwnerObservation();
      if (isAlreadyFarming(snapshot)) return makeIntent('safe_wait', null, 'no boss work - already farming', 'none', 0.8);
      return makeIntent('travel_farm', null, 'no boss work', 'click_farm_target', 0.8);
    }

    function chooseUnknownMapIntent(snapshot) {
      const now = Number(snapshot.at) || Date.now();
      // 优先:实例模块可进(经挑战 BOSS 面板,不需要先传送野外)
      const instances = MAP_MODULES
        .filter((m) => m.type === 'instance' && isModuleEnabled(m))
        .sort((a, b) => effectiveModulePriority(b) - effectiveModulePriority(a));
      for (const instModule of instances) {
        if (shouldEnterInstance(instModule, snapshot, now)) {
          state.currentModuleId = instModule.id;
          return makeIntent('enter_instance', null, instModule.id + ' has boss', 'enter_instance', 0.92);
        }
      }
      // 否则:传送回优先级最高的野外模块
      const wildModule = selectHighestPriorityWildModule(snapshot);
      if (wildModule) {
        state.currentModuleId = wildModule.id;
        return makeIntent('teleport_to_module', null, 'go to wild map: ' + wildModule.id, 'teleport_wild', 0.85);
      }
      // 兜底:传送四风平原(默认)
      const fw = moduleById('four_winds');
      state.currentModuleId = fw ? fw.id : 'four_winds';
      return makeIntent('teleport_to_module', null, 'fallback to four winds', 'teleport_wild', 0.8);
    }

    function selectHighestPriorityWildModule(snapshot) {
      const now = Number(snapshot.at) || Date.now();
      const wilds = MAP_MODULES
        .filter((m) => m.type === 'wild' && isModuleEnabled(m))
        .sort((a, b) => effectiveModulePriority(b) - effectiveModulePriority(a));
      // 优先选有可打 BOSS 的野外图
      for (const m of wilds) {
        if (!isMapRateLow(m.mapName)) {
          const attackable = getAttackableTargets(m, now);
          if (attackable.length) return m;
        }
      }
      // 否则默认四风平原
      return wilds.find((m) => m.id === 'four_winds') || wilds[0] || null;
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
      } else if (state.enterInstanceCtx) {
        intent = makeIntent('enter_instance', state.enterInstanceCtx.selectedBossId || null,
          'entering instance: ' + state.enterInstanceCtx.phase, 'enter_instance', 0.95);
      } else if (state.exitInstanceCtx) {
        intent = makeIntent('exit_instance', null,
          'exiting instance: ' + state.exitInstanceCtx.phase, 'exit_instance', 0.95);
      } else if (state.teleportCtx) {
        intent = makeIntent('teleport_to_module', null,
          'teleporting to module: ' + state.teleportCtx.phase, 'teleport_wild', 0.95);
      } else if (needRateCheck(snapshot)) {
        resetOwnerObservation();
        intent = makeIntent('check_rate', null, 'boss rate check due', 'check_boss_rate', 0.96);
      } else if (hasLockedValidTarget(snapshot)) {
        intent = intentForLockedTarget(snapshot);
      } else {
        const mapName = (snapshot.scene || {}).mapName || '';
        const currentModule = moduleByMapName(mapName);
        if (currentModule && currentModule.type === 'instance') {
          intent = chooseInstanceIntent(snapshot, currentModule);
        } else if (currentModule && currentModule.type === 'wild') {
          intent = chooseWildIntent(snapshot, currentModule);
        } else {
          intent = chooseUnknownMapIntent(snapshot);
        }
      }

      // 爆率低优先级兜底
      if (!intent || intent.type === 'safe_wait' || intent.type === 'disabled' || intent.type === 'sync') {
        const currentMapName = (snapshot && snapshot.scene || {}).mapName || '';
        const currentModule = moduleByMapName(currentMapName);
        if (currentModule && isMapRateLow(currentModule.mapName)) {
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

    // --- Tick loop (Task 5) ---

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
          return executeIntentPlaceholder(intent, snapshot);
        }
        return intent;
      } catch (error) {
        state.lastError = { at: Date.now(), message: error && error.message ? error.message : String(error) };
        appendLog('tick_error', { message: error && error.message ? error.message : String(error) });
        return null;
      }
    }

    function executeIntentPlaceholder(intent, snapshot) {
      // Task 6 会替换为真正 executeIntent
      appendLog('intent_placeholder', { type: intent && intent.type, reason: intent && intent.reason });
      return intent;
    }

    setupKeyboardToggle();
    scheduleTick();
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
