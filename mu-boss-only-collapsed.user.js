// ==UserScript==
// @name         全民红月 - 收起菜单仅保留挑战BOSS
// @namespace    codex.mu.ui
// @version      0.3.1
// @description  在右上菜单收起后，仅保留“挑战BOSS”按钮，隐藏同组其它顶部按钮。
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

  // The game UI is rendered by Laya/FairyGUI into WebGL canvas, not by DOM.
  // This userscript injects code into the page context so it can access window.fgui/window.Laya.
  const injected = function () {
    'use strict';

    const CFG = {
      debug: false,
      tickMs: 400,
      topLimitY: 190,
      foregroundPanelMinY: 80,
      foregroundPanelMinWidth: 320,
      foregroundPanelMinHeight: 180,
      minMenuChildren: 3,
      expandedVisibleThreshold: 5,
      bossButtonName: 'btnBigBoss',
      topRightAnchorLeftPadding: 260,
      topRightAnchorRightPadding: 220,
      bossPatterns: [
        /挑战\s*BOSS/i,
        /挑战.*boss/i,
        /boss.*挑战/i,
        /BossBtn/i,
        /btn.*Boss/i,
        /Boss.*Btn/i,
        /challenge/i,
      ],
      nonBossTopLabels: [
        '效率',
        '合服活动',
        '每日目标',
        '福利',
        '挂机',
        '商城',
        '攻城战',
        '排行榜',
        '交易',
        '专属客服',
        '游戏宝典',
        '猎魔榜',
        '悬赏',
      ],
      neverHideNamePatterns: [
        /^btnChange/i,
        /change/i,
        /fold/i,
        /shrink/i,
        /arrow/i,
      ],
    };

    const state = {
      lastLogAt: 0,
      lastSummary: '',
      hidden: new WeakSet(),
    };

    window.__muBossOnlyCollapsed = {
      version: '0.3.1',
      config: CFG,
      scan,
      debugTreeAroundBoss,
      debugTopRight,
      applyOnce,
    };

    function log(...args) {
      if (CFG.debug) console.log('[mu-boss-only]', ...args);
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
      if (!obj || depth > 4) return '';
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

    function findByName(name) {
      const root = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
      if (!root) return null;
      let found = null;
      walk(root, (obj) => {
        if (found) return;
        try {
          if (obj.name === name) found = obj;
        } catch (_) {}
      });
      return found;
    }

    function isVisible(obj) {
      try {
        return obj.visible !== false && obj.internalVisible !== false;
      } catch (_) {
        return false;
      }
    }

    function isTopCandidate(obj) {
      const r = getRect(obj);
      if (!r || r.w < 20 || r.h < 20) return false;
      if (r.y < -10 || r.y > CFG.topLimitY) return false;
      if (r.w > 260 || r.h > 140) return false;
      const text = deepText(obj);
      if (CFG.bossPatterns.some((p) => p.test(text))) return true;
      return CFG.nonBossTopLabels.some((label) => text.includes(label));
    }

    function isBoss(obj) {
      try {
        if (obj && obj.name === CFG.bossButtonName) return true;
      } catch (_) {}
      const text = deepText(obj);
      return CFG.bossPatterns.some((p) => p.test(text));
    }

    function shouldKeepAuxiliary(obj) {
      const text = ownText(obj);
      return CFG.neverHideNamePatterns.some((p) => p.test(text));
    }

    function isDescendantOf(obj, ancestor) {
      if (!obj || !ancestor) return false;
      let node = obj;
      for (let i = 0; node && i < 12; i += 1) {
        if (node === ancestor) return true;
        try {
          node = node.parent || null;
        } catch (_) {
          return false;
        }
      }
      return false;
    }

    function topCandidates() {
      const root = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
      if (!root) return [];
      const out = [];
      walk(root, (obj) => {
        if (isTopCandidate(obj)) out.push(obj);
      });
      return out;
    }

    function topRightControls(boss) {
      const root = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
      const bossRect = getRect(boss);
      if (!root || !bossRect) return [];

      const minX = bossRect.x - CFG.topRightAnchorLeftPadding;
      const maxX = bossRect.x + CFG.topRightAnchorRightPadding;
      const out = [];

      walk(root, (obj) => {
        if (!obj || obj === root) return;
        if (isDescendantOf(obj, boss) && obj !== boss) return;
        if (isInsideForegroundPanel(obj, boss)) return;

        const r = getRect(obj);
        if (!r || r.w < 16 || r.h < 16) return;
        if (r.y < -20 || r.y > CFG.topLimitY) return;
        if (r.x < minX || r.x > maxX) return;
        if (r.w > 260 || r.h > 150) return;

        if (isBoss(obj) || shouldKeepAuxiliary(obj) || shouldHideTopRightControl(obj)) {
          out.push(obj);
        }
      });

      return uniqueObjects(out);
    }

    function isInsideForegroundPanel(obj, boss) {
      let node = obj && obj.parent;
      for (let i = 0; node && i < 12; i += 1) {
        if (node === boss || isDescendantOf(boss, node)) return false;

        const r = getRect(node);
        if (r
          && r.y >= CFG.foregroundPanelMinY
          && r.w >= CFG.foregroundPanelMinWidth
          && r.h >= CFG.foregroundPanelMinHeight) {
          return true;
        }

        try {
          node = node.parent || null;
        } catch (_) {
          return false;
        }
      }

      return false;
    }

    function shouldHideTopRightControl(obj) {
      if (!obj || isBoss(obj) || shouldKeepAuxiliary(obj)) return false;
      const text = deepText(obj);
      if (CFG.nonBossTopLabels.some((label) => text.includes(label))) return true;
      try {
        const name = obj.name || '';
        if (/^btn/i.test(name) && !/map|mini|line|switch/i.test(name)) return true;
      } catch (_) {}
      if (/效率|合服活动|每日目标|福利|挂机|商城|攻城战|排行榜|交易|专属客服|游戏宝典|猎魔榜|悬赏/.test(text)) return true;
      if (/MainWnd\/(btn|Button|.*Top|.*Menu)/i.test(text) && !/MiniMap|map|line|切线|切换/.test(text)) return true;
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

    function chooseMenuGroup(candidates) {
      const anchored = chooseAnchoredMenuGroup();
      if (anchored) return anchored;

      const boss = candidates.find(isBoss);
      if (!boss) return null;

      let node = boss.parent || null;
      for (let level = 0; node && level < 5; level += 1, node = node.parent || null) {
        const children = [];
        const n = Number(node.numChildren) || 0;
        for (let i = 0; i < n; i += 1) {
          try {
            const child = node.getChildAt(i);
            if (isTopCandidate(child) || isBoss(child)) children.push(child);
          } catch (_) {}
        }
        const hasBoss = children.some(isBoss);
        if (hasBoss && children.length >= CFG.minMenuChildren) {
          return { group: node, boss, children };
        }
      }

      return { group: boss.parent || null, boss, children: candidates };
    }

    function chooseAnchoredMenuGroup() {
      const boss = findByName(CFG.bossButtonName);
      if (!boss || !boss.parent) return null;

      const group = boss.parent;
      const children = directChildren(group).filter(isMenuSibling);
      if (!children.includes(boss)) children.push(boss);

      return {
        group,
        boss,
        children,
        anchored: true,
      };
    }

    function directChildren(group) {
      const out = [];
      const n = Number(group && group.numChildren) || 0;
      for (let i = 0; i < n; i += 1) {
        try {
          out.push(group.getChildAt(i));
        } catch (_) {}
      }
      return out;
    }

    function isMenuSibling(obj) {
      if (!obj) return false;
      if (isBoss(obj) || shouldKeepAuxiliary(obj)) return true;

      const r = getRect(obj);
      if (!r || r.w < 18 || r.h < 18) return false;
      if (r.y < -20 || r.y > CFG.topLimitY) return false;
      if (r.w > 220 || r.h > 130) return false;

      const text = deepText(obj);
      if (CFG.nonBossTopLabels.some((label) => text.includes(label))) return true;
      if (/btn|Button|Top|Menu|Activity|Rank|Shop|Trade|Welfare|Target|Hook/i.test(text)) return true;
      try {
        return /^btn/i.test(obj.name || '');
      } catch (_) {
        return false;
      }
    }

    function isCollapsedGroup(children) {
      const visibleCount = children.filter(isVisible).length;
      const bossVisible = children.some((child) => isBoss(child) && isVisible(child));
      const boss = children.find(isBoss);

      // In this game the collapsed top menu can leave btnBigBoss hidden while other
      // buttons remain visible. That is the exact state this script corrects.
      try {
        if (boss && boss.name === CFG.bossButtonName && boss.visible === false) return true;
      } catch (_) {}

      // Expanded state shows a long row of top buttons. Collapsed state shows only a few.
      if (visibleCount >= CFG.expandedVisibleThreshold) return false;

      // If the boss button is currently hidden but the group is mostly collapsed, we still fix it.
      return visibleCount <= CFG.expandedVisibleThreshold - 1 || !bossVisible;
    }

    function applyOnce() {
      if (!window.fgui || !window.fgui.GRoot || !window.fgui.GRoot.inst) return false;

      const candidates = topCandidates();
      const selected = chooseMenuGroup(candidates);
      if (!selected) {
        throttledLog('no boss candidate', candidates);
        return false;
      }

      const { boss } = selected;
      const children = uniqueObjects(selected.children.concat(topRightControls(boss)));
      if (!isCollapsedGroup(children)) {
        // Restore anything this script hid if the user expands the menu.
        children.forEach((child) => {
          if (state.hidden.has(child)) {
            try { child.visible = true; } catch (_) {}
          }
        });
        throttledLog('expanded/no-op', summary(children));
        return false;
      }

      children.forEach((child) => {
        try {
          if (child === boss || isBoss(child)) {
            child.visible = true;
          } else if (shouldKeepAuxiliary(child)) {
            // Keep the fold/expand control usable.
            child.visible = true;
          } else {
            child.visible = false;
            state.hidden.add(child);
          }
        } catch (_) {}
      });

      throttledLog('collapsed/applied', summary(children));
      return true;
    }

    function summary(items) {
      return items.map((obj) => {
        const r = getRect(obj) || {};
        return {
          name: (() => { try { return obj.name || ''; } catch (_) { return ''; } })(),
          text: deepText(obj).slice(0, 80),
          visible: (() => { try { return obj.visible; } catch (_) { return undefined; } })(),
          x: Math.round(r.x || 0),
          y: Math.round(r.y || 0),
          w: Math.round(r.w || 0),
          h: Math.round(r.h || 0),
        };
      });
    }

    function scan() {
      return {
        bossTree: debugTreeAroundBoss(),
        topRight: debugTopRight(),
      };
    }

    function debugTreeAroundBoss() {
      const boss = findByName(CFG.bossButtonName);
      if (!boss) {
        return {
          found: false,
          candidates: summary(topCandidates()),
        };
      }

      const parent = boss.parent || null;
      const siblings = parent ? directChildren(parent) : [boss];
      return {
        found: true,
        boss: summary([boss])[0],
        parent: parent ? summary([parent])[0] : null,
        siblings: summary(siblings),
        menuSiblings: summary(siblings.filter(isMenuSibling)),
      };
    }

    function debugTopRight() {
      const boss = findByName(CFG.bossButtonName);
      if (!boss) {
        return {
          found: false,
          candidates: summary(topCandidates()),
        };
      }

      const controls = topRightControls(boss);
      return {
        found: true,
        boss: summary([boss])[0],
        controls: summary(controls),
        hideTargets: summary(controls.filter(shouldHideTopRightControl)),
        keepTargets: summary(controls.filter((obj) => isBoss(obj) || shouldKeepAuxiliary(obj))),
      };
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
      if (!window.fgui || !window.fgui.GRoot || !window.fgui.GRoot.inst) {
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

