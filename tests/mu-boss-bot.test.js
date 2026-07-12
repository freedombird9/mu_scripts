const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scriptPath = path.resolve(__dirname, '..', 'mu-boss-bot.user.js');

class FakeNode {
  constructor({
    name = '',
    text = '',
    title = '',
    icon = '',
    packageItem = null,
    x = 0,
    y = 0,
    w = 80,
    h = 30,
    visible = true,
    internalVisible = true,
    enabled = true,
    touchable = true,
    grayed,
  } = {}) {
    this.name = name;
    this.text = text;
    this.title = title;
    this.icon = icon;
    this.packageItem = packageItem;
    this.x = x;
    this.y = y;
    this.width = w;
    this.height = h;
    this.visible = visible;
    this.internalVisible = internalVisible;
    this.enabled = enabled;
    this.touchable = touchable;
    if (grayed !== undefined) this.grayed = grayed;
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

function buildEmptyRoot() {
  return new FakeNode({ name: 'GRoot', w: 1280, h: 720 });
}

function buildSensorScene() {
  const root = buildEmptyRoot();
  root.add(new FakeNode({ name: 'mapName', text: '试炼之地1', x: 1040, y: 64, w: 160, h: 30 }));
  root.add(new FakeNode({ name: 'coord', text: '(146,127)', x: 1110, y: 205, w: 100, h: 24 }));
  root.add(new FakeNode({ name: 'auto', text: '自动攻击', x: 580, y: 680, w: 120, h: 30 }));

  const bossPanel = root.add(new FakeNode({ name: 'bossPanel', text: '挑战BOSS 当前爆率:高', x: 120, y: 120, w: 980, h: 560 }));
  bossPanel.add(new FakeNode({ name: 'tabTrial', text: '试炼之地', x: 530, y: 180, w: 120, h: 35 }));
  bossPanel.add(new FakeNode({ name: 'row1', text: '邪恶龙虾战士 推荐防御:36199 推荐攻击:11632', x: 150, y: 360, w: 260, h: 70 }));
  bossPanel.add(new FakeNode({ name: 'enter1', text: '试炼之地1 (79,68) 1只', x: 410, y: 560, w: 210, h: 40 }));

  const left = root.add(new FakeNode({ name: 'leftTaskPanel', text: '任务', x: 0, y: 80, w: 320, h: 260 }));
  left.add(new FakeNode({ name: 'bossLine1', text: '邪恶龙虾战士 坐标79,68 待击杀', x: 55, y: 120, w: 260, h: 45 }));
  left.add(new FakeNode({ name: 'bossLine2', text: '咆哮龙虾战士 坐标121,33 剩余刷新时间01分30秒', x: 55, y: 175, w: 260, h: 45 }));
  left.add(new FakeNode({ name: 'warriorLine', text: '勇士任务 BOSS悬赏3星 傲之煞 0/1 完成次数:1/4', x: 55, y: 230, w: 300, h: 45 }));

  const taskPanel = root.add(new FakeNode({ name: 'taskPanel', text: '任务面板 BOSS悬赏 3星 领取 提交', x: 340, y: 100, w: 520, h: 500 }));
  taskPanel.add(new FakeNode({ name: 'threeStar', text: '3星 BOSS 傲之煞', x: 380, y: 180, w: 220, h: 40 }));
  taskPanel.add(new FakeNode({ name: 'accept', text: '领取', x: 700, y: 520, w: 90, h: 36 }));
  taskPanel.add(new FakeNode({ name: 'submit', text: '提交', x: 800, y: 520, w: 90, h: 36 }));

  root.add(new FakeNode({ name: 'targetHp', text: 'Lv1200 邪恶龙虾战士 88% 归属:普尔赫达', x: 400, y: 70, w: 420, h: 40 }));
  return root;
}

function buildInstanceBossWndScene() {
  const root = buildEmptyRoot();
  root.add(new FakeNode({ name: 'mapName', text: '四风平原', x: 1040, y: 64, w: 160, h: 30 }));

  const panel = root.add(new FakeNode({
    packageItem: { name: 'InstanceBossWnd', id: 'qt7v0', owner: 'InstanceBossWnd' },
    x: 133,
    y: 95,
    w: 1039,
    h: 560,
  }));

  panel.add(new FakeNode({ name: 'tabWild', text: '野外BOSS', x: 165, y: 155, w: 133, h: 35 }));
  panel.add(new FakeNode({ name: 'tabWildShadow', text: '野外BOSS', x: 165, y: 159, w: 133, h: 35 }));
  panel.add(new FakeNode({ name: 'tabWelfare', text: '福利BOSS', x: 300, y: 155, w: 133, h: 35 }));

  const scroll = panel.add(new FakeNode({ name: 'wildlevelScroll', x: 163, y: 190, w: 266, h: 420 }));
  const row = scroll.add(new FakeNode({
    packageItem: { name: 'BtnBoss', id: 'w4lfq9', owner: '_UIComponent' },
    x: 163,
    y: 480,
    w: 266,
    h: 77,
  }));
  row.add(new FakeNode({ name: 'lab_name', text: '愤怒傲之煞', x: 244, y: 489, w: 88, h: 16 }));
  row.add(new FakeNode({
    name: 'lab_level',
    text: '推荐防御：[color=#1Add1F]33366[/color]推荐攻击：[color=#1Add1F]11637[/color]',
    x: 244,
    y: 510,
    w: 167,
    h: 44,
  }));

  const locked = scroll.add(new FakeNode({
    packageItem: { name: 'BtnBoss', id: 'w4lfq9', owner: '_UIComponent' },
    x: 163,
    y: 634,
    w: 266,
    h: 77,
  }));
  locked.add(new FakeNode({ name: 'lab_name', text: '地狱骑士', x: 244, y: 643, w: 72, h: 16 }));
  locked.add(new FakeNode({ name: 'lab_level', text: '开启等级:[color=#FF2323]4转[/color]', x: 244, y: 674, w: 167, h: 44 }));

  const mapButton = panel.add(new FakeNode({
    packageItem: { name: 'BtnBossMore', id: 'qt7vq5', owner: '_UIComponent' },
    x: 455,
    y: 530,
    w: 212,
    h: 40,
  }));
  mapButton.add(new FakeNode({ name: 'lab_mapName', text: '[color=#DCE1E5]四风平原 [1线][/color]', x: 464, y: 544, w: 104, h: 15 }));
  mapButton.add(new FakeNode({ name: 'lab_bossCount', text: '[color=#1Add1F]1只[/color]', x: 578, y: 544, w: 82, h: 26 }));

  const hiddenPanel = panel.add(new FakeNode({ name: 'KunDunBossPanel', x: 0, y: 0, w: 320, h: 500 }));
  const placeholder = hiddenPanel.add(new FakeNode({
    packageItem: { name: 'BtnBoss', id: 'w4lfq9', owner: '_UIComponent' },
    x: 30,
    y: 103,
    w: 266,
    h: 77,
  }));
  placeholder.add(new FakeNode({ name: 'lab_name', text: '冰后', x: 80, y: 112, w: 40, h: 16 }));

  root.add(new FakeNode({ name: 'unrelatedTask', text: '前往下层', x: 106, y: 114, w: 170, h: 40 }));
  return root;
}

function buildConfiguredBossPanelScene({
  tab = '野外BOSS',
  bossName = '傲之煞',
  detail = '推荐防御：27529推荐攻击：11637',
  rows = null,
  hiddenKunDunEntrance = false,
  mapButtons = ['幻术秘境3 (126,118) 0只', '会员秘境4 (126,118) 1只', '四风平原 [1线] 1只'],
} = {}) {
  const root = buildEmptyRoot();
  const panel = root.add(new FakeNode({
    packageItem: { name: 'InstanceBossWnd', id: 'qt7v0', owner: 'InstanceBossWnd' },
    x: 133,
    y: 95,
    w: 1039,
    h: 560,
  }));
  panel.add(new FakeNode({ name: 'tab', text: tab, x: 165, y: 155, w: 133, h: 35 }));

  const scroll = panel.add(new FakeNode({ name: 'wildlevelScroll', x: 163, y: 190, w: 266, h: 420 }));
  (rows || [{ name: bossName, detail }]).forEach((item, index) => {
    const y = 403 + index * 77;
    const row = scroll.add(new FakeNode({
      packageItem: { name: 'BtnBoss', id: 'w4lfq9', owner: '_UIComponent' },
      x: 163,
      y,
      w: 266,
      h: 77,
    }));
    row.add(new FakeNode({ name: 'lab_name', text: item.name, x: 244, y: y + 9, w: 88, h: 16 }));
    row.add(new FakeNode({ name: 'lab_level', text: item.detail || detail, x: 244, y: y + 30, w: 167, h: 44 }));
  });

  mapButtons.forEach((text, index) => {
    const x = 455 + (index % 3) * 222;
    const y = 530 + Math.floor(index / 3) * 50;
    const button = panel.add(new FakeNode({
      packageItem: { name: 'BtnBossMore', id: 'qt7vq5', owner: '_UIComponent' },
      x,
      y,
      w: 212,
      h: 40,
    }));
    button.add(new FakeNode({ name: 'lab_mapName', text, x: x + 9, y: y + 14, w: 180, h: 15 }));
  });

  if (hiddenKunDunEntrance) {
    const hiddenPanel = panel.add(new FakeNode({
      name: 'KunDunBossPanel',
      packageItem: { name: 'KunDunBossPanel', id: 'qt7vk0', owner: 'InstanceBossWnd' },
      x: 30,
      y: 60,
      w: 1006,
      h: 490,
      internalVisible: false,
    }));
    const mapList = hiddenPanel.add(new FakeNode({ name: 'KunDun_mapName', x: 322, y: 435, w: 226, h: 48 }));
    const button = mapList.add(new FakeNode({
      packageItem: { name: 'BtnBossMore', id: 'qt7vq5', owner: '_UIComponent' },
      x: 322,
      y: 435,
      w: 212,
      h: 40,
    }));
    button.add(new FakeNode({ name: 'lab_mapName', text: '秘境14层 (23,232)', x: 331, y: 449, w: 130, h: 15 }));
    button.add(new FakeNode({ name: 'lab_bossCount', text: '20只', x: 470, y: 449, w: 50, h: 15 }));
  }
  return root;
}

function buildWarriorTaskScene(firstState = 'available') {
  const root = buildEmptyRoot();
  const panel = root.add(new FakeNode({
    name: 'Task_TaskStart',
    packageItem: { name: 'StarTaskWnd', id: 'chtd2', owner: 'StarTaskWnd' },
    x: 119,
    y: 89,
    w: 1067,
    h: 573,
  }));

  panel.add(new FakeNode({ name: 'title', text: '勇士任务', x: 412, y: 102, w: 482, h: 49 }));
  const taskList = panel.add(new FakeNode({ name: 'taskList', x: 155, y: 167, w: 746, h: 376 }));

  addWarriorCard(taskList, {
    index: 0,
    name: '傲之煞',
    map: '四风平原',
    progress: firstState === 'reward_ready' ? '1/1' : '0/1',
    star: 3,
    state: firstState,
    x: 155,
  });
  addWarriorCard(taskList, {
    index: 1,
    name: '狂暴火焰巨人',
    map: '安宁池',
    progress: '0/1',
    star: 2,
    state: 'available',
    x: 408,
  });
  addWarriorCard(taskList, {
    index: 2,
    name: '愤怒火焰巨人',
    map: '安宁池',
    progress: '0/1',
    star: 1,
    state: 'available',
    x: 661,
  });

  panel.add(new FakeNode({ name: 'n5', text: '完成次数：', x: 490, y: 545, w: 90, h: 18 }));
  panel.add(new FakeNode({ name: 'textFinishTime', text: '2/4', x: 580, y: 545, w: 33, h: 18 }));
  panel.add(new FakeNode({ name: 'n6', text: '消耗：', x: 643, y: 544, w: 54, h: 18 }));
  panel.add(new FakeNode({ name: 'textTaskCost', text: '6379613/200', x: 763, y: 545, w: 113, h: 18 }));
  panel.add(new FakeNode({ name: 'btnRefresh', text: '一键刷新', x: 565, y: 582, w: 191, h: 47 }));
  panel.add(new FakeNode({ name: 'n4', text: '最高可接取三星难度任务', x: 586, y: 635, w: 132, h: 12 }));
  return root;
}

function addWarriorCard(parent, { index, name, map, progress, star, state, x }) {
  const card = parent.add(new FakeNode({
    packageItem: { name: 'taskItem', id: 'w6ae6', owner: 'StarTaskWnd' },
    x,
    y: 167,
    w: 240,
    h: 376,
  }));
  card.add(new FakeNode({ name: `bg${star}`, packageItem: { name: `bg${star}`, id: `bg${star}`, owner: 'StarTaskWnd' }, x, y: 167, w: 240, h: 368 }));
  const listStar = card.add(new FakeNode({ name: 'listStar', x: x + 73, y: 187, w: 96, h: 29 }));
  for (let i = 0; i < star; i += 1) {
    listStar.add(new FakeNode({ packageItem: { name: 'ico_auctionStar_bright', id: 'fihopi', owner: '_UIComponent' }, x: x + 74 + i * 31, y: 187, w: 31, h: 29 }));
  }
  card.add(new FakeNode({ name: 'textName', text: name, x: x - 1, y: 360, w: 150, h: 26 }));
  card.add(new FakeNode({ name: 'textMapName', text: `所在地图：${map}`, x: x + 42, y: 385, w: 144, h: 16 }));
  card.add(new FakeNode({ name: 'textTaskTarget', text: progress, x: x + 125, y: 406, w: 107, h: 24 }));
  card.add(new FakeNode({
    name: 'btnQuit',
    text: '放弃',
    packageItem: { name: 'btnShort2', id: 'hxnani', owner: '_UIComponent' },
    x: state === 'accepted' ? x + 22 : 22,
    y: state === 'accepted' ? 493 : 326,
    w: 93,
    h: 31,
    internalVisible: state === 'accepted',
  }));
  card.add(new FakeNode({
    name: 'btnAccept',
    text: state === 'reward_ready' ? '领取奖励' : '领取任务',
    packageItem: { name: 'btnShort3', id: 'qhb62d', owner: '_UIComponent' },
    x: x + 63,
    y: 487,
    w: 113,
    h: 40,
    internalVisible: state !== 'accepted',
    grayed: false,
  }));
  card.add(new FakeNode({
    name: 'btnGo',
    text: '前往',
    packageItem: { name: 'btnShort2', id: 'hxnani', owner: '_UIComponent' },
    x: state === 'accepted' ? x + 129 : 129,
    y: state === 'accepted' ? 493 : 326,
    w: 93,
    h: 31,
    internalVisible: state === 'accepted',
  }));
  return card;
}

function makeStorage(seed = {}) {
  return {
    data: { ...seed },
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
    },
    setItem(key, value) {
      this.data[key] = String(value);
    },
    removeItem(key) {
      delete this.data[key];
    },
  };
}

function serializeNode(node) {
  return {
    name: node.name,
    text: node.text,
    title: node.title,
    icon: node.icon,
    packageItem: node.packageItem,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    visible: node.visible,
    internalVisible: node.internalVisible,
    enabled: node.enabled,
    touchable: node.touchable,
    grayed: node.grayed,
    children: node.children.map(serializeNode),
  };
}

function loadUserscript(root = buildEmptyRoot(), storage = makeStorage(), now = 1783339200000) {
  const storageSeed = storage && storage.data ? storage.data : {};
  const sandbox = {
    __rootJson: JSON.stringify(serializeNode(root)),
    __now: now,
    __storageSeed: JSON.stringify(storageSeed),
    __href: 'https://cdn.qj2h5.jiuxiaokj.cn/mu2h5/h5-data/mu-release/index.html',
  };
  vm.createContext(sandbox);
  vm.runInContext(`
    const NativeDate = Date;
    const rootData = JSON.parse(__rootJson);
    const storageData = JSON.parse(__storageSeed);
    location = {
      href: __href,
      hostname: 'cdn.qj2h5.jiuxiaokj.cn',
      pathname: '/mu2h5/h5-data/mu-release/index.html',
    };

    function noop() {}

    function MockDate(...args) {
      if (!(this instanceof MockDate)) {
        return new MockDate(...args).toString();
      }

      const value = args.length ? new NativeDate(...args).getTime() : __now;
      Object.defineProperty(this, '_time', {
        value,
        enumerable: false,
        configurable: false,
        writable: false,
      });
    }

    MockDate.now = function nowMock() {
      return __now;
    };

    MockDate.parse = function parseMock(value) {
      return NativeDate.parse(value);
    };

    MockDate.UTC = function utcMock(...args) {
      return NativeDate.UTC(...args);
    };

    MockDate.prototype._date = function dateMock() {
      return new NativeDate(this._time);
    };

    MockDate.prototype.getUTCFullYear = function getUTCFullYear() {
      return this._date().getUTCFullYear();
    };

    MockDate.prototype.getUTCMonth = function getUTCMonth() {
      return this._date().getUTCMonth();
    };

    MockDate.prototype.getUTCDate = function getUTCDate() {
      return this._date().getUTCDate();
    };

    MockDate.prototype.getUTCHours = function getUTCHours() {
      return this._date().getUTCHours();
    };

    MockDate.prototype.getUTCMinutes = function getUTCMinutes() {
      return this._date().getUTCMinutes();
    };

    MockDate.prototype.getUTCSeconds = function getUTCSeconds() {
      return this._date().getUTCSeconds();
    };

    MockDate.prototype.getUTCDay = function getUTCDay() {
      return this._date().getUTCDay();
    };

    MockDate.prototype.getTime = function getTime() {
      return this._time;
    };

    MockDate.prototype.valueOf = function valueOf() {
      return this._time;
    };

    MockDate.prototype.toISOString = function toISOString() {
      return this._date().toISOString();
    };

    MockDate.prototype.toJSON = function toJSON() {
      return this.toISOString();
    };

    MockDate.prototype.toString = function toString() {
      return this._date().toString();
    };

    function makeElement(tagName) {
      return {
        tagName: String(tagName || '').toUpperCase(),
        style: {},
        dataset: {},
        textContent: '',
        appendChild(child) { return child; },
        remove() {},
        addEventListener() {},
      };
    }

    function hydrateNode(data, parent) {
      const node = {
        name: data.name || '',
        text: data.text || '',
        title: data.title || '',
        icon: data.icon || '',
        packageItem: data.packageItem || null,
        x: data.x || 0,
        y: data.y || 0,
        width: data.width || 0,
        height: data.height || 0,
        visible: data.visible !== false,
        internalVisible: data.internalVisible !== false,
        enabled: data.enabled !== false,
        touchable: data.touchable !== false,
        grayed: data.grayed,
        parent: parent || null,
        children: [],
        getChildAt(index) {
          return this.children[index];
        },
        localToGlobalRect() {
          return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
          };
        },
      };
      Object.defineProperty(node, 'numChildren', {
        get() {
          return this.children.length;
        },
      });
      node.children = (data.children || []).map((child) => hydrateNode(child, node));
      return node;
    }

    const documentElement = makeElement('html');
    documentElement.appendChild = function appendChild(node) {
      if (node && node.tagName === 'SCRIPT') {
        (0, eval)(node.textContent);
      }
      return node;
    };

    const localStorage = {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(storageData, key) ? storageData[key] : null;
      },
      setItem(key, value) {
        storageData[key] = String(value);
      },
      removeItem(key) {
        delete storageData[key];
      },
      _dump() {
        return JSON.parse(JSON.stringify(storageData));
      },
    };

    console = {
      log: noop,
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
    };
    Date = MockDate;
    setInterval = function setIntervalMock() { return 1; };
    clearInterval = noop;
    setTimeout = function setTimeoutMock(fn) {
      if (typeof fn === 'function') fn();
      return 1;
    };
    clearTimeout = noop;
    document = {
      createElement: makeElement,
      getElementById() { return null; },
      documentElement,
      head: documentElement,
      body: documentElement,
    };
    window = {
      fgui: { GRoot: { inst: hydrateNode(rootData) } },
      localStorage,
    };
    window.window = window;
    window.document = document;
    window.location = location;
    window.console = console;
    window.Date = Date;
    window.setInterval = setInterval;
    window.clearInterval = clearInterval;
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    window.unsafeWindow = window;
    unsafeWindow = window;
  `, sandbox, { filename: 'mu-boss-bot-test-sandbox.js' });

  // Task 1 intentionally fails with ENOENT until Task 2 adds mu-boss-bot.user.js.
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), sandbox, { filename: scriptPath });
  return { api: sandbox.window.__muBossBot, storage: sandbox.window.localStorage, sandbox };
}

