const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scriptPath = path.resolve(__dirname, '..', 'manual-attack-no-autowalk.js');

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const list = listeners.get(type) || [];
      list.push(listener);
      listeners.set(type, list);
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) {
        listener(event);
      }
    },
  };
}

function loadUserscript() {
  const pageEvents = createEventTarget();
  const documentEvents = createEventTarget();

  function Node() {}
  Node.prototype.appendChild = function appendChild(node) {
    this.children.push(node);
    return node;
  };

  let blobSource = '';
  const sandbox = {
    console,
    unsafeWindow: null,
    window: null,
    document: {
      body: { appendChild() {} },
      createElement(tagName) {
        return {
          tagName: tagName.toUpperCase(),
          async: false,
          dataset: {},
          style: {},
        };
      },
      addEventListener: documentEvents.addEventListener,
      getElementById() {
        return null;
      },
    },
  };

  const page = {
    location: {
      hostname: 'cdn.qj2h5.jiuxiaokj.cn',
      pathname: '/mu2h5/h5-data/mu-release/index.html',
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    Node,
    Blob: class Blob {
      constructor(parts) {
        blobSource = parts.join('');
      }
    },
    URL: {
      createObjectURL() {
        return 'blob:patched-bundle';
      },
    },
    fetch: async () => ({
      ok: true,
      text: async () => [
        'before ',
        TARGET_BRANCH,
        ' middle ',
        KEY_DOWN_BRANCH,
        ' middle ',
        KEY_UP_BRANCH,
        ' after',
      ].join(''),
    }),
    setTimeout() {},
    clearTimeout() {},
    addEventListener: pageEvents.addEventListener,
    dispatch: pageEvents.dispatch,
  };
  page.window = page;
  sandbox.unsafeWindow = page;
  sandbox.window = page;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), sandbox, { filename: scriptPath });

  return {
    page,
    getBlobSource() {
      return blobSource;
    },
  };
}

const TARGET_BRANCH = `else{_0x26afb8[_0x569830(0x6390)](_0x1c7cbb['IsNearTarget'],_0x2c3851['FAILED']);let _0x5254f7=_0x3ca950[_0x569830(0x2bd3)];if(_0x5254f7&&_0x5254f7[_0x569830(0x74f0)](_0x16461a)){let _0x181bf9=_0x5254f7[_0x569830(0x1a82)](_0x16461a)[_0x569830(0x218c)],_0x9c7460=Laya['Point'][_0x569830(0x34a8)];(_0x9c7460['x']=Math[_0x569830(0x174a)](-_0x181bf9['x']),_0x9c7460['y']=Math[_0x569830(0x174a)](_0x181bf9['z']),_0x5254f7)&&(_0x3ca950[_0x569830(0x5ce8)]=_0x9c7460['x'],_0x3ca950['lastMoveY']=_0x9c7460['y'],_0x5bb43c[_0x569830(0x12e4)](_0x599def,_0x9c7460,_0x3ca950['range'])||_0x599def[_0x569830(0x1a82)](_0x2006c8)['setTarget'](null));}_0x188fb2['setStatus'](_0x2c3851[_0x569830(0x4497)]);}`;

const KEY_DOWN_BRANCH = `case Laya[_0x37fbd1(0x4f2e)][_0x37fbd1(0x6125)]:_0x39616f['vm'](_0x3f63d8)[_0x37fbd1(0x5491)][_0x37fbd1(0x3007)]();break;`;

const KEY_UP_BRANCH = `case Laya[_0x4cf0d6(0x4f2e)]['D']:case Laya[_0x4cf0d6(0x4f2e)][_0x4cf0d6(0x5fdf)]:this[_0x4cf0d6(0x463e)]['D']=!0x1,this[_0x4cf0d6(0x463e)][_0x4cf0d6(0x583a)]=!0x0;}`;

async function testPatchesSpaceKeyBranches() {
  const { page, getBlobSource } = loadUserscript();
  const parent = new page.Node();
  parent.children = [];
  const script = {
    tagName: 'SCRIPT',
    src: 'https://cdn.qj2h5.jiuxiaokj.cn/mu2h5/h5-data/mu-release/js/bundle-test.js',
    dataset: {},
  };

  page.Node.prototype.appendChild.call(parent, script);
  await new Promise((resolve) => setImmediate(resolve));

  const patched = getBlobSource();
  assert.ok(
    patched.includes('handleSpaceKeyDown'),
    'space keydown branch should call helper',
  );
  assert.ok(
    patched.includes('handleSpaceKeyUp'),
    'space keyup branch should call helper',
  );
}

function testSpaceHelperLifecycle() {
  const { page } = loadUserscript();
  const api = page.__MU_MANUAL_NO_AUTOWALK__;
  let starts = 0;
  let stops = 0;
  const start = () => { starts += 1; };
  const stop = () => { stops += 1; };

  assert.strictEqual(api.handleSpaceKeyDown(false, start, stop), true);
  assert.strictEqual(starts, 1);
  assert.strictEqual(api.handleSpaceKeyDown(false, start, stop), true);
  assert.strictEqual(starts, 1, 'repeated keydown must not toggle attack');

  page.dispatch('keydown', { code: 'ArrowUp', key: 'ArrowUp', target: null });
  assert.strictEqual(stops, 1, 'movement key should pause manual space attack');
  page.dispatch('keyup', { code: 'ArrowUp', key: 'ArrowUp', target: null });
  assert.strictEqual(starts, 2, 'space hold should resume after movement key release');

  assert.strictEqual(api.handleSpaceKeyUp(stop), true);
  assert.strictEqual(stops, 2, 'space keyup should stop manual space attack');
}

function testAutoHuntPassesThrough() {
  const { page } = loadUserscript();
  const api = page.__MU_MANUAL_NO_AUTOWALK__;

  assert.strictEqual(api.handleSpaceKeyDown(true, () => {}, () => {}), false);
  assert.strictEqual(api.handleSpaceKeyUp(() => {}), false);
}

(async () => {
  await testPatchesSpaceKeyBranches();
  testSpaceHelperLifecycle();
  testAutoHuntPassesThrough();
  console.log('mu-space-manual-attack tests passed');
})();
