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

function makeConsoleStub() {
  return {
    log() {},
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

function makeMockDate(now) {
  function MockDate(...args) {
    if (!(this instanceof MockDate)) {
      return new MockDate(...args).toISOString();
    }

    const value = args.length ? new global.Date(...args).getTime() : now;
    Object.defineProperty(this, '_time', {
      value,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }

  MockDate.now = function nowMock() {
    return now;
  };

  MockDate.parse = function parseMock(value) {
    return global.Date.parse(value);
  };

  MockDate.UTC = function utcMock(...args) {
    return global.Date.UTC(...args);
  };

  MockDate.prototype.getUTCFullYear = function getUTCFullYear() {
    return new global.Date(this._time).getUTCFullYear();
  };

  MockDate.prototype.getUTCMonth = function getUTCMonth() {
    return new global.Date(this._time).getUTCMonth();
  };

  MockDate.prototype.getUTCDate = function getUTCDate() {
    return new global.Date(this._time).getUTCDate();
  };

  MockDate.prototype.toISOString = function toISOString() {
    return new global.Date(this._time).toISOString();
  };

  return MockDate;
}

function loadUserscript(root = buildEmptyRoot(), storage = makeStorage(), now = 1783339200000) {
  const documentElement = new FakeNode({ name: 'documentElement' });
  const safeConsole = makeConsoleStub();
  const MockDate = makeMockDate(now);
  const sandbox = {
    location: { href: 'https://cdn.qj2h5.jiuxiaokj.cn/mu2h5/h5-data/mu-release/index.html' },
    console: safeConsole,
    Date: MockDate,
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout(fn) { return fn(); },
    clearTimeout() {},
    window: {
      fgui: { GRoot: { inst: root } },
      localStorage: storage,
    },
    document: {
      createElement(tagName) {
        return {
          tagName: tagName.toUpperCase(),
          style: {},
          dataset: {},
          textContent: '',
          appendChild() {},
          remove() {},
          addEventListener() {},
        };
      },
      getElementById() {
        return null;
      },
      documentElement,
      head: documentElement,
      body: documentElement,
    },
  };

  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.window.location = sandbox.location;
  sandbox.window.console = sandbox.console;
  sandbox.window.Date = sandbox.Date;
  sandbox.window.setInterval = sandbox.setInterval;
  sandbox.window.clearInterval = sandbox.clearInterval;
  sandbox.window.setTimeout = sandbox.setTimeout;
  sandbox.window.clearTimeout = sandbox.clearTimeout;
  sandbox.window.unsafeWindow = sandbox.window;
  sandbox.unsafeWindow = sandbox.window;
  documentElement.appendChild = (node) => {
    if (node.tagName === 'SCRIPT') {
      vm.runInContext(node.textContent, sandbox, { filename: 'injected-mu-boss-bot.js' });
    }
    return node;
  };

  vm.createContext(sandbox);
  // Task 1 intentionally fails with ENOENT until Task 2 adds mu-boss-bot.user.js.
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), sandbox, { filename: scriptPath });
  return { api: sandbox.window.__muBossBot, storage, sandbox };
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

function run() {
  testPublicApiExists();
  console.log('mu-boss-bot tests passed');
}

run();