function testPublicApiExists() {
  const { api } = loadUserscript();
  assert(api, 'expected window.__muBossBot to exist');
  [
    'getStatus',
    'getConfig',
    'setConfig',
    'pause',
    'resume',
    'scan',
    'plan',
    'tick',
    'exportLogs',
    'clearLogs',
    'markManualResult',
  ].forEach((name) => assert.strictEqual(typeof api[name], 'function', `${name} should be a function`));
  const status = api.getStatus();
  assert.strictEqual(status.state, 'SYNC');
  assert.strictEqual(status.mode, 'dry-run');
}

function testConfigNormalizationAndLogs() {
  const { api, storage } = loadUserscript();
  const config = api.setConfig({
    enabled: true,
    dryRun: false,
    defaults: { preWaitSeconds: 9999 },
    targets: [
      { type: '福利BOSS', name: '愤怒闪电巨人', priority: 2000, dailyLimit: 2 },
      { type: '福利BOSS', name: '', priority: 1 },
    ],
    fallbackFarmSpots: [
      { name: '挂机点A', map: '', coordinate: '', priority: 5 },
      { name: '挂机点B', map: '四风平原', coordinate: '100,120', priority: 10 },
    ],
  });

  assert.strictEqual(config.enabled, true);
  assert.strictEqual(config.dryRun, false);
  assert.strictEqual(config.defaults.preWaitSeconds, 600);
  assert.strictEqual(config.targets.length, 1);
  assert.strictEqual(config.targets[0].priority, 999);
  assert.strictEqual(config.fallbackFarmSpots.length, 2);
  assert(storage.getItem('mu_boss_bot_config_v1'), 'config should be persisted');

  const logs = api.exportLogs();
  assert(logs.some((entry) => entry.type === 'config_updated'), 'config update should be logged');
  assert.strictEqual(api.clearLogs().length, 0);
}

