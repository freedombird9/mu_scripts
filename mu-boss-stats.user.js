// ==UserScript==
// @name         全民红月 - BOSS 统计面板
// @namespace    codex.mu.boss-stats
// @version      1.0.0
// @description  读取 mu-boss-multi-map-mvp 的统计事件 journal,按时间窗口聚合打 BOSS 指标,console 呈现。
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

    // --- 聚合核心 ---

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

    function dateLabel(ts) {
      if (!ts) return '';
      const d = new Date(Number(ts));
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    // 按 attempt 事件聚合出 boss 维度统计;attempt_update 仅修正 outcome,stolen 不新增尝试。
    function aggregateBoss(events) {
      const map = new Map();  // key: mapName|bossName|bossId
      const outcomeFix = new Map();  // attemptId -> 'stolen'
      // 先扫一遍 attempt_update 建修正表(它在 attempt 之后发出,但遍历时顺序不保证)
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

    // 全天按小时聚合的繁忙度表:尝试数、被抢数、被抢率。
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

    // 窗口内时间线桶(30min 桶):尝试数、归属我、被抢。
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

    // --- 报告输出 ---

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

      // 默认:预设窗口各一张汇总 + 全天小时表 + 被抢榜
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

    window.__muBossStats = { report, raw, clear: clearJournal,
      _testAggregateBoss: aggregateBoss, _testAggregateStolen: aggregateStolenByPlayer,
      _testAggregateSkipped: aggregateSkipped, _testAggregateHourly: aggregateHourly,
      _testAggregateTimeline: aggregateTimeline, _testInWindow: inWindow,
    };

    // 实时监听新事件(后加载也能感知 emitter 的 CustomEvent)
    try {
      window.addEventListener('mu-boss-stats-event', (ev) => {
        // 仅记录,不自动打印,避免刷屏;用户随时 report() 即可看到最新数据。
      });
    } catch (_) {}

    console.log('[mu-boss-stats] 已加载。控制台输入 __muBossStats.report() 查看统计。');
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
