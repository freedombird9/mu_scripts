// ==UserScript==
// @name         全民红月 - BOSS 刷新倒计时浮层
// @namespace    codex.mu.boss.respawn.overlay
// @version      0.1.10
// @description  只读识别画面中已死亡 BOSS 的刷新倒计时,记录并在右侧浮层动态显示。
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

    const VERSION = '0.1.10';
    const STORAGE_KEY = 'mu_boss_respawn_overlay_records_v1';
    const COLLAPSED_KEY = 'mu_boss_respawn_overlay_collapsed_v1';
    const POSITION_KEY = 'mu_boss_respawn_overlay_position_v1';
    const CONFIG_KEY = 'mu_boss_respawn_overlay_config_v1';
    const SCAN_INTERVAL_MS = 500;
    const HIGHLIGHT_SECONDS = 90;
    const MERGE_REFRESH_WINDOW_MS = 15000;
    const RECENT_BOSS_NAME_TTL_MS = 10000;
    const EXPIRED_KEEP_MS = 30000;
    const MAX_RECORDS = 40;
    const BOSS_NAME_EXAMPLES = [
      '愤怒闪电巨人',
      '深渊咒怨魔王',
      '邪恶龙虾战士',
      '咆哮龙虾战士',
      '狂暴火焰巨人',
      '愤怒火焰巨人',
      '龙虾战士',
      '傲之煞',
      '闪电巨人',
      '火焰巨人',
      '幽灵巨人',
      '地狱骑士',
    ];
    const DEFAULT_CANDIDATES = ['傲之煞', '闪电巨人'];

    const state = {
      records: normalizeRecords(readJson(STORAGE_KEY, [])),
      config: normalizeConfig(readJson(CONFIG_KEY, defaultConfig())),
      collapsed: readBool(COLLAPSED_KEY, false),
      position: readPosition(),
      drag: null,
      overlayEl: null,
      bodyEl: null,
      statusEl: null,
      configEl: null,
      configOpen: false,
      configEditing: false,
      lastScanAt: 0,
      lastScanReason: 'waiting',
      scanCount: 0,
      lastDetected: [],
      recentBossName: null,
      dismissedRecords: {},
    };

    window.__muBossRespawnOverlay = {
      version: VERSION,
      scanNow,
      getRecords() {
        pruneRecords();
        return clone(state.records);
      },
      clearRecords() {
        state.records = [];
        persistRecords();
        renderOverlay();
        return [];
      },
      getConfig() {
        return clone(state.config);
      },
      setConfig(patch) {
        state.config = normalizeConfig({ ...state.config, ...(patch || {}) });
        persistConfig();
        renderOverlay();
        return clone(state.config);
      },
      setCandidates(names) {
        state.config = normalizeConfig({ ...state.config, candidates: names });
        persistConfig();
        state.records = state.records.filter((record) => shouldKeepExistingRecord(record));
        persistRecords();
        renderOverlay();
        return clone(state.config);
      },
      renameLatest(name) {
        return renameLatestRecord(name);
      },
      renameRecord(id, name) {
        return renameRecordById(id, name);
      },
      removeRecord(id) {
        return removeRecordById(id);
      },
      toggle() {
        state.collapsed = !state.collapsed;
        writeBool(COLLAPSED_KEY, state.collapsed);
        renderOverlay();
        return state.collapsed;
      },
      status() {
        return {
          version: VERSION,
          scanCount: state.scanCount,
          lastScanAt: state.lastScanAt,
          lastScanReason: state.lastScanReason,
          collapsed: state.collapsed,
          position: state.position ? { ...state.position } : null,
          config: clone(state.config),
          configEditing: state.configEditing,
          records: state.records.length,
          lastDetected: clone(state.lastDetected),
          recentBossName: state.recentBossName ? { ...state.recentBossName } : null,
        };
      },
      resetPosition() {
        state.position = null;
        writeJson(POSITION_KEY, null);
        if (state.overlayEl) {
          state.overlayEl.style.left = '';
          state.overlayEl.style.right = '8px';
          state.overlayEl.style.top = '220px';
        }
        return null;
      },
    };

    bootstrap();

    function bootstrap() {
      installEditingEventShield();
      setInterval(() => {
        scanNow();
        renderOverlay();
      }, SCAN_INTERVAL_MS);
      setInterval(renderOverlay, 1000);
      scanNow();
      renderOverlay();
    }

    function installEditingEventShield() {
      if (typeof window.addEventListener !== 'function') return;
      [
        'keydown',
        'keyup',
        'keypress',
        'beforeinput',
        'input',
        'paste',
        'copy',
        'cut',
        'compositionstart',
        'compositionupdate',
        'compositionend',
      ].forEach((type) => {
        window.addEventListener(type, shieldEditingEvent, true);
      });
    }

    function shieldEditingEvent(event) {
      if (!state.configEditing) return;
      if (!isConfigInputEvent(event)) return;
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }

    function scanNow() {
      state.scanCount += 1;
      state.lastScanAt = Date.now();
      const context = readContext();
      const candidates = scanSceneCountdowns();
      state.lastDetected = candidates.map((item) => ({
        text: item.text,
        seconds: item.seconds,
        sourcePath: item.sourcePath,
        score: item.score,
      }));

      if (!candidates.length) {
        state.lastScanReason = 'no visible scene countdown';
        pruneRecords();
        return [];
      }

      const records = candidates
        .map((candidate) => recordFromCandidate(candidate, context))
        .filter(Boolean);

      if (!records.length) {
        state.lastScanReason = 'countdown found but no configured candidate';
        pruneRecords();
        return [];
      }

      records.forEach(upsertRecord);
      pruneRecords();
      persistRecords();
      state.lastScanReason = `recorded ${records.length}`;
      return clone(records);
    }

    function readContext() {
      const bot = readBotSnapshot();
      const fgui = readFguiContext();
      const reliableBossName = cleanText(bot.combat.targetName || fgui.targetName || '');
      const bossNameSource = bot.combat.targetName ? 'muBossBot.combat' : (fgui.targetName ? 'fgui.combat' : '');
      const mapName = cleanText(bot.scene.mapName || fgui.mapName || '');
      if (reliableBossName && isConfiguredCandidate(reliableBossName)) {
        state.recentBossName = {
          name: reliableBossName,
          source: bossNameSource,
          mapName,
          at: Date.now(),
        };
      }
      const recent = state.recentBossName
        && Date.now() - Number(state.recentBossName.at) <= RECENT_BOSS_NAME_TTL_MS
        && sameKnownMap(mapName, state.recentBossName.mapName)
        && isConfiguredCandidate(state.recentBossName.name)
        ? state.recentBossName
        : null;
      const bossName = reliableBossName || (recent ? recent.name : '');
      return {
        bossName,
        bossNameSource: reliableBossName ? bossNameSource : (recent ? `recent.${recent.source}` : 'unknown'),
        mapName,
        mapSource: bot.scene.mapName ? 'muBossBot.scene' : (fgui.mapName ? 'fgui' : 'unknown'),
      };
    }

    function readBotSnapshot() {
      try {
        if (window.__muBossBot && typeof window.__muBossBot.scan === 'function') {
          const snapshot = window.__muBossBot.scan() || {};
          return {
            scene: snapshot.scene || {},
            combat: snapshot.combat || {},
          };
        }
      } catch (_) {
        return { scene: {}, combat: {} };
      }
      return { scene: {}, combat: {} };
    }

    function readFguiContext() {
      const out = {
        mapName: '',
        coordinates: '',
        targetName: '',
      };
      const root = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
      if (!root) return out;
      walkFgui(root, (node, effectiveVisible) => {
        const nodeText = firstCleanText(
          safeString(() => node.text),
          safeString(() => node.title)
        );
        const nodeName = cleanText(safeString(() => node.name));
        if (!out.mapName && nodeName === 'mapName') out.mapName = normalizeMapName(nodeText, nodeName);
        if (!effectiveVisible && nodeName !== 'mapName') return;
        const text = cleanText([nodeText, nodeName].filter(Boolean).join(' '));
        if (!text) return;
        if (!out.targetName && /Lv\s*\d+/.test(text)) out.targetName = extractBossName(text);
        if (!out.coordinates) out.coordinates = normalizeCoordinate(text);
        if (!out.mapName) out.mapName = normalizeMapName(text, '');
      }, true, 0);
      return out;
    }

    function scanSceneCountdowns() {
      const stage = window.Laya && window.Laya.stage;
      if (!stage) return [];
      const candidates = [];
      walkLaya(stage, (node, path, effectiveVisible, ancestors) => {
        if (!effectiveVisible) return;
        const text = firstCleanText(
          safeString(() => node.text),
          safeString(() => node._text),
          safeString(() => node.htmlText),
          safeString(() => node._htmlText)
        );
        const seconds = parseColonSeconds(text);
        if (seconds == null || seconds <= 0) return;
        const color = cleanText(safeString(() => node.color || node._color)).toLowerCase();
        if (color && color !== '#ff0000' && color !== '#dd201a') return;
        const names = [safeString(() => node.name), ...ancestors.map((item) => item.name)].join(' ');
        if (/textTimeCount|mainTipUIPanel|小怪|保护|btnAddTime/i.test(names)) return;

        const rect = globalRect(node);
        const fontSize = Number(node.fontSize || node._fontSize) || 0;
        let score = 0;
        if (color === '#ff0000') score += 120;
        if (fontSize >= 18) score += 60;
        if (rect.y >= 100 && rect.y <= 430) score += 80;
        if (rect.x >= 250 && rect.x <= 760) score += 60;
        if (/nameLayer/i.test(names)) score += 40;
        if (path.indexOf('stage/[0]') === 0 || path.indexOf('laya.stage/[0]') === 0) score += 30;
        if (rect.y > 500) score -= 200;
        candidates.push({
          text,
          seconds,
          sourcePath: path,
          rect,
          color,
          fontSize,
          score,
        });
      }, 'laya.stage', true, [], 0);
      return candidates.sort((a, b) => b.score - a.score || a.seconds - b.seconds).slice(0, 3);
    }

    function recordFromCandidate(candidate, context) {
      const observedAt = Date.now();
      const refreshAt = observedAt + candidate.seconds * 1000;
      const bossName = context.bossName || '未知BOSS';
      if (bossName !== '未知BOSS' && !isConfiguredCandidate(bossName)) return null;
      if (bossName === '未知BOSS' && !configuredCandidates().length) return null;
      const confidence = scoreRecordConfidence(candidate, context);
      if (confidence < 0.45) return null;
      const record = {
        id: recordKey({
          bossName,
          mapName: context.mapName,
          refreshAt,
        }),
        bossName,
        bossNameSource: context.bossNameSource,
        mapName: context.mapName,
        mapSource: context.mapSource,
        countdownText: candidate.text,
        detectedSeconds: candidate.seconds,
        observedAt,
        refreshAt,
        refreshAtText: formatClock(refreshAt),
        source: 'laya_scene_countdown',
        sourcePath: candidate.sourcePath,
        confidence,
      };
      if (isDismissedRecord(record)) return null;
      return record;
    }

    function scoreRecordConfidence(candidate, context) {
      let score = 0;
      if (context.bossName) score += 0.35;
      if (context.mapName) score += 0.15;
      if (candidate.score >= 200) score += 0.25;
      if (candidate.score >= 120) score += 0.1;
      if (candidate.score >= 300) score += 0.2;
      return Math.min(1, score);
    }

    function upsertRecord(next) {
      const existingIndex = findMergeableRecordIndex(next, state.records);
      if (existingIndex >= 0) {
        const prev = state.records[existingIndex];
        state.records[existingIndex] = {
          ...prev,
          ...next,
          id: prev.id || next.id,
          bossName: chooseBetterText(prev.bossName, next.bossName, '未知BOSS'),
          bossNameSource: next.bossName && next.bossName !== '未知BOSS' ? next.bossNameSource : prev.bossNameSource,
          mapName: chooseBetterText(prev.mapName, next.mapName, '未知地图'),
          mapSource: next.mapName ? next.mapSource : prev.mapSource,
          firstObservedAt: prev.firstObservedAt || prev.observedAt || next.observedAt,
          updatedAt: Date.now(),
        };
      } else {
        state.records.unshift({
          ...next,
          firstObservedAt: next.observedAt,
          updatedAt: Date.now(),
        });
      }
      state.records.sort((a, b) => Number(a.refreshAt || 0) - Number(b.refreshAt || 0));
      if (state.records.length > MAX_RECORDS) state.records = state.records.slice(0, MAX_RECORDS);
    }

    function pruneRecords() {
      const now = Date.now();
      state.records = normalizeRecords(state.records)
        .reduce((out, item) => {
          const existingIndex = findMergeableRecordIndex(item, out);
          if (existingIndex >= 0) {
            const prev = out[existingIndex];
            out[existingIndex] = {
              ...prev,
              ...item,
              id: prev.id || item.id,
              bossName: chooseBetterText(prev.bossName, item.bossName, '未知BOSS'),
              bossNameSource: item.bossName && item.bossName !== '未知BOSS' ? item.bossNameSource : prev.bossNameSource,
              mapName: chooseBetterText(prev.mapName, item.mapName, '未知地图'),
              mapSource: item.mapName ? item.mapSource : prev.mapSource,
              firstObservedAt: Math.min(Number(prev.firstObservedAt) || Number(prev.observedAt) || Date.now(), Number(item.firstObservedAt) || Number(item.observedAt) || Date.now()),
              updatedAt: Math.max(Number(prev.updatedAt) || 0, Number(item.updatedAt) || 0, Date.now()),
            };
          } else {
            out.push(item);
          }
          return out;
        }, [])
        .filter((item) => shouldKeepExistingRecord(item) && Number(item.refreshAt) > now - EXPIRED_KEEP_MS)
        .sort((a, b) => Number(a.refreshAt || 0) - Number(b.refreshAt || 0))
        .slice(0, MAX_RECORDS);
      persistRecords();
    }

    function recordKey(input) {
      const name = cleanText(input.bossName || '未知BOSS');
      const map = cleanText(input.mapName || '');
      const refreshAt = Number(input.refreshAt);
      const bucket = Number.isFinite(refreshAt) ? Math.round(refreshAt / MERGE_REFRESH_WINDOW_MS) : '';
      if (name || map || bucket) return [name, map, bucket].join('|');
      return cleanText(input.sourcePath || 'unknown');
    }

    function findMergeableRecordIndex(next, records) {
      return records.findIndex((item) => canMergeRecords(item, next));
    }

    function canMergeRecords(left, right) {
      if (!left || !right) return false;
      if (!namesMergeable(left.bossName, right.bossName)) return false;
      if (!mapsMergeable(left.mapName, right.mapName)) return false;
      if (Number(left.refreshAt) <= Date.now() && Number(right.refreshAt) > Date.now()) return true;
      return Math.abs(Number(left.refreshAt) - Number(right.refreshAt)) <= MERGE_REFRESH_WINDOW_MS;
    }

    function namesMergeable(left, right) {
      const a = cleanText(left || '未知BOSS');
      const b = cleanText(right || '未知BOSS');
      return a === b || a === '未知BOSS' || b === '未知BOSS';
    }

    function mapsMergeable(left, right) {
      const a = cleanText(left);
      const b = cleanText(right);
      return !a || !b || a === b;
    }

    function sameKnownMap(left, right) {
      const a = cleanText(left);
      const b = cleanText(right);
      return Boolean(a && b && a === b);
    }

    function chooseBetterText(previous, next, unknown) {
      const prev = cleanText(previous);
      const value = cleanText(next);
      if (!prev || prev === unknown) return value || prev;
      if (!value || value === unknown) return prev;
      return value.length >= prev.length ? value : prev;
    }

    function defaultConfig() {
      return {
        candidates: DEFAULT_CANDIDATES.slice(),
      };
    }

    function normalizeConfig(value) {
      const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const candidates = Object.prototype.hasOwnProperty.call(source, 'candidates')
        ? parseCandidateInput(source.candidates)
        : DEFAULT_CANDIDATES.slice();
      const normalized = uniqueStrings(candidates);
      return {
        candidates: normalized,
      };
    }

    function parseCandidateInput(input) {
      if (Array.isArray(input)) return input;
      if (typeof input === 'string') {
        return input
          .split(/[\n,，;；]+/)
          .map((item) => cleanText(item));
      }
      return [];
    }

    function configuredCandidates() {
      return normalizeConfig(state.config).candidates;
    }

    function isConfiguredCandidate(name) {
      const value = cleanText(name);
      if (!value || value === '未知BOSS') return false;
      return configuredCandidates().includes(value);
    }

    function shouldKeepExistingRecord(record) {
      if (!record) return false;
      if (record.bossName === '未知BOSS') return configuredCandidates().length > 0;
      return isConfiguredCandidate(record.bossName);
    }

    function renameLatestRecord(name) {
      const targetName = normalizeCandidateName(name);
      if (!targetName) return null;
      pruneRecords();
      const index = state.records.findIndex((record) => record.bossName === '未知BOSS')
        >= 0
        ? state.records.findIndex((record) => record.bossName === '未知BOSS')
        : state.records.length - 1;
      if (index < 0 || !state.records[index]) return null;
      return renameRecordAt(index, targetName);
    }

    function renameRecordById(id, name) {
      const targetName = normalizeCandidateName(name);
      if (!targetName) return null;
      const key = cleanText(id);
      const index = state.records.findIndex((record) => cleanText(record.id) === key);
      if (index < 0) return null;
      return renameRecordAt(index, targetName);
    }

    function renameRecordAt(index, targetName) {
      const previous = state.records[index];
      if (!previous) return null;
      state.records[index] = {
        ...previous,
        id: recordKey({ bossName: targetName, mapName: previous.mapName, refreshAt: previous.refreshAt }),
        bossName: targetName,
        bossNameSource: 'manual',
        confidence: Math.max(Number(previous.confidence) || 0, 0.95),
        updatedAt: Date.now(),
      };
      pruneRecords();
      persistRecords();
      renderOverlay();
      return clone(state.records.find((record) => record.refreshAt === previous.refreshAt && record.bossName === targetName) || state.records[index] || null);
    }

    function removeRecordById(id) {
      const key = cleanText(id);
      if (!key) return false;
      const record = state.records.find((item) => cleanText(item.id) === key);
      if (record) markRecordDismissed(record);
      const before = state.records.length;
      state.records = state.records.filter((record) => cleanText(record.id) !== key);
      if (state.records.length === before) return false;
      persistRecords();
      renderOverlay();
      return true;
    }

    function markRecordDismissed(record) {
      if (!record) return;
      const refreshAt = Number(record.refreshAt) || Date.now();
      const expiresAt = refreshAt + EXPIRED_KEEP_MS;
      [
        cleanText(record.id),
        recordKey({ bossName: record.bossName, mapName: record.mapName, refreshAt: refreshAt - MERGE_REFRESH_WINDOW_MS }),
        recordKey({ bossName: record.bossName, mapName: record.mapName, refreshAt }),
        recordKey({ bossName: record.bossName, mapName: record.mapName, refreshAt: refreshAt + MERGE_REFRESH_WINDOW_MS }),
      ].forEach((key) => {
        if (key) state.dismissedRecords[key] = expiresAt;
      });
      pruneDismissedRecords();
    }

    function isDismissedRecord(record) {
      pruneDismissedRecords();
      const key = cleanText(record && record.id);
      return Boolean(key && Number(state.dismissedRecords[key]) > Date.now());
    }

    function pruneDismissedRecords() {
      const now = Date.now();
      Object.keys(state.dismissedRecords).forEach((key) => {
        if (Number(state.dismissedRecords[key]) <= now) delete state.dismissedRecords[key];
      });
    }

    function normalizeCandidateName(name) {
      const value = cleanText(name);
      if (!isConfiguredCandidate(value)) return '';
      return value;
    }

    function uniqueStrings(values) {
      const seen = {};
      const out = [];
      (values || []).forEach((item) => {
        const value = cleanText(item);
        if (!value || seen[value]) return;
        seen[value] = true;
        out.push(value);
      });
      return out;
    }

    function renderOverlay() {
      if (!canUseDom()) return;
      const doc = window.document;
      if (!state.overlayEl) {
        state.overlayEl = createOverlay(doc);
        doc.body.appendChild(state.overlayEl);
        clampOverlayToViewport();
      }
      renderOverlayContent();
    }

    function createOverlay(doc) {
      const panel = doc.createElement('div');
      panel.id = 'mu-boss-respawn-overlay';
      panel.style.position = 'fixed';
      applyOverlayPosition(panel);
      panel.style.zIndex = '2147483647';
      panel.style.width = '292px';
      panel.style.maxWidth = '34vw';
      panel.style.boxSizing = 'border-box';
      panel.style.border = '1px solid rgba(255,255,255,0.28)';
      panel.style.background = 'rgba(10,12,16,0.78)';
      panel.style.color = '#f3f7ff';
      panel.style.font = '12px/1.35 Arial, sans-serif';
      panel.style.borderRadius = '6px';
      panel.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
      panel.style.pointerEvents = 'auto';
      panel.style.userSelect = 'none';

      const header = doc.createElement('div');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.justifyContent = 'space-between';
      header.style.gap = '6px';
      header.style.padding = '5px 6px';
      header.style.borderBottom = '1px solid rgba(255,255,255,0.16)';
      header.style.cursor = 'move';
      header.title = '拖动调整浮层位置';
      header.addEventListener('mousedown', startDragOverlay);

      const title = doc.createElement('div');
      title.textContent = 'BOSS刷新';
      title.style.fontWeight = '700';
      title.style.color = '#ffe4a8';

      const controls = doc.createElement('div');
      controls.style.display = 'flex';
      controls.style.gap = '4px';
      controls.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });

      const clear = doc.createElement('button');
      clear.type = 'button';
      clear.textContent = '清';
      styleSmallButton(clear);
      clear.title = '清空记录';
      clear.addEventListener('click', (event) => {
        event.stopPropagation();
        state.records = [];
        persistRecords();
        renderOverlay();
      });

      const config = doc.createElement('button');
      config.type = 'button';
      config.textContent = '配';
      styleSmallButton(config);
      config.title = '配置候选BOSS';
      config.addEventListener('click', (event) => {
        event.stopPropagation();
        state.configOpen = !state.configOpen;
        renderOverlay();
      });

      const toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.textContent = state.collapsed ? '+' : '-';
      styleSmallButton(toggle);
      toggle.title = '收起/展开';
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        state.collapsed = !state.collapsed;
        writeBool(COLLAPSED_KEY, state.collapsed);
        renderOverlay();
      });

      controls.appendChild(clear);
      controls.appendChild(config);
      controls.appendChild(toggle);
      header.appendChild(title);
      header.appendChild(controls);

      const status = doc.createElement('div');
      status.style.padding = '4px 6px';
      status.style.color = '#b8c7d9';
      status.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
      status.style.whiteSpace = 'nowrap';
      status.style.overflow = 'hidden';
      status.style.textOverflow = 'ellipsis';

      const body = doc.createElement('div');
      body.style.padding = '4px 5px';
      body.style.maxHeight = '280px';
      body.style.overflow = 'hidden auto';

      const configPanel = doc.createElement('div');
      configPanel.style.display = 'none';
      configPanel.style.padding = '6px';
      configPanel.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
      configPanel.style.background = 'rgba(255,255,255,0.05)';
      configPanel.style.userSelect = 'text';
      configPanel.style.webkitUserSelect = 'text';

      panel.appendChild(header);
      panel.appendChild(status);
      panel.appendChild(configPanel);
      panel.appendChild(body);
      state.statusEl = status;
      state.configEl = configPanel;
      state.bodyEl = body;
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('resize', clampOverlayToViewport);
      }
      return panel;
    }

    function applyOverlayPosition(panel) {
      if (state.position) {
        const point = clampPoint(state.position.left, state.position.top, panel);
        panel.style.left = `${point.left}px`;
        panel.style.top = `${point.top}px`;
        panel.style.right = '';
        state.position = point;
        return;
      }
      panel.style.right = '8px';
      panel.style.top = '220px';
      panel.style.left = '';
    }

    function startDragOverlay(event) {
      if (!state.overlayEl || event.button !== 0) return;
      if (isConfigInputEvent(event)) return;
      event.preventDefault();
      const rect = state.overlayEl.getBoundingClientRect();
      state.drag = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      state.overlayEl.style.right = '';
      state.overlayEl.style.left = `${rect.left}px`;
      state.overlayEl.style.top = `${rect.top}px`;
      window.document.addEventListener('mousemove', dragOverlay);
      window.document.addEventListener('mouseup', stopDragOverlay);
    }

    function dragOverlay(event) {
      if (!state.drag || !state.overlayEl) return;
      const point = clampPoint(event.clientX - state.drag.offsetX, event.clientY - state.drag.offsetY, state.overlayEl);
      state.overlayEl.style.left = `${point.left}px`;
      state.overlayEl.style.top = `${point.top}px`;
    }

    function stopDragOverlay() {
      if (!state.drag || !state.overlayEl) return;
      state.drag = null;
      const rect = state.overlayEl.getBoundingClientRect();
      state.position = clampPoint(rect.left, rect.top, state.overlayEl);
      state.overlayEl.style.left = `${state.position.left}px`;
      state.overlayEl.style.top = `${state.position.top}px`;
      writeJson(POSITION_KEY, state.position);
      window.document.removeEventListener('mousemove', dragOverlay);
      window.document.removeEventListener('mouseup', stopDragOverlay);
    }

    function isConfigInputEvent(event) {
      const target = event && event.target;
      return Boolean(target && state.configEl && containsElement(state.configEl, target));
    }

    function containsElement(parent, child) {
      if (!parent || !child) return false;
      if (parent === child) return true;
      if (typeof parent.contains === 'function') return parent.contains(child);
      let node = child;
      while (node) {
        if (node === parent) return true;
        node = node.parentNode;
      }
      return false;
    }

    function clampOverlayToViewport() {
      if (!state.overlayEl || !state.position) return;
      const point = clampPoint(state.position.left, state.position.top, state.overlayEl);
      state.position = point;
      state.overlayEl.style.left = `${point.left}px`;
      state.overlayEl.style.top = `${point.top}px`;
      state.overlayEl.style.right = '';
      writeJson(POSITION_KEY, state.position);
    }

    function clampPoint(left, top, el) {
      const margin = 4;
      const width = Number(el && el.offsetWidth) || 292;
      const height = Number(el && el.offsetHeight) || 80;
      const viewportWidth = Number(window.innerWidth) || 1334;
      const viewportHeight = Number(window.innerHeight) || 750;
      return {
        left: Math.max(margin, Math.min(Math.round(Number(left) || margin), Math.max(margin, viewportWidth - width - margin))),
        top: Math.max(margin, Math.min(Math.round(Number(top) || margin), Math.max(margin, viewportHeight - height - margin))),
      };
    }

    function renderOverlayContent() {
      if (!state.overlayEl || !state.bodyEl || !state.statusEl) return;
      const toggle = state.overlayEl.querySelector && state.overlayEl.querySelector('button[title="收起/展开"]');
      if (toggle) toggle.textContent = state.collapsed ? '+' : '-';
      renderConfigPanel();

      const now = Date.now();
      const activeRecords = state.records
        .filter((item) => Number(item.refreshAt) > now - EXPIRED_KEEP_MS)
        .sort((a, b) => Number(a.refreshAt || 0) - Number(b.refreshAt || 0));
      const soon = activeRecords.filter((item) => {
        const remaining = Math.ceil((Number(item.refreshAt) - now) / 1000);
        return remaining >= 0 && remaining <= HIGHLIGHT_SECONDS;
      });

      state.statusEl.textContent = soon.length
        ? `${soon.length} 个BOSS 90秒内刷新`
        : `${activeRecords.length} 条记录 | ${state.lastScanReason}`;
      state.statusEl.style.color = soon.length ? '#ffe66d' : '#b8c7d9';
      state.statusEl.style.background = soon.length ? 'rgba(160,60,0,0.35)' : 'transparent';
      state.bodyEl.style.display = state.collapsed ? 'none' : 'block';
      if (state.collapsed) return;

      clearElement(state.bodyEl);
      if (!activeRecords.length) {
        const empty = window.document.createElement('div');
        empty.textContent = '未检测到BOSS刷新倒计时';
        empty.style.color = '#b8c7d9';
        empty.style.padding = '4px 0';
        state.bodyEl.appendChild(empty);
        return;
      }

      activeRecords.forEach((record) => {
        state.bodyEl.appendChild(renderRecord(record, now));
      });
    }

    function renderRecord(record, now) {
      const doc = window.document;
      const row = doc.createElement('div');
      const remaining = Math.ceil((Number(record.refreshAt) - now) / 1000);
      const expired = remaining < 0;
      const soon = remaining >= 0 && remaining <= HIGHLIGHT_SECONDS;

      row.style.position = 'relative';
      row.style.padding = '4px 26px 4px 6px';
      row.style.margin = '0 0 4px';
      row.style.border = soon ? '1px solid rgba(255,226,82,0.85)' : '1px solid rgba(255,255,255,0.12)';
      row.style.background = soon ? 'rgba(164,84,0,0.58)' : 'rgba(255,255,255,0.06)';
      row.style.borderRadius = '4px';

      const head = doc.createElement('div');
      head.style.display = 'flex';
      head.style.alignItems = 'center';
      head.style.justifyContent = 'space-between';
      head.style.gap = '6px';
      head.style.minWidth = '0';

      const title = doc.createElement('div');
      title.textContent = record.bossName || '未知BOSS';
      title.style.fontWeight = '700';
      title.style.color = soon ? '#fff0a8' : '#ffffff';
      title.style.whiteSpace = 'nowrap';
      title.style.overflow = 'hidden';
      title.style.textOverflow = 'ellipsis';
      title.style.minWidth = '0';
      title.style.flex = '1 1 auto';

      const place = doc.createElement('div');
      place.textContent = record.mapName || '未知地图';
      place.style.color = '#cbd7e6';
      place.style.whiteSpace = 'nowrap';
      place.style.overflow = 'hidden';
      place.style.textOverflow = 'ellipsis';
      place.style.maxWidth = '42%';
      place.style.flex = '0 1 auto';
      place.style.textAlign = 'right';

      const close = doc.createElement('button');
      close.type = 'button';
      close.textContent = '×';
      close.title = '删除该BOSS追踪';
      close.style.position = 'absolute';
      close.style.top = '3px';
      close.style.right = '4px';
      close.style.width = '18px';
      close.style.height = '18px';
      close.style.padding = '0';
      close.style.border = '1px solid rgba(255,255,255,0.22)';
      close.style.borderRadius = '3px';
      close.style.background = 'rgba(22,25,30,0.86)';
      close.style.color = '#dce7f6';
      close.style.font = '14px/16px Arial, sans-serif';
      close.style.cursor = 'pointer';
      close.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeRecordById(record.id);
      });

      const time = doc.createElement('div');
      time.textContent = expired
        ? `已刷新 | ${record.refreshAtText || formatClock(record.refreshAt)}`
        : `剩余 ${formatDuration(remaining)} | 刷新 ${record.refreshAtText || formatClock(record.refreshAt)}`;
      time.style.color = expired ? '#72ff92' : (soon ? '#ffe66d' : '#9fe6ff');
      time.style.fontWeight = soon ? '700' : '400';
      time.style.whiteSpace = 'nowrap';
      time.style.overflow = 'hidden';
      time.style.textOverflow = 'ellipsis';

      head.appendChild(title);
      head.appendChild(place);
      row.appendChild(head);
      row.appendChild(close);
      row.appendChild(time);
      if (record.bossName === '未知BOSS') {
        row.appendChild(renderRenameButtons(record));
      }
      return row;
    }

    function renderConfigPanel() {
      if (!state.configEl) return;
      const panel = state.configEl;
      panel.style.display = state.configOpen && !state.collapsed ? 'block' : 'none';
      if (panel.style.display === 'none') return;
      const existingTextarea = panel.querySelector && panel.querySelector('textarea[data-mu-boss-candidates="1"]');
      if (existingTextarea) return;
      clearElement(panel);
      const title = window.document.createElement('div');
      title.textContent = '候选BOSS（每行一个）';
      title.style.color = '#ffe4a8';
      title.style.fontWeight = '700';
      title.style.marginBottom = '5px';
      panel.appendChild(title);

      const textarea = window.document.createElement('textarea');
      textarea.setAttribute('data-mu-boss-candidates', '1');
      textarea.value = configuredCandidates().join('\n');
      textarea.placeholder = '例如:\n傲之煞\n闪电巨人\n也支持逗号或分号分隔';
      textarea.spellcheck = false;
      textarea.style.width = '100%';
      textarea.style.height = '86px';
      textarea.style.boxSizing = 'border-box';
      textarea.style.resize = 'vertical';
      textarea.style.border = '1px solid rgba(255,255,255,0.22)';
      textarea.style.borderRadius = '4px';
      textarea.style.background = 'rgba(0,0,0,0.35)';
      textarea.style.color = '#f3f7ff';
      textarea.style.font = '12px/1.35 Arial, sans-serif';
      textarea.style.padding = '5px';
      textarea.style.userSelect = 'text';
      textarea.style.webkitUserSelect = 'text';
      textarea.style.caretColor = '#ffffff';
      isolateTextInputEvents(textarea);
      textarea.addEventListener('focus', () => {
        state.configEditing = true;
      });
      textarea.addEventListener('blur', () => {
        state.configEditing = false;
      });
      panel.appendChild(textarea);

      const hint = window.document.createElement('div');
      hint.textContent = '支持换行、逗号、分号分隔；清空后暂停新增。';
      hint.style.marginTop = '4px';
      hint.style.color = '#9fb0c4';
      hint.style.fontSize = '11px';
      panel.appendChild(hint);

      const actions = window.document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '6px';
      actions.style.marginTop = '6px';

      const save = window.document.createElement('button');
      save.type = 'button';
      save.textContent = '保存';
      styleSmallButton(save);
      save.style.width = '52px';
      save.addEventListener('click', (event) => {
        event.stopPropagation();
        state.configEditing = false;
        state.config = normalizeConfig({ ...state.config, candidates: textarea.value });
        persistConfig();
        state.records = state.records.filter((record) => shouldKeepExistingRecord(record));
        persistRecords();
        renderOverlay();
      });

      const defaults = window.document.createElement('button');
      defaults.type = 'button';
      defaults.textContent = '示例';
      styleSmallButton(defaults);
      defaults.style.width = '52px';
      defaults.addEventListener('click', (event) => {
        event.stopPropagation();
        textarea.value = DEFAULT_CANDIDATES.join('\n');
        if (typeof textarea.focus === 'function') textarea.focus();
      });

      actions.appendChild(save);
      actions.appendChild(defaults);
      panel.appendChild(actions);
    }

    function isolateTextInputEvents(el) {
      if (!el || typeof el.addEventListener !== 'function') return;
      [
        'pointerdown',
        'pointerup',
        'mousedown',
        'mouseup',
        'click',
        'dblclick',
        'touchstart',
        'touchend',
        'keydown',
        'keyup',
        'keypress',
        'beforeinput',
        'input',
        'paste',
        'copy',
        'cut',
        'contextmenu',
        'compositionstart',
        'compositionupdate',
        'compositionend',
      ].forEach((type) => {
        el.addEventListener(type, isolateTextInputEvent, true);
        el.addEventListener(type, isolateTextInputEvent, false);
      });
    }

    function isolateTextInputEvent(event) {
      state.configEditing = true;
      event.stopPropagation();
    }

    function renderRenameButtons(record) {
      const wrap = window.document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexWrap = 'wrap';
      wrap.style.gap = '4px';
      wrap.style.marginTop = '5px';
      configuredCandidates().forEach((name) => {
        const button = window.document.createElement('button');
        button.type = 'button';
        button.textContent = shortBossName(name);
        button.title = `标记为${name}`;
        button.style.padding = '2px 5px';
        button.style.border = '1px solid rgba(255,255,255,0.24)';
        button.style.borderRadius = '4px';
        button.style.background = 'rgba(50,62,78,0.92)';
        button.style.color = '#fff';
        button.style.font = '11px/1.3 Arial, sans-serif';
        button.style.cursor = 'pointer';
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          renameRecordById(record.id, name);
        });
        wrap.appendChild(button);
      });
      return wrap;
    }

    function shortBossName(name) {
      const value = cleanText(name);
      if (value === '闪电巨人') return '闪电';
      if (value === '愤怒闪电巨人') return '怒闪';
      if (value === '傲之煞') return '傲之煞';
      if (value === '狂暴火焰巨人') return '狂火';
      if (value === '愤怒火焰巨人') return '怒火';
      if (value === '火焰巨人') return '火焰';
      if (value === '地狱骑士') return '骑士';
      return value.length > 4 ? value.slice(0, 4) : value;
    }

    function styleSmallButton(button) {
      button.style.width = '24px';
      button.style.height = '22px';
      button.style.padding = '0';
      button.style.border = '1px solid rgba(255,255,255,0.28)';
      button.style.borderRadius = '4px';
      button.style.background = 'rgba(38,42,50,0.92)';
      button.style.color = '#fff';
      button.style.font = '12px/20px Arial, sans-serif';
      button.style.cursor = 'pointer';
    }

    function walkFgui(node, visit, inheritedVisible, depth) {
      if (!node || depth > 18) return;
      const selfVisible = node.visible !== false && node.internalVisible !== false;
      const effectiveVisible = inheritedVisible !== false && selfVisible;
      visit(node, effectiveVisible);
      const count = Number(node.numChildren) || 0;
      for (let index = 0; index < count; index += 1) {
        if (typeof node.getChildAt === 'function') walkFgui(node.getChildAt(index), visit, effectiveVisible, depth + 1);
      }
    }

    function walkLaya(node, visit, path, inheritedVisible, ancestors, depth) {
      if (!node || depth > 22) return;
      const selfVisible = node.visible !== false && node._visible !== false && node.active !== false && node.destroyed !== true;
      const effectiveVisible = inheritedVisible !== false && selfVisible;
      const info = { name: cleanText(safeString(() => node.name)), className: node.constructor && node.constructor.name ? node.constructor.name : '' };
      visit(node, path, effectiveVisible, ancestors);
      const children = layaChildren(node);
      children.forEach((child, index) => {
        const childName = cleanText(safeString(() => child.name)) || '?';
        walkLaya(child, visit, `${path}/${childName}[${index}]`, effectiveVisible, ancestors.concat(info), depth + 1);
      });
    }

    function layaChildren(node) {
      if (node && node._children && typeof node._children.length === 'number') return Array.prototype.slice.call(node._children);
      const count = Number(node && node.numChildren) || 0;
      const out = [];
      for (let index = 0; index < count; index += 1) {
        if (typeof node.getChildAt === 'function') out.push(node.getChildAt(index));
      }
      return out;
    }

    function globalRect(node) {
      const rect = {
        x: Number(node && node.x) || Number(node && node._x) || 0,
        y: Number(node && node.y) || Number(node && node._y) || 0,
        w: Number(node && node.width) || Number(node && node._width) || 0,
        h: Number(node && node.height) || Number(node && node._height) || 0,
      };
      let parent = node && (node.parent || node._parent);
      while (parent) {
        rect.x += Number(parent.x) || Number(parent._x) || 0;
        rect.y += Number(parent.y) || Number(parent._y) || 0;
        parent = parent.parent || parent._parent;
      }
      return rect;
    }

    function extractBossName(text) {
      const value = cleanText(text);
      const names = uniqueStrings(configuredCandidates().concat(BOSS_NAME_EXAMPLES))
        .sort((a, b) => b.length - a.length);
      return names.find((name) => value.includes(name)) || '';
    }

    function parseColonSeconds(text) {
      const match = cleanText(text).match(/^(\d{1,2}):([0-5]\d)$/);
      if (!match) return null;
      return Number(match[1]) * 60 + Number(match[2]);
    }

    function normalizeCoordinate(text) {
      const match = cleanText(text).match(/(\d{1,3}),\s*(\d{1,3})/);
      return match ? `${match[1]},${match[2]}` : '';
    }

    function normalizeMapName(text, nodeName) {
      const raw = cleanText(text).replace(/\bmapName\b/ig, '').trim();
      if (!raw || normalizeCoordinate(raw)) return '';
      if (cleanText(nodeName) === 'mapName') return raw.slice(0, 18);
      if (!/^[\u4e00-\u9fa5A-Za-z0-9]{2,18}$/.test(raw)) return '';
      return /试炼|福利|野外|平原|大陆|炼狱|秘境|幻术|森林|沙漠|峡谷|神殿|禁地|洞窟|洞穴|广场|城|谷|岛|塔|宫/.test(raw)
        ? raw
        : '';
    }

    function formatDuration(seconds) {
      const total = Math.max(0, Number(seconds) || 0);
      const minutes = Math.floor(total / 60);
      const rest = total % 60;
      return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
    }

    function formatClock(timestamp) {
      const date = new Date(Number(timestamp) || Date.now());
      const h = String(date.getHours()).padStart(2, '0');
      const m = String(date.getMinutes()).padStart(2, '0');
      const s = String(date.getSeconds()).padStart(2, '0');
      return `${h}:${m}:${s}`;
    }

    function normalizeRecords(value) {
      if (!Array.isArray(value)) return [];
      return value
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const refreshAt = Number(item.refreshAt);
          if (!Number.isFinite(refreshAt)) return null;
          const bossName = cleanText(item.bossName || item.name || '未知BOSS');
          return {
            id: cleanText(item.id) || recordKey({
              bossName,
              mapName: item.mapName,
              refreshAt,
            }),
            bossName,
            bossNameSource: cleanText(item.bossNameSource),
            mapName: cleanText(item.mapName),
            mapSource: cleanText(item.mapSource),
            countdownText: cleanText(item.countdownText),
            detectedSeconds: Number(item.detectedSeconds) || null,
            observedAt: Number(item.observedAt) || Date.now(),
            firstObservedAt: Number(item.firstObservedAt) || Number(item.observedAt) || Date.now(),
            updatedAt: Number(item.updatedAt) || Date.now(),
            refreshAt,
            refreshAtText: cleanText(item.refreshAtText) || formatClock(refreshAt),
            source: cleanText(item.source),
            sourcePath: cleanText(item.sourcePath),
            confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
          };
        })
        .filter(Boolean);
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
        state.lastScanReason = 'localStorage write failed';
      }
    }

    function persistRecords() {
      writeJson(STORAGE_KEY, state.records);
    }

    function persistConfig() {
      writeJson(CONFIG_KEY, state.config);
    }

    function readBool(key, fallback) {
      try {
        const raw = window.localStorage && window.localStorage.getItem(key);
        if (raw === '1' || raw === 'true') return true;
        if (raw === '0' || raw === 'false') return false;
      } catch (_) {
        return fallback;
      }
      return fallback;
    }

    function readPosition() {
      const value = readJson(POSITION_KEY, null);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const left = Number(value.left);
      const top = Number(value.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
      return { left, top };
    }

    function writeBool(key, value) {
      try {
        if (window.localStorage) window.localStorage.setItem(key, value ? '1' : '0');
      } catch (_) {
        state.lastScanReason = 'localStorage write failed';
      }
    }

    function canUseDom() {
      return Boolean(window.document && window.document.body && typeof window.document.createElement === 'function');
    }

    function clearElement(el) {
      while (el.firstChild) el.removeChild(el.firstChild);
    }

    function safeString(read) {
      try {
        const value = read();
        return value == null ? '' : String(value);
      } catch (_) {
        return '';
      }
    }

    function cleanText(value) {
      return String(value == null ? '' : value)
        .replace(/<[^>]+>/g, '')
        .replace(/\[\/?color(?:=[^\]]+)?\]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function firstCleanText(...values) {
      for (let index = 0; index < values.length; index += 1) {
        const text = cleanText(values[index]);
        if (text) return text;
      }
      return '';
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