function testMalformedConfigPatchesUseDefaults() {
  const { api } = loadUserscript();
  let config = api.setConfig({ defaults: null, warriorTask: null });
  assert.strictEqual(config.defaults.preWaitSeconds, 90);
  assert.strictEqual(config.warriorTask.dailyLimit, 4);

  config = api.setConfig({ defaults: 'bad', warriorTask: 'bad' });
  assert.strictEqual(config.defaults.preWaitSeconds, 90);
  assert.strictEqual(config.warriorTask.dailyLimit, 4);
  assert.strictEqual(config.warriorTask.requiredStar, 3);
}

function testPauseResumeAndManualResult() {
  const { api } = loadUserscript();
  api.pause('user playing');
  assert.strictEqual(api.getStatus().state, 'PAUSED');
  assert.strictEqual(api.getStatus().paused, true);
  assert.strictEqual(api.getStatus().pauseReason, 'user playing');

  api.markManualResult({ type: 'user_killed_boss', target: '傲之煞' });
  assert(api.exportLogs().some((entry) => entry.type === 'manual_result'));

  api.resume();
  assert.strictEqual(api.getStatus().state, 'SYNC');
  assert.strictEqual(api.getStatus().paused, false);
}

function testSensorSnapshotFromUi() {
  const { api } = loadUserscript(buildSensorScene());
  const snapshot = api.scan();

  assert.strictEqual(snapshot.scene.mapName, '试炼之地1');
  assert.strictEqual(snapshot.scene.coordinates, '146,127');
  assert.strictEqual(snapshot.scene.autoBattleState, 'auto');

  assert.strictEqual(snapshot.bossPanel.open, true);
  assert(snapshot.bossPanel.tabs.some((tab) => tab.text === '试炼之地'));
  assert(snapshot.bossPanel.rows.some((row) => row.name === '邪恶龙虾战士'));
  assert(snapshot.bossPanel.enterButtons.some((button) => button.text.includes('试炼之地1')));

  assert(snapshot.leftPanel.bossEntries.some((entry) => entry.name === '邪恶龙虾战士' && entry.state === 'ready'));
  assert(snapshot.leftPanel.bossEntries.some((entry) => entry.name === '咆哮龙虾战士' && entry.refreshInSeconds === 90));
  assert.strictEqual(snapshot.leftPanel.warriorTaskEntries[0].star, 3);

  assert.strictEqual(snapshot.taskPanel.open, true);
  assert.strictEqual(snapshot.taskPanel.selectedTask.star, 3);
  assert.strictEqual(snapshot.taskPanel.acceptButton.text, '领取');
  assert.strictEqual(snapshot.taskPanel.submitButton.text, '提交');

  assert.strictEqual(snapshot.combat.targetName, '邪恶龙虾战士');
  assert.strictEqual(snapshot.combat.hpPercent, 88);
  assert.strictEqual(snapshot.combat.ownerName, '普尔赫达');
  assert(snapshot.confidence.scene > 0.5);
  assert(snapshot.confidence.bossPanel > 0.5);
}

