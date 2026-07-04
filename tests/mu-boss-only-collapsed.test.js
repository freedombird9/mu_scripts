const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scriptPath = path.resolve(__dirname, '..', 'mu-boss-only-collapsed.user.js');

class FakeNode {
  constructor({ name = '', text = '', x = 0, y = 0, w = 60, h = 60, visible = true } = {}) {
    this.name = name;
    this.text = text;
    this.x = x;
    this.y = y;
    this.width = w;
    this.height = h;
    this.visible = visible;
    this.internalVisible = true;
    this.children = [];
    this.parent = null;
  }

  get numChildren() {
    return this.children.length;
  }

  add(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  getChildAt(index) {
    return this.children[index];
  }

  localToGlobalRect() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };
  }
}

function loadUserscript(root) {
  const documentElement = new FakeNode({ name: 'documentElement' });
  const sandbox = {
    location: { href: 'https://cdn.qj2h5.jiuxiaokj.cn/mu2h5/h5-data/mu-release/index.html' },
    console,
    setInterval() {},
    setTimeout(fn) { fn(); },
    window: {
      fgui: { GRoot: { inst: root } },
    },
    document: {
      createElement() {
        return {
          textContent: '',
          remove() {},
        };
      },
      documentElement,
      head: documentElement,
      body: documentElement,
    },
  };

  sandbox.window.window = sandbox.window;
  documentElement.appendChild = (script) => {
    vm.runInContext(script.textContent, sandbox);
    return script;
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), sandbox, { filename: scriptPath });
  return sandbox.window.__muBossOnlyCollapsed;
}

function buildSceneWithAppearanceTabs() {
  const root = new FakeNode({ name: 'GRoot', w: 1280, h: 720 });

  const topMenu = root.add(new FakeNode({ name: 'topMenu', x: 720, y: 20, w: 360, h: 90 }));
  const boss = topMenu.add(new FakeNode({ name: 'btnBigBoss', text: '挑战BOSS', x: 1000, y: 30, visible: false }));
  const welfare = topMenu.add(new FakeNode({ name: 'btnWelfare', text: '福利', x: 880, y: 30 }));
  const shop = topMenu.add(new FakeNode({ name: 'btnShop', text: '商城', x: 820, y: 30 }));

  root.add(new FakeNode({ name: 'appearancePanel', x: 730, y: 70, w: 470, h: 680 }));
  const tabRail = root.add(new FakeNode({ name: 'btnAppearanceTabs', x: 1162, y: 150, w: 60, h: 140 }));
  const appearance = tabRail.add(new FakeNode({ name: 'btnAppearance', x: 1168, y: 160 }));
  const title = tabRail.add(new FakeNode({ name: 'btnTitle', x: 1168, y: 230 }));
  const transform = tabRail.add(new FakeNode({ name: 'btnTransform', x: 1168, y: 300 }));

  return { root, boss, welfare, shop, tabRail, appearance, title, transform };
}

function testKeepsAppearanceTabsVisible() {
  const scene = buildSceneWithAppearanceTabs();
  const api = loadUserscript(scene.root);

  assert.strictEqual(api.applyOnce(), true, 'collapsed menu should be processed');
  assert.strictEqual(scene.boss.visible, true, 'boss button should be restored');
  assert.strictEqual(scene.welfare.visible, false, 'non-boss top menu button should be hidden');
  assert.strictEqual(scene.shop.visible, false, 'non-boss top menu button should be hidden');
  assert.strictEqual(scene.tabRail.visible, true, 'appearance tab rail must not be hidden');
  assert.strictEqual(scene.appearance.visible, true, 'appearance tab must not be hidden');
  assert.strictEqual(scene.title.visible, true, 'title tab must not be hidden');
  assert.strictEqual(scene.transform.visible, true, 'transform tab must not be hidden');
}

testKeepsAppearanceTabsVisible();
console.log('mu-boss-only-collapsed tests passed');
