const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scriptPath = path.resolve(__dirname, '..', 'mu-left-top-buttons-compact.user.js');

class FakeNode {
  constructor({
    name = '',
    text = '',
    packageItem = null,
    x = 0,
    y = 0,
    w = 80,
    h = 30,
    visible = true,
    scaleX = 1,
    scaleY = 1,
    pivotX = 0,
    pivotY = 0,
  } = {}) {
    this.name = name;
    this.text = text;
    this.packageItem = packageItem;
    this.x = x;
    this.y = y;
    this.width = w;
    this.height = h;
    this.visible = visible;
    this.internalVisible = true;
    this.scaleX = scaleX;
    this.scaleY = scaleY;
    // fgui: pivot 是 0~1 比例；pivotAsAnchor=false 时 x/y 仍表示左上角,
    // 缩放以 pivot 点为中心,因此视觉左上角 = x + pivot*size*(1-scale)。
    this.pivotX = pivotX;
    this.pivotY = pivotY;
    this.pivotAsAnchor = false;
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

  setXY(x, y) {
    this.x = x;
    this.y = y;
  }

  setPivot(px, py, asAnchor = false) {
    this.pivotX = px;
    this.pivotY = py;
    this.pivotAsAnchor = asAnchor;
  }

  localToGlobalRect() {
    // 复现 fgui pivotAsAnchor=false 的缩放语义(父节点均为 scale=1、pivot=0)。
    let x = this.x + this.pivotX * this.width * (1 - this.scaleX);
    let y = this.y + this.pivotY * this.height * (1 - this.scaleY);
    let parent = this.parent;
    while (parent) {
      x += parent.x;
      y += parent.y;
      parent = parent.parent;
    }
    return {
      x,
      y,
      width: this.width * this.scaleX,
      height: this.height * this.scaleY,
    };
  }
}

function loadUserscript(root) {
  const documentElement = new FakeNode({ name: 'documentElement' });
  const sandbox = {
    location: { href: 'https://cdn.qj2h5.jiuxiaokj.cn/mu2h5/h5-data/mu-release/index.html' },
    console,
    setInterval() {},
    setTimeout(fn) { return fn(); },
    clearTimeout() {},
    window: {
      fgui: { GRoot: { inst: root } },
      Laya: { stage: { width: root.width, height: root.height } },
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
  sandbox.window.document = sandbox.document;
  sandbox.window.setInterval = sandbox.setInterval;
  sandbox.window.setTimeout = sandbox.setTimeout;
  sandbox.window.clearTimeout = sandbox.clearTimeout;
  documentElement.appendChild = (script) => {
    vm.runInContext(script.textContent, sandbox);
    return script;
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), sandbox, { filename: scriptPath });
  return sandbox.window.__muLeftTopButtonsCompact;
}

function bottomRight(node) {
  const r = node.localToGlobalRect();
  return {
    x: r.x + r.width,
    y: r.y + r.height,
  };
}

// 游戏期望的锚点:缩放前(scale=1、pivot 左上)的右下角全局坐标。
function naturalBottomRight(node) {
  let x = node.x + node.width;
  let y = node.y + node.height;
  let parent = node.parent;
  while (parent) {
    x += parent.x;
    y += parent.y;
    parent = parent.parent;
  }
  return { x, y };
}

function approxEqual(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.001, `${message}: expected ${expected}, got ${actual}`);
}

function makeTips() {
  const root = new FakeNode({ name: 'GRoot', w: 1280, h: 720 });
  const bottomPart = root.add(new FakeNode({ name: 'BottomPart', w: 1280, h: 120 }));
  const tips = bottomPart.add(new FakeNode({
    w: 136,
    h: 176,
    x: 900,
    y: 500,
    packageItem: { owner: { name: 'MainBottomPC' }, name: 'TipsViewWnd', id: 'tips' },
  }));
  tips.add(new FakeNode({ name: 'btnUse', text: '打开背包', w: 130, h: 40, x: 0, y: 113 }));
  return { root, tips };
}

function testTipsViewKeepsBottomRightAfterRelayout() {
  const { root, tips } = makeTips();

  const wantBR = naturalBottomRight(tips);
  const api = loadUserscript(root);

  assert.strictEqual(tips.scaleX, 0.7, 'tips view should be scaled');
  approxEqual(bottomRight(tips).x, wantBR.x, 'initial compact should keep right edge at natural BR');
  approxEqual(bottomRight(tips).y, wantBR.y, 'initial compact should keep bottom edge at natural BR');

  // 模拟浏览器 resize:游戏重写弹窗左上角坐标。
  tips.x = 850;
  tips.y = 470;
  const wantBR2 = naturalBottomRight(tips);

  api.applyOnce();
  approxEqual(bottomRight(tips).x, wantBR2.x, 'after relayout right edge should follow natural BR');
  approxEqual(bottomRight(tips).y, wantBR2.y, 'after relayout bottom edge should follow natural BR');

  // 反复执行不漂移(脚本每 400ms 触发一次)。
  api.applyOnce();
  approxEqual(bottomRight(tips).x, wantBR2.x, 'repeated apply should not drift right edge');
  approxEqual(bottomRight(tips).y, wantBR2.y, 'repeated apply should not drift bottom edge');
}

function testTipsViewDoesNotWrapSetXY() {
  const { root, tips } = makeTips();

  const originalSetXY = tips.setXY;
  const api = loadUserscript(root);

  assert.strictEqual(tips.setXY, originalSetXY, 'script must not wrap game setXY');

  tips.setXY(850, 470);
  const wantBR = naturalBottomRight(tips);

  api.applyOnce();
  approxEqual(bottomRight(tips).x, wantBR.x, 'right edge should follow natural BR after setXY relayout');
  approxEqual(bottomRight(tips).y, wantBR.y, 'bottom edge should follow natural BR after setXY relayout');
}

testTipsViewKeepsBottomRightAfterRelayout();
testTipsViewDoesNotWrapSetXY();
console.log('mu-left-top-buttons-compact tests passed');