function testBossPanelScansInstanceBossWndRows() {
  const { api } = loadUserscript(buildInstanceBossWndScene());
  const snapshot = api.scan();

  assert.strictEqual(snapshot.bossPanel.open, true);
  assert(snapshot.bossPanel.tabs.some((tab) => tab.text === '野外BOSS'));
  assert.strictEqual(snapshot.bossPanel.tabs.filter((tab) => tab.text === '野外BOSS').length, 1);
  assert(snapshot.bossPanel.rows.some((row) => row.name === '愤怒傲之煞' && /33366/.test(row.text)));
  assert(snapshot.bossPanel.rows.some((row) => row.name === '地狱骑士' && /4转/.test(row.text)));
  assert(!snapshot.bossPanel.rows.some((row) => row.name === '冰后'));
  assert(snapshot.bossPanel.enterButtons.some((button) => button.text.includes('四风平原') && button.text.includes('1只')));
  assert(!snapshot.bossPanel.rows.some((row) => row.text.includes('[color=')));
  assert(!snapshot.bossPanel.enterButtons.some((button) => button.text.includes('[color=')));
  assert(!snapshot.bossPanel.enterButtons.some((button) => button.text.includes('前往下层')));
  assert(snapshot.confidence.bossPanel > 0.5);
}

function testBossPanelParsesEntranceAvailability() {
  const { api } = loadUserscript(buildConfiguredBossPanelScene());
  const panel = api.scan().bossPanel;

  assert.strictEqual(panel.enterButtons[0].map, '幻术秘境3');
  assert.strictEqual(panel.enterButtons[0].coordinate, '126,118');
  assert.strictEqual(panel.enterButtons[0].count, 0);
  assert.strictEqual(panel.enterButtons[0].blockedReason, '');

  assert.strictEqual(panel.enterButtons[1].map, '会员秘境4');
  assert.strictEqual(panel.enterButtons[1].count, 1);
  assert(panel.enterButtons[1].blockedReason.includes('会员秘境'));

  assert.strictEqual(panel.enterButtons[2].map, '四风平原 [1线]');
  assert.strictEqual(panel.enterButtons[2].count, 1);
  assert.strictEqual(panel.enterButtons[2].blockedReason, '');
}

