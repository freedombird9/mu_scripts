// ==UserScript==
// @name         全民红月 - BOSS 刷新倒计时浮层
// @namespace    codex.mu.boss.respawn.overlay
// @version      0.2.3
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

    const VERSION = '0.2.1';
    const STORAGE_KEY = 'mu_boss_respawn_overlay_records_v1';
    const COLLAPSED_KEY = 'mu_boss_respawn_overlay_collapsed_v1';
    const POSITION_KEY = 'mu_boss_respawn_overlay_position_v1';
    const SIZE_KEY = 'mu_boss_respawn_overlay_size_v1';
    const CONFIG_KEY = 'mu_boss_respawn_overlay_config_v1';
    const SCAN_INTERVAL_MS = 500;
    const HIGHLIGHT_SECONDS = 90;
    const NEW_RECORD_HIGHLIGHT_MS = 5000;
    const MERGE_REFRESH_WINDOW_MS = 15000;
    const REFRESH_RECONCILE_WINDOW_MS = 3000;
    const RECENT_BOSS_NAME_TTL_MS = 4000;
    const COUNTDOWN_SOURCE_GAP_MS = 1600;
    const EXPIRED_KEEP_MS = 30000;
    const MAX_RECORDS = 40;
    const DEFAULT_OVERLAY_WIDTH = 292;
    const DEFAULT_OVERLAY_HEIGHT = 180;
    const MIN_OVERLAY_WIDTH = 220;
    const MIN_OVERLAY_HEIGHT = 118;
    const MIN_OVERLAY_FONT_PX = 10;
    const MAX_OVERLAY_FONT_PX = 20;
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
      '愤怒傲之煞',
      '狂暴傲之煞',
    ];
    const DEFAULT_CANDIDATES = ['傲之煞', '闪电巨人'];

    const initialConfig = normalizeConfig(readJson(CONFIG_KEY, defaultConfig()));
    const state = {
      records: normalizeRecords(readJson(STORAGE_KEY, []), initialConfig),
      config: initialConfig,
      collapsed: readBool(COLLAPSED_KEY, false),
      position: readPosition(),
      size: readSize(),
      drag: null,
      resize: null,
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
      mapBossMarkers: [],
      countdownSources: {},
      dismissedRecords: {},
      newRecordHighlights: {},
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
        state.newRecordHighlights = {};
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
      confirmNameChoice(id, name, choice) {
        return confirmRecordNameChoice(id, name, choice);
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
          size: state.size ? { ...state.size } : null,
          config: clone(state.config),
          configEditing: state.configEditing,
          records: state.records.length,
          lastDetected: clone(state.lastDetected),
          recentBossName: state.recentBossName ? { ...state.recentBossName } : null,
          mapBossMarkers: clone(state.mapBossMarkers),
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
      resetSize() {
        state.size = null;
        writeJson(SIZE_KEY, null);
        if (state.overlayEl) {
          state.overlayEl.style.width = `${DEFAULT_OVERLAY_WIDTH}px`;
          state.overlayEl.style.height = '';
          applyOverlayTypography();
          applyOverlayBodySizing();
          clampOverlayToViewport();
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
      const trialTaskbarOnly = isTrialLandMap(context.mapName);
      const taskbarCandidates = scanTrialTaskbarCountdowns(context);
      if (trialTaskbarOnly) removeTrialNonTaskbarRecords();
      const candidates = annotateCountdownObservations(
        trialTaskbarOnly
          ? taskbarCandidates.concat(scanSceneCountdowns())
          : scanSceneCountdowns().concat(taskbarCandidates),
      );
      state.lastDetected = candidates.map((item) => ({
        text: item.text,
        seconds: item.seconds,
        bossName: item.bossName,
        mapName: item.mapName,
        source: item.source,
        sourcePath: item.sourcePath,
        score: item.score,
      }));

      if (!candidates.length) {
        state.lastScanReason = 'no visible boss countdown';
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

    function removeTrialNonTaskbarRecords() {
      state.records = state.records.filter((record) => (
        !isTrialLandMap(record && record.mapName)
          || isTrialTaskbarRecord(record)
          || isTrialSceneCountdownRecord(record)
      ));
    }

    function readContext() {
      const bot = readBotSnapshot();
      const fgui = readFguiContext();
      const mapName = cleanText(bot.scene.mapName || fgui.mapName || '');
      const visibleMapBossMarkers = readMapBossMarkers(mapName);
      if (visibleMapBossMarkers.length) state.mapBossMarkers = visibleMapBossMarkers;
      const mapBossMarkers = state.mapBossMarkers.filter((marker) => (
        !mapName || !marker.mapName || marker.mapName === mapName
      ));
      const reliableBossName = cleanText(bot.combat.targetName || fgui.targetName || '');
      const bossNameSource = bot.combat.targetName ? 'muBossBot.combat' : (fgui.targetName ? 'fgui.combat' : '');
      if (reliableBossName) {
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
        ? state.recentBossName
        : null;
      const bossName = reliableBossName || (recent ? recent.name : '');
      return {
        bossName,
        bossNameSource: reliableBossName ? bossNameSource : (recent ? `recent.${recent.source}` : 'unknown'),
        mapName,
        mapSource: bot.scene.mapName ? 'muBossBot.scene' : (fgui.mapName ? 'fgui' : 'unknown'),
        playerCoordinate: normalizeBossCoordinate(fgui.coordinates),
        mapBossMarkers,
        combatTargetVisible: Boolean(reliableBossName),
        recentBossAgeMs: recent ? Date.now() - Number(recent.at) : null,
      };
    }

    function annotateCountdownObservations(candidates) {
      const now = Date.now();
      const result = (candidates || []).map((candidate) => {
        const key = [cleanText(candidate.source), cleanText(candidate.sourcePath)].join('|');
        const previous = state.countdownSources[key];
        const isNewObservation = !previous || now - Number(previous.seenAt) > COUNTDOWN_SOURCE_GAP_MS;
        state.countdownSources[key] = {
          seenAt: now,
          seconds: Number(candidate.seconds) || 0,
        };
        return { ...candidate, isNewObservation };
      });
      Object.keys(state.countdownSources).forEach((key) => {
        if (now - Number(state.countdownSources[key].seenAt) > COUNTDOWN_SOURCE_GAP_MS) {
          delete state.countdownSources[key];
        }
      });
      return result;
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
        if (window.__muBossObserver && typeof window.__muBossObserver.scan === 'function') {
          const snapshot = window.__muBossObserver.scan() || {};
          return {
            scene: { mapName: cleanText(snapshot.scene && snapshot.scene.currentMap) },
            combat: { targetName: cleanText(snapshot.combat && snapshot.combat.parsedTarget && snapshot.combat.parsedTarget.name) },
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
      const targetCandidates = [];
      const mapCandidates = [];
      walkFgui(root, (node, effectiveVisible, path) => {
        const nodeText = firstCleanText(
          safeString(() => node.text),
          safeString(() => node.title)
        );
        const nodeName = cleanText(safeString(() => node.name));
        if (!effectiveVisible && nodeName !== 'mapName') return;
        const text = cleanText([nodeText, nodeName].filter(Boolean).join(' '));
        if (!text) return;
        const mapName = normalizeMapName(nodeText, nodeName);
        if (mapName) mapCandidates.push({
          name: mapName,
          score: scoreMapNameCandidate(nodeName, fguiRect(node), path),
        });
        if (/Lv\s*\d+/i.test(text)) {
          const targetName = extractCombatTargetName(text);
          const rect = fguiRect(node);
          if (targetName && isLikelyCombatTarget(path, rect, text)) {
            targetCandidates.push({
              name: targetName,
              score: scoreCombatTarget(path, rect, text),
            });
          }
        }
        const coordinate = normalizeCoordinate(text);
        if (!out.coordinates && coordinate && isLikelyPlayerCoordinate(path, nodeName, fguiRect(node))) {
          out.coordinates = coordinate;
        }
      }, true, 0);
      targetCandidates.sort((a, b) => b.score - a.score || b.name.length - a.name.length);
      if (targetCandidates[0]) out.targetName = targetCandidates[0].name;
      mapCandidates.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
      if (mapCandidates[0]) out.mapName = mapCandidates[0].name;
      return out;
    }

    function scoreMapNameCandidate(nodeName, rect, path) {
      let score = 0;
      if (nodeName === 'mapName') score += 1000;
      if (/miniMap|MainWnd|mapName/i.test(cleanText(path))) score += 180;
      if (rect && rect.x >= 980 && rect.y <= 150) score += 160;
      if (rect && rect.x >= 700 && rect.y <= 220) score += 30;
      return score;
    }

    function readMapBossMarkers(mapName) {
      const root = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
      if (!root) return [];
      const maps = [];
      walkFgui(root, (node, effectiveVisible) => {
        if (!effectiveVisible || cleanText(safeString(() => node.name)) !== 'Main_MapDetailUI') return;
        const entries = safeMapEntries(node.spmonsterList);
        entries.forEach(([coordinate, value]) => {
          const point = normalizeBossCoordinate(coordinate);
          const marker = Array.isArray(value) ? value[0] : null;
          const monsterId = Array.isArray(value) ? Number(value[1]) || 0 : 0;
          const name = cleanText(safeString(() => marker && marker.title));
          const icon = cleanText(safeString(() => marker && marker.icon));
          if (!point || !name || !/ico_boss/i.test(icon)) return;
          maps.push({
            name,
            coordinate: point,
            monsterId,
            mapName: cleanText(mapName),
            source: 'fgui.map_marker',
            seenAt: Date.now(),
          });
        });
      }, true, 0);
      return uniqueMapBossMarkers(maps);
    }

    function safeMapEntries(value) {
      try {
        return value && typeof value.forEach === 'function'
          ? Array.from(value.entries ? value.entries() : [])
          : [];
      } catch (_) {
        return [];
      }
    }

    function uniqueMapBossMarkers(markers) {
      const seen = {};
      return (markers || []).filter((marker) => {
        const key = [marker.mapName, marker.coordinate, marker.name, marker.monsterId].join('|');
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    function isLikelyCombatTarget(path, rect, text) {
      if (/\d+级怪物|经验|任务|地图|怪点/.test(cleanText(text))) return false;
      if (!rect || rect.y > 210 || rect.x < 180 || rect.x > 980) return false;
      return /boss|target|hp|fight|role/i.test(cleanText(path)) || rect.y <= 140;
    }

    function scoreCombatTarget(path, rect, text) {
      let score = 0;
      if (/Lv\s*\d+/i.test(text)) score += 80;
      if (/\d+%/.test(text)) score += 25;
      if (/boss|target|hp/i.test(cleanText(path))) score += 40;
      if (rect.y <= 140) score += 25;
      score -= Math.abs(rect.x - 570) / 20;
      return score;
    }

    function isLikelyPlayerCoordinate(path, nodeName, rect) {
      if (/coord|position|pos|map/i.test(cleanText(path)) || /coord|position|pos/i.test(cleanText(nodeName))) return true;
      return Boolean(rect && rect.x >= 760 && rect.y <= 190);
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
      return candidates.sort((a, b) => b.score - a.score || a.seconds - b.seconds).slice(0, 1);
    }

    function scanTrialTaskbarCountdowns(context) {
      const root = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
      if (!root) return [];
      const candidates = [];
      const mapName = taskbarMapName(context);
      walkFgui(root, (node, effectiveVisible, path) => {
        if (!effectiveVisible || !isTrialTaskbarEntryPath(path)) return;
        const pair = readDirectChildTexts(node);
        const nameText = cleanText(pair.nameTxt);
        const countdownText = cleanText(pair.desTxt);
        if (!nameText || !countdownText) return;
        const bossName = extractTaskbarBossName(nameText);
        if (!bossName) return;
        const seconds = parseTaskbarCountdownSeconds(countdownText);
        if (seconds == null || seconds <= 0) return;
        candidates.push({
          text: `${nameText} ${countdownText}`,
          seconds,
          bossName,
          bossNameSource: 'fgui.trial_taskbar',
          mapName,
          mapSource: mapName ? context.mapSource : 'unknown',
          source: 'fgui_trial_taskbar',
          sourcePath: path,
          score: 260,
          confidence: 0.9,
        });
      }, true, 0);
      scanTrialLeftPanelCountdowns(root, context).forEach((candidate) => candidates.push(candidate));
      return dedupeTaskbarCandidates(candidates)
        .sort((a, b) => a.seconds - b.seconds)
        .slice(0, 8);
    }

    function scanTrialLeftPanelCountdowns(root, context) {
      const mapName = taskbarMapName(context);
      return groupTrialLeftPanelBossRows(trialLeftPanelRows(root))
        .map((entry) => {
          const refreshText = extractTaskbarRefreshText(entry.text);
          const seconds = parseTaskbarCountdownSeconds(refreshText);
          if (seconds == null || seconds <= 0) return null;
          return {
            text: `${entry.bossName} ${refreshText}`,
            seconds,
            bossName: entry.bossName,
            bossNameSource: 'fgui.trial_left_panel',
            mapName,
            mapSource: mapName ? context.mapSource : 'unknown',
            source: 'fgui_trial_left_panel',
            sourcePath: `fgui.left_panel:${Math.round(entry.rect.y)}:${entry.bossName}`,
            score: 255,
            confidence: 0.9,
          };
        })
        .filter(Boolean);
    }

    function trialLeftPanelRows(root) {
      const items = [];
      walkFgui(root, (node, effectiveVisible) => {
        if (!effectiveVisible) return;
        const childCount = Number(node && node.numChildren) || 0;
        if (childCount !== 0) return;
        const text = fguiContentText(node);
        if (!text) return;
        const rect = fguiRect(node);
        if (!isTrialLeftPanelTextRect(rect)) return;
        items.push({ text, rect });
      }, true, 0);

      const rows = [];
      items
        .sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x))
        .forEach((item) => {
          let row = rows.find((candidate) => Math.abs(candidate.y - item.rect.y) <= 14);
          if (!row) {
            row = { y: item.rect.y, items: [] };
            rows.push(row);
          }
          row.items.push(item);
          row.y = (row.y + item.rect.y) / 2;
        });

      return rows.map((row) => {
        const sorted = row.items.sort((a, b) => a.rect.x - b.rect.x);
        return {
          y: row.y,
          rect: unionRects(sorted.map((item) => item.rect)),
          text: cleanText(sorted.map((item) => item.text).join(' ')),
        };
      });
    }

    function groupTrialLeftPanelBossRows(rows) {
      const out = [];
      let current = null;
      rows.forEach((row) => {
        const bossName = extractTaskbarBossName(row.text);
        if (bossName) {
          if (current) out.push(finalizeTrialLeftPanelEntry(current));
          current = { bossName, parts: [row.text], rects: [row.rect] };
          return;
        }
        if (current && isTaskbarBossDetailText(row.text)) {
          current.parts.push(row.text);
          current.rects.push(row.rect);
        }
      });
      if (current) out.push(finalizeTrialLeftPanelEntry(current));
      return out.filter((entry) => extractTaskbarRefreshText(entry.text));
    }

    function finalizeTrialLeftPanelEntry(entry) {
      return {
        bossName: entry.bossName,
        text: cleanText(entry.parts.join(' ')),
        rect: unionRects(entry.rects),
      };
    }

    function dedupeTaskbarCandidates(candidates) {
      const out = [];
      candidates.forEach((candidate) => {
        if (!candidate) return;
        const duplicate = out.some((item) => item.bossName === candidate.bossName
          && Math.abs(Number(item.seconds) - Number(candidate.seconds)) <= 1);
        if (!duplicate) out.push(candidate);
      });
      return out;
    }

    function recordFromCandidate(candidate, context) {
      const observedAt = Date.now();
      const refreshAt = observedAt + candidate.seconds * 1000;
      const detectedName = candidate.bossName || (canAttributeRecentCombat(candidate, context) ? context.bossName : '');
      const mapMarker = chooseMapBossMarker(context, detectedName);
      const mapMarkerNameCount = mapMarker
        ? countMapBossMarkersByName(context.mapBossMarkers, mapMarker.name)
        : 0;
      const initialMapName = candidate.mapName || (mapMarker && mapMarker.mapName) || (isExplicitBossSource(candidate) ? '' : context.mapName);
      const reconciledRecord = findUniqueRecordByRefresh({
        mapName: initialMapName,
        bossName: detectedName,
        refreshAt,
        sourcePath: candidate.sourcePath,
      });
      const bossName = cleanText(mapMarker && mapMarker.name)
        || cleanText(reconciledRecord && reconciledRecord.bossName)
        || detectedName
        || '未知BOSS';
      const mapName = initialMapName || cleanText(reconciledRecord && reconciledRecord.mapName);
      const bossNameSource = (mapMarker ? mapMarker.source : '')
        || candidate.bossNameSource
        || (reconciledRecord ? 'record.refresh_reconcile' : context.bossNameSource);
      const mapSource = candidate.mapName ? candidate.mapSource : (isExplicitBossSource(candidate) ? 'unknown' : context.mapSource);
      if (bossName === '未知BOSS' && !configuredCandidates().length) return null;
      const confidence = Math.max(
        scoreRecordConfidence(candidate, { ...context, bossName, mapName, mapMarker }),
        Number(candidate.confidence) || 0,
      );
      if (confidence < 0.45) return null;
      const detectedBossName = bossName !== '未知BOSS' ? bossName : '';
      const taskbarBossNameConfirmed = isExplicitBossSource(candidate) && detectedBossName;
      const mapMarkerNameConfirmed = Boolean(mapMarker && detectedBossName);
      const autoNameConfirmed = taskbarBossNameConfirmed || mapMarkerNameConfirmed || shouldAutoConfirmNameChoice(bossName);
      const record = {
        id: recordKey({
          bossName,
          mapName,
          bossCoordinate: (mapMarker && mapMarker.coordinate) || (reconciledRecord && reconciledRecord.bossCoordinate),
          monsterId: (mapMarker && mapMarker.monsterId) || (reconciledRecord && reconciledRecord.monsterId),
          refreshAt,
        }),
        bossName,
        bossNameSource,
        detectedBossName,
        nameChoiceConfirmed: Boolean(autoNameConfirmed),
        nameChoice: autoNameConfirmed ? 'auto' : '',
        mapName,
        mapSource,
        bossCoordinate: cleanText((mapMarker && mapMarker.coordinate) || (reconciledRecord && reconciledRecord.bossCoordinate)),
        monsterId: Number((mapMarker && mapMarker.monsterId) || (reconciledRecord && reconciledRecord.monsterId)) || 0,
        mapMarkerNameCount,
        countdownText: candidate.text,
        detectedSeconds: candidate.seconds,
        observedAt,
        refreshAt,
        refreshAtText: formatClock(refreshAt),
        source: candidate.source || 'laya_scene_countdown',
        sourcePath: candidate.sourcePath,
        confidence,
      };
      if (isDismissedRecord(record)) return null;
      // Trial-only guard: scene countdown records must be complete (boss name + coordinate + seconds)
      // before we accept them; otherwise fall back to the taskbar record.
      if (isTrialLandMap(mapName)
          && isTrialSceneCountdownRecord(record)
          && !isCompleteTrialSceneRecord(record)) {
        return null;
      }
      return record;
    }

    function isTrialSceneCountdownRecord(record) {
      return cleanText(record && record.source) === 'laya_scene_countdown';
    }

    function isCompleteTrialSceneRecord(record) {
      if (!record) return false;
      const bossName = cleanText(record.bossName);
      if (!bossName || bossName === '未知BOSS') return false;
      if (!normalizeBossCoordinate(record.bossCoordinate)) return false;
      const seconds = Number(record.detectedSeconds);
      if (!seconds || seconds <= 0) return false;
      return true;
    }

    function scoreRecordConfidence(candidate, context) {
      let score = 0;
      if (context.bossName) score += 0.35;
      if (context.mapName) score += 0.15;
      if (context.mapMarker) score += 0.45;
      if (candidate.score >= 200) score += 0.25;
      if (candidate.score >= 120) score += 0.1;
      if (candidate.score >= 300) score += 0.2;
      return Math.min(1, score);
    }

    function chooseMapBossMarker(context, detectedName) {
      const markers = (context && context.mapBossMarkers) || [];
      if (!markers.length) return null;
      const name = cleanText(detectedName);
      const named = name
        ? markers.filter((marker) => cleanText(marker.name) === name)
        : markers.slice();
      if (!named.length) return null;
      if (named.length === 1) return named[0];
      const playerCoordinate = normalizeBossCoordinate(context && context.playerCoordinate);
      if (!playerCoordinate) return null;
      const near = named
        .map((marker) => ({ marker, distance: coordinateDistance(playerCoordinate, marker.coordinate) }))
        .filter((item) => Number.isFinite(item.distance))
        .sort((a, b) => a.distance - b.distance);
      if (!near[0] || near[0].distance > 24) return null;
      if (near[1] && near[1].distance === near[0].distance) return null;
      return near[0].marker;
    }

    function countMapBossMarkersByName(markers, name) {
      const target = cleanText(name);
      if (!target) return 0;
      return (markers || []).filter((marker) => cleanText(marker && marker.name) === target).length;
    }

    function canAttributeRecentCombat(candidate, context) {
      if (!candidate || !candidate.isNewObservation || !context || context.combatTargetVisible) return false;
      const source = cleanText(context.bossNameSource);
      return /^recent\./.test(source)
        && Number(context.recentBossAgeMs) >= 0
        && Number(context.recentBossAgeMs) <= RECENT_BOSS_NAME_TTL_MS;
    }

    function findUniqueRecordByRefresh(input) {
      const mapName = cleanText(input && input.mapName);
      if (!mapName) return null;
      const probe = {
        bossName: cleanText(input && input.bossName) || '未知BOSS',
        detectedBossName: cleanText(input && input.bossName),
      };
      const matches = state.records.filter((record) => (
        cleanText(record && record.mapName) === mapName
        && recordNamesMergeable(record, probe)
        && Number(record && record.refreshAt) > Date.now() - EXPIRED_KEEP_MS
        && Math.abs(Number(record && record.refreshAt) - Number(input && input.refreshAt)) <= REFRESH_RECONCILE_WINDOW_MS
      ));
      if (matches.length === 1) return matches[0];
      // Fallback: match by same countdown source path when name attribution differs
      // between scans (e.g., base name from combat context vs prefixed name from map marker).
      const sourcePath = cleanText(input && input.sourcePath);
      if (sourcePath) {
        const sourceMatches = state.records.filter((record) => (
          cleanText(record && record.mapName) === mapName
          && cleanText(record && record.sourcePath) === sourcePath
          && Number(record && record.refreshAt) > Date.now() - EXPIRED_KEEP_MS
          && Math.abs(Number(record && record.refreshAt) - Number(input && input.refreshAt)) <= REFRESH_RECONCILE_WINDOW_MS
        ));
        if (sourceMatches.length === 1) return sourceMatches[0];
      }
      return null;
    }

    function upsertRecord(next) {
      discardSupersededCountdownGuesses(next);
      const existingIndex = findMergeableRecordIndex(next, state.records);
      if (existingIndex >= 0) {
        const prev = state.records[existingIndex];
        const preferred = preferredRecordOnMerge(prev, next);
        state.records[existingIndex] = {
          ...prev,
          ...next,
          id: preferred.id || prev.id || next.id,
          bossName: chooseMergedBossName(prev, next),
          bossNameSource: chooseMergedBossNameSource(prev, next),
          detectedBossName: chooseBetterText(prev.detectedBossName, next.detectedBossName, ''),
          nameChoiceConfirmed: Boolean(prev.nameChoiceConfirmed) || Boolean(next.nameChoiceConfirmed),
          nameChoice: prev.nameChoiceConfirmed ? prev.nameChoice : next.nameChoice,
          mapName: chooseBetterText(prev.mapName, next.mapName, '未知地图'),
          mapSource: next.mapName ? next.mapSource : prev.mapSource,
          bossCoordinate: chooseBetterCoordinate(prev.bossCoordinate, next.bossCoordinate),
          monsterId: chooseBetterMonsterId(prev.monsterId, next.monsterId),
          firstObservedAt: prev.firstObservedAt || prev.observedAt || next.observedAt,
          countdownText: preferred.countdownText,
          detectedSeconds: preferred.detectedSeconds,
          observedAt: preferred.observedAt,
          refreshAt: preferred.refreshAt,
          refreshAtText: preferred.refreshAtText,
          source: preferred.source,
          sourcePath: preferred.sourcePath,
          updatedAt: Date.now(),
        };
      } else {
        state.records.unshift({
          ...next,
          firstObservedAt: next.observedAt,
          updatedAt: Date.now(),
        });
        markNewRecordHighlighted(next);
      }
      state.records.sort((a, b) => Number(a.refreshAt || 0) - Number(b.refreshAt || 0));
      if (state.records.length > MAX_RECORDS) state.records = state.records.slice(0, MAX_RECORDS);
    }

    function discardSupersededCountdownGuesses(next) {
      if (!next || !normalizeBossCoordinate(next.bossCoordinate)) return;
      const nextMap = cleanText(next.mapName);
      const nextPath = cleanText(next.sourcePath);
      if (!nextMap || !nextPath) return;
      state.records = state.records.filter((record) => {
        const staleGuess = !normalizeBossCoordinate(record && record.bossCoordinate)
          && /^recent\.|^unknown$/.test(cleanText(record && record.bossNameSource));
        const sameObservation = cleanText(record && record.mapName) === nextMap
          && cleanText(record && record.sourcePath) === nextPath
          && Math.abs(Number(record && record.refreshAt) - Number(next.refreshAt)) <= REFRESH_RECONCILE_WINDOW_MS;
        const conflictingName = cleanText(record && record.bossName)
          && cleanText(record && record.bossName) !== cleanText(next.bossName);
        return !(staleGuess && sameObservation && conflictingName);
      });
    }

    function pruneRecords() {
      const now = Date.now();
      pruneNewRecordHighlights(now);
      state.records = normalizeRecords(state.records)
        .reduce((out, item) => {
          const existingIndex = findMergeableRecordIndex(item, out);
          if (existingIndex >= 0) {
            const prev = out[existingIndex];
            const preferred = preferredRecordOnMerge(prev, item);
            out[existingIndex] = {
              ...prev,
              ...item,
              id: preferred.id || prev.id || item.id,
              bossName: chooseMergedBossName(prev, item),
              bossNameSource: chooseMergedBossNameSource(prev, item),
              detectedBossName: chooseBetterText(prev.detectedBossName, item.detectedBossName, ''),
              nameChoiceConfirmed: Boolean(prev.nameChoiceConfirmed) || Boolean(item.nameChoiceConfirmed),
              nameChoice: prev.nameChoiceConfirmed ? prev.nameChoice : item.nameChoice,
              mapName: chooseBetterText(prev.mapName, item.mapName, '未知地图'),
              mapSource: item.mapName ? item.mapSource : prev.mapSource,
              bossCoordinate: chooseBetterCoordinate(prev.bossCoordinate, item.bossCoordinate),
              monsterId: chooseBetterMonsterId(prev.monsterId, item.monsterId),
              countdownText: preferred.countdownText,
              detectedSeconds: preferred.detectedSeconds,
              observedAt: preferred.observedAt,
              refreshAt: preferred.refreshAt,
              refreshAtText: preferred.refreshAtText,
              source: preferred.source,
              sourcePath: preferred.sourcePath,
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
      pruneNewRecordHighlights(now);
      persistRecords();
    }

    function recordKey(input) {
      const name = cleanText(input.bossName || '未知BOSS');
      const map = cleanText(input.mapName || '');
      const coordinate = normalizeBossCoordinate(input.bossCoordinate);
      const monsterId = Number(input.monsterId) || 0;
      if (map && coordinate && name) return [map, coordinate, name, monsterId].join('|');
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
      if (!mapsMergeable(left.mapName, right.mapName)) return false;
      // Same countdown element (identical sourcePath) + close refresh time = same observation.
      // Name attribution can differ between scans (map marker vs combat context), so
      // bypass the name check when the source path matches.
      // Guard: if both records have different coordinates, they are distinct BOSSes
      // even if the sourcePath happened to match, so don't merge.
      if (sameCountdownSource(left, right) && withinRefreshWindow(left, right)) {
        const lc = normalizeBossCoordinate(left.bossCoordinate);
        const rc = normalizeBossCoordinate(right.bossCoordinate);
        if (lc && rc && lc !== rc) return false;
        return true;
      }
      if (!recordNamesMergeable(left, right)) return false;
      if (sameStoredRecordId(left, right)) return true;
      if (sameTrialTaskbarBossRecord(left, right)) return true;
      const leftCoordinate = normalizeBossCoordinate(left.bossCoordinate);
      const rightCoordinate = normalizeBossCoordinate(right.bossCoordinate);
      if (leftCoordinate && rightCoordinate) return leftCoordinate === rightCoordinate;
      if (canUpgradeMissingCoordinate(left, right)) return true;
      return false;
    }

    function sameStoredRecordId(left, right) {
      const a = cleanText(left && left.id);
      const b = cleanText(right && right.id);
      return Boolean(a && b && a === b);
    }

    function canUpgradeMissingCoordinate(left, right) {
      const leftCoordinate = normalizeBossCoordinate(left && left.bossCoordinate);
      const rightCoordinate = normalizeBossCoordinate(right && right.bossCoordinate);
      if (leftCoordinate && rightCoordinate) return false;
      const markerRecord = leftCoordinate ? left : (rightCoordinate ? right : null);
      if (!markerRecord || !hasUniqueMapMarkerIdentity(markerRecord)) return false;
      return withinRefreshReconcileWindow(left, right);
    }

    function hasUniqueMapMarkerIdentity(record) {
      return cleanText(record && record.bossNameSource) === 'fgui.map_marker'
        && normalizeBossCoordinate(record && record.bossCoordinate)
        && Number(record && record.mapMarkerNameCount) === 1;
    }

    function withinRefreshReconcileWindow(left, right) {
      return Math.abs(Number(left && left.refreshAt) - Number(right && right.refreshAt))
        <= REFRESH_RECONCILE_WINDOW_MS;
    }

    function sameCountdownSource(left, right) {
      const a = cleanText(left && left.sourcePath);
      const b = cleanText(right && right.sourcePath);
      return Boolean(a && b && a === b);
    }

    function withinRefreshWindow(left, right) {
      return Math.abs(Number(left && left.refreshAt) - Number(right && right.refreshAt)) <= MERGE_REFRESH_WINDOW_MS;
    }

    function sameTrialTaskbarBossRecord(left, right) {
      return isTrialTaskbarRecord(left) && isTrialTaskbarRecord(right);
    }

    function isTrialTaskbarRecord(record) {
      return /^fgui_trial_/.test(cleanText(record && record.source))
        || /^fgui\.left_panel:/.test(cleanText(record && record.sourcePath));
    }

    function preferredRecordOnMerge(previous, next) {
      if (sameTrialTaskbarBossRecord(previous, next)) {
        return Number(next.observedAt) >= Number(previous.observedAt) ? next : previous;
      }
      return next;
    }

    function recordNamesMergeable(left, right) {
      const leftNames = recordKnownNames(left);
      const rightNames = recordKnownNames(right);
      if (!leftNames.length || !rightNames.length) return true;
      return leftNames.some((name) => rightNames.includes(name));
    }

    function recordKnownNames(record) {
      return uniqueStrings([
        record && record.bossName,
        record && record.detectedBossName,
      ].filter((name) => {
        const value = cleanText(name);
        return value && value !== '未知BOSS';
      }));
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

    function chooseMergedBossName(previous, next) {
      if (previous && previous.nameChoiceConfirmed && cleanText(previous.bossName) && cleanText(previous.bossName) !== '未知BOSS') {
        return cleanText(previous.bossName);
      }
      return chooseBetterText(previous && previous.bossName, next && next.bossName, '未知BOSS');
    }

    function chooseMergedBossNameSource(previous, next) {
      if (previous && previous.nameChoiceConfirmed && cleanText(previous.bossNameSource)) return cleanText(previous.bossNameSource);
      return next && next.bossName && next.bossName !== '未知BOSS' ? next.bossNameSource : previous && previous.bossNameSource;
    }

    function chooseBetterCoordinate(previous, next) {
      return normalizeBossCoordinate(next) || normalizeBossCoordinate(previous);
    }

    function chooseBetterMonsterId(previous, next) {
      return Number(next) || Number(previous) || 0;
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

    function configuredCandidates(config) {
      return normalizeConfig(config || state.config).candidates;
    }

    function isConfiguredCandidate(name) {
      const value = cleanText(name);
      if (!value || value === '未知BOSS') return false;
      return configuredCandidates().includes(value);
    }

    function shouldKeepExistingRecord(record) {
      if (!record) return false;
      if (record.nameChoiceConfirmed && record.bossName && record.bossName !== '未知BOSS') return true;
      if (record.detectedBossName && record.detectedBossName !== '未知BOSS') return true;
      if (isExplicitBossSource(record) && record.bossName && record.bossName !== '未知BOSS') return true;
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
      return setRecordNameAt(index, targetName, 'manual');
    }

    function confirmRecordNameChoice(id, name, choice) {
      const targetName = cleanText(name);
      if (!targetName || targetName === '未知BOSS') return null;
      const key = cleanText(id);
      const index = state.records.findIndex((record) => cleanText(record.id) === key);
      if (index < 0) return null;
      const normalizedChoice = cleanText(choice) === 'config' || cleanText(choice) === 'config_overwrite'
        ? 'config_overwrite'
        : 'auto';
      return setRecordNameAt(index, targetName, normalizedChoice);
    }

    function setRecordNameAt(index, targetName, choice) {
      const previous = state.records[index];
      if (!previous) return null;
      const previousKey = cleanText(previous.id);
      const nextKey = recordKey({
        bossName: targetName,
        mapName: previous.mapName,
        bossCoordinate: previous.bossCoordinate,
        monsterId: previous.monsterId,
        refreshAt: previous.refreshAt,
      });
      const highlightUntil = previousKey ? Number(state.newRecordHighlights[previousKey]) || 0 : 0;
      const previousSource = cleanText(previous.bossNameSource);
      const detectedBossName = cleanText(previous.detectedBossName)
        || (previousSource && previousSource !== 'manual' ? cleanText(previous.bossName) : '');
      state.records[index] = {
        ...previous,
        id: nextKey,
        bossName: targetName,
        bossNameSource: choice === 'auto' ? (previous.bossNameSource || 'auto.confirmed') : 'manual',
        detectedBossName,
        nameChoiceConfirmed: true,
        nameChoice: choice || 'manual',
        confidence: Math.max(Number(previous.confidence) || 0, 0.95),
        updatedAt: Date.now(),
      };
      if (previousKey && previousKey !== nextKey) delete state.newRecordHighlights[previousKey];
      if (highlightUntil > Date.now()) state.newRecordHighlights[nextKey] = highlightUntil;
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
      delete state.newRecordHighlights[key];
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
        recordKey({ bossName: record.bossName, mapName: record.mapName, bossCoordinate: record.bossCoordinate, monsterId: record.monsterId, refreshAt: refreshAt - MERGE_REFRESH_WINDOW_MS }),
        recordKey({ bossName: record.bossName, mapName: record.mapName, bossCoordinate: record.bossCoordinate, monsterId: record.monsterId, refreshAt }),
        recordKey({ bossName: record.bossName, mapName: record.mapName, bossCoordinate: record.bossCoordinate, monsterId: record.monsterId, refreshAt: refreshAt + MERGE_REFRESH_WINDOW_MS }),
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

    function markNewRecordHighlighted(record) {
      const key = cleanText(record && record.id);
      if (key) state.newRecordHighlights[key] = Date.now() + NEW_RECORD_HIGHLIGHT_MS;
    }

    function isNewRecordHighlighted(record, now) {
      const key = cleanText(record && record.id);
      return Boolean(key && Number(state.newRecordHighlights[key]) > now);
    }

    function pruneNewRecordHighlights(now) {
      const activeRecordIds = {};
      state.records.forEach((record) => {
        const key = cleanText(record && record.id);
        if (key) activeRecordIds[key] = true;
      });
      Object.keys(state.newRecordHighlights).forEach((key) => {
        if (Number(state.newRecordHighlights[key]) <= now || !activeRecordIds[key]) {
          delete state.newRecordHighlights[key];
        }
      });
    }

    function normalizeCandidateName(name) {
      const value = cleanText(name);
      if (!isConfiguredCandidate(value)) return '';
      return value;
    }

    function shouldAutoConfirmNameChoice(name, config) {
      const value = cleanText(name);
      if (!value || value === '未知BOSS') return false;
      const candidates = configuredCandidates(config);
      return !candidates.some((candidate) => cleanText(candidate) && cleanText(candidate) !== value);
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
      applyOverlaySize(panel);
      panel.style.boxSizing = 'border-box';
      panel.style.border = '1px solid rgba(255,255,255,0.28)';
      panel.style.background = 'rgba(10,12,16,0.78)';
      panel.style.color = '#f3f7ff';
      panel.style.font = 'var(--mu-boss-overlay-font-size, 12px)/1.35 Arial, sans-serif';
      panel.style.borderRadius = '6px';
      panel.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
      panel.style.pointerEvents = 'auto';
      panel.style.userSelect = 'none';
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      panel.style.minWidth = `${MIN_OVERLAY_WIDTH}px`;
      panel.style.minHeight = `${MIN_OVERLAY_HEIGHT}px`;
      panel.style.maxWidth = 'calc(100vw - 8px)';
      panel.style.maxHeight = 'calc(100vh - 8px)';
      panel.style.overflow = 'hidden';
      applyOverlayTypography(panel);

      const header = doc.createElement('div');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.justifyContent = 'space-between';
      header.style.gap = '6px';
      header.style.padding = '5px 6px';
      header.style.borderBottom = '1px solid rgba(255,255,255,0.16)';
      header.style.cursor = 'move';
      header.style.flex = '0 0 auto';
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
        state.newRecordHighlights = {};
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
      status.style.flex = '0 0 auto';

      const body = doc.createElement('div');
      body.style.padding = '4px 5px';
      body.style.maxHeight = '280px';
      body.style.overflow = 'hidden auto';
      body.style.flex = '1 1 auto';
      body.style.minHeight = '0';

      const configPanel = doc.createElement('div');
      configPanel.style.display = 'none';
      configPanel.style.padding = '6px';
      configPanel.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
      configPanel.style.background = 'rgba(255,255,255,0.05)';
      configPanel.style.userSelect = 'text';
      configPanel.style.webkitUserSelect = 'text';
      configPanel.style.flex = '0 0 auto';

      panel.appendChild(header);
      panel.appendChild(status);
      panel.appendChild(configPanel);
      panel.appendChild(body);
      appendResizeHandles(doc, panel);
      state.statusEl = status;
      state.configEl = configPanel;
      state.bodyEl = body;
      applyOverlayBodySizing();
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

    function applyOverlaySize(panel) {
      const target = panel || state.overlayEl;
      if (!target) return;
      const size = clampSize(state.size || { width: DEFAULT_OVERLAY_WIDTH, height: null }, target);
      target.style.width = `${size.width}px`;
      target.style.height = state.size ? `${size.height}px` : '';
      if (state.size) state.size = size;
    }

    function appendResizeHandles(doc, panel) {
      [
        ['n', 'ns-resize'],
        ['e', 'ew-resize'],
        ['s', 'ns-resize'],
        ['w', 'ew-resize'],
        ['ne', 'nesw-resize'],
        ['nw', 'nwse-resize'],
        ['se', 'nwse-resize'],
        ['sw', 'nesw-resize'],
      ].forEach(([edge, cursor]) => {
        const handle = doc.createElement('div');
        handle.setAttribute('data-mu-boss-resize', edge);
        handle.style.position = 'absolute';
        handle.style.zIndex = '2';
        handle.style.pointerEvents = 'auto';
        handle.style.cursor = cursor;
        handle.style.background = 'transparent';
        if (edge.indexOf('n') >= 0) handle.style.top = '-4px';
        if (edge.indexOf('s') >= 0) handle.style.bottom = '-4px';
        if (edge.indexOf('w') >= 0) handle.style.left = '-4px';
        if (edge.indexOf('e') >= 0) handle.style.right = '-4px';
        if (edge === 'n' || edge === 's') {
          handle.style.left = '10px';
          handle.style.right = '10px';
          handle.style.height = '8px';
        } else if (edge === 'e' || edge === 'w') {
          handle.style.top = '10px';
          handle.style.bottom = '10px';
          handle.style.width = '8px';
        } else {
          handle.style.width = '12px';
          handle.style.height = '12px';
        }
        handle.addEventListener('mousedown', (event) => startResizeOverlay(event, edge));
        panel.appendChild(handle);
      });
    }

    function startDragOverlay(event) {
      if (!state.overlayEl || event.button !== 0) return;
      if (isConfigInputEvent(event)) return;
      if (event.target && event.target.getAttribute && event.target.getAttribute('data-mu-boss-resize')) return;
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

    function startResizeOverlay(event, edge) {
      if (!state.overlayEl || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = state.overlayEl.getBoundingClientRect();
      state.resize = {
        edge,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      state.overlayEl.style.right = '';
      state.overlayEl.style.left = `${Math.round(rect.left)}px`;
      state.overlayEl.style.top = `${Math.round(rect.top)}px`;
      state.overlayEl.style.width = `${Math.round(rect.width)}px`;
      state.overlayEl.style.height = `${Math.round(rect.height)}px`;
      window.document.addEventListener('mousemove', resizeOverlay);
      window.document.addEventListener('mouseup', stopResizeOverlay);
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

    function resizeOverlay(event) {
      if (!state.resize || !state.overlayEl) return;
      const next = resizeRectFromPointer(event.clientX, event.clientY, state.resize);
      state.size = { width: next.width, height: next.height };
      state.overlayEl.style.left = `${next.left}px`;
      state.overlayEl.style.top = `${next.top}px`;
      state.overlayEl.style.width = `${next.width}px`;
      state.overlayEl.style.height = `${next.height}px`;
      applyOverlayTypography();
      applyOverlayBodySizing();
    }

    function stopResizeOverlay() {
      if (!state.resize || !state.overlayEl) return;
      state.resize = null;
      const rect = state.overlayEl.getBoundingClientRect();
      state.position = clampPoint(rect.left, rect.top, state.overlayEl);
      state.size = clampSize({ width: rect.width, height: rect.height }, state.overlayEl);
      state.overlayEl.style.left = `${state.position.left}px`;
      state.overlayEl.style.top = `${state.position.top}px`;
      state.overlayEl.style.width = `${state.size.width}px`;
      state.overlayEl.style.height = `${state.size.height}px`;
      writeJson(POSITION_KEY, state.position);
      writeJson(SIZE_KEY, state.size);
      applyOverlayTypography();
      applyOverlayBodySizing();
      window.document.removeEventListener('mousemove', resizeOverlay);
      window.document.removeEventListener('mouseup', stopResizeOverlay);
    }

    function resizeRectFromPointer(clientX, clientY, resize) {
      const margin = 4;
      const viewportWidth = Number(window.innerWidth) || 1334;
      const viewportHeight = Number(window.innerHeight) || 750;
      const dx = clientX - resize.startX;
      const dy = clientY - resize.startY;
      const edge = resize.edge || '';
      let left = resize.left;
      let top = resize.top;
      let width = resize.width;
      let height = resize.height;

      if (edge.indexOf('w') >= 0) {
        const right = resize.left + resize.width;
        left = Math.max(margin, Math.min(resize.left + dx, right - MIN_OVERLAY_WIDTH));
        width = right - left;
      } else if (edge.indexOf('e') >= 0) {
        width = Math.max(MIN_OVERLAY_WIDTH, Math.min(resize.width + dx, viewportWidth - left - margin));
      }

      if (edge.indexOf('n') >= 0) {
        const bottom = resize.top + resize.height;
        top = Math.max(margin, Math.min(resize.top + dy, bottom - MIN_OVERLAY_HEIGHT));
        height = bottom - top;
      } else if (edge.indexOf('s') >= 0) {
        height = Math.max(MIN_OVERLAY_HEIGHT, Math.min(resize.height + dy, viewportHeight - top - margin));
      }

      width = Math.max(MIN_OVERLAY_WIDTH, Math.min(Math.round(width), viewportWidth - left - margin));
      height = Math.max(MIN_OVERLAY_HEIGHT, Math.min(Math.round(height), viewportHeight - top - margin));
      return {
        left: Math.round(left),
        top: Math.round(top),
        width,
        height,
      };
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
      if (!state.overlayEl) return;
      if (state.size) {
        state.size = clampSize(state.size, state.overlayEl);
        state.overlayEl.style.width = `${state.size.width}px`;
        state.overlayEl.style.height = `${state.size.height}px`;
        writeJson(SIZE_KEY, state.size);
      }
      if (state.position) {
        const point = clampPoint(state.position.left, state.position.top, state.overlayEl);
        state.position = point;
        state.overlayEl.style.left = `${point.left}px`;
        state.overlayEl.style.top = `${point.top}px`;
        state.overlayEl.style.right = '';
        writeJson(POSITION_KEY, state.position);
      }
      applyOverlayTypography();
      applyOverlayBodySizing();
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

    function clampSize(size, el) {
      const margin = 4;
      const currentWidth = Number(el && el.offsetWidth) || DEFAULT_OVERLAY_WIDTH;
      const currentHeight = Number(el && el.offsetHeight) || DEFAULT_OVERLAY_HEIGHT;
      const viewportWidth = Number(window.innerWidth) || 1334;
      const viewportHeight = Number(window.innerHeight) || 750;
      const rawWidth = Number(size && size.width);
      const rawHeight = Number(size && size.height);
      return {
        width: Math.max(MIN_OVERLAY_WIDTH, Math.min(Math.round(Number.isFinite(rawWidth) ? rawWidth : currentWidth), viewportWidth - margin * 2)),
        height: Math.max(MIN_OVERLAY_HEIGHT, Math.min(Math.round(Number.isFinite(rawHeight) ? rawHeight : currentHeight), viewportHeight - margin * 2)),
      };
    }

    function applyOverlayTypography(panel) {
      const target = panel || state.overlayEl;
      if (!target) return;
      const width = state.size ? state.size.width : DEFAULT_OVERLAY_WIDTH;
      const height = state.size ? state.size.height : DEFAULT_OVERLAY_HEIGHT;
      const scale = Math.sqrt(Math.max(0.45, width / DEFAULT_OVERLAY_WIDTH) * Math.max(0.45, height / DEFAULT_OVERLAY_HEIGHT));
      const fontSize = Math.max(MIN_OVERLAY_FONT_PX, Math.min(MAX_OVERLAY_FONT_PX, Math.round(12 * scale * 10) / 10));
      target.style.setProperty('--mu-boss-overlay-font-size', `${fontSize}px`);
      target.style.setProperty('--mu-boss-small-font-size', `${Math.max(9, Math.round(fontSize * 0.92 * 10) / 10)}px`);
      target.style.setProperty('--mu-boss-button-font-size', `${Math.max(10, Math.round(fontSize * 10) / 10)}px`);
      target.style.setProperty('--mu-boss-button-height', `${Math.max(20, Math.round(fontSize * 1.85))}px`);
      target.style.setProperty('--mu-boss-button-line-height', `${Math.max(18, Math.round(fontSize * 1.65))}px`);
      target.style.setProperty('--mu-boss-close-size', `${Math.max(18, Math.round(fontSize * 1.55))}px`);
      target.style.setProperty('--mu-boss-close-font-size', `${Math.max(13, Math.round(fontSize * 1.15 * 10) / 10)}px`);
    }

    function applyOverlayBodySizing() {
      if (state.overlayEl && state.size) {
        state.overlayEl.style.height = state.collapsed && !state.resize ? '' : `${state.size.height}px`;
      }
      if (!state.bodyEl) return;
      state.bodyEl.style.maxHeight = state.size ? 'none' : '280px';
    }

    function renderOverlayContent() {
      if (!state.overlayEl || !state.bodyEl || !state.statusEl) return;
      applyOverlayTypography();
      applyOverlayBodySizing();
      const toggle = state.overlayEl.querySelector && state.overlayEl.querySelector('button[title="收起/展开"]');
      if (toggle) toggle.textContent = state.collapsed ? '+' : '-';
      renderConfigPanel();

      const now = Date.now();
      pruneNewRecordHighlights(now);
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
      const isNewHighlight = isNewRecordHighlighted(record, now);

      row.style.position = 'relative';
      row.style.padding = '4px 26px 4px 6px';
      row.style.margin = '0 0 4px';
      row.style.border = isNewHighlight
        ? '1px solid rgba(92,226,255,0.95)'
        : (soon ? '1px solid rgba(255,226,82,0.85)' : '1px solid rgba(255,255,255,0.12)');
      row.style.background = isNewHighlight
        ? 'rgba(10,116,138,0.72)'
        : (soon ? 'rgba(164,84,0,0.58)' : 'rgba(255,255,255,0.06)');
      row.style.borderRadius = '4px';
      row.style.boxShadow = isNewHighlight ? '0 0 10px rgba(92,226,255,0.32)' : 'none';

      const head = doc.createElement('div');
      head.style.display = 'flex';
      head.style.alignItems = 'center';
      head.style.justifyContent = 'space-between';
      head.style.gap = '6px';
      head.style.minWidth = '0';

      const title = doc.createElement('div');
      const direction = bossDirectionLabel(record, state.mapBossMarkers);
      if (direction) {
        const directionEl = doc.createElement('span');
        directionEl.textContent = `${direction} · `;
        directionEl.style.color = '#62b8ff';
        directionEl.style.fontWeight = '700';
        title.appendChild(directionEl);
      }
      title.appendChild(doc.createTextNode(record.bossName || '未知BOSS'));
      title.style.fontWeight = '700';
      title.style.color = isNewHighlight ? '#e8fcff' : (soon ? '#fff0a8' : '#ffffff');
      title.style.whiteSpace = 'nowrap';
      title.style.overflow = 'hidden';
      title.style.textOverflow = 'ellipsis';
      title.style.minWidth = '0';
      title.style.flex = '1 1 auto';

      const place = doc.createElement('div');
      place.textContent = [record.mapName || '未知地图', record.bossCoordinate ? `(${record.bossCoordinate})` : '']
        .filter(Boolean)
        .join(' ');
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
      close.style.padding = '0';
      close.style.border = '1px solid rgba(255,255,255,0.22)';
      close.style.borderRadius = '3px';
      close.style.background = 'rgba(22,25,30,0.86)';
      close.style.color = '#dce7f6';
      close.style.width = 'var(--mu-boss-close-size, 18px)';
      close.style.height = 'var(--mu-boss-close-size, 18px)';
      close.style.font = 'var(--mu-boss-close-font-size, 14px)/calc(var(--mu-boss-close-size, 18px) - 2px) Arial, sans-serif';
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
      time.style.color = isNewHighlight ? '#c9fbff' : (expired ? '#72ff92' : (soon ? '#ffe66d' : '#9fe6ff'));
      time.style.fontWeight = isNewHighlight || soon ? '700' : '400';
      time.style.whiteSpace = 'nowrap';
      time.style.overflow = 'hidden';
      time.style.textOverflow = 'ellipsis';

      head.appendChild(title);
      head.appendChild(place);
      row.appendChild(head);
      row.appendChild(close);
      row.appendChild(time);
      const nameChoice = renderNameChoice(record);
      if (nameChoice) row.appendChild(nameChoice);
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
      textarea.style.font = 'var(--mu-boss-overlay-font-size, 12px)/1.35 Arial, sans-serif';
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
      hint.style.fontSize = 'var(--mu-boss-small-font-size, 11px)';
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

    function renderNameChoice(record) {
      if (!shouldShowNameChoice(record)) return null;
      const wrap = window.document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexWrap = 'wrap';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '4px';
      wrap.style.marginTop = '5px';
      const detectedName = detectedRecordName(record);
      if (detectedName) {
        wrap.appendChild(createNameChoiceButton(shortBossName(detectedName), `确认使用自动检测名: ${detectedName}`, '#236b53', (event) => {
          event.stopPropagation();
          confirmRecordNameChoice(record.id, detectedName, 'auto');
        }));
      }
      configuredCandidates()
        .filter((name) => cleanText(name) && cleanText(name) !== detectedName)
        .forEach((name) => {
          wrap.appendChild(createNameChoiceButton(shortBossName(name), `使用配置名覆盖: ${name}`, 'rgba(138,38,38,0.92)', (event) => {
            event.stopPropagation();
            confirmRecordNameChoice(record.id, name, 'config_overwrite');
          }));
        });
      return wrap;
    }

    function shouldShowNameChoice(record) {
      if (!record || record.nameChoiceConfirmed) return false;
      if (isExplicitBossSource(record)) return false;
      const detectedName = detectedRecordName(record);
      const configNames = configuredCandidates().filter((name) => cleanText(name) && cleanText(name) !== detectedName);
      if (!configNames.length) return false;
      return Boolean(detectedName || record.bossName === '未知BOSS');
    }

    function detectedRecordName(record) {
      const detected = cleanText(record && record.detectedBossName);
      if (detected && detected !== '未知BOSS') return detected;
      const source = cleanText(record && record.bossNameSource);
      const current = cleanText(record && record.bossName);
      if (current && current !== '未知BOSS' && source !== 'manual') return current;
      return '';
    }

    function createNameChoiceButton(text, title, background, onClick) {
      const button = window.document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.title = title;
      button.style.padding = '2px 5px';
      button.style.border = '1px solid rgba(255,255,255,0.24)';
      button.style.borderRadius = '4px';
      button.style.background = background;
      button.style.color = '#fff';
      button.style.font = 'var(--mu-boss-small-font-size, 11px)/1.3 Arial, sans-serif';
      button.style.cursor = 'pointer';
      button.addEventListener('click', onClick);
      return button;
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
      button.style.width = 'calc(var(--mu-boss-button-height, 22px) + 2px)';
      button.style.height = 'var(--mu-boss-button-height, 22px)';
      button.style.padding = '0';
      button.style.border = '1px solid rgba(255,255,255,0.28)';
      button.style.borderRadius = '4px';
      button.style.background = 'rgba(38,42,50,0.92)';
      button.style.color = '#fff';
      button.style.font = 'var(--mu-boss-button-font-size, 12px)/var(--mu-boss-button-line-height, 20px) Arial, sans-serif';
      button.style.cursor = 'pointer';
    }

    function walkFgui(node, visit, inheritedVisible, depth, path) {
      if (!node || depth > 18) return;
      const selfVisible = node.visible !== false && node.internalVisible !== false;
      const effectiveVisible = inheritedVisible !== false && selfVisible;
      const currentPath = path || 'fgui.root';
      visit(node, effectiveVisible, currentPath);
      const count = Number(node.numChildren) || 0;
      for (let index = 0; index < count; index += 1) {
        if (typeof node.getChildAt === 'function') {
          const child = node.getChildAt(index);
          const childName = cleanText(safeString(() => child.name)) || '?';
          walkFgui(child, visit, effectiveVisible, depth + 1, `${currentPath}/${childName}[${index}]`);
        }
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

    function extractCombatTargetName(text) {
      const value = cleanText(text);
      const lvIndex = value.search(/\bLv\s*\d+/i);
      if (lvIndex < 0) return '';
      // Try before Lv first (legacy format: 'BossName Lv1350')
      const beforeLevel = value.slice(0, lvIndex)
        .replace(/(?:BOSS|目标|怪物|名称)\s*[:：]?/ig, ' ')
        .trim();
      const beforeChunks = beforeLevel.match(/[\u4e00-\u9fa5]{2,18}/g) || [];
      if (beforeChunks.length) return cleanText(beforeChunks[beforeChunks.length - 1]);
      // Then try after Lv (actual format: 'Lv1350 BossName  OwnerName')
      const afterLevel = value.slice(lvIndex).replace(/^\s*Lv\s*\d+\s*/i, '').trim();
      const afterChunks = afterLevel.match(/[\u4e00-\u9fa5]{2,18}/g) || [];
      if (afterChunks.length) return cleanText(afterChunks[0]);
      return extractBossName(value);
    }

    function extractTaskbarBossName(text) {
      const value = cleanText(text);
      if (!value) return '';
      const names = uniqueStrings(configuredCandidates().concat(BOSS_NAME_EXAMPLES))
        .sort((a, b) => b.length - a.length);
      return names.find((name) => {
        if (!name) return false;
        if (value === name || value.indexOf(name) === 0) return true;
        if (name === '龙虾') return /^龙虾(?:战士)?$/.test(value);
        return name.length >= 4 && value.includes(name);
      }) || '';
    }

    function isExplicitBossSource(item) {
      return /^fgui_trial_/.test(cleanText(item && item.source));
    }

    function parseColonSeconds(text) {
      const match = cleanText(text).match(/^(\d{1,2}):([0-5]\d)$/);
      if (!match) return null;
      return Number(match[1]) * 60 + Number(match[2]);
    }

    function parseCountdownSeconds(text) {
      const value = cleanText(text);
      let match = value.match(/(\d{1,2}):([0-5]\d)(?::([0-5]\d))?/);
      if (match) {
        if (match[3] != null) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        return Number(match[1]) * 60 + Number(match[2]);
      }
      const hourMatch = value.match(/(\d+)\s*小时/);
      const minuteMatch = value.match(/(\d+)\s*分/);
      const secondMatch = value.match(/(\d+)\s*秒/);
      if (!hourMatch && !minuteMatch && !secondMatch) return null;
      return (Number(hourMatch && hourMatch[1]) || 0) * 3600
        + (Number(minuteMatch && minuteMatch[1]) || 0) * 60
        + (Number(secondMatch && secondMatch[1]) || 0);
    }

    function parseTaskbarCountdownSeconds(text) {
      const value = cleanText(text).replace(/\s+/g, '');
      if (!value || isTrialTaskbarLiveBossStatus(value)) return null;
      const countdownText = stripTaskbarCountdownLabel(value);
      const colonMatch = countdownText.match(/^(\d{1,2}:[0-5]\d(?::[0-5]\d)?)(?:后)?(?:刷新|复活)?$/);
      if (colonMatch) return parseCountdownSeconds(colonMatch[1]);
      const unitMatch = countdownText.match(/^((?:(?:\d+)小时)?(?:(?:\d+)分)?(?:(?:\d+)秒)?)(?:后)?(?:刷新|复活)?$/);
      if (!unitMatch || !/\d+(?:小时|分|秒)/.test(unitMatch[1])) return null;
      return parseCountdownSeconds(unitMatch[1]);
    }

    function stripTaskbarCountdownLabel(text) {
      return cleanText(text)
        .replace(/\s+/g, '')
        .replace(/^(?:剩余(?:刷新|复活)?(?:倒计时|时间)?|(?:刷新|复活)(?:倒计时|时间)?|倒计时|时间)[:：]?/, '');
    }

    function extractTaskbarRefreshText(text) {
      const value = cleanText(text).replace(/\s+/g, '');
      const match = value.match(/(?:剩余)?(?:刷新|复活)?(?:倒计时|时间)?[:：]?(?:\d{1,2}:[0-5]\d(?::[0-5]\d)?|\d+小时(?:\d+分)?(?:\d+秒)?|\d+分(?:\d+秒)?|\d+秒)(?:后)?(?:刷新|复活)?/);
      return match ? match[0] : '';
    }

    function isTrialTaskbarLiveBossStatus(text) {
      const value = cleanText(text);
      return /待击杀|已刷新|伤害|排名|排行|第[一二三四五六七八九十\d]+名|输出|玩家|挑战/.test(value);
    }

    function isTaskbarBossDetailText(text) {
      return /坐标\s*\d{1,3},\d{1,3}|\(\d{1,3},\d{1,3}\)|剩余刷新时间|刷新时间|待击杀/.test(cleanText(text));
    }

    function taskbarMapName(context) {
      const mapName = cleanText(context && context.mapName);
      return isTrialLandMap(mapName) ? mapName : '';
    }

    function readDirectChildTexts(node) {
      const out = {};
      const count = Number(node && node.numChildren) || 0;
      for (let index = 0; index < count; index += 1) {
        if (!node || typeof node.getChildAt !== 'function') continue;
        const child = node.getChildAt(index);
        if (child.visible === false || child.internalVisible === false) continue;
        const name = cleanText(safeString(() => child.name));
        if (name === 'nameTxt' || name === 'desTxt') {
          out[name] = firstCleanText(
            safeString(() => child.text),
            safeString(() => child.title)
          );
        }
      }
      return out;
    }

    function isTrialTaskbarEntryPath(path) {
      return /compLeftTop.*activityInfoCom.*Damage list/i.test(cleanText(path));
    }

    function isTrialLandMap(mapName) {
      return /试炼之地/.test(cleanText(mapName));
    }

    function fguiContentText(node) {
      return firstCleanText(
        safeString(() => node.text),
        safeString(() => node.title)
      );
    }

    function fguiRect(node) {
      try {
        if (node && typeof node.localToGlobalRect === 'function') {
          const rect = node.localToGlobalRect(0, 0, node.width || 0, node.height || 0);
          if (rect) {
            return {
              x: Number(rect.x) || 0,
              y: Number(rect.y) || 0,
              w: Number(rect.width) || 0,
              h: Number(rect.height) || 0,
            };
          }
        }
      } catch (_) {}
      const rect = {
        x: Number(node && node.x) || 0,
        y: Number(node && node.y) || 0,
        w: Number(node && node.width) || 0,
        h: Number(node && node.height) || 0,
      };
      let parent = node && node.parent;
      while (parent) {
        rect.x += Number(parent.x) || 0;
        rect.y += Number(parent.y) || 0;
        parent = parent.parent;
      }
      return rect;
    }

    function isTrialLeftPanelTextRect(rect) {
      if (!rect) return false;
      return rect.x <= 420
        && rect.y >= 60
        && rect.y <= 430
        && rect.w >= 10
        && rect.h >= 8
        && rect.h <= 90;
    }

    function unionRects(rects) {
      const valid = (rects || []).filter(Boolean);
      if (!valid.length) return { x: 0, y: 0, w: 0, h: 0 };
      const minX = Math.min.apply(null, valid.map((rect) => rect.x));
      const minY = Math.min.apply(null, valid.map((rect) => rect.y));
      const maxX = Math.max.apply(null, valid.map((rect) => rect.x + rect.w));
      const maxY = Math.max.apply(null, valid.map((rect) => rect.y + rect.h));
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function normalizeCoordinate(text) {
      const match = cleanText(text).match(/(\d{1,4})\s*[,，]\s*(\d{1,4})/);
      return match ? `${match[1]},${match[2]}` : '';
    }

    function normalizeBossCoordinate(value) {
      const match = cleanText(value).match(/^(\d{1,4})\s*(?:#|,|，)\s*(\d{1,4})$/);
      return match ? `${Number(match[1])},${Number(match[2])}` : '';
    }

    function parseBossCoordinate(value) {
      const coordinate = normalizeBossCoordinate(value);
      if (!coordinate) return null;
      const [x, y] = coordinate.split(',').map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y, coordinate } : null;
    }

    function bossDirectionLabel(record, markers) {
      const mapName = cleanText(record && record.mapName);
      const bossName = cleanText(record && record.bossName);
      const current = parseBossCoordinate(record && record.bossCoordinate);
      if (!mapName || !bossName || !current) return '';

      const seen = {};
      const sameBosses = (markers || []).filter((marker) => {
        const coordinate = normalizeBossCoordinate(marker && marker.coordinate);
        if (cleanText(marker && marker.mapName) !== mapName || cleanText(marker && marker.name) !== bossName) return false;
        if (!coordinate || seen[coordinate]) return false;
        seen[coordinate] = true;
        return true;
      }).map((marker) => parseBossCoordinate(marker.coordinate));
      if (sameBosses.length !== 2) return '';

      if (!sameBosses.some((item) => item.coordinate === current.coordinate)) return '';
      const other = sameBosses.find((item) => item.coordinate !== current.coordinate);
      if (!other) return '';
      const deltaX = other.x - current.x;
      const deltaY = other.y - current.y;
      if (deltaX === 0 && deltaY === 0) return '';
      if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX > 0 ? '左' : '右';
      return deltaY > 0 ? '下' : '上';
    }

    function coordinateDistance(left, right) {
      const a = normalizeBossCoordinate(left).split(',').map(Number);
      const b = normalizeBossCoordinate(right).split(',').map(Number);
      if (a.length !== 2 || b.length !== 2 || a.some((value) => !Number.isFinite(value)) || b.some((value) => !Number.isFinite(value))) return NaN;
      return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    }

    function normalizeMapName(text, nodeName) {
      const raw = cleanText(text)
        .replace(/\bmapName\b/ig, '')
        .replace(/\s*\d+线\s*$/, '')
        .trim();
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

    function normalizeRecords(value, config) {
      if (!Array.isArray(value)) return [];
      return value
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const refreshAt = Number(item.refreshAt);
          if (!Number.isFinite(refreshAt)) return null;
          const bossName = cleanText(item.bossName || item.name || '未知BOSS');
          const bossNameSource = cleanText(item.bossNameSource);
          const detectedBossName = cleanText(item.detectedBossName)
            || (bossNameSource && bossNameSource !== 'manual' && bossName !== '未知BOSS' ? bossName : '');
          const nameChoiceConfirmed = item.nameChoiceConfirmed === true
            || (bossNameSource === 'manual' && bossName !== '未知BOSS')
            || shouldAutoConfirmNameChoice(bossName, config);
          return {
            id: cleanText(item.id) || recordKey({
              bossName,
              mapName: item.mapName,
              bossCoordinate: item.bossCoordinate,
              monsterId: item.monsterId,
              refreshAt,
            }),
            bossName,
            bossNameSource,
            detectedBossName,
            nameChoiceConfirmed,
            nameChoice: cleanText(item.nameChoice) || (nameChoiceConfirmed ? 'auto' : ''),
            mapName: cleanText(item.mapName),
            mapSource: cleanText(item.mapSource),
            bossCoordinate: normalizeBossCoordinate(item.bossCoordinate),
            monsterId: Number(item.monsterId) || 0,
            mapMarkerNameCount: Math.max(0, Number(item.mapMarkerNameCount) || 0),
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

    function readSize() {
      const value = readJson(SIZE_KEY, null);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const width = Number(value.width);
      const height = Number(value.height);
      if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
      return {
        width: Math.max(MIN_OVERLAY_WIDTH, Math.round(width)),
        height: Math.max(MIN_OVERLAY_HEIGHT, Math.round(height)),
      };
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
        .replace(/\[\/?[^\]]*\]/gi, '')
        .replace(/&[a-z]+;/gi, ' ')
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
