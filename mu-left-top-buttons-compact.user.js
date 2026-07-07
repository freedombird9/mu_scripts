// ==UserScript==
// @name         全民红月 - 左上按钮 + 右下弹窗缩小
// @namespace    codex.mu.ui.left-top-compact
// @version      0.4.0
// @description  缩小左上”升级”/”送大天使”/”限时活动”按钮(0.5)和右下”立即使用”弹窗(0.7，右下角锚定)。
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
      scale: 0.5,
      leftLimitX: 560,
      topLimitY: 280,
      minWidth: 28,
      minHeight: 28,
      maxWidth: 180,
      maxHeight: 170,
      targetPatterns: [
        /升级/,
        /送大天使/,
        /LimitedTime/, // 命中 btn_LimitedTimeActivity（图标资源 url 含 img_LimitedTimeActivity_new）
      ],
      // 右下"立即使用"弹窗（TipsViewWnd）缩小配置
      tipsView: {
        packageItemName: 'TipsViewWnd',
        scale: 0.7, // 比 0.5 大一点，避免文字看不清
      },
    };

    const state = {
      compacted: new WeakSet(),
      original: new WeakMap(),
      lastLogAt: 0,
      lastSummary: '',
      status: {
        version: '0.4.0',
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
      if (targets.length) {
        targets.forEach(compact);
        state.status.applyCount += targets.length;
        state.status.lastMatched = summary(targets);
        state.status.lastReason = 'compacted left top buttons';
        throttledLog('compacted', state.status.lastMatched);
      }

      // 右下"立即使用"弹窗：每次都重新检查（弹窗可能动态切换物品/重建）
      const tips = findTipsView();
      if (tips) {
        compactTipsView(tips);
        state.status.lastReason = targets.length
          ? 'compacted left top buttons + tips view'
          : 'compacted tips view';
      }

      return targets.length > 0 || !!tips;
    }

    function findTipsView() {
      const gRoot = root();
      if (!gRoot) return null;
      const target = { name: CFG.tipsView.packageItemName };
      function walk(node, depth) {
        if (!node || depth > 20) return null;
        try {
          if (node.packageItem && node.packageItem.name === target.name) return node;
        } catch (_) {}
        const n = Number(node.numChildren) || 0;
        for (let i = 0; i < n; i += 1) {
          try {
            const r = walk(node.getChildAt(i), depth + 1);
            if (r) return r;
          } catch (_) {}
        }
        return null;
      }
      return walk(gRoot, 0);
    }

    function compactTipsView(node) {
      if (!node) return;
      const target = CFG.tipsView.scale;
      // 把 pivot 设到右下角(不改 x/y 语义:pivotAsAnchor=false),
      // 缩放即以右下角为中心 → 右下角恒定贴着游戏给出的自然位置。
      // 游戏 resize 后会重写 x/y(仍是缩放前的左上角),右下角自动跟随,
      // 无需任何 x/y 补偿,天然幂等(每 tick 重复执行不漂移)。
      try {
        if (typeof node.setPivot === 'function') {
          if (!(Number(node.pivotX) === 1 && Number(node.pivotY) === 1)) {
            node.setPivot(1, 1, false);
          }
        } else {
          node.pivotX = 1;
          node.pivotY = 1;
        }
      } catch (_) {}

      try { if (Math.abs(Number(node.scaleX) - target) > 0.001) node.scaleX = target; } catch (_) {}
      try { if (Math.abs(Number(node.scaleY) - target) > 0.001) node.scaleY = target; } catch (_) {}
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