function testBossPanelIgnoresHiddenAncestorEntrances() {
  const { api } = loadUserscript(buildConfiguredBossPanelScene({
    hiddenKunDunEntrance: true,
    mapButtons: ['幻术秘境3 (126,118) 1只'],
  }));
  const panel = api.scan().bossPanel;

  assert(panel.enterButtons.some((button) => button.map === '幻术秘境3'));
  assert(!panel.enterButtons.some((button) => button.map === '秘境14层'));
}

function testPlannerUsesConfiguredBossEligibleEntrance() {
  const { api } = loadUserscript(buildConfiguredBossPanelScene());
  api.setConfig({
    enabled: true,
    targets: [{ type: '野外BOSS', name: '傲之煞', priority: 100, dailyLimit: 3 }],
    warriorTask: { enabled: false },
  });

  const plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'prepare_boss');
  assert.strictEqual(plan.intent.reason, 'configured boss panel candidate');
  assert.strictEqual(plan.intent.row.name, '傲之煞');
  assert.strictEqual(plan.intent.enterButton.map, '四风平原 [1线]');
  assert.strictEqual(plan.intent.enterButton.count, 1);
}

function testPlannerDoesNotMatchDecoratedBossNameByDefault() {
  const { api } = loadUserscript(buildConfiguredBossPanelScene({
    bossName: '愤怒闪电巨人',
    mapButtons: ['幻术秘境3 (126,118) 1只'],
  }));
  api.setConfig({
    enabled: true,
    targets: [{ type: '野外BOSS', name: '闪电巨人', priority: 100, dailyLimit: 3 }],
    warriorTask: { enabled: false },
    fallbackFarmSpots: [],
  });

  const plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'pause');
  assert.strictEqual(plan.intent.reason, 'no actionable target and no valid farm spot');
}

