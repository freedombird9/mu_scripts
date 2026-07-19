// ==UserScript==
// @name         全民红月 - 多地图 BOSS 自动化 MVP
// @namespace    codex.mu.multi-map-boss-mvp
// @version      0.7.0
// @description  腐蚀之地 + 试炼之地1 + 苦难炼狱2 模块化自动打 BOSS。地图可插拔扩展。
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
    const KNOWN_MAP_NAMES = ['腐蚀之地', '试炼之地1', '苦难炼狱2', '勇者大陆', '幻术秘境4'];
    const CONFIG_DEFAULTS = Object.freeze({
      enabled: false,
      dryRun: true,
      ownerName: '普尔赫达',
      preWaitSeconds: 90,
      ownerObserveSeconds: 10,
      contestedCooldownMs: 5 * 60 * 1000,
      arrivalStallMs: 15 * 1000,
      travelTimeoutMs: 180 * 1000,
      farmTargetName: '1600级怪物',
      rateRecheckIntervalMs: 15 * 60 * 1000,
      trialPriorityWindowMs: 60 * 1000,
      enabledMaps: ['corrosion', 'trial_land', 'purgatory', 'accessory'],
      mapPriorities: { corrosion: 10, trial_land: 20, purgatory: 30, accessory: 40 },
      enabledBosses: ['hell-knight-1','hell-knight-2','lobster-1','lobster-2','lobster-3','magic-crystal','phantom-giant'],
     purgatoryMapChoice: '苦难炼狱2',
     instanceEmptyCooldownMs: 15 * 60 * 1000,
      scheduledHour: 0,
      scheduledMinute: 30,
      scheduledStartAt: 0,
   });

    const corrosionModule = Object.freeze({
      id: 'corrosion',
      mapName: '腐蚀之地',
      type: 'wild',
      priority: 10,
      enabled: true,
      farmTarget: { name: '1600级怪物' },
      bossRowTab: '野外BOSS',
      bossRowScroll: null,
      enterButtonTog: null,
      enterButtonTextRegex: null,
      hasTaskbar: false,
      bosses: [
        { id: 'hell-knight-1', name: '地狱骑士', coordinate: '170,164' },
        { id: 'hell-knight-2', name: '地狱骑士', coordinate: '179,90' },
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
      // CDP 实测(2026-07-17):试炼之地 tab 下 BOSS 行实际在 wildlevelScroll(与野外 tab 共用),
      // 进入按钮也在 wildtog_mapName。之前 spec 探查误写为 privatelevelScroll/privatetog_mapName。
      bossRowScroll: 'wildlevelScroll',
      enterButtonTog: 'wildtog_mapName',
      enterButtonTextRegex: /^试炼之地1/,
      hasTaskbar: false,
      // 与 purgatory/accessory 一致:进副本后走 M 大地图点击右栏 BOSS 行导航。
      // 之前未设此 flag 走 executeInstanceTravel(只跟踪坐标变化),但游戏自动寻路只送
      // 第一只 BOSS,打完后切下一只时角色原地不动 → "稳定但远" 分支永不超时 →
      // 卡在 TRAVEL_BOSS 发呆。统一为大地图点击路径,与其它副本一致。
      instanceTravelClicksMap: true,
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
      // 与 accessory 一致:进副本后走 M 大地图点击导航,既能让 mu-boss-respawn-overlay
      // 抓取 BOSS 名-坐标信息,又统一两种副本逻辑便于复用。
      instanceTravelClicksMap: true,
      bosses: [
        // Task 0 项 2 探查:角色站墓碑旁亲自验证为 '149,101'(按钮上的 (126,95) 是按钮坐标,非 BOSS 坐标)
        { id: 'magic-crystal', name: '魔晶菲尼斯', coordinate: '149,101' },
      ],
    });

    const accessoryModule = Object.freeze({
      id: 'accessory',
      mapName: '幻术秘境4',
      type: 'instance',
      priority: 40,
      enabled: true,
      farmTarget: null,
      bossRowTab: '首饰BOSS',
      // TODO CDP 验证:首饰BOSS tab 下 BOSS 行 scroll 容器名(占位与 purgatory 一致)
      bossRowScroll: 'wildlevelScroll',
      enterButtonTog: 'wildtog_mapName',
      enterButtonTextRegex: /^幻术秘境4/,
      hasTaskbar: false,
      hasIntermediatePopup: true,
      intermediatePopupTitle: '卓越之境',         // TODO CDP 验证弹窗标题
      intermediatePopupButtonText: '进入',       // TODO CDP 验证按钮文字
      // 副本内 BOSS 导航:与 purgatory/trial_land 不同,幻术秘境4 需要点大地图右栏 BOSS 行
      // 触发游戏自动寻路(spec 原描述"完全与 purgatory 一致"不准确;CDP 探查发现该副本
      // 进副本后角色停在入口 126,118 不自动寻路,需手动点大地图)。
      instanceTravelClicksMap: true,
      bosses: [
        // CDP 探查(2026-07-17):幽灵巨人 BOSS 坐标 197,151(用户站在 BOSS 旁实测)
        { id: 'phantom-giant', name: '幽灵巨人', coordinate: '197,151' },
      ],
    });

    const MAP_MODULES = [corrosionModule, trialLandModule, purgatoryModule, accessoryModule];

    // Derived from MAP_MODULES; needed by scanMapPanel and scanCombat to filter BOSS rows
    // by known names. (Equivalent to reference script L50 `const TARGET_TABLE = TARGETS;`.)
    // Note: this is computed once at injection time. If MAP_MODULES were ever mutated at
    // runtime (it is not — Task 3 freezes it), this would go stale. Keep this constraint.
    const TARGET_TABLE = MAP_MODULES.flatMap((m) => m.bosses.map((b) => ({ id: b.id, name: b.name, coordinate: b.coordinate, mapName: m.mapName })));

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
      lastOwnBossCombatAt: 0,
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
      // instanceTravelClicksMap 模块专用:本次副本访问是否已开过 M 大地图。
      // 进副本时重置为 false;executeTravel 成功打开地图后置 true。
      // 用途:苦难炼狱地图小,角色可能在 enter_instance.waiting 期间就自动走到
      // BOSS 坐标,intentForTarget 直接走 hold/engage 跳过 travel_boss,导致
      // M 大地图从未打开,mu-boss-respawn-overlay 抓不到坐标。此 flag 强制
      // 先开一次大地图再允许 hold/engage。
      instanceMapOpened: false,
    };

    // --- Rate-check maps (Task 5) ---
    // 声明必须早于下方 rebuildRateCheckMaps() 调用,否则 const TDZ 会抛 ReferenceError。

    const RATE_URL_MAP = {
      'txt_bld': 'low',
      'txt_blz': 'medium',
      'txt_blg': 'high',
    };

    // Task 0 项 5 探查结论:BaolvIcon0 反映当前选中 BOSS 爆率(魔晶菲尼斯=txt_blg=high,地狱骑士=txt_bld=low)
    // → PURGATORY_RATE_CHECK_ENABLED = true,苦难炼狱纳入爆率检查
    const PURGATORY_RATE_CHECK_ENABLED = true;
    const ACCESSORY_RATE_CHECK_ENABLED = true;

    // RATE_CHECK_MAPS 从 MAP_MODULES 动态生成;在 state.config 初始化后调用 rebuildRateCheckMaps()
    const RATE_CHECK_MAPS = {};

    function rebuildRateCheckMaps() {
      for (const key in RATE_CHECK_MAPS) delete RATE_CHECK_MAPS[key];
      for (const module of MAP_MODULES) {
        if (!isModuleEnabled(module)) continue;
        // 跳过 Task 0 决定不做爆率检查的模块
        if (module.id === 'purgatory' && !PURGATORY_RATE_CHECK_ENABLED) continue;
        if (module.id === 'accessory' && !ACCESSORY_RATE_CHECK_ENABLED) continue;
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
        enabledMaps: mergeWithDefaults(source.enabledMaps, CONFIG_DEFAULTS.enabledMaps),
        mapPriorities: normalizeMapPriorities(source.mapPriorities),
        enabledBosses: mergeWithDefaults(source.enabledBosses, CONFIG_DEFAULTS.enabledBosses),
       purgatoryMapChoice: cleanText(source.purgatoryMapChoice) || CONFIG_DEFAULTS.purgatoryMapChoice,
       instanceEmptyCooldownMs: clampNumber(source.instanceEmptyCooldownMs, 60 * 1000, 24 * 60 * 60 * 1000, CONFIG_DEFAULTS.instanceEmptyCooldownMs),
        scheduledHour: clampNumber(source.scheduledHour, 0, 23, CONFIG_DEFAULTS.scheduledHour),
        scheduledMinute: clampNumber(source.scheduledMinute, 0, 59, CONFIG_DEFAULTS.scheduledMinute),
        scheduledStartAt: clampNumber(source.scheduledStartAt, 0, Date.now() + 7 * 24 * 3600 * 1000, CONFIG_DEFAULTS.scheduledStartAt),
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

    // mergeWithDefaults: 保留 source 中的项,并追加 CONFIG_DEFAULTS 中存在但 source 缺失的项。
    // 用于 enabledMaps/enabledBosses 升级兼容:旧 localStorage 缺新加的 module/boss 时自动补齐,
    // 用户用 setConfig 显式删掉的项仍会被加回(array schema 无法表达"关闭意图")。
    function mergeWithDefaults(sourceList, defaultList) {
      const source = Array.isArray(sourceList) ? sourceList.map(cleanText).filter(Boolean) : [];
      const out = source.slice();
      for (const item of defaultList) {
        if (!out.includes(item)) out.push(item);
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

    // --- Scheduled start (timer) ---

    // 计算 UTC+8 时区下,从 fromMs 起严格未来的最近一个 hour:minute:00 的时间戳。
    // 边界:恰好等于目标时刻算"已过",返回次日的(避免 tick 重复触发)。
    function computeNextScheduledStart(hour, minute, fromMs) {
      const base = fromMs || Date.now();
      const utc8Ms = base + 8 * 3600 * 1000;
      const utc8Date = new Date(utc8Ms);
      // "UTC+8 时区 D 日 00:00" 对应的 UTC 时间戳 = Date.UTC(D) - 8h
      let targetMs = Date.UTC(utc8Date.getUTCFullYear(), utc8Date.getUTCMonth(), utc8Date.getUTCDate())
                   + (hour * 3600 + minute * 60) * 1000
                   - 8 * 3600 * 1000;
      if (targetMs <= base) {
        targetMs += 24 * 3600 * 1000;
      }
      return targetMs;
    }

    function formatUtc8HHMM(ms) {
      const utc8Date = new Date(ms + 8 * 3600 * 1000);
      const hh = String(utc8Date.getUTCHours()).padStart(2, '0');
      const mm = String(utc8Date.getUTCMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    }

    function scheduleNextStart() {
      const at = computeNextScheduledStart(state.config.scheduledHour, state.config.scheduledMinute);
      state.config.scheduledStartAt = at;
      persist();
      appendLog('schedule_set', { at, hhmm: formatUtc8HHMM(at) });
      return at;
    }

    function cancelScheduledStart() {
      if (!state.config.scheduledStartAt) return false;
      state.config.scheduledStartAt = 0;
      persist();
      appendLog('schedule_canceled', {});
      return true;
    }

    // 到点触发:已开启则跳过 start(),只清空 scheduledStartAt;未开启则启动。
    function maybeFireSchedule() {
      const at = state.config.scheduledStartAt;
      if (!at || Date.now() < at) return false;
      state.config.scheduledStartAt = 0;
      persist();
      const alreadyRunning = state.config.enabled && !state.config.dryRun;
      if (alreadyRunning) {
        appendLog('schedule_skipped_already_running', { at });
        return true;
      }
      appendLog('schedule_fired', { at });
      if (window.__muMultiMapBossMvp && typeof window.__muMultiMapBossMvp.start === 'function') {
        window.__muMultiMapBossMvp.start();
      }
      showToast('定时启动');
      return true;
    }

    function setupSchedulerKey() {
      if (window.__muMultiMapBossScheduleKeyBound) return;
     window.__muMultiMapBossScheduleKeyBound = true;
     window.addEventListener('keydown', function (e) {
        if (e.ctrlKey && !e.shiftKey && (e.key === 'j' || e.key === 'J')) {
         e.preventDefault();
         e.stopPropagation();
          if (state.config.scheduledStartAt) {
            cancelScheduledStart();
            showToast('已取消定时启动');
          } else {
            const at = scheduleNextStart();
            showToast('已安排 ' + formatUtc8HHMM(at) + ' 开启');
          }
        }
      }, true);
    }

   // --- Scan functions ---

    function scanScene(nodes) {
      let mapName = '';
      // 首选:MiniMapPart 子树下的 mapName 节点(角色真实所在地图名)。
      // 不依赖 KNOWN_MAP_NAMES 过滤,避免挑战 BOSS 面板里的"幻术秘境4"等地图名文本
      // 被误判为 scene mapName(2026-07-17 CDP 探查发现:面板打开时 scanScene 误读
      // 面板顶部的地图名而非 minimap 的真实地图名,导致 enter_instance.waiting 阶段
      // 误判到达)。
      // 注:MiniMapPart 下的 mapName 在某些地图(如试炼之地)visible=false,仍要读。
      const minimapMapName = nodes
        .filter((item) => item.name === 'mapName' && item.path && item.path.indexOf('MiniMapPart') >= 0)
        .sort((a, b) => {
          if (a.effectiveVisible !== b.effectiveVisible) return a.effectiveVisible ? -1 : 1;
          return 0;
        })[0];
      if (minimapMapName) {
        mapName = cleanText(minimapMapName.contentText);
      }
      // Fallback:其他可见且文本在 KNOWN_MAP_NAMES 里的节点(用于 minimap mapName 读取失败的极端情况)
      if (!mapName) {
        const candidates = nodes
          .filter((item) => (item.effectiveVisible || item.name === 'mapName')
            && KNOWN_MAP_NAMES.includes(cleanText(item.contentText)))
          .sort((a, b) => {
            const aScore = (a.name === 'mapName' ? 1000 : 0) + (a.rect.x >= 900 && a.rect.y <= 130 ? 100 : 0);
            const bScore = (b.name === 'mapName' ? 1000 : 0) + (b.rect.x >= 900 && b.rect.y <= 130 ? 100 : 0);
            return bScore - aScore;
          });
        if (candidates.length) mapName = cleanText(candidates[0].contentText);
      }
      // Fallback 2:pattern match for trial land variants
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
      // 'bigBtn' > 'title' contains the map name (e.g. '腐蚀之地（4转）')
      // 'bigBtn' > 'title' contains the map name (e.g. '腐蚀之地（4转）')
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
      state.lastOwnBossCombatAt = 0;
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
      scheduleNext() {
        const at = scheduleNextStart();
        showToast('已安排 ' + formatUtc8HHMM(at) + ' 开启');
        return getStatus();
      },
      cancelSchedule() {
        const ok = cancelScheduledStart();
        showToast(ok ? '已取消定时启动' : '无定时安排');
        return getStatus();
      },
      setScheduleTime(h, m) {
        state.config.scheduledHour = clampNumber(h, 0, 23, CONFIG_DEFAULTS.scheduledHour);
        state.config.scheduledMinute = clampNumber(m, 0, 59, CONFIG_DEFAULTS.scheduledMinute);
        persist();
        appendLog('schedule_time_set', { hour: state.config.scheduledHour, minute: state.config.scheduledMinute });
        return getStatus();
      },
      getSchedule() {
        return {
          scheduledStartAt: state.config.scheduledStartAt,
          scheduledHour: state.config.scheduledHour,
          scheduledMinute: state.config.scheduledMinute,
          nextRunLocalString: state.config.scheduledStartAt ? formatUtc8HHMM(state.config.scheduledStartAt) : '',
        };
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
      const now = Number(snapshot.at) || Date.now();
      const rc = state.rateCheck;
      if (rc.phase !== 'idle') return true;
      if (state.navigationContext) return false;
      if (state.mapScanContext) return false;
      if (state.enterInstanceCtx) return false;
      if (state.exitInstanceCtx) return false;
      if (state.teleportCtx) return false;
      const autoBattle = snapshot && snapshot.autoBattle;
      if (autoBattle && autoBattle.enabled) return false;
      const sceneMap = snapshot && snapshot.scene && snapshot.scene.mapName;
      if (!sceneMap || !RATE_CHECK_MAPS[sceneMap]) return false;
      return getRateResult(sceneMap) === null;
    }

    function markRateCheckDone(result, mapName) {
      const now = Date.now();
      state.rateCheck.phase = 'idle';
      state.rateCheck.targetModuleId = '';
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

    const MAP_SCAN_COOLDOWN_MS = 60 * 1000;
    const MAP_SCAN_OPEN_WAIT_MS = 2000;
    // 修复 B: isInCombatWithOwnBoss 滑动窗口宽限期。HP 条瞬时闪烁/BOSS 切阶段时,
    //   距上次确认在打自己 BOSS 不超过此阈值仍视为在战斗, 防止跨模块抢占。
    const OWN_BOSS_COMBAT_GRACE_MS = 5 * 1000;

    function needMapScan(snapshot, module) {
      const now = Number(snapshot.at) || Date.now();
      if (state.mapScanContext) return true;
      if (state.navigationContext) return false;
      if (state.rateCheck.phase !== 'idle') return false;
      if (state.enterInstanceCtx || state.exitInstanceCtx || state.teleportCtx) return false;
      if (!module) return false;
      const eligible = state.targets.filter((target) =>
        target.moduleId === module.id
        && isBossEnabled(target)
        && !isCooling(target, now)
        && !isMapRateLow(module.mapName));
      if (!eligible.length) return false;
      const allUnknown = eligible.every((target) => validRefreshAt(target.refreshAt) === null);
      if (!allUnknown) return false;
      if (now - state.lastMapScanAt < MAP_SCAN_COOLDOWN_MS) return false;
      return true;
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
      if (state.currentIntent.type === 'engage' || state.currentIntent.type === 'observe_owner') {
        if (!target || isCooling(target, now)) {
          releaseLockedTarget();
          return false;
        }
        return true;
      }
      // 修复 A: 上面 engage/observe_owner 分支提前返回, 战斗保护只看 isCooling,
      //   不被 WAITING_REFRESH 状态释放锁定。原因: 战斗中 mu-boss-respawn-overlay
      //   抓到刷新时间会让 targetStatus 变 WAITING_REFRESH, 而 isLockTargetEligible
      //   的 allowedStatuses 不含 WAITING_REFRESH, 会误释放锁定, 导致下一 tick
      //   chooseIntent 落到 chooseWildIntent, 跨模块抢占战斗。
      if (state.currentAction === 'navigation_failed' || !isLockTargetEligible(target, now)) {
        releaseLockedTarget();
        return false;
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
      // 同名 BOSS(如 hell-knight-1/hell-knight-2 都叫"地狱骑士")在 HUD 上 targetName 不能区分,
      // 排除 lockedTarget 同名的其他 BOSS,避免 hold 期间被同名 BOSS 误判为可见可攻击
      // 而释放锁。不同名 BOSS 不受影响,仍能正常转火。
      const excludedTarget = state.targets.find((t) => t.id === excludedTargetId);
      const excludedName = excludedTarget ? excludedTarget.name : null;
      return state.targets.find((target) => target.id !== excludedTargetId
        && (!excludedName || target.name !== excludedName)
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

    // 判定当前 HUD 是否在打一个自己/无主的 BOSS:
    // HP 可见 > 0,targetName 在 TARGET_TABLE 内,归属为空或为自己。
    // 用于"战斗中不被 instance 副本抢占"守卫:只要正在打自己的 BOSS,就不进副本。
    // 归属他人时返回 false,允许放弃当前 BOSS 进副本。
    // 修复 B: 加滑动窗口兜底。HP 条瞬时闪烁(combat.hpPercent 一帧 null/0、BOSS 切阶段)
    //   会让瞬时判定失败, 此时若距上次确认在战斗 < OWN_BOSS_COMBAT_GRACE_MS 仍视为在战斗,
    //   避免 A 释放锁定那一 tick 恰好 HP 条闪烁, 让 shouldEnterInstance 通过而跨模块抢占。
    function isInCombatWithOwnBoss(snapshot) {
      const combat = snapshot && snapshot.combat;
      const now = Number(snapshot && snapshot.at) || Date.now();
      if (!combat || !hasVisibleHpBar(combat) || Number(combat.hpPercent) === 0) {
        // HP 条瞬时缺失: 滑动窗口兜底
        if (state.lastOwnBossCombatAt && now - state.lastOwnBossCombatAt < OWN_BOSS_COMBAT_GRACE_MS) {
          return true;
        }
        return false;
      }
      const targetName = cleanText(combat.targetName);
      if (!targetName) return false;
      if (!TARGET_TABLE.some((entry) => entry.name === targetName)) return false;
      const ownerName = cleanText(combat.ownerName);
      const own = !ownerName || ownerName === state.config.ownerName;
      if (own) state.lastOwnBossCombatAt = now;
      return own;
    }

    function isAtTarget(target, snapshot) {
      const scene = snapshot && snapshot.scene;
      if (!scene || scene.mapName !== target.mapName || !scene.coordinate) return false;
      if (target.coordinate === 'TBD') return false;
      return chebyshevDistance(scene.coordinate, target.coordinate) <= ARRIVAL_THRESHOLD;
    }

    function isAlreadyFarming(snapshot) {
      // 副本地图无 farming 点(只有 BOSS),直接返回 false。
      // 用 farmTarget != null 判定野外地图:当前只有腐蚀之地有 farmTarget,
      // 未来新增野外模块自动适配。
      const mapName = snapshot && snapshot.scene && snapshot.scene.mapName;
      if (mapName) {
        const module = moduleByMapName(mapName);
        if (!module || !module.farmTarget) return false;
      }
      if (!state.farmArrivedAt || !state.farmArrivedCoord) return false;
      if (state.navigationContext) return false;
      const autoBattle = snapshot && snapshot.autoBattle;
      if (autoBattle && autoBattle.enabled) {
        // 挂机开着但角色停在 BOSS 坐标(如打完 BOSS 原地打小怪)不算在 farming 点。
        // 不用 farmArrivedCoord 校验:farming 点有 3 个,点击大地图 farming 行随机去
        // 其中一个,farmArrivedCoord 是单值只记最近一次,跨点校验会误判。
        // BOSS 坐标固定已知,用"角色不在任一 BOSS 坐标附近"反推在 farming 点。
        const coord = snapshot && snapshot.scene && snapshot.scene.coordinate;
        if (coord && isNearAnyBossCoordinate(coord, snapshot.scene && snapshot.scene.mapName)) {
          state.farmLastSeenFarmingAt = 0;
          return false;
        }
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

    function isNearAnyBossCoordinate(coord, mapName) {
      return MAP_MODULES
        .filter((m) => !mapName || m.mapName === mapName)
        .flatMap((m) => m.bosses)
        .some((b) => b.coordinate && b.coordinate !== 'TBD'
          && chebyshevDistance(coord, b.coordinate) <= ARRIVAL_THRESHOLD);
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
      // 1.5 instanceTravelClicksMap 模块:本次副本未开过大地图 → 强制 travel_boss
      //     先开 M 大地图(让 overlay 抓坐标),再走 hold/engage。地图小/寻路快时
      //     角色可能在 enter_instance 期间已到位,没有此守卫会直接 hold 跳过开地图。
      if (module.instanceTravelClicksMap && !state.instanceMapOpened) {
        return makeIntent('travel_boss', target.id, 'force open map for overlay scan', 'click_boss_target', 0.9);
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
        // 守卫:正在打自己/无主的 BOSS → 不进副本。
        // 此分支只在锁错乱(lockedTarget 是其他 instance 模块 BOSS)时触发,
        // 正常战斗中 isInCombatWithOwnBoss=true 时拦截,释放锁重新选,避免传送走。
        if (isInCombatWithOwnBoss(snapshot)) {
          appendLog('enter_instance_blocked_by_combat', { targetId: target.id, combatName: cleanText(snapshot.combat.targetName) });
          releaseLockedTarget();
          return makeIntent('safe_wait', null, 'in combat with own boss, skip enter_instance', 'none', 0.5);
        }
        state.currentModuleId = module.id;
        return makeIntent('enter_instance', null, module.id + ' has boss, need enter', 'enter_instance', 0.95);
      }
      // 5. 已在正确地图但未到坐标 → travel_boss
      //    野外和副本统一:executeTravel 开 M 大地图点 BOSS 行导航(副本均设 instanceTravelClicksMap=true)
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
      // 守卫:正在打自己/无主的 BOSS → 不进副本。
      // 覆盖所有地图(野外 + 副本 + 未知),战斗中不被更高优先级 instance 模块抢占。
      // 归属他人时 isInCombatWithOwnBoss 返回 false,允许放弃当前 BOSS 进副本。
      if (isInCombatWithOwnBoss(snapshot)) return false;
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
        // 副本内:intentForTarget 已处理 atTarget→hold / visible→engage / 未到→travel_boss 三种情况。
        // 副本均设 instanceTravelClicksMap=true,travel_boss 走开 M 大地图点 BOSS 行导航。
        // 不主动 scan_map,因为副本内 BOSS 信息只能靠 overlay,scan 会让大地图卡开不关。
        const target = selectInstanceTarget(attackable, snapshot);
        return intentForTarget(target, module, snapshot);
      }
      // 本副本 BOSS 状态未知 → 先 scan 判空(scan_map 内部 60s cooldown 防频繁)
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
      // 兜底:传送腐蚀之地(默认)
      const fw = moduleById('corrosion');
      state.currentModuleId = fw ? fw.id : 'corrosion';
      return makeIntent('teleport_to_module', null, 'fallback to corrosion', 'teleport_wild', 0.8);
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
      // 否则默认腐蚀之地
      return wilds.find((m) => m.id === 'corrosion') || wilds[0] || null;
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
       // 定时启动检查:放在 tick 最前,disabled 状态也能触发。
       maybeFireSchedule();
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

    // --- executeIntent: main dispatch (Task 6) ---

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
        case 'hold': result = executeHold(intent, snapshot); break;
        case 'engage': result = executeEngage(intent, snapshot); break;
        case 'observe_owner': result = executeObserveOwner(intent, snapshot); break;
        case 'check_rate': result = executeCheckRate(intent, snapshot); break;
        case 'scan_map': result = executeScanMap(intent, snapshot); break;
        case 'enter_instance': result = executeEnterInstance(intent, snapshot); break;
        case 'exit_instance': result = executeExitInstance(intent, snapshot); break;
        case 'teleport_to_module': result = executeTeleportToModule(intent, snapshot); break;
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

    // --- Z key / auto-battle safety net (Task 6) ---

    function ensureZKey(snapshot) {
      const now = Date.now();
      const autoBattle = snapshot.autoBattle;

      if (autoBattle && autoBattle.enabled) {
        state.zKeyRetryCount = 0;
        return { ok: true, reason: 'auto_battle_enabled' };
      }

      if (!state.arrivalConfirmedAt) return { ok: true, reason: 'not_arrived_yet' };

      if (now - state.arrivalConfirmedAt < 1500) return { ok: true, reason: 'waiting_post_arrival' };

      if (state.zKeySentAt && now - state.zKeySentAt > 15000) {
        state.zKeyRetryCount = 0;
      }

      if (now - state.zKeySentAt < 5000) return { ok: true, reason: 'z_key_throttled' };

      if (toggleAutoFight()) {
        state.zKeySentAt = now;
        state.zKeyRetryCount++;
        appendLog('z_key_sent', { method: 'laya_keydown', retry: state.zKeyRetryCount });
        return { ok: true, method: 'laya_keydown', reason: 'z_key_sent' };
      }

      state.zKeyRetryCount++;
      return { ok: true, reason: 'z_key_pending' };
    }

    function toggleAutoFight() {
      try {
        if (typeof Laya === 'undefined' || !Laya.stage || !Laya.stage._events || !Laya.stage._events.keydown) return false;
        const ev = new Laya.Event();
        ev.type = Laya.Event.KEYDOWN;
        ev.keyCode = 90;
        ev.nativeEvent = { keyCode: 90, key: 'z', code: 'KeyZ', preventDefault: function(){}, stopPropagation: function(){} };
        ev.target = Laya.stage;
        ev.currentTarget = Laya.stage;
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

    function ensureAutoBattle(snapshot) {
      if (snapshot.autoBattle && snapshot.autoBattle.enabled) {
        state.zKeyRetryCount = 0;
        return { ok: true, reason: 'already_enabled' };
      }
      const zResult = ensureZKey(snapshot);
      if (zResult.ok) {
        return { ok: true, reason: 'z_key_safety_net: ' + zResult.reason };
      }
      return { ok: true, reason: 'z_key_safety_net_failed: ' + zResult.reason };
    }

    // --- Hold / Engage / ObserveOwner (Task 6) ---

    function executeHold(intent, snapshot) {
      const target = targetById(intent.targetId);
      if (!target) return { ok: false, reason: 'hold_target_missing' };
      if (!isAtTarget(target, snapshot)) {
        return { ok: false, reason: 'not_at_coordinate' };
      }
      // 清理泄漏的 navigationContext:角色可能在 travel_boss 的 checkNavProgress
      // 运行前就到位(isAtTarget=true),此时 navContext 未被正常清理。hold 属于
      // locking intent,applyIntent 不会清它,这里兜底。
      if (state.navigationContext) {
        appendLog('hold_nav_context_leak_clear', { targetId: intent.targetId });
        state.navigationContext = null;
      }
      if (!state.arrivalConfirmedAt) {
        state.arrivalConfirmedAt = Date.now();
      }
      const result = ensureAutoBattle(snapshot);
      if (!result.ok && result.reason === 'auto_battle_state_unknown') {
        appendLog('auto_battle_state_unknown', { targetId: intent.targetId, coordinate: snapshot.scene.coordinate });
      }
      return result;
    }

    function executeEngage(intent, snapshot) {
      // 大地图可能还开着:isVisibleAndAttackable 不检查地图状态,BOSS 在 HUD 可见
      // 且 HP>0 时 intent 可从 travel_boss 直接跳 engage,此时 M 大地图仍打开。
      // 先关掉,下一 tick 再继续,避免违反单面板约束。
      if (snapshot.mapPanel && snapshot.mapPanel.open) {
        const closeResult = closeMapPanel(snapshot);
        appendLog('engage_closing_leftover_map', { targetId: intent.targetId, reason: closeResult.reason });
        return { ok: true, reason: 'closing_leftover_map' };
      }
      // 清理泄漏的 navigationContext(同 executeHold 理由)。
      if (state.navigationContext) {
        appendLog('engage_nav_context_leak_clear', { targetId: intent.targetId });
        state.navigationContext = null;
      }
      const result = ensureAutoBattle(snapshot);
      if (!result.ok && result.reason === 'auto_battle_state_unknown') {
        appendLog('auto_battle_state_unknown', { targetId: intent.targetId });
      }
      return result;
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

    // --- Panel helpers (Task 6) ---

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

    function ensureMapReady(snapshot, ctx, contentReady, label) {
      const now = Date.now();
      const RENDER_WAIT_MS = 5000;

      if (snapshot.mapPanel.open) {
        if (!ctx.mapOpenedAt) ctx.mapOpenedAt = now;
        if (contentReady(snapshot)) {
          ctx.reopenClicked = false;
          return { ok: true, reason: 'ready' };
        }
        if (now - ctx.mapOpenedAt < RENDER_WAIT_MS) {
          return { ok: true, reason: 'waiting_for_content' };
        }
        if (!ctx.reopenClicked) {
          closePanelIfExists('MapDetialWnd');
          ctx.reopenClicked = true;
          ctx.mapOpenedAt = 0;
          appendLog(label + '_map_reopen_for_retry', {});
          return { ok: true, reason: 'map_reopen_for_retry' };
        }
        appendLog(label + '_map_give_up', {});
        return { ok: false, reason: 'map_give_up' };
      }

      const result = clickOpenMapButton(snapshot);
      if (result.ok) {
        ctx.mapOpenedAt = 0;
        ctx.reopenClicked = false;
        return { ok: true, reason: 'waiting_for_open' };
      }
      return { ok: false, reason: result.reason };
    }

    // --- Navigation (travel_boss / travel_farm) (Task 6) ---

    function executeTravel(intent, snapshot, kind) {
      const now = Date.now();
      const targetKey = intent.targetId || 'farm';
      let navCtx = state.navigationContext;
      const isSameNav = navCtx && navCtx.kind === kind && navCtx.targetId === targetKey;

      if (snapshot.bossChallengePanel && snapshot.bossChallengePanel.open) {
        closePanelIfExists('Instance_BossUI');
        return { ok: true, reason: 'closing_blocking_panel' };
      }

      // 所有 instance 副本(trial_land/purgatory/accessory)均标记 instanceTravelClicksMap=true,
      // 统一走"开 M 大地图 → 点右栏 BOSS 行 → 游戏自动寻路 → checkNavProgress 跟踪到达"流程。
      // 旧 executeInstanceTravel(只跟踪坐标、不点大地图)已废弃:游戏自动寻路只送第一只
      // BOSS,打完后切下一只时角色原地不动,"稳定但远"分支永不超时导致卡死发呆。
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

      if (navCtx.clicked) {
        if (snapshot.mapPanel.open) {
          if (navCtx.closeClicked) return { ok: true, reason: 'waiting_map_close' };
          return closeMapPanel(snapshot);
        }
        return checkNavProgress(navCtx, snapshot, intent, kind, now);
      }

      const contentReady = (snap) => {
        if (kind === 'boss') {
          const t = targetById(intent.targetId);
          if (!t) return false;
          const rows = snap.mapPanel.bossTargets || [];
          return Boolean(rows.find((r) => r.name === t.name)
            || rows.find((r) => r.targetId === intent.targetId));
        }
        return Boolean(snap.mapPanel.farmTarget);
      };

      const mapResult = ensureMapReady(snapshot, navCtx, contentReady, 'travel');
      if (!mapResult.ok) {
        appendLog('travel_give_up', { kind, targetId: targetKey, reason: mapResult.reason });
        // give-up 也标记已开过,避免反复重试开图卡死;overlay 可能已在重开期间扫到。
        if (kind === 'boss') state.instanceMapOpened = true;
        state.navigationContext = null;
        releaseLockedTarget();
        return { ok: false, reason: 'target_row_render_timeout' };
      }
      if (mapResult.reason !== 'ready') {
        return mapResult;
      }
      // 大地图已开且内容就绪:overlay 可扫描,标记本次副本已开过图。
      if (kind === 'boss') state.instanceMapOpened = true;

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

    // --- scan_map (Task 6) ---

    function executeScanMap(intent, snapshot) {
      const now = Date.now();
      const ctx = state.mapScanContext;

      if (!ctx) {
        state.mapScanContext = { startedAt: now, opened: false, closeClicked: false, openedAt: 0 };
        appendLog('map_scan_start', {});
      }

      const scan = state.mapScanContext;

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

    // --- check_rate (Task 6) ---

    function executeCheckRate(intent, snapshot) {
      const now = Date.now();
      const rc = state.rateCheck;
      const panel = snapshot.bossChallengePanel;

      if (rc.phase !== 'idle' && now - rc.startedAt > 60 * 1000) {
        appendLog('rate_check_timeout', { phase: rc.phase, elapsed: now - rc.startedAt });
        markRateCheckDone('unknown', rc.targetModuleId);
        return { ok: false, reason: 'rate_check_timeout' };
      }

      if (rc.phase === 'idle') {
        const sceneMap = (snapshot.scene || {}).mapName || '';
        rc.targetModuleId = sceneMap;
        rc.phase = 'closing_map';
        rc.startedAt = now;
        rc.lastActionAt = 0;
        appendLog('rate_check_start', { targetMap: sceneMap });
      }

      const MIN_ACTION_GAP = 800;
      if (now - rc.lastActionAt < MIN_ACTION_GAP) {
        return { ok: true, reason: 'rate_throttled' };
      }

      const rateMap = rc.targetModuleId ? RATE_CHECK_MAPS[rc.targetModuleId] : null;
      if (!rateMap) {
        appendLog('rate_check_no_map_config', { targetMap: rc.targetModuleId });
        markRateCheckDone('unknown', rc.targetModuleId);
        return { ok: false, reason: 'no_rate_check_map' };
      }

      switch (rc.phase) {
        case 'closing_map': {
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
              markRateCheckDone('unknown', rc.targetModuleId);
              rc.phase = 'closing';
              rc.lastActionAt = now;
              return { ok: true, reason: 'rate_unknown_timeout' };
            }
            return { ok: true, reason: 'rate_not_ready' };
          }
          appendLog('rate_detected', { rate, url: rateUrl, mapName: rc.targetModuleId });
          markRateCheckDone(rate, rc.targetModuleId);
          rc.phase = 'closing';
          rc.lastActionAt = now;
          return { ok: true, reason: 'rate_read: ' + rate };
        }

        case 'closing': {
          if (!panel || !panel.open) {
            rc.phase = 'idle';
            rc.lastActionAt = now;
            return { ok: true, reason: 'panel_already_closed' };
          }
          const result = closePanelIfExists('Instance_BossUI');
          rc.lastActionAt = now;
          appendLog('rate_check_closed_panel', { reason: result.reason });
          return { ok: true, reason: 'panel_closing' };
        }

        default:
          rc.phase = 'idle';
          return { ok: false, reason: 'unknown_rate_phase' };
      }
    }

    // --- enter_instance / exit_instance / teleport_to_module (Task 7) ---

    // --- Intermediate popup helpers (accessory module) ---
    // CDP 探查(2026-07-17)结论:"卓越之境"弹窗 packageName=Instance_BossHouseUI,
    // frame 节点的 title 子节点文本是"卓越之境";弹窗内"进入"按钮 name=btnEnter,
    // pkg=btnShort3。helper 用精确 packageName + name 匹配,文本兜底。
    function findIntermediatePopup(nodes, module) {
      if (!nodes || !module || !module.intermediatePopupTitle) return null;
      const title = module.intermediatePopupTitle;
      // 精确匹配:packageName=Instance_BossHouseUI 的弹窗根节点
      const exact = nodes.find((item) => item.effectiveVisible
        && (item.packageName === 'Instance_BossHouseUI' || item.name === 'Instance_BossHouseUI'));
      if (exact) return exact;
      // 兜底:文本含标题文本且看起来像弹窗
      const fallback = nodes.find((item) => item.effectiveVisible
        && (item.name === 'AlertWnd' || /Alert|Popup|Tip|Wnd/i.test(item.name || ''))
        && (cleanText(item.text).includes(title) || cleanText(item.contentText).includes(title)));
      return fallback || null;
    }

    // CDP 探查:弹窗内"进入"按钮 name=btnEnter, pkg=btnShort3。精确 name 优先,
    // 文本含按钮文字 + btn 前缀作兜底。
    function findPopupEnterButton(popupChildren, module) {
      if (!popupChildren || !module || !module.intermediatePopupButtonText) return null;
      const buttonText = module.intermediatePopupButtonText;
      // 精确匹配:name=btnEnter
      const exact = popupChildren.find((item) => item.effectiveVisible
        && item.name === 'btnEnter');
      if (exact) return exact;
      // 兜底:text/contentText 含按钮文字且 name 以 btn/button 开头
      const candidate = popupChildren.find((item) => item.effectiveVisible
        && (cleanText(item.text).includes(buttonText) || cleanText(item.contentText).includes(buttonText))
        && /^(btn|button)/i.test(item.name || ''));
      return candidate || null;
    }

    function executeEnterInstance(intent, snapshot) {
      const now = Date.now();
      if (!state.enterInstanceCtx) {
        // Recover target module from state.currentModuleId or currentTargetId
        const moduleId = state.currentModuleId;
        let targetModule = moduleId ? moduleById(moduleId) : null;
        if (!targetModule) {
          // Fallback: try from currentTargetId
          const target = state.currentTargetId ? targetById(state.currentTargetId) : null;
          targetModule = target ? moduleById(target.moduleId) : null;
        }
        if (!targetModule) {
          // Last fallback: first instance module that shouldEnterInstance
          const inst = MAP_MODULES.find((m) => m.type === 'instance' && shouldEnterInstance(m, snapshot, now));
          if (!inst) return { ok: false, reason: 'no instance to enter' };
          targetModule = inst;
        }
        state.enterInstanceCtx = {
          moduleId: targetModule.id,
          phase: 'closing_panels',
          startedAt: now,
          selectedBossId: state.currentTargetId || null,
          lastActionAt: 0,
          retried: false,
        };
        appendLog('enter_instance_start', { moduleId: state.enterInstanceCtx.moduleId });
      }

      const ctx = state.enterInstanceCtx;
      const currentModule = moduleById(ctx.moduleId);
      if (!currentModule) {
        state.enterInstanceCtx = null;
        return { ok: false, reason: 'module_missing: ' + ctx.moduleId };
      }

      if (now - ctx.startedAt > 60 * 1000) {
        appendLog('enter_instance_timeout', { phase: ctx.phase, elapsed: now - ctx.startedAt });
        closePanelIfExists('Instance_BossUI');
        closePanelIfExists('MapDetialWnd');
        state.enterInstanceCtx = null;
        releaseLockedTarget();
        return { ok: false, reason: 'enter_instance_timeout' };
      }

      const MIN_ACTION_GAP = 800;
      if (now - ctx.lastActionAt < MIN_ACTION_GAP) {
        return { ok: true, reason: 'enter_instance_throttled' };
      }

      const panel = snapshot.bossChallengePanel;

      switch (ctx.phase) {
        case 'closing_panels': {
          const closeResult = closePanelIfExists('MapDetialWnd');
          closePanelIfExists('Instance_BossUI');
          ctx.phase = 'opening';
          ctx.lastActionAt = now;
          appendLog('enter_instance_panels_closed', { reason: closeResult.reason });
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
          appendLog('enter_instance_opened_panel', { method: action.method });
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
            appendLog('enter_instance_panel_open_retry', {});
            return { ok: true, reason: 'panel_open_timeout_retry' };
          }
          return { ok: true, reason: 'waiting_for_panel_open' };
        }

        case 'select_tab': {
          if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
          if (panel.selectedTab === currentModule.bossRowTab) {
            ctx.phase = 'select_boss';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'tab_already_selected' };
          }
          const tab = panel.tabs.find((t) => t.text === currentModule.bossRowTab);
          if (!tab) return { ok: false, reason: 'tab_not_found:' + currentModule.bossRowTab };
          const fresh = readSnapshot();
          const freshPanel = fresh.bossChallengePanel;
          if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
          const freshTab = freshPanel.tabs.find((t) => t.text === currentModule.bossRowTab);
          if (!freshTab) return { ok: false, reason: 'tab_vanished' };
          const node = findNodeByPath(root(), freshTab.sourcePath);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'tab_node_unavailable' };
          const action = activateNode(node);
          if (!action.ok) return { ok: false, reason: action.reason };
          ctx.lastActionAt = now;
          appendLog('enter_instance_selected_tab', { method: action.method, tab: currentModule.bossRowTab });
          return { ok: true, method: action.method, reason: 'tab_selected' };
        }

        case 'select_boss': {
          if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
          const now2 = Date.now();
          const attackable = getAttackableTargets(currentModule, now2);
          if (!attackable.length) {
            appendLog('enter_instance_no_attackable', { moduleId: currentModule.id });
            state.enterInstanceCtx = null;
            return { ok: false, reason: 'no_attackable_boss' };
          }
          const candidate = selectInstanceTarget(attackable, snapshot);
          if (!candidate) return { ok: false, reason: 'no_selectable_boss' };
          ctx.selectedBossId = candidate.id;
          state.currentTargetId = candidate.id;

          // Find boss row filtered by module.bossRowScroll
          const bossRow = panel.bossRows.find((r) => r.name === candidate.name
            && (!currentModule.bossRowScroll || r.scrollName === currentModule.bossRowScroll));
          if (!bossRow) return { ok: false, reason: 'boss_row_not_found' };
          const fresh = readSnapshot();
          const freshPanel = fresh.bossChallengePanel;
          if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
          const freshRow = freshPanel.bossRows.find((r) => r.name === candidate.name
            && (!currentModule.bossRowScroll || r.scrollName === currentModule.bossRowScroll));
          if (!freshRow) return { ok: false, reason: 'boss_row_vanished' };
          const node = findNodeByPath(root(), freshRow.sourcePath);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'boss_row_node_unavailable' };
          const action = activateNode(node);
          if (!action.ok) return { ok: false, reason: action.reason };
          ctx.lastActionAt = now;
          appendLog('enter_instance_selected_boss', { bossName: candidate.name, moduleId: currentModule.id });
          // 爆率检查:若该模块纳入 RATE_CHECK_MAPS,选完 BOSS 后先读 BaolvIcon0,
          // low 则跳过该模块(走下一个 intent),非 low 则进副本后不再重复 check_rate。
          ctx.phase = RATE_CHECK_MAPS[currentModule.mapName] ? 'read_rate' : 'click_enter';
          return { ok: true, method: action.method, reason: 'boss_selected' };
        }

        case 'read_rate': {
          if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
          // 点击 BOSS 行后 BaolvIcon0 可能下一帧才刷新,先读再决定
          const rateUrl = panel.rateIconUrl || '';
          const rateKey = rateUrl.split('/').pop() || '';
          const rate = RATE_URL_MAP[rateKey] || null;
          if (!rate) {
            // 8s 内等待图标刷新;超时降级为 unknown,不阻塞进入
            if (now - ctx.lastActionAt > 8 * 1000) {
              appendLog('enter_instance_rate_unknown_timeout', { moduleId: currentModule.id });
              markRateCheckDone('unknown', currentModule.mapName);
              ctx.phase = 'click_enter';
              ctx.lastActionAt = now;
              return { ok: true, reason: 'rate_unknown_proceed' };
            }
            return { ok: true, reason: 'rate_not_ready' };
          }
          appendLog('enter_instance_rate_detected', { rate, url: rateUrl, moduleId: currentModule.id });
          markRateCheckDone(rate, currentModule.mapName);
          if (rate === 'low') {
            // 爆率低:跳过该模块,关面板释放锁定,下一 tick 选下一个 intent
            appendLog('enter_instance_rate_low_skip', { moduleId: currentModule.id, mapName: currentModule.mapName });
            closePanelIfExists('Instance_BossUI');
            closePanelIfExists('MapDetialWnd');
            state.enterInstanceCtx = null;
            releaseLockedTarget();
            return { ok: false, reason: 'rate_low_skip' };
          }
          // 非 low:rateResults 已写入,getRateResult !== null → needRateCheck 返回 false,
          // 进副本后不会触发 check_rate,直接走 boss 导航
          ctx.phase = 'click_enter';
          ctx.lastActionAt = now;
          return { ok: true, reason: 'rate_ok: ' + rate };
        }

        case 'click_enter': {
          if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
          // Find enter button by module.enterButtonTog + module.enterButtonTextRegex
          const enterButtons = (panel.enterButtons || []).filter((b) =>
            (!currentModule.enterButtonTog || b.togName === currentModule.enterButtonTog)
            && currentModule.enterButtonTextRegex && currentModule.enterButtonTextRegex.test(b.text));
          if (!enterButtons.length) {
            appendLog('enter_instance_no_enter_button', { moduleId: currentModule.id });
            ctx.phase = 'waiting';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'no_enter_button_proceed_to_wait' };
          }
          const enterBtn = enterButtons[0];
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
          appendLog('enter_instance_clicked_enter', { text: enterBtn.text, method: action.method });
          ctx.phase = currentModule.hasIntermediatePopup ? 'waiting_for_intermediate' : 'waiting';
          return { ok: true, method: action.method, reason: 'enter_clicked' };
        }

        case 'waiting_for_intermediate': {
          const sceneMap = (snapshot.scene || {}).mapName || '';
          if (!sceneMap) return { ok: true, reason: 'waiting_for_teleport' };
          const gRoot = root();
          const allNodes = gRoot ? collectNodes(gRoot) : [];
          const popup = findIntermediatePopup(allNodes, currentModule);
          if (!popup) {
            if (now - ctx.lastActionAt > 10 * 1000) {
              if (!ctx.retried) {
                ctx.retried = true;
                ctx.phase = 'click_enter';
                ctx.lastActionAt = 0;  // 让下一 tick 节流通过后重新点 enter
                appendLog('intermediate_popup_timeout_retry', { moduleId: currentModule.id });
                return { ok: true, reason: 'retry_click_enter' };
              }
              appendLog('intermediate_popup_failed', { moduleId: currentModule.id });
              closePanelIfExists('Instance_BossUI');
              closePanelIfExists('MapDetialWnd');
              state.enterInstanceCtx = null;
              releaseLockedTarget();
              return { ok: false, reason: 'intermediate_popup_timeout' };
            }
            return { ok: true, reason: 'waiting_for_popup' };
          }
          ctx.phase = 'click_popup_enter';
          // lastActionAt 不重置:click_popup_enter 内 5s 超时基准沿用本时刻
          appendLog('intermediate_popup_appeared', { moduleId: currentModule.id });
          return { ok: true, reason: 'popup_detected' };
        }

        case 'click_popup_enter': {
          const gRoot = root();
          const allNodes = gRoot ? collectNodes(gRoot) : [];
          const popup = findIntermediatePopup(allNodes, currentModule);
          if (!popup) {
            // 弹窗消失(可能已被自动点击或加载抖动)
            ctx.phase = 'waiting_for_intermediate';
            ctx.lastActionAt = now;
            appendLog('popup_vanished_back_to_wait', { moduleId: currentModule.id });
            return { ok: true, reason: 'popup_vanished_back_to_wait' };
          }
          const popupChildren = descendantsOf(allNodes, popup).filter((item) => item.path !== popup.path);
          const btnNode = findPopupEnterButton(popupChildren, currentModule);
          if (!btnNode) {
            if (now - ctx.lastActionAt > 5 * 1000) {
              ctx.phase = 'waiting_for_intermediate';
              ctx.lastActionAt = now;
              appendLog('popup_enter_button_not_found_retry', { moduleId: currentModule.id });
              return { ok: true, reason: 'button_not_found_back_to_wait' };
            }
            return { ok: true, reason: 'waiting_for_button' };
          }
          const node = findNodeByPath(gRoot, btnNode.path);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'button_node_unavailable' };
          const action = activateNode(node);
          if (!action.ok) return { ok: false, reason: action.reason };
          ctx.lastActionAt = now;
          ctx.phase = 'waiting';
          appendLog('enter_instance_clicked_popup_enter', { method: action.method, moduleId: currentModule.id });
          return { ok: true, method: action.method, reason: 'popup_enter_clicked' };
        }

        case 'waiting': {
          const mapName = (snapshot.scene || {}).mapName || '';
          if (mapName === currentModule.mapName) {
            appendLog('enter_instance_arrived', { mapName, moduleId: currentModule.id });
            closePanelIfExists('Instance_BossUI');
            // 重置副本大地图访问标记:每次进副本清零,确保本次副本至少开一次大地图。
            state.instanceMapOpened = false;
            state.enterInstanceCtx = null;
            state.currentTargetId = ctx.selectedBossId || '';
            state.arrivalConfirmedAt = 0;
            state.zKeyRetryCount = 0;
            return { ok: true, reason: 'arrived_instance' };
          }
          if (panel && panel.open && now - ctx.lastActionAt > 3000) {
            return { ok: true, reason: 'waiting_for_teleport' };
          }
          return { ok: true, reason: 'waiting_for_teleport' };
        }

        default:
          state.enterInstanceCtx = null;
          return { ok: false, reason: 'unknown_enter_phase' };
      }
    }

    function executeExitInstance(intent, snapshot) {
      const now = Date.now();
      if (!state.exitInstanceCtx) {
        const currentMap = (snapshot.scene || {}).mapName || '';
        const module = moduleByMapName(currentMap) || MAP_MODULES.find((m) => m.type === 'instance' && m.mapName === currentMap);
        if (!module) {
          return { ok: false, reason: 'not_in_instance' };
        }
        state.exitInstanceCtx = {
          moduleId: module.id,
          phase: 'closing_panels',
          startedAt: now,
          lastActionAt: 0,
          retried: false,
        };
        appendLog('exit_instance_start', { moduleId: module.id });
      }

      const ctx = state.exitInstanceCtx;
      const module = moduleById(ctx.moduleId);
      if (!module) {
        state.exitInstanceCtx = null;
        return { ok: false, reason: 'module_missing' };
      }

      if (now - ctx.startedAt > 30 * 1000) {
        if (!ctx.retried) {
          ctx.retried = true;
          ctx.phase = 'closing_panels';
          ctx.startedAt = now;
          ctx.lastActionAt = 0;
          appendLog('exit_instance_retry_timeout', {});
          return { ok: true, reason: 'retry_pending' };
        }
        appendLog('exit_instance_failed_timeout', {});
        state.exitInstanceCtx = null;
        return { ok: false, reason: 'exit_instance_timeout' };
      }

      const mapName = (snapshot.scene || {}).mapName || '';
      if (mapName !== module.mapName) {
        appendLog('exit_instance_done', { mapName });
        state.exitInstanceCtx = null;
        return { ok: true, reason: 'exited_instance' };
      }

      const MIN_ACTION_GAP = 800;
      if (now - ctx.lastActionAt < MIN_ACTION_GAP) {
        return { ok: true, reason: 'exit_instance_throttled' };
      }

      const gRoot = root();
      const nodes = gRoot ? collectNodes(gRoot) : [];

      switch (ctx.phase) {
        case 'closing_panels': {
          const closeResult = closePanelIfExists('Instance_BossUI');
          closePanelIfExists('MapDetialWnd');
          ctx.phase = 'waiting_for_close';
          ctx.lastActionAt = now;
          appendLog('exit_instance_panels_closed', { reason: closeResult.reason });
          return { ok: true, reason: 'panels_closing' };
        }

        case 'waiting_for_close': {
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
            appendLog('exit_instance_close_retry', {});
            return { ok: true, reason: 'close_retry' };
          }
          return { ok: true, reason: 'waiting_for_panels_close' };
        }

        case 'click_exit': {
          // btnExit in Damage list (Task 0 项 3 verified: same as trial land)
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
          appendLog('exit_instance_clicked_exit', { method: action.method });
          return { ok: true, method: action.method, reason: 'exit_clicked' };
        }

        case 'confirm': {
          const alertNode = nodes.find((item) =>
            item.effectiveVisible && item.name === 'AlertWnd');
          if (!alertNode) {
            if (now - ctx.lastActionAt > 3000) {
              ctx.phase = 'click_exit';
              ctx.lastActionAt = now;
              appendLog('exit_instance_popup_timeout_retry', {});
              return { ok: true, reason: 'popup_not_found_retry' };
            }
            return { ok: true, reason: 'waiting_for_popup' };
          }
          const alertObj = findNodeByPath(gRoot, alertNode.path);
          if (!alertObj || !nodeIsEffectivelyVisible(alertObj)) {
            return { ok: false, reason: 'alert_node_unavailable' };
          }
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
          appendLog('exit_instance_confirmed', { method: 'params.rightCallback + hideImmediately' });
          return { ok: true, method: 'params.rightCallback', reason: 'confirmed' };
        }

        case 'waiting': {
          if (mapName !== module.mapName) {
            appendLog('exit_instance_arrived', { mapName });
            state.exitInstanceCtx = null;
            return { ok: true, reason: 'exited' };
          }
          return { ok: true, reason: 'waiting_for_exit' };
        }

        default:
          state.exitInstanceCtx = null;
          return { ok: false, reason: 'unknown_exit_phase' };
      }
    }

    function executeTeleportToModule(intent, snapshot) {
      const now = Date.now();
      let targetModule = state.teleportCtx ? moduleById(state.teleportCtx.moduleId) : null;
      if (!state.teleportCtx) {
        const moduleId = state.currentModuleId || 'corrosion';
        targetModule = moduleById(moduleId) || moduleById('corrosion');
        if (!targetModule) return { ok: false, reason: 'no_target_module' };
        state.teleportCtx = {
          moduleId: targetModule.id,
          phase: 'opening_map',
          startedAt: now,
          lastActionAt: 0,
          mapOpenedAt: 0,
          reopenClicked: false,
        };
        appendLog('teleport_start', { moduleId: targetModule.id });
      }

      const ctx = state.teleportCtx;
      const module = targetModule || moduleById(ctx.moduleId);
      if (!module) {
        state.teleportCtx = null;
        return { ok: false, reason: 'module_missing' };
      }

      if (now - ctx.startedAt > 60 * 1000) {
        appendLog('teleport_timeout', { phase: ctx.phase, elapsed: now - ctx.startedAt });
        closePanelIfExists('MapDetialWnd');
        state.teleportCtx = null;
        return { ok: false, reason: 'teleport_timeout' };
      }

      const MIN_ACTION_GAP = 800;
      if (now - ctx.lastActionAt < MIN_ACTION_GAP) {
        return { ok: true, reason: 'teleport_throttled' };
      }

      const mapName = (snapshot.scene || {}).mapName || '';
      if (mapName === module.mapName) {
        appendLog('teleport_arrived', { mapName });
        state.teleportCtx = null;
        state.farmArrivedAt = 0;
        state.farmArrivedCoord = '';
        return { ok: true, reason: 'arrived_module_map' };
      }

      switch (ctx.phase) {
        case 'opening_map': {
          const bossOpen = snapshot.bossChallengePanel && snapshot.bossChallengePanel.open;
          if (bossOpen) {
            closePanelIfExists('Instance_BossUI');
            ctx.lastActionAt = now;
            return { ok: true, reason: 'closing_blocking_panel' };
          }
          ctx.phase = 'select_map';
          ctx.lastActionAt = now;
          return { ok: true, reason: 'proceed_to_select_map' };
        }

        case 'select_map': {
          const contentReady = (snap) => {
            const entries = (snap.mapPanel && snap.mapPanel.mapEntries) || [];
            return entries.some((e) => cleanText(e.name) === module.mapName
              || cleanText(e.name).includes(module.mapName));
          };
          const mapResult = ensureMapReady(snapshot, ctx, contentReady, 'teleport');
          if (!mapResult.ok) {
            appendLog('teleport_give_up', { reason: mapResult.reason });
            state.teleportCtx = null;
            return { ok: false, reason: 'teleport_map_give_up' };
          }
          if (mapResult.reason !== 'ready') {
            return mapResult;
          }
          const fresh = readSnapshot();
          if (!fresh.mapPanel.open) {
            ctx.phase = 'opening_map';
            ctx.lastActionAt = now;
            return { ok: true, reason: 'map_closed_retry' };
          }
          const targetEntry = (fresh.mapPanel.mapEntries || []).find((e) =>
            cleanText(e.name) === module.mapName || cleanText(e.name).includes(module.mapName));
          if (!targetEntry) return { ok: false, reason: 'map_not_in_list: ' + module.mapName };
          const gRoot = root();
          const node = findNodeByPath(gRoot, targetEntry.sourcePath);
          if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'map_entry_node_unavailable' };
          const bigBtn = findBigBtnChild(gRoot, node);
          const clickTarget = bigBtn || node;
          const action = activateNode(clickTarget);
          if (!action.ok) return { ok: false, reason: action.reason };
          ctx.lastActionAt = now;
          ctx.phase = 'select_submap';
          appendLog('teleport_clicked_module', { method: action.method, module: module.id });
          return { ok: true, method: action.method, reason: 'module_clicked' };
        }

        case 'select_submap': {
          const gRoot = root();
          const allNodes = gRoot ? collectNodes(gRoot) : [];
          const listTree = allNodes.find((item) =>
            item.effectiveVisible && item.name === 'List_tree');
          if (!listTree) {
            if (now - ctx.lastActionAt > 3000) {
              ctx.phase = 'closing_map';
              ctx.lastActionAt = now;
              appendLog('teleport_submap_timeout', {});
              return { ok: true, reason: 'submap_not_found_retry' };
            }
            return { ok: true, reason: 'waiting_for_submap' };
          }
          const treeChildren = allNodes.filter((item) =>
            item.effectiveVisible && item.path !== listTree.path
            && item.path.startsWith(listTree.path + '/')
            && item.packageName === 'smallitemBtn');
          const targetSubItem = treeChildren.find((row) => {
            const kids = descendantsOf(allNodes, row).filter((item) => item.path !== row.path);
            const titleNode = kids.find((item) => item.name === 'title' && item.contentText);
            return titleNode && cleanText(titleNode.contentText) === module.mapName;
          });
          if (!targetSubItem) return { ok: false, reason: 'submap_not_found: ' + module.mapName };
          const subNode = findNodeByPath(gRoot, targetSubItem.path);
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
          if (mapName === module.mapName) {
            appendLog('teleport_arrived', { mapName });
            state.teleportCtx = null;
            state.farmArrivedAt = 0;
            state.farmArrivedCoord = '';
            return { ok: true, reason: 'arrived' };
          }
          return { ok: true, reason: 'waiting_for_teleport' };
        }

        default:
          state.teleportCtx = null;
          return { ok: false, reason: 'unknown_teleport_phase' };
      }
    }

   setupKeyboardToggle();
    setupSchedulerKey();

    // 加载时过期检查:超过 60s 的安排直接清空(避免重启后误触发);
    // 60s 内的留给 tick 第一帧触发(maybeFireSchedule 会处理)。
    (function reconcileScheduleOnLoad() {
      const at = state.config.scheduledStartAt;
      if (!at) return;
      const overdueMs = Date.now() - at;
      if (overdueMs > 60 * 1000) {
        state.config.scheduledStartAt = 0;
        persist();
        appendLog('schedule_expired', { at, overdueMs });
      }
    })();
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
