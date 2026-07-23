// ==UserScript==
// @name         全民红月 - BOSS 统计面板
// @namespace    codex.mu.boss-stats
// @version      1.1.1
// @description  读取统计事件 journal,按时间窗口聚合打 BOSS 指标,浮层(Ctrl+i 切换)与 console 双呈现。
// @author       Codex
// @match        https://www.602.com/game/show/*
// @match        https://client.qj2h5.jiuxiaokj.cn/mu2h5/*
// @match        https://cdn.qj2h5.jiuxiaokj.cn/mu2h5/*
// @match        https://*.jiuxiaokj.cn/mu2h5/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const injected = function () {
    'use strict';

    if (window.__muBossStats) return;

    const JOURNAL_KEY = '__mu_boss_stats_events_v1';
    const UI_POSITION_KEY = 'mu_boss_stats_ui_position_v1';
    const UI_SIZE_KEY = 'mu_boss_stats_ui_size_v1';
    const UI_TAB_KEY = 'mu_boss_stats_ui_tab_v1';
    const UI_HOURS_KEY = 'mu_boss_stats_ui_hours_v1';
    const DEFAULT_WIDTH = 760;
    const DEFAULT_HEIGHT = 520;
    const MIN_WIDTH = 480;
    const MIN_HEIGHT = 300;
    const MIN_FONT_PX = 11;
    const MAX_FONT_PX = 16;
    const BASE_FONT_PX = 13;
    const REFRESH_MS = 1500;
    const TABS = [
      { id: 'summary', label: 'BOSS汇总' },
      { id: 'stolen', label: '被抢榜' },
      { id: 'skipped', label: '跳过' },
      { id: 'hourly', label: '小时繁忙' },
      { id: 'timeline', label: '时间线' },
    ];
    const HOUR_OPTIONS = [0, 1, 2, 3, 6, 12, 24];

    // ---------- journal 读写 ----------

    function readJournal() {
      try {
        const raw = window.localStorage && window.localStorage.getItem(JOURNAL_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return parsed && Array.isArray(parsed.events) ? parsed.events : [];
      } catch (_) {
        return [];
      }
    }

    function clearJournal() {
      try {
        if (window.localStorage) window.localStorage.removeItem(JOURNAL_KEY);
      } catch (_) {}
    }

    // ---------- 聚合核心 ----------

    function inWindow(events, hours) {
      if (!hours || hours <= 0) return events.slice();
      const cutoff = Date.now() - hours * 3600 * 1000;
      return events.filter((e) => Number(e.ts || e.endTs || 0) >= cutoff);
    }

    function fmtTs(ts) {
      if (!ts) return '';
      const d = new Date(Number(ts));
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function hourLabel(ts) {
      if (!ts) return '';
      const d = new Date(Number(ts));
      return String(d.getHours()).padStart(2, '0') + ':00';
    }

    function aggregateBoss(events) {
      const map = new Map();
      const outcomeFix = new Map();
      for (const e of events) {
        if (e.type === 'attempt_update') outcomeFix.set(e.attemptId, 'stolen');
      }
      for (const e of events) {
        if (e.type !== 'attempt') continue;
        const key = [e.mapName || '?', e.bossName || '?', e.bossId || '?'].join('|');
        if (!map.has(key)) {
          map.set(key, {
            mapName: e.mapName || '?', bossName: e.bossName || '?', bossId: e.bossId || '?',
            attempts: 0, killMine: 0, killOther: 0, stolen: 0, left: 0, unknown: 0,
          });
        }
        const row = map.get(key);
        row.attempts += 1;
        const effective = outcomeFix.get(e.attemptId) || e.outcome || 'unknown';
        if (effective === 'kill_mine') row.killMine += 1;
        else if (effective === 'kill_other') row.killOther += 1;
        else if (effective === 'stolen') row.stolen += 1;
        else if (effective === 'left') row.left += 1;
        else row.unknown += 1;
      }
      return Array.from(map.values());
    }

    function aggregateStolenByPlayer(events) {
      const map = new Map();
      for (const e of events) {
        const owner = e.ownerName || '';
        if (!owner) continue;
        if (e.type === 'attempt' && e.outcome === 'stolen') {
          map.set(owner, (map.get(owner) || 0) + 1);
        }
        if (e.type === 'attempt_update' && e.outcome === 'stolen') {
          map.set(owner, (map.get(owner) || 0) + 1);
        }
      }
      return Array.from(map.entries())
        .map(([player, count]) => ({ player, count }))
        .sort((a, b) => b.count - a.count);
    }

    function aggregateSkipped(events) {
      const map = new Map();
      for (const e of events) {
        if (e.type !== 'skipped_owned') continue;
        const key = [e.mapName || '?', e.bossName || '?'].join('|');
        if (!map.has(key)) map.set(key, { mapName: e.mapName || '?', bossName: e.bossName || '?', count: 0 });
        map.get(key).count += 1;
      }
      return Array.from(map.values()).sort((a, b) => b.count - a.count);
    }

    function aggregateHourly(events) {
      const hours = new Map();
      for (const e of events) {
        if (e.type !== 'attempt' && e.type !== 'skipped_owned') continue;
        const ts = e.ts || e.endTs || 0;
        if (!ts) continue;
        const h = hourLabel(ts);
        if (!hours.has(h)) hours.set(h, { hour: h, attempts: 0, stolen: 0, skipped: 0 });
        const row = hours.get(h);
        if (e.type === 'attempt') {
          row.attempts += 1;
          if (e.outcome === 'stolen') row.stolen += 1;
        } else {
          row.skipped += 1;
        }
      }
      const rows = Array.from(hours.values()).sort((a, b) => a.hour.localeCompare(b.hour));
      for (const r of rows) r.stealRate = r.attempts > 0 ? (r.stolen / r.attempts * 100).toFixed(1) + '%' : '-';
      return rows;
    }

    function aggregateTimeline(events, bucketMs) {
      const buckets = new Map();
      for (const e of events) {
        if (e.type !== 'attempt') continue;
        const ts = e.ts || e.endTs || 0;
        if (!ts) continue;
        const bucket = Math.floor(Number(ts) / bucketMs) * bucketMs;
        const label = fmtTs(bucket);
        if (!buckets.has(label)) buckets.set(label, { time: label, attempts: 0, killMine: 0, stolen: 0 });
        const row = buckets.get(label);
        row.attempts += 1;
        if (e.outcome === 'kill_mine') row.killMine += 1;
        if (e.outcome === 'stolen') row.stolen += 1;
      }
      return Array.from(buckets.values()).sort((a, b) => a.time.localeCompare(b.time));
    }

    // ---------- console 报告 ----------

    function printSummary(rows, label) {
      if (!rows.length) { console.log(`[${label}] 无数据`); return; }
      console.log(`\n=== ${label} ===`);
      console.table(rows.map((r) => ({
        地图: r.mapName, BOSS: r.bossName, 尝试: r.attempts,
        归属我: r.killMine, 归属他人: r.killOther, 被抢: r.stolen,
        离开: r.left, 未知: r.unknown,
      })));
    }

    function printStolenBoard(players, label) {
      if (!players.length) { console.log(`[${label}] 无被抢记录`); return; }
      console.log(`\n=== ${label} 被抢榜 ===`);
      console.table(players.map((p) => ({ 玩家: p.player, 次数: p.count })));
    }

    function printSkipped(rows, label) {
      if (!rows.length) { console.log(`[${label}] 无跳过记录`); return; }
      console.log(`\n=== ${label} 跳过(归属他人) ===`);
      console.table(rows.map((r) => ({ 地图: r.mapName, BOSS: r.bossName, 次数: r.count })));
    }

    function printHourly(rows, label) {
      if (!rows.length) { console.log(`[${label}] 无小时数据`); return; }
      console.log(`\n=== ${label} 全天小时繁忙度 ===`);
      console.table(rows.map((r) => ({
        时段: r.hour, 尝试: r.attempts, 被抢: r.stolen, 跳过: r.skipped, 被抢率: r.stealRate,
      })));
    }

    function printTimeline(rows, label) {
      if (!rows.length) { console.log(`[${label}] 无时间线数据`); return; }
      console.log(`\n=== ${label} 时间线(30min 桶) ===`);
      console.table(rows.map((r) => ({
        时间: r.time, 尝试: r.attempts, 归属我: r.killMine, 被抢: r.stolen,
      })));
    }

    function printDetail(events, hours) {
      const w = inWindow(events, hours);
      const label = hours ? `近 ${hours}h` : '全部';
      printSummary(aggregateBoss(w), label);
      printStolenBoard(aggregateStolenByPlayer(w), label);
      printSkipped(aggregateSkipped(w), label);
      printTimeline(aggregateTimeline(w, 30 * 60 * 1000), label);
    }

    function report(hours) {
      const events = readJournal();
      if (!events.length) { console.log('BOSS 统计: 无事件数据(emitter 还没跑过或 journal 为空)'); return; }

      if (hours) {
        printDetail(events, hours);
        return;
      }

      for (const h of [1, 2, 3, 6, 12, 24]) {
        const w = inWindow(events, h);
        const label = `近 ${h}h`;
        printSummary(aggregateBoss(w), label);
      }
      printHourly(aggregateHourly(events), '全部');
      printStolenBoard(aggregateStolenByPlayer(events), '全部');
      printSkipped(aggregateSkipped(events), '全部');
      console.log(`\n如需指定窗口明细: __muBossStats.report(6)  // 近6h`);
      console.log(`调试: __muBossStats.raw() / __muBossStats.raw(24) / __muBossStats.clear()`);
    }

    function raw(hours) {
      const events = readJournal();
      const w = hours ? inWindow(events, hours) : events;
      console.log(`事件数: ${w.length}${hours ? ` (近${hours}h)` : ' (全部)'}`);
      w.forEach((e) => console.log(JSON.stringify(e)));
      return w;
    }

    // ---------- 通用工具 ----------

    function clone(v) { return JSON.parse(JSON.stringify(v)); }

    function readJson(key, fallback) {
      try {
        const raw = window.localStorage && window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : clone(fallback);
      } catch (_) { return clone(fallback); }
    }

    function writeJson(key, value) {
      try { if (window.localStorage) window.localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    }

    function readStr(key, fallback) {
      try {
        const v = window.localStorage && window.localStorage.getItem(key);
        return v || fallback;
      } catch (_) { return fallback; }
    }

    function readNum(key, fallback) {
      try {
        const v = window.localStorage && window.localStorage.getItem(key);
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
      } catch (_) { return fallback; }
    }

    function normalizeSize(s) {
      if (!s) return null;
      const w = Math.round(Number(s.width));
      const h = Math.round(Number(s.height));
      if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
      return { width: Math.max(MIN_WIDTH, w), height: Math.max(MIN_HEIGHT, h) };
    }

    function clearElement(el) { while (el.firstChild) el.removeChild(el.firstChild); }

    // ---------- 浮层 UI ----------

    const ui = {
      visible: false,
      overlayEl: null,
      contentEl: null,
      statusEl: null,
      tabBarEl: null,
      hoursBarEl: null,
      position: readJson(UI_POSITION_KEY, null),
      size: normalizeSize(readJson(UI_SIZE_KEY, null)),
      activeTab: readStr(UI_TAB_KEY, 'summary'),
      hoursSel: readNum(UI_HOURS_KEY, 0),
      drag: null,
      resize: null,
      timer: null,
    };

    function bootstrapUI() {
      window.addEventListener('keydown', onGlobalKey, true);
    }

    function onGlobalKey(e) {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'i' && e.key !== 'I') return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      e.stopPropagation();
      toggleOverlay();
    }

    function toggleOverlay() {
      ui.visible = !ui.visible;
      if (ui.visible) {
        try {
          ensureOverlay();
          ui.overlayEl.style.display = 'flex';
          startRefresh();
          renderContent();
        } catch (err) {
          console.error('[mu-boss-stats] 浮层创建失败', err);
          ui.visible = false;
        }
      } else {
        if (ui.overlayEl) ui.overlayEl.style.display = 'none';
        stopRefresh();
      }
    }

    function startRefresh() {
      stopRefresh();
      ui.timer = setInterval(renderContent, REFRESH_MS);
    }

    function stopRefresh() {
      if (ui.timer) { clearInterval(ui.timer); ui.timer = null; }
    }

    function ensureOverlay() {
      if (ui.overlayEl) return;
      ui.overlayEl = createOverlay();
      document.body.appendChild(ui.overlayEl);
      clampToViewport();
    }

    function createOverlay() {
      const doc = document;
      const panel = doc.createElement('div');
      panel.id = 'mu-boss-stats-overlay';
      panel.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'display:flex',
        'flex-direction:column',
        'box-sizing:border-box',
        'border:1px solid rgba(255,255,255,0.28)',
        'background:rgba(10,12,16,0.92)',
        'color:#f3f7ff',
        'border-radius:8px',
        'box-shadow:0 8px 28px rgba(0,0,0,0.5)',
        'pointer-events:auto',
        'user-select:none',
        'overflow:hidden',
        `min-width:${MIN_WIDTH}px`,
        `min-height:${MIN_HEIGHT}px`,
        'max-width:calc(100vw - 8px)',
        'max-height:calc(100vh - 8px)',
      ].join(';');
      applyPosition(panel);
      applySize(panel);
      applyTypography(panel);

      // header (拖动区)
      const header = doc.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.16);cursor:move;flex:0 0 auto';
      header.addEventListener('mousedown', startDrag);
      const title = doc.createElement('div');
      title.textContent = 'BOSS 统计';
      title.style.cssText = 'font-weight:700;color:#ffe4a8;font-size:calc(var(--mu-stats-font,13px) * 1.08)';
      const closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = '\u00d7';
      closeBtn.title = '关闭 (Ctrl+i)';
      styleCloseButton(closeBtn);
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleOverlay(); });
      header.appendChild(title);
      header.appendChild(closeBtn);

      // tab 栏
      const tabBar = doc.createElement('div');
      tabBar.style.cssText = 'display:flex;gap:3px;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.1);flex:0 0 auto;flex-wrap:wrap';
      TABS.forEach((t) => {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.textContent = t.label;
        btn.dataset.tab = t.id;
        styleToolbarButton(btn);
        btn.addEventListener('click', (e) => { e.stopPropagation(); selectTab(t.id); });
        tabBar.appendChild(btn);
      });
      ui.tabBarEl = tabBar;

      // 时间窗口选择栏
      const hoursBar = doc.createElement('div');
      hoursBar.style.cssText = 'display:flex;align-items:center;gap:3px;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.1);flex:0 0 auto;flex-wrap:wrap';
      const lbl = doc.createElement('span');
      lbl.textContent = '窗口:';
      lbl.style.cssText = 'color:#b8c7d9;font-size:var(--mu-stats-font,13px);margin-right:2px';
      hoursBar.appendChild(lbl);
      HOUR_OPTIONS.forEach((h) => {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.textContent = h === 0 ? '全部' : `${h}h`;
        btn.dataset.hours = String(h);
        styleToolbarButton(btn);
        btn.addEventListener('click', (e) => { e.stopPropagation(); selectHours(h); });
        hoursBar.appendChild(btn);
      });
      ui.hoursBarEl = hoursBar;

      // 内容区(可滚动)
      const content = doc.createElement('div');
      content.style.cssText = 'flex:1 1 auto;min-height:0;overflow:auto;padding:6px 8px';
      ui.contentEl = content;

      // 状态栏
      const status = doc.createElement('div');
      status.style.cssText = 'padding:4px 10px;color:#b8c7d9;border-top:1px solid rgba(255,255,255,0.1);flex:0 0 auto;font-size:calc(var(--mu-stats-font,13px) * 0.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      ui.statusEl = status;

      panel.appendChild(header);
      panel.appendChild(tabBar);
      panel.appendChild(hoursBar);
      panel.appendChild(content);
      panel.appendChild(status);
      appendResizeHandles(panel);
      window.addEventListener('resize', clampToViewport);
      updateTabHighlight();
      updateHoursHighlight();
      return panel;
    }

    function styleCloseButton(btn) {
      btn.style.cssText = [
        'border:1px solid rgba(255,255,255,0.22)',
        'border-radius:4px',
        'background:rgba(22,25,30,0.86)',
        'color:#dce7f6',
        'width:24px',
        'height:24px',
        'padding:0',
        'font-size:16px',
        'line-height:20px',
        'cursor:pointer',
      ].join(';');
    }

    function styleToolbarButton(btn) {
      btn.style.cssText = [
        'border:1px solid rgba(255,255,255,0.18)',
        'border-radius:4px',
        'background:rgba(255,255,255,0.06)',
        'color:#cbd7e6',
        'padding:2px 8px',
        'cursor:pointer',
        'font-size:var(--mu-stats-font,13px)',
        'line-height:1.5',
      ].join(';');
    }

    function updateTabHighlight() {
      if (!ui.tabBarEl) return;
      Array.prototype.forEach.call(
        ui.tabBarEl.querySelectorAll('button[data-tab]'),
        (btn) => {
          const active = btn.dataset.tab === ui.activeTab;
          btn.style.background = active ? 'rgba(255,180,60,0.25)' : 'rgba(255,255,255,0.06)';
          btn.style.color = active ? '#ffe4a8' : '#cbd7e6';
          btn.style.fontWeight = active ? '700' : '400';
        }
      );
    }

    function updateHoursHighlight() {
      if (!ui.hoursBarEl) return;
      Array.prototype.forEach.call(
        ui.hoursBarEl.querySelectorAll('button[data-hours]'),
        (btn) => {
          const active = Number(btn.dataset.hours) === ui.hoursSel;
          btn.style.background = active ? 'rgba(92,226,255,0.22)' : 'rgba(255,255,255,0.06)';
          btn.style.color = active ? '#9fe6ff' : '#cbd7e6';
          btn.style.fontWeight = active ? '700' : '400';
        }
      );
    }

    function selectTab(id) {
      ui.activeTab = id;
      try { if (window.localStorage) window.localStorage.setItem(UI_TAB_KEY, id); } catch (_) {}
      updateTabHighlight();
      if (ui.contentEl) ui.contentEl.scrollTop = 0;
      renderContent();
    }

    function selectHours(h) {
      ui.hoursSel = h;
      try { if (window.localStorage) window.localStorage.setItem(UI_HOURS_KEY, String(h)); } catch (_) {}
      updateHoursHighlight();
      renderContent();
    }

    function renderContent() {
      if (!ui.visible || !ui.contentEl) return;
      const all = readJournal();
      const windowed = ui.hoursSel > 0 ? inWindow(all, ui.hoursSel) : all;
      clearElement(ui.contentEl);
      let table;
      switch (ui.activeTab) {
        case 'stolen': table = buildStolenTable(windowed); break;
        case 'skipped': table = buildSkippedTable(windowed); break;
        case 'hourly': table = buildHourlyTable(all); break;
        case 'timeline': table = buildTimelineTable(windowed); break;
        default: table = buildSummaryTable(windowed); break;
      }
      ui.contentEl.appendChild(table);

      if (ui.statusEl) {
        const label = ui.hoursSel > 0 ? `近${ui.hoursSel}h` : '全部';
        const now = new Date();
        const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const hourlyNote = ui.activeTab === 'hourly' ? '(全天)' : '';
        ui.statusEl.textContent = `事件 ${all.length} 条 | 窗口:${label}${hourlyNote} | ${ts}`;
      }
    }

    function buildSummaryTable(events) {
      const rows = aggregateBoss(events).slice().sort((a, b) => b.attempts - a.attempts);
      return renderTable(
        [
          { label: '地图', key: 'mapName' },
          { label: 'BOSS', key: 'bossName' },
          { label: '尝试', key: 'attempts', align: 'right' },
          { label: '归属我', key: 'killMine', align: 'right' },
          { label: '归属他人', key: 'killOther', align: 'right' },
          { label: '被抢', key: 'stolen', align: 'right' },
          { label: '离开', key: 'left', align: 'right' },
          { label: '未知', key: 'unknown', align: 'right' },
        ],
        rows
      );
    }

    function buildStolenTable(events) {
      const rows = aggregateStolenByPlayer(events);
      return renderTable(
        [
          { label: '#', key: 'rank', align: 'right' },
          { label: '玩家', key: 'player' },
          { label: '被抢次数', key: 'count', align: 'right' },
        ],
        rows.map((r, i) => ({ rank: i + 1, player: r.player, count: r.count }))
      );
    }

    function buildSkippedTable(events) {
      const rows = aggregateSkipped(events);
      return renderTable(
        [
          { label: '地图', key: 'mapName' },
          { label: 'BOSS', key: 'bossName' },
          { label: '跳过次数', key: 'count', align: 'right' },
        ],
        rows
      );
    }

    function buildHourlyTable(events) {
      const rows = aggregateHourly(events);
      return renderTable(
        [
          { label: '时段', key: 'hour', align: 'right' },
          { label: '尝试', key: 'attempts', align: 'right' },
          { label: '被抢', key: 'stolen', align: 'right' },
          { label: '跳过', key: 'skipped', align: 'right' },
          { label: '被抢率', key: 'stealRate', align: 'right' },
        ],
        rows
      );
    }

    function buildTimelineTable(events) {
      const rows = aggregateTimeline(events, 30 * 60 * 1000);
      return renderTable(
        [
          { label: '时间', key: 'time' },
          { label: '尝试', key: 'attempts', align: 'right' },
          { label: '归属我', key: 'killMine', align: 'right' },
          { label: '被抢', key: 'stolen', align: 'right' },
        ],
        rows
      );
    }

    function renderTable(columns, rows) {
      const doc = document;
      const table = doc.createElement('table');
      table.style.cssText = 'width:100%;border-collapse:collapse;font-size:var(--mu-stats-font,13px);color:#f3f7ff';
      const thead = doc.createElement('thead');
      const htr = doc.createElement('tr');
      columns.forEach((c) => {
        const th = doc.createElement('th');
        th.textContent = c.label;
        th.style.cssText = `position:sticky;top:0;z-index:1;background:rgba(30,34,42,0.98);padding:5px 8px;text-align:${c.align || 'left'};border-bottom:1px solid rgba(255,255,255,0.2);white-space:nowrap;color:#ffe4a8`;
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);
      const tbody = doc.createElement('tbody');
      if (!rows.length) {
        const tr = doc.createElement('tr');
        const td = doc.createElement('td');
        td.textContent = '无数据';
        td.colSpan = columns.length;
        td.style.cssText = 'padding:10px;color:#b8c7d9;text-align:center';
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        rows.forEach((r, idx) => {
          const tr = doc.createElement('tr');
          if (idx % 2 === 1) tr.style.background = 'rgba(255,255,255,0.03)';
          columns.forEach((c) => {
            const td = doc.createElement('td');
            td.textContent = String(r[c.key] == null ? '' : r[c.key]);
            td.style.cssText = `padding:3px 8px;border-bottom:1px solid rgba(255,255,255,0.06);white-space:nowrap;text-align:${c.align || 'left'};color:#f3f7ff`;
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody);
      return table;
    }

    // ---------- 位置 / 尺寸 / 缩放 ----------

    function applyPosition(panel) {
      if (ui.position) {
        panel.style.left = `${ui.position.left}px`;
        panel.style.top = `${ui.position.top}px`;
        return;
      }
      const w = ui.size ? ui.size.width : DEFAULT_WIDTH;
      const h = ui.size ? ui.size.height : DEFAULT_HEIGHT;
      const vw = Number(window.innerWidth) || 1334;
      const vh = Number(window.innerHeight) || 750;
      panel.style.left = `${Math.max(4, Math.round((vw - w) / 2))}px`;
      panel.style.top = `${Math.max(4, Math.round((vh - h) / 2))}px`;
    }

    function applySize(panel) {
      const target = panel || ui.overlayEl;
      if (!target) return;
      if (ui.size) {
        target.style.width = `${ui.size.width}px`;
        target.style.height = `${ui.size.height}px`;
      } else {
        target.style.width = `${DEFAULT_WIDTH}px`;
        target.style.height = `${DEFAULT_HEIGHT}px`;
      }
    }

    function applyTypography(panel) {
      const target = panel || ui.overlayEl;
      if (!target) return;
      const w = ui.size ? ui.size.width : DEFAULT_WIDTH;
      const h = ui.size ? ui.size.height : DEFAULT_HEIGHT;
      const scale = Math.sqrt(Math.max(0.6, w / DEFAULT_WIDTH) * Math.max(0.6, h / DEFAULT_HEIGHT));
      const fs = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, Math.round(BASE_FONT_PX * scale * 10) / 10));
      target.style.setProperty('--mu-stats-font', `${fs}px`);
    }

    function clampPoint(left, top) {
      const margin = 4;
      const w = ui.overlayEl ? ui.overlayEl.offsetWidth : DEFAULT_WIDTH;
      const h = ui.overlayEl ? ui.overlayEl.offsetHeight : DEFAULT_HEIGHT;
      const vw = Number(window.innerWidth) || 1334;
      const vh = Number(window.innerHeight) || 750;
      return {
        left: Math.max(margin, Math.min(Math.round(Number(left) || margin), Math.max(margin, vw - w - margin))),
        top: Math.max(margin, Math.min(Math.round(Number(top) || margin), Math.max(margin, vh - h - margin))),
      };
    }

    function clampSizeValue(size) {
      const margin = 4;
      const vw = Number(window.innerWidth) || 1334;
      const vh = Number(window.innerHeight) || 750;
      return {
        width: Math.max(MIN_WIDTH, Math.min(Math.round(size.width), vw - margin * 2)),
        height: Math.max(MIN_HEIGHT, Math.min(Math.round(size.height), vh - margin * 2)),
      };
    }

    function clampToViewport() {
      if (!ui.overlayEl) return;
      if (ui.size) {
        ui.size = clampSizeValue(ui.size);
        ui.overlayEl.style.width = `${ui.size.width}px`;
        ui.overlayEl.style.height = `${ui.size.height}px`;
        writeJson(UI_SIZE_KEY, ui.size);
      }
      if (ui.position) {
        const p = clampPoint(ui.position.left, ui.position.top);
        ui.position = p;
        ui.overlayEl.style.left = `${p.left}px`;
        ui.overlayEl.style.top = `${p.top}px`;
        writeJson(UI_POSITION_KEY, ui.position);
      }
      applyTypography();
    }

    // ---------- 拖动 ----------

    function startDrag(e) {
      if (!ui.overlayEl || e.button !== 0) return;
      if (e.target && e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      const rect = ui.overlayEl.getBoundingClientRect();
      ui.drag = { ox: e.clientX - rect.left, oy: e.clientY - rect.top };
      ui.overlayEl.style.left = `${rect.left}px`;
      ui.overlayEl.style.top = `${rect.top}px`;
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', stopDrag);
    }

    function onDrag(e) {
      if (!ui.drag || !ui.overlayEl) return;
      const p = clampPoint(e.clientX - ui.drag.ox, e.clientY - ui.drag.oy);
      ui.overlayEl.style.left = `${p.left}px`;
      ui.overlayEl.style.top = `${p.top}px`;
    }

    function stopDrag() {
      if (!ui.drag || !ui.overlayEl) return;
      ui.drag = null;
      const rect = ui.overlayEl.getBoundingClientRect();
      ui.position = clampPoint(rect.left, rect.top);
      ui.overlayEl.style.left = `${ui.position.left}px`;
      ui.overlayEl.style.top = `${ui.position.top}px`;
      writeJson(UI_POSITION_KEY, ui.position);
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', stopDrag);
    }

    // ---------- 缩放 ----------

    function appendResizeHandles(panel) {
      const edges = [
        ['n', 'ns-resize'], ['e', 'ew-resize'], ['s', 'ns-resize'], ['w', 'ew-resize'],
        ['ne', 'nesw-resize'], ['nw', 'nwse-resize'], ['se', 'nwse-resize'], ['sw', 'nesw-resize'],
      ];
      edges.forEach(([edge, cursor]) => {
        const handle = document.createElement('div');
        handle.setAttribute('data-mu-stats-resize', edge);
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
        handle.addEventListener('mousedown', (e) => startResize(e, edge));
        panel.appendChild(handle);
      });
    }

    function startResize(e, edge) {
      if (!ui.overlayEl || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = ui.overlayEl.getBoundingClientRect();
      ui.resize = {
        edge, startX: e.clientX, startY: e.clientY,
        left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      };
      ui.overlayEl.style.left = `${Math.round(rect.left)}px`;
      ui.overlayEl.style.top = `${Math.round(rect.top)}px`;
      ui.overlayEl.style.width = `${Math.round(rect.width)}px`;
      ui.overlayEl.style.height = `${Math.round(rect.height)}px`;
      document.addEventListener('mousemove', onResize);
      document.addEventListener('mouseup', stopResize);
    }

    function onResize(e) {
      if (!ui.resize || !ui.overlayEl) return;
      const next = resizeRectFromPointer(e.clientX, e.clientY, ui.resize);
      ui.size = { width: next.width, height: next.height };
      ui.overlayEl.style.left = `${next.left}px`;
      ui.overlayEl.style.top = `${next.top}px`;
      ui.overlayEl.style.width = `${next.width}px`;
      ui.overlayEl.style.height = `${next.height}px`;
      applyTypography();
    }

    function stopResize() {
      if (!ui.resize || !ui.overlayEl) return;
      ui.resize = null;
      const rect = ui.overlayEl.getBoundingClientRect();
      ui.position = clampPoint(rect.left, rect.top);
      ui.size = clampSizeValue({ width: rect.width, height: rect.height });
      ui.overlayEl.style.left = `${ui.position.left}px`;
      ui.overlayEl.style.top = `${ui.position.top}px`;
      ui.overlayEl.style.width = `${ui.size.width}px`;
      ui.overlayEl.style.height = `${ui.size.height}px`;
      writeJson(UI_POSITION_KEY, ui.position);
      writeJson(UI_SIZE_KEY, ui.size);
      applyTypography();
      document.removeEventListener('mousemove', onResize);
      document.removeEventListener('mouseup', stopResize);
    }

    function resizeRectFromPointer(clientX, clientY, resize) {
      const margin = 4;
      const vw = Number(window.innerWidth) || 1334;
      const vh = Number(window.innerHeight) || 750;
      const dx = clientX - resize.startX;
      const dy = clientY - resize.startY;
      const edge = resize.edge || '';
      let left = resize.left;
      let top = resize.top;
      let width = resize.width;
      let height = resize.height;

      if (edge.indexOf('w') >= 0) {
        const right = resize.left + resize.width;
        left = Math.max(margin, Math.min(resize.left + dx, right - MIN_WIDTH));
        width = right - left;
      } else if (edge.indexOf('e') >= 0) {
        width = Math.max(MIN_WIDTH, Math.min(resize.width + dx, vw - left - margin));
      }

      if (edge.indexOf('n') >= 0) {
        const bottom = resize.top + resize.height;
        top = Math.max(margin, Math.min(resize.top + dy, bottom - MIN_HEIGHT));
        height = bottom - top;
      } else if (edge.indexOf('s') >= 0) {
        height = Math.max(MIN_HEIGHT, Math.min(resize.height + dy, vh - top - margin));
      }

      width = Math.max(MIN_WIDTH, Math.min(Math.round(width), vw - left - margin));
      height = Math.max(MIN_HEIGHT, Math.min(Math.round(height), vh - top - margin));
      return { left: Math.round(left), top: Math.round(top), width, height };
    }

    // ---------- 导出 + 启动 ----------

    window.__muBossStats = {
      report, raw, clear: clearJournal,
      toggle: toggleOverlay,
      show() { if (!ui.visible) toggleOverlay(); },
      hide() { if (ui.visible) toggleOverlay(); },
      _testAggregateBoss: aggregateBoss, _testAggregateStolen: aggregateStolenByPlayer,
      _testAggregateSkipped: aggregateSkipped, _testAggregateHourly: aggregateHourly,
      _testAggregateTimeline: aggregateTimeline, _testInWindow: inWindow,
    };

    try {
      window.addEventListener('mu-boss-stats-event', () => {
        if (ui.visible) renderContent();
      });
    } catch (_) {}

    bootstrapUI();
    console.log('[mu-boss-stats] 已加载。Ctrl+i 打开统计浮层;控制台 __muBossStats.report() 查看文本报告。');
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