function testPlannerAllowsConfiguredContainsNameMatch() {
  const { api } = loadUserscript(buildConfiguredBossPanelScene({
    bossName: '愤怒闪电巨人',
    mapButtons: ['幻术秘境3 (126,118) 1只'],
  }));
  api.setConfig({
    enabled: true,
    targets: [{ type: '野外BOSS', name: '闪电巨人', matchMode: 'contains', priority: 100, dailyLimit: 3 }],
    warriorTask: { enabled: false },
  });

  const plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'prepare_boss');
  assert.strictEqual(plan.intent.row.name, '愤怒闪电巨人');
}

function testPlannerBlocksConfiguredBossWithoutEligibleEntrance() {
  const { api } = loadUserscript(buildConfiguredBossPanelScene({
    bossName: '闪电巨人',
    mapButtons: ['会员秘境4 (126,118) 1只', '会员9层 [1线] 3只', '幻术秘境3 (126,118) 0只'],
  }));
  api.setConfig({
    enabled: true,
    targets: [{ type: '野外BOSS', name: '闪电巨人', priority: 100, dailyLimit: 3 }],
    warriorTask: { enabled: false },
  });

  const plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'configured_boss_blocked');
  assert.strictEqual(plan.intent.reason, 'configured boss has no eligible entrance');
  assert.strictEqual(plan.intent.row.name, '闪电巨人');
  assert(plan.intent.blockedEntrances.some((entry) => entry.blockedReason.includes('会员秘境')));
  assert(plan.intent.blockedEntrances.some((entry) => entry.blockedReason.includes('会员\\d+层')));
}

