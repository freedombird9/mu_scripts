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

function run() {
  testPublicApiExists();
  testConfigNormalizationAndLogs();
  testPauseResumeAndManualResult();
  testSensorSnapshotFromUi();
  testPlannerChoosesConfiguredReadyBoss();
  testPlannerPreWaitsConfiguredCooldownBoss();
  testPlannerDoesNotFarmWithoutConfiguredSpot();
  testPlannerUsesValidFarmFallback();
  testDailyKeysUseUtc8();
  testManualResultRecordsKillCount();
  console.log('mu-boss-bot tests passed');
}

run();
