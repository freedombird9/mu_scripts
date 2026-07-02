// ==UserScript==
// @name         全民红月 - 左上按钮缩小
// @namespace    codex.mu.ui.left-top-compact
// @version      0.1.0
// @description  缩小左上“升级”和“送大天使”按钮，独立于 BOSS 折叠菜单脚本。
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

    const CFG = {
      debug: false,
      tickMs: 400,
      scale: 0.7,
      leftLimitX: 560,
      topLimitY: 280,
      minWidth: 28,
      minHeight: 28,
      maxWidth: 180,
      maxHeight: 170,
      targetPatterns: [
        /升级/,
        /送大天使/,
      ],
    };

    const state = {
      compacted: new WeakSet(),
      original: new WeakMap(),
      lastLogAt: 0,
      lastSummary: '',
      status: {
        version: '0.1.0',
        applyCount: 0,
        lastMatched: [],
        lastReason: 'waiting for fgui',
      },
    };

    window.__muLeftTopButtonsCompact = {
      version: state.status.version,
      config: CFG,
      status: state.status,
      scan,
      applyOnce,
      restoreAll,
    };

    function log(...args) {
      if (CFG.debug) console.log('[mu-left-top-compact]', ...args);
    }

    function getRect(obj) {
      try {
        if (obj && typeof obj.localToGlobalRect === 'function') {
          const r = obj.localToGlobalRect(0, 0, obj.width || 0, obj.height || 0);
          return r && {
            x: Number(r.x) || 0,
            y: Number(r.y) || 0,
            w: Number(r.width) || 0,
            h: Number(r.height) || 0,
          };
        }
      } catch (_) {}
      return null;
    }

    function ownText(obj) {
      const parts = [];
      try { if (obj.name) parts.push(String(obj.name)); } catch (_) {}
      try { if (obj.text) parts.push(String(obj.text)); } catch (_) {}
      try { if (obj.title) parts.push(String(obj.title)); } catch (_) {}
      try { if (obj.icon) parts.push(String(obj.icon)); } catch (_) {}
      try { if (obj.url) parts.push(String(obj.url)); } catch (_) {}
      try {
        if (obj.packageItem) {
          const owner = obj.packageItem.owner && obj.packageItem.owner.name;
          parts.push([owner, obj.packageItem.name, obj.packageItem.id].filter(Boolean).join('/'));
        }
      } catch (_) {}
      return parts.join(' ');
    }

    function deepText(obj, depth = 0) {
      if (!obj || depth > 3) return '';
      let text = ownText(obj);
      const n = Number(obj.numChildren) || 0;
      for (let i = 0; i < n; i += 1) {
        try {
          text += ' ' + deepText(obj.getChildAt(i), depth + 1);
        } catch (_) {}
      }
      return text;
    }

    function walk(root, visit, depth = 0) {
      if (!root || depth > 14) return;
      visit(root, depth);
      const n = Number(root.numChildren) || 0;
      for (let i = 0; i < n; i += 1) {
        try {
          walk(root.getChildAt(i), visit, depth + 1);
        } catch (_) {}
      }
    }

    function root() {
      return window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
    }

    function isVisible(obj) {
      try {
        return obj.visible !== false && obj.internalVisible !== false;
      } catch (_) {
        return false;
      }
    }

    function isTarget(obj) {
      if (!obj || !isVisible(obj)) return false;

      const r = getRect(obj);
      if (!r) return false;
      if (r.x < -20 || r.x > CFG.leftLimitX) return false;
      if (r.y < -20 || r.y > CFG.topLimitY) return false;
      if (r.w < CFG.minWidth || r.h < CFG.minHeight) return false;
      if (r.w > CFG.maxWidth || r.h > CFG.maxHeight) return false;

      const text = deepText(obj);
      return CFG.targetPatterns.some((pattern) => pattern.test(text));
    }

    function findTargets() {
      const gRoot = root();
      if (!gRoot) return [];

      const out = [];
      walk(gRoot, (obj) => {
        if (isTarget(obj)) out.push(obj);
      });
      return uniqueObjects(out).filter((obj) => !hasTargetAncestor(obj));
    }

    function hasTargetAncestor(obj) {
      let node = obj && obj.parent;
      for (let i = 0; node && i < 10; i += 1) {
        if (isTarget(node)) return true;
        try {
          node = node.parent || null;
        } catch (_) {
          return false;
        }
      }
      return false;
    }

    function uniqueObjects(items) {
      const out = [];
      const seen = new Set();
      items.forEach((item) => {
        if (!item || seen.has(item)) return;
        seen.add(item);
        out.push(item);
      });
      return out;
    }

    function rememberOriginal(obj) {
      if (state.original.has(obj)) return;
      state.original.set(obj, {
        scaleX: readNumber(obj, 'scaleX', 1),
        scaleY: readNumber(obj, 'scaleY', 1),
      });
    }

    function readNumber(obj, key, fallback) {
      try {
        const value = Number(obj[key]);
        return Number.isFinite(value) ? value : fallback;
      } catch (_) {
        return fallback;
      }
    }

    function compact(obj) {
      rememberOriginal(obj);
      try { obj.scaleX = CFG.scale; } catch (_) {}
      try { obj.scaleY = CFG.scale; } catch (_) {}
      state.compacted.add(obj);
    }

    function restore(obj) {
      const original = state.original.get(obj);
      if (!original) return;
      try { obj.scaleX = original.scaleX; } catch (_) {}
      try { obj.scaleY = original.scaleY; } catch (_) {}
    }

    function restoreAll() {
      const targets = findTargets();
      targets.forEach(restore);
      state.status.lastReason = 'restored current targets';
    }

    function summary(items) {
      return items.map((obj) => {
        const r = getRect(obj) || {};
        return {
          name: (() => { try { return obj.name || ''; } catch (_) { return ''; } })(),
          text: deepText(obj).slice(0, 80),
          x: Math.round(r.x || 0),
          y: Math.round(r.y || 0),
          w: Math.round(r.w || 0),
          h: Math.round(r.h || 0),
          scaleX: readNumber(obj, 'scaleX', 1),
          scaleY: readNumber(obj, 'scaleY', 1),
        };
      });
    }

    function scan() {
      const targets = findTargets();
      return summary(targets);
    }

    function applyOnce() {
      const targets = findTargets();
      if (!targets.length) {
        state.status.lastMatched = [];
        state.status.lastReason = root() ? 'no target matched' : 'waiting for fgui';
        throttledLog('no target');
        return false;
      }

      targets.forEach(compact);
      state.status.applyCount += targets.length;
      state.status.lastMatched = summary(targets);
      state.status.lastReason = 'compacted left top buttons';
      throttledLog('compacted', state.status.lastMatched);
      return true;
    }

    function throttledLog(label, data) {
      if (!CFG.debug) return;
      const now = Date.now();
      const text = label + JSON.stringify(data || '');
      if (now - state.lastLogAt < 2500 && text === state.lastSummary) return;
      state.lastLogAt = now;
      state.lastSummary = text;
      log(label, data);
    }

    function start() {
      if (!root()) {
        setTimeout(start, 300);
        return;
      }

      log('started');
      setInterval(applyOnce, CFG.tickMs);
      applyOnce();
    }

    start();
  };

  function inject(fn) {
    const script = document.createElement('script');
    script.textContent = '(' + fn.toString() + ')();';
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  function isGameFrame() {
    return /jiuxiaokj\.cn\/mu2h5\//.test(location.href);
  }

  if (isGameFrame()) {
    inject(injected);
  }
})();