function testWarriorTaskPanelScansAvailableAcceptedAndRewardStates() {
  let snapshot = loadUserscript(buildWarriorTaskScene('available')).api.scan();
  assert.strictEqual(snapshot.warriorTaskPanel.open, true);
  assert.strictEqual(snapshot.warriorTaskPanel.completed, 2);
  assert.strictEqual(snapshot.warriorTaskPanel.limit, 4);
  assert.strictEqual(snapshot.warriorTaskPanel.maxStar, 3);
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].name, '傲之煞');
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].map, '四风平原');
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].progressText, '0/1');
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].star, 3);
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].state, 'available');
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].buttons.accept.text, '领取任务');

  snapshot = loadUserscript(buildWarriorTaskScene('accepted')).api.scan();
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].state, 'accepted');
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].buttons.go.text, '前往');
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].buttons.abandon.text, '放弃');
  assert.strictEqual(snapshot.warriorTaskPanel.cards[1].state, 'available');

  snapshot = loadUserscript(buildWarriorTaskScene('reward_ready')).api.scan();
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].state, 'reward_ready');
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].progressText, '1/1');
  assert.strictEqual(snapshot.warriorTaskPanel.cards[0].buttons.reward.text, '领取奖励');
}

function testPlannerUsesWarriorTaskPanelPriority() {
  let { api } = loadUserscript(buildWarriorTaskScene('reward_ready'));
  api.setConfig({ enabled: true, targets: [], warriorTask: { requiredStar: 3 } });
  let plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'warrior_task_claim_reward');
  assert.strictEqual(plan.intent.task.name, '傲之煞');

  ({ api } = loadUserscript(buildWarriorTaskScene('accepted')));
  api.setConfig({ enabled: true, targets: [], warriorTask: { requiredStar: 3 } });
  plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'warrior_task_go');
  assert.strictEqual(plan.intent.task.name, '傲之煞');

  ({ api } = loadUserscript(buildWarriorTaskScene('available')));
  api.setConfig({ enabled: true, targets: [], warriorTask: { requiredStar: 3 } });
  plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'warrior_task_accept');
  assert.strictEqual(plan.intent.task.name, '傲之煞');
  assert.strictEqual(plan.intent.task.star, 3);
}

function testPlannerChoosesConfiguredReadyBoss() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [
      { type: '试炼之地', name: '咆哮龙虾战士', priority: 90, dailyLimit: 3, preWaitSeconds: 90 },
      { type: '试炼之地', name: '邪恶龙虾战士', priority: 10, dailyLimit: 3, preWaitSeconds: 90 },
    ],
  });
  const snapshot = api.scan();
  const plan = api.plan(snapshot);
  assert.strictEqual(plan.intent.type, 'prepare_boss');
  assert.strictEqual(plan.intent.target.name, '邪恶龙虾战士');
  assert.strictEqual(plan.intent.reason, 'configured boss ready');
}

function testPlannerPreWaitsConfiguredCooldownBoss() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [
      { type: '试炼之地', name: '咆哮龙虾战士', priority: 90, dailyLimit: 3, preWaitSeconds: 90 },
    ],
  });
  const snapshot = api.scan();
  const plan = api.plan(snapshot);
  assert.strictEqual(plan.intent.type, 'travel_to_boss');
  assert.strictEqual(plan.intent.target.name, '咆哮龙虾战士');
  assert.strictEqual(plan.intent.reason, 'within pre-wait window');
}

function testPlannerAllowsWarriorTaskDuringLongBossCooldown() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [
      { type: '试炼之地', name: '咆哮龙虾战士', priority: 90, dailyLimit: 3, preWaitSeconds: 60 },
    ],
  });
  const snapshot = api.scan();
  const plan = api.plan(snapshot);
  assert.strictEqual(plan.intent.type, 'warrior_task');
  assert.strictEqual(plan.intent.reason, 'three-star warrior boss task available');
  assert.strictEqual(plan.intent.task.star, 3);
}

function testPlannerDoesNotFarmWithoutConfiguredSpot() {
  const { api } = loadUserscript(buildEmptyRoot());
  api.setConfig({ enabled: true, targets: [], fallbackFarmSpots: [{ name: 'empty', map: '', coordinate: '' }] });
  const plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'pause');
  assert.strictEqual(plan.intent.reason, 'no actionable target and no valid farm spot');
}

function testPlannerUsesValidFarmFallback() {
  const { api } = loadUserscript(buildEmptyRoot());
  api.setConfig({ enabled: true, targets: [], fallbackFarmSpots: [{ name: 'farm', map: '四风平原', coordinate: '100,120', priority: 1 }] });
  const plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'farm_fallback');
  assert.strictEqual(plan.intent.farmSpot.name, 'farm');
}

function testWarriorTaskDailyLimitBlocksPlanning() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [],
    warriorTask: { dailyLimit: 1 },
  });
  api.markManualResult({ type: 'warrior_task_submitted' });
  const status = api.getStatus();
  assert.strictEqual(status.daily.counts.warriorTask, 1);

  const plan = api.plan(api.scan());
  assert.notStrictEqual(plan.intent.type, 'warrior_task');
}

function testAutoCandidateRequiresEnterEvidence() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [],
    fallbackFarmSpots: [{ name: 'farm', map: '四风平原', coordinate: '100,120', priority: 1 }],
    warriorTask: { enabled: false },
  });
  const snapshot = api.scan();
  snapshot.bossPanel.enterButtons = [];
  const plan = api.plan(snapshot);
  assert.strictEqual(plan.intent.type, 'farm_fallback');
  assert.strictEqual(plan.intent.farmSpot.name, 'farm');
}

function testAutoCandidateRequiresFiniteConfidence() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [],
    fallbackFarmSpots: [{ name: 'farm', map: '四风平原', coordinate: '100,120', priority: 1 }],
    warriorTask: { enabled: false },
  });

  const missingConfidence = api.scan();
  delete missingConfidence.confidence;
  let plan = api.plan(missingConfidence);
  assert.strictEqual(plan.intent.type, 'farm_fallback');

  const nanConfidence = api.scan();
  nanConfidence.confidence.bossPanel = 'not-a-number';
  plan = api.plan(nanConfidence);
  assert.strictEqual(plan.intent.type, 'farm_fallback');
}

function testAutoCandidateIncludesEnterEvidence() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [],
    warriorTask: { enabled: false },
  });
  const plan = api.plan(api.scan());
  assert.strictEqual(plan.intent.type, 'auto_candidate');
  assert.strictEqual(plan.intent.reason, 'panel candidate with enter evidence');
  assert.strictEqual(plan.intent.row.name, '邪恶龙虾战士');
  assert(plan.intent.enterButton.text.includes('试炼之地1'));
}

function testDailyKeysUseUtc8() {
  const beforeReset = global.Date.parse('2026-07-05T15:59:00.000Z');
  const afterReset = global.Date.parse('2026-07-05T16:01:00.000Z');

  const first = loadUserscript(buildEmptyRoot(), makeStorage(), beforeReset).api;
  assert.strictEqual(first.getStatus().dayKey, '2026-07-05');

  const second = loadUserscript(buildEmptyRoot(), makeStorage(), afterReset).api;
  assert.strictEqual(second.getStatus().dayKey, '2026-07-06');
}

function testManualResultRecordsKillCount() {
  const { api } = loadUserscript();
  api.setConfig({
    enabled: true,
    targets: [{ type: '福利BOSS', name: '愤怒闪电巨人', priority: 10, dailyLimit: 1 }],
  });
  api.markManualResult({ type: 'boss_killed', target: { type: '福利BOSS', name: '愤怒闪电巨人' } });
  const status = api.getStatus();
  assert.strictEqual(status.daily.counts['福利BOSS::愤怒闪电巨人'], 1);

  const snapshot = api.scan();
  snapshot.leftPanel.bossEntries = [{ name: '愤怒闪电巨人', state: 'ready', refreshInSeconds: null }];
  const plan = api.plan(snapshot);
  assert.strictEqual(plan.intent.type, 'disabled');
  assert.strictEqual(plan.intent.reason, 'daily limit reached');
}

function testTickLogsIntentWithoutExecutingActions() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [{ type: '试炼之地', name: '邪恶龙虾战士', priority: 10, dailyLimit: 3, preWaitSeconds: 90 }],
  });
  const result = api.tick();
  assert.strictEqual(result.status.currentIntent.type, 'prepare_boss');
  assert.strictEqual(result.executed.length, 0);
  assert(api.exportLogs().some((entry) => entry.type === 'intent_planned' && entry.intent.type === 'prepare_boss'));
}

function testPausedTickDoesNotPlanGameplayIntent() {
  const { api } = loadUserscript(buildSensorScene());
  api.setConfig({
    enabled: true,
    targets: [{ type: '试炼之地', name: '邪恶龙虾战士', priority: 10, dailyLimit: 3, preWaitSeconds: 90 }],
  });
  api.pause('manual takeover');
  const result = api.tick();
  assert.strictEqual(result.status.state, 'PAUSED');
  assert.strictEqual(result.status.currentIntent.type, 'pause');
  assert.strictEqual(result.executed.length, 0);
}

function run() {
  testPublicApiExists();
  testConfigNormalizationAndLogs();
  testMalformedConfigPatchesUseDefaults();
  testPauseResumeAndManualResult();
  testSensorSnapshotFromUi();
  testBossPanelScansInstanceBossWndRows();
  testBossPanelParsesEntranceAvailability();
  testBossPanelIgnoresHiddenAncestorEntrances();
  testPlannerUsesConfiguredBossEligibleEntrance();
  testPlannerDoesNotMatchDecoratedBossNameByDefault();
  testPlannerAllowsConfiguredContainsNameMatch();
  testPlannerBlocksConfiguredBossWithoutEligibleEntrance();
  testWarriorTaskPanelScansAvailableAcceptedAndRewardStates();
  testPlannerUsesWarriorTaskPanelPriority();
  testPlannerChoosesConfiguredReadyBoss();
  testPlannerPreWaitsConfiguredCooldownBoss();
  testPlannerAllowsWarriorTaskDuringLongBossCooldown();
  testPlannerDoesNotFarmWithoutConfiguredSpot();
  testPlannerUsesValidFarmFallback();
  testWarriorTaskDailyLimitBlocksPlanning();
  testAutoCandidateRequiresEnterEvidence();
  testAutoCandidateRequiresFiniteConfidence();
  testAutoCandidateIncludesEnterEvidence();
  testDailyKeysUseUtc8();
  testManualResultRecordsKillCount();
  testTickLogsIntentWithoutExecutingActions();
  testPausedTickDoesNotPlanGameplayIntent();
  console.log('mu-boss-bot tests passed');
}

run();
