const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 让沙箱 document.appendChild 能执行 inject 注入的脚本(模拟浏览器 <script> 执行)
function makeInjectableDocument(sandbox) {
  const doc = { documentElement: null, head: null, body: null };
  // documentElement 指向 doc 自身,使 inject 函数能找到 appendChild
  doc.documentElement = doc; doc.head = doc; doc.body = doc;
  doc.createElement = function() { return { textContent: '', remove: () => {} }; };
  doc.appendChild = function(child) {
    if (child && child.textContent) { try { vm.runInContext(child.textContent, sandbox); } catch(_) {} }
    return child;
  };
  doc.removeChild = doc.remove = () => {};
  return doc;
}

function makeStorage() {
  return { _d: {}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };
}

const HOUR = 3600 * 1000;
const now = Date.now();

// --- 测试 1: 聚合逻辑(合成 journal -> 断言聚合数据) ---

function loadStatsScript(sandbox) {
  const scriptPath = path.resolve(__dirname, '..', 'mu-boss-stats.user.js');
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), sandbox, { filename: scriptPath });
}

function makeStatsSandbox(storage) {
  const sandbox = {
    console: { log: () => {}, table: () => {}, error: () => {}, warn: () => {} },
    window: {},
    CustomEvent: function(name, opts) { this.type = name; this.detail = opts && opts.detail; },
    Date: Date,
  };
  sandbox.document = makeInjectableDocument(sandbox);
  sandbox.localStorage = storage || makeStorage();
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.dispatchEvent = () => {};
  sandbox.window.addEventListener = () => {};
  sandbox.window.top = sandbox.window;  // 非 top frame
  sandbox.window.fgui = {};  // 模拟游戏 frame
  vm.createContext(sandbox);
  return sandbox;
}

function seedJournal(sandbox, events) {
  sandbox.localStorage.setItem('__mu_boss_stats_events_v1', JSON.stringify({ v: 1, seq: events.length, events }));
}

const mockEvents = [
  { type: 'attempt', attemptId: 'a0', ts: now - 25 * HOUR, endTs: now - 25 * HOUR + 60000, bossId: 'b1', bossName: '地狱骑士', mapId: 'corrosion', mapName: '腐蚀之地', outcome: 'kill_mine', ownerName: '' },
  { type: 'attempt', attemptId: 'a1', ts: now - 5 * HOUR, endTs: now - 5 * HOUR + 120000, bossId: 'b1', bossName: '地狱骑士', mapId: 'corrosion', mapName: '腐蚀之地', outcome: 'kill_mine', ownerName: '' },
  { type: 'attempt', attemptId: 'a2', ts: now - 3 * HOUR, endTs: now - 3 * HOUR + 90000, bossId: 'b2', bossName: '龙虾战士', mapId: 'trial1', mapName: '试炼之地1', outcome: 'stolen', ownerName: '抢人甲' },
  { type: 'attempt', attemptId: 'a3', ts: now - 2 * HOUR, endTs: now - 2 * HOUR + 80000, bossId: 'b2', bossName: '龙虾战士', mapId: 'trial1', mapName: '试炼之地1', outcome: 'kill_other', ownerName: '抢人乙' },
  { type: 'attempt', attemptId: 'a4', ts: now - 1 * HOUR, endTs: now - 1 * HOUR + 300000, bossId: 'b3', bossName: '魔晶菲尼斯', mapId: 'purgatory2', mapName: '苦难炼狱2', outcome: 'left', ownerName: '' },
  { type: 'attempt_update', attemptId: 'a4', ts: now - 30 * 60 * 1000, outcome: 'stolen', ownerName: '抢人丙' },
  { type: 'skipped_owned', ts: now - 20 * 60 * 1000, bossId: 'b1', bossName: '地狱骑士', mapId: 'corrosion', mapName: '腐蚀之地', ownerName: '抢人丁' },
  { type: 'low_hp', ts: now - 2 * HOUR, endTs: now - 2 * HOUR + 45000, mapName: '腐蚀之地', minHpPercent: 9, names: ['玩家甲', '玩家乙'] },
  { type: 'low_hp', ts: now - 30 * 60 * 1000, endTs: now - 30 * 60 * 1000 + 12000, mapName: '试炼之地2', minHpPercent: 12, names: ['玩家甲', '玩家丙'] },
];

function inWindow6(events) {
  return events.filter(e => Number(e.ts || e.endTs || 0) >= now - 6 * HOUR);
}

function testAggregation() {
  const sandbox = makeStatsSandbox();
  seedJournal(sandbox, mockEvents);
  loadStatsScript(sandbox);
  const stats = sandbox.window.__muBossStats;
  assert(stats, '__muBossStats should exist');

  const w6 = inWindow6(mockEvents);
  const boss6 = stats._testAggregateBoss(w6);

  // 地狱骑士: 1 attempt (kill_mine), skipped 不算 attempt
  const hk = boss6.find(r => r.bossName === '地狱骑士');
  assert(hk, '地狱骑士 should exist in 6h');
  assert.strictEqual(hk.attempts, 1, '地狱骑士 attempts');
  assert.strictEqual(hk.killMine, 1, '地狱骑士 killMine');

  // 龙虾战士: 2 attempts (stolen + kill_other)
  const lobster = boss6.find(r => r.bossName === '龙虾战士');
  assert(lobster, '龙虾战士 should exist');
  assert.strictEqual(lobster.attempts, 2, '龙虾战士 attempts');
  assert.strictEqual(lobster.stolen, 1, '龙虾战士 stolen');
  assert.strictEqual(lobster.killOther, 1, '龙虾战士 killOther');

  // 魔晶菲尼斯: 1 attempt, 先 left 后修正为 stolen
  const crystal = boss6.find(r => r.bossName === '魔晶菲尼斯');
  assert(crystal, '魔晶菲尼斯 should exist');
  assert.strictEqual(crystal.attempts, 1, '魔晶 attempts');
  assert.strictEqual(crystal.stolen, 1, '魔晶 should be stolen after update');
  assert.strictEqual(crystal.left, 0, '魔晶 left should be 0 after update');

  // 被抢榜: 抢人甲 1, 抢人丙 1 (attempt_update); 抢人乙不算(kill_other 非 stolen)
  const stolen6 = stats._testAggregateStolen(w6);
  const jia = stolen6.find(s => s.player === '抢人甲');
  assert(jia && jia.count === 1, '抢人甲 count 1');
  const bing = stolen6.find(s => s.player === '抢人丙');
  assert(bing && bing.count === 1, '抢人丙 count 1 (from attempt_update)');
  const yi = stolen6.find(s => s.player === '抢人乙');
  assert(!yi, '抢人乙 should not appear (kill_other not stolen)');

  // 跳过统计: 地狱骑士 1
  const skipped6 = stats._testAggregateSkipped(w6);
  assert.strictEqual(skipped6.length, 1, 'one skipped row');
  assert.strictEqual(skipped6[0].bossName, '地狱骑士', 'skipped boss');
  assert.strictEqual(skipped6[0].count, 1, 'skipped count 1');

  // 低血嫌疑榜: 玩家甲 2 次, 玩家乙/丙各 1 次
  const lowSuspects = stats._testAggregateLowHpSuspects(w6);
  const lowJia = lowSuspects.find(s => s.player === '玩家甲');
  assert(lowJia && lowJia.count === 2, '玩家甲 should appear twice');
  assert(lowSuspects.find(s => s.player === '玩家乙' && s.count === 1), '玩家乙 once');
  assert(lowSuspects.find(s => s.player === '玩家丙' && s.count === 1), '玩家丙 once');
  assert.strictEqual(lowSuspects[0].player, '玩家甲', 'highest count first');

  // 低血记录按时间倒序
  const lowRecords = stats._testAggregateLowHpRecords(w6);
  assert.strictEqual(lowRecords.length, 2, 'two low_hp records');
  assert.strictEqual(lowRecords[0].minHpPercent, 12, 'newest record first');
  assert.strictEqual(lowRecords[0].mapName, '试炼之地2', 'newest record keeps mapName');
  assert(lowRecords[1].players.includes('玩家乙'), 'older record keeps players');

  // 24h 窗口包含 a0(kill_mine 25h 前应被排除)
  const boss24 = stats._testAggregateBoss(mockEvents.filter(e => Number(e.ts || e.endTs || 0) >= now - 24 * HOUR));
  const hk24 = boss24.find(r => r.bossName === '地狱骑士');
  assert.strictEqual(hk24.attempts, 1, '24h should exclude 25h-old event');

  console.log('  testAggregation: PASS');
}

// --- 测试 2: emitter 加载不崩溃 + status().stats 存在 ---

function makeMainSandbox(storage) {
  const sandbox = {
    console: { log: () => {}, table: () => {}, error: () => {}, warn: () => {} },
    window: {},
    CustomEvent: function(name, opts) { this.type = name; this.detail = opts && opts.detail; },
    Date: Date,
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    addEventListener: () => {},
  };
  sandbox.document = makeInjectableDocument(sandbox);
  sandbox.localStorage = storage || makeStorage();
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.dispatchEvent = () => {};
  sandbox.window.addEventListener = () => {};
  sandbox.window.top = sandbox.window;
  sandbox.window.fgui = { GRoot: { inst: {} } };
  sandbox.window.location = { href: 'https://cdn.qj2h5.jiuxiaokj.cn/mu2h5/h5-data/mu-release/index.html', hostname: 'cdn.qj2h5.jiuxiaokj.cn', pathname: '/mu2h5/h5-data/mu-release/index.html' };
  sandbox.location = sandbox.window.location;
  vm.createContext(sandbox);
  return sandbox;
}

function loadMainScript(sandbox) {
  const scriptPath = path.resolve(__dirname, '..', 'mu-boss-multi-map-mvp.user.js');
  vm.runInContext(fs.readFileSync(scriptPath, 'utf8'), sandbox, { filename: scriptPath });
}

function testEmitterBasic() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  const api = sandbox.window.__muMultiMapBossMvp;
  assert(api, '__muMultiMapBossMvp should exist');

  const st = api.status();
  assert(st.stats, 'status().stats should exist');
  assert.strictEqual(st.stats.disabled, false, 'emitter not disabled');
  assert.strictEqual(st.stats.emitted, 0, 'no events yet');
  assert.strictEqual(typeof st.stats.sessionId, 'string', 'sessionId is string');
  assert.strictEqual(st.stats.activeAttempt, null, 'no active attempt initially');

  console.log('  testEmitterBasic: PASS');
}

function testEmitterJournalAccess() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  // 脚本加载后访问 journal 不应崩溃
  const st = sandbox.window.__muMultiMapBossMvp.status();
  assert.strictEqual(st.stats.journalSize, 0, 'journal empty initially');

  console.log('  testEmitterJournalAccess: PASS');
}

function testLowHpRecorder() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  const api = sandbox.window.__muMultiMapBossMvp;

  api.statsTest.onPlayerHp(
    { percent: 14, name: '普尔赫达' },
    ['普尔赫达', '抢人甲'],
    '腐蚀之地'
  );
  api.statsTest.onPlayerHp(
    { percent: 0, name: '普尔赫达' },
    ['抢人乙'],
    '腐蚀之地'
  );
  assert(api.status().stats.lowHp, 'lowHp episode should be active');
  assert.strictEqual(api.status().stats.lowHp.minHpPercent, 0, 'death hp 0 should be tracked');
  assert.strictEqual(api.status().stats.lowHp.mapName, '腐蚀之地', 'mapName tracked while low');

  // 死亡期间血条可能短暂消失, 不能因此拆成多个事件。
  for (let i = 0; i < 5; i += 1) {
    api.statsTest.onPlayerHp({ percent: null, name: '普尔赫达' }, []);
  }
  assert(api.status().stats.lowHp, 'missing HP should keep the same death episode open');

  api.statsTest.onPlayerHp({ percent: 90, name: '普尔赫达' }, []);
  const events = readJournal(sandbox);
  const ev = events.find((e) => e.type === 'low_hp');
  assert(ev, 'low_hp event should be emitted on recovery');
  assert.strictEqual(events.filter((e) => e.type === 'low_hp').length, 1, 'one death episode should produce one event');
  assert.strictEqual(ev.minHpPercent, 0, 'low_hp minHpPercent');
  assert.strictEqual(ev.mapName, '腐蚀之地', 'low_hp mapName');
  assert(ev.names.includes('抢人甲'), 'names collected while low');
  assert(ev.names.includes('抢人乙'), 'names collected while low');
  assert(!ev.names.includes('普尔赫达'), 'self excluded');
  assert(!api.status().stats.lowHp, 'episode closed after recovery');

  console.log('  testLowHpRecorder: PASS');
}

function testVisiblePlayerFilter() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  const api = sandbox.window.__muMultiMapBossMvp;
  const layer = {
    visible: true,
    _parent: null,
    _children: [
      { text: '普尔赫达', visible: true, x: 100, y: 200 },
      { text: '玩家乙', visible: true, x: 500, y: 200 },
      { text: '侦察兵', visible: true, x: 900, y: 200 },
    ],
  };
  // 投影后名字标签固定在实体上方 100px: y=200, 实体投影 y=300。
  const actorCtor = { createPlayer() {} };
  const camera = {
    _orthographic: false,
    _viewport: { width: 1268, height: 750 },
    projections: { 0: { x: 100, y: 300 }, 1: { x: 500, y: 300 } },
    worldToViewportPoint() {},
    _projectionMatrix: {},
    _viewMatrix: {},
    project(pos, out) {
      const p = this.projections[pos.x];
      out.x = p.x;
      out.y = p.y;
    },
    _children: [],
  };
  camera._viewport.project = (pos, pv, out) => {
    const p = pos.x === 0 ? { x: 100, y: 300 } : { x: 500, y: 300 };
    out.x = p.x;
    out.y = p.y;
  };
  const actors = [
    { entity: {}, constructor: actorCtor, _transform: { position: { x: 0, y: 0, z: 0 } }, _children: [] },
    { entity: {}, constructor: actorCtor, _transform: { position: { x: 1, y: 0, z: 0 } }, _children: [] },
  ];
  function Matrix4x4() {}
  Matrix4x4.multiply = () => {};
  sandbox.Laya = {
    Matrix4x4,
    stage: { clientScaleX: 1, clientScaleY: 1, _children: [{ nameLayer: layer, _children: [] }, camera].concat(actors) },
  };

  const names = api.getVisiblePlayerNames();
  assert(Array.isArray(names), 'visible player names should be array');
  assert(names.includes('玩家乙'), 'player without guild should be detected by 3D actor projection');
  assert(!names.includes('普尔赫达'), 'own player excluded');
  assert(!names.includes('侦察兵'), 'monster without guild should be excluded');

  console.log('  testVisiblePlayerFilter: PASS');
}

function readJournal(sandbox) {
  const raw = sandbox.localStorage.getItem('__mu_boss_stats_events_v1');
  return raw ? JSON.parse(raw).events : [];
}

function testLateArrivalContestedIsSkipped() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  const api = sandbox.window.__muMultiMapBossMvp;
  const target = { id: 'hell-knight-1', name: '地狱骑士', moduleId: 'corrosion', mapName: '腐蚀之地' };

  api.statsTest.onTick(
    { at: Date.now(), combat: { targetName: '地狱骑士', hpPercent: 50, ownerName: '' } },
    { type: 'engage', targetId: 'hell-knight-1' }
  );
  api.statsTest.onContested(target, '抢人甲');

  const events = readJournal(sandbox);
  assert(events.some((e) => e.type === 'skipped_owned' && e.ownerName === '抢人甲'),
    'late arrival contested should emit skipped_owned');
  assert(!events.some((e) => e.type === 'attempt'),
    'late arrival contested should not emit an attempt event');

  console.log('  testLateArrivalContestedIsSkipped: PASS');
}

function testFromStartContestedIsStolen() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  const api = sandbox.window.__muMultiMapBossMvp;
  const target = { id: 'hell-knight-1', name: '地狱骑士', moduleId: 'corrosion', mapName: '腐蚀之地' };

  api.statsTest.onTick(
    { at: Date.now(), combat: { targetName: '地狱骑士', hpPercent: 100, ownerName: '' } },
    { type: 'engage', targetId: 'hell-knight-1' }
  );
  api.statsTest.onContested(target, '抢人乙');

  const events = readJournal(sandbox);
  assert(events.some((e) => e.type === 'attempt' && e.outcome === 'stolen' && e.ownerName === '抢人乙'),
    'from-start contested should emit stolen attempt');

  console.log('  testFromStartContestedIsStolen: PASS');
}

function testLateArrivalSelfKillIsKillMine() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  const api = sandbox.window.__muMultiMapBossMvp;
  const now = Date.now();

  api.statsTest.onTick(
    { at: now, combat: { targetName: '地狱骑士', hpPercent: 50, ownerName: '' } },
    { type: 'engage', targetId: 'hell-knight-1' }
  );
  for (let i = 1; i <= 3; i++) {
    api.statsTest.onTick(
      { at: now + i * 1000, combat: { targetName: '地狱骑士', hpPercent: 0, ownerName: '' } },
      { type: 'engage', targetId: 'hell-knight-1' }
    );
  }

  const events = readJournal(sandbox);
  assert(events.some((e) => e.type === 'attempt' && e.outcome === 'kill_mine'),
    'late arrival self kill should emit kill_mine attempt');
  assert(!events.some((e) => e.type === 'skipped_owned'),
    'late arrival self kill should not emit skipped_owned');

  console.log('  testLateArrivalSelfKillIsKillMine: PASS');
}

function testNoAttemptContestedIsSkipped() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  const api = sandbox.window.__muMultiMapBossMvp;
  const target = { id: 'hell-knight-1', name: '地狱骑士', moduleId: 'corrosion', mapName: '腐蚀之地' };

  api.statsTest.onContested(target, '抢人丙');

  const events = readJournal(sandbox);
  assert(events.some((e) => e.type === 'skipped_owned' && e.ownerName === '抢人丙'),
    'no-attempt contested should emit skipped_owned');
  assert(!events.some((e) => e.type === 'attempt'),
    'no-attempt contested should not synthesize an attempt event');

  console.log('  testNoAttemptContestedIsSkipped: PASS');
}

function testRecentFromStartContestedBecomesStolen() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  const api = sandbox.window.__muMultiMapBossMvp;
  const target = { id: 'hell-knight-1', name: '地狱骑士', moduleId: 'corrosion', mapName: '腐蚀之地' };
  const now = Date.now();

  api.statsTest.onTick(
    { at: now, combat: { targetName: '地狱骑士', hpPercent: 100, ownerName: '' } },
    { type: 'engage', targetId: 'hell-knight-1' }
  );
  api.statsTest.onTick(
    { at: now + 1000, combat: { targetName: '愤怒地狱骑士', hpPercent: 100, ownerName: '' } },
    { type: 'engage', targetId: 'furious-hell-knight-1' }
  );
  api.statsTest.onContested(target, '抢人丁');

  const events = readJournal(sandbox);
  assert(events.some((e) => e.type === 'attempt_update' && e.outcome === 'stolen' && e.ownerName === '抢人丁'),
    'from-start recent closed attempt should be corrected to stolen');

  console.log('  testRecentFromStartContestedBecomesStolen: PASS');
}

// P1.1: getThiefNames 必须同时统计 attempt 与 attempt_update 类型的 stolen,
// 并按 attemptId 去重 (同一次 attempt 被抢只算一次)。
function testThiefNamesDedupAttemptUpdate() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  const api = sandbox.window.__muMultiMapBossMvp;

  // 构造: 抢人甲 1 次 attempt.stolen + 1 次 attempt_update.stolen (同 attemptId) → 计 1 次
  //       抢人乙 2 次 attempt.stolen (不同 attemptId) → 计 2 次, 阈值=2 进名单
  //       抢人丙 1 次 attempt_update.stolen → 计 1 次, 阈值=2 不进名单
  const ts = Date.now();
  const events = [
    { type: 'attempt', attemptId: 's1', ts: ts - 3 * HOUR, endTs: ts - 3 * HOUR + 60000, bossId: 'b1', bossName: 'A', mapId: 'm', mapName: 'M', outcome: 'stolen', ownerName: '抢人甲' },
    { type: 'attempt_update', attemptId: 's1', ts: ts - 2 * HOUR, outcome: 'stolen', ownerName: '抢人甲' },
    { type: 'attempt', attemptId: 's2', ts: ts - 2 * HOUR, endTs: ts - 2 * HOUR + 60000, bossId: 'b2', bossName: 'B', mapId: 'm', mapName: 'M', outcome: 'stolen', ownerName: '抢人乙' },
    { type: 'attempt', attemptId: 's3', ts: ts - 1 * HOUR, endTs: ts - 1 * HOUR + 60000, bossId: 'b3', bossName: 'C', mapId: 'm', mapName: 'M', outcome: 'stolen', ownerName: '抢人乙' },
    { type: 'attempt_update', attemptId: 's4', ts: ts - 30 * 60 * 1000, outcome: 'stolen', ownerName: '抢人丙' },
  ];
  // getThiefNames 直接读 window.__muBossStats, 需要在 sandbox 中预置 __muBossStats
  sandbox.window.__muBossStats = {
    rawEvents: () => events,
  };

  // 通过 setConfig 把阈值设为 2
  api.setConfig({
    thiefSkipEnabled: true,
    thiefStolenCount: 2,
    thiefWindowHours: 24,
  });

  const names = api.getThiefNames();
  assert(names.includes('抢人乙'), '抢人乙 (2 distinct stolen) should be in thief list');
  assert(!names.includes('抢人甲'), '抢人甲 (1 attempt, deduped with attempt_update) should NOT be in thief list at threshold 2');
  assert(!names.includes('抢人丙'), '抢人丙 (1 attempt_update) should NOT be in thief list at threshold 2');

  console.log('  testThiefNamesDedupAttemptUpdate: PASS');
}

// P2.3: 切目标同 tick HUD 仍显示旧 BOSS 血量时, 新 attempt 的 startHpPercent 必须为 null,
// 不能把旧 BOSS 的 HP 写入新 attempt (否则后续 onContested 会误判为中间介入)。
function testStartHpPercentValidatesTargetIdentity() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  const api = sandbox.window.__muMultiMapBossMvp;
  const now = Date.now();

  // 先 engage 旧 BOSS, HUD 显示其 HP=50%
  api.statsTest.onTick(
    { at: now, combat: { targetName: '地狱骑士', hpPercent: 50, ownerName: '' } },
    { type: 'engage', targetId: 'hell-knight-1' }
  );
  // 切到新 BOSS, 但 HUD 仍显示旧 BOSS 50% (combat.targetName 还是 '地狱骑士')
  api.statsTest.onTick(
    { at: now + 1000, combat: { targetName: '地狱骑士', hpPercent: 50, ownerName: '' } },
    { type: 'engage', targetId: 'furious-hell-knight-1' }
  );

  const st = api.status();
  assert(st.stats.activeAttempt, 'should have active attempt on new target');
  assert.strictEqual(st.stats.activeAttempt.bossId, 'furious-hell-knight-1',
    'active attempt should be on new target');
  // startHpPercent 必须是 null, 不能是 50 (那是旧 BOSS 的血量)
  assert.strictEqual(st.stats.activeAttempt.startHpPercent, null,
    'startHpPercent should be null when HUD shows different target');

  console.log('  testStartHpPercentValidatesTargetIdentity: PASS');
}

// P2.4: applyThiefDetection 触发 skip 后必须主动关闭当前 stats attempt,
// 否则旧 attempt 挂起 3 tick 后会被误判为 kill_mine/kill_other。
// 这里直接测试 statsEmitter.closeActive('left') 是否正确关闭 attempt。
function testThiefSkipClosesStatsAttempt() {
  const sandbox = makeMainSandbox();
  loadMainScript(sandbox);
  const api = sandbox.window.__muMultiMapBossMvp;
  const now = Date.now();

  // engage 一个 BOSS, 从满血开始
  api.statsTest.onTick(
    { at: now, combat: { targetName: '地狱骑士', hpPercent: 100, ownerName: '' } },
    { type: 'engage', targetId: 'hell-knight-1' }
  );
  assert(api.status().stats.activeAttempt, 'attempt should be active after engage');

  // 模拟 thief-skip 触发: closeActive('left')
  api.statsTest.closeActive('left');

  const events = readJournal(sandbox);
  // 从满血开始 + outcome=left → 不是 lateArrival, 应该 emit attempt 事件
  assert(events.some((e) => e.type === 'attempt' && e.outcome === 'left'),
    'closeActive(left) should emit attempt event with outcome=left');
  assert(!api.status().stats.activeAttempt, 'no active attempt after closeActive');

  console.log('  testThiefSkipClosesStatsAttempt: PASS');
}

// 运行
console.log('mu-boss-stats tests:');
testAggregation();
testEmitterBasic();
testEmitterJournalAccess();
testLowHpRecorder();
testVisiblePlayerFilter();
testLateArrivalContestedIsSkipped();
testFromStartContestedIsStolen();
testLateArrivalSelfKillIsKillMine();
testNoAttemptContestedIsSkipped();
testRecentFromStartContestedBecomesStolen();
testThiefNamesDedupAttemptUpdate();
testStartHpPercentValidatesTargetIdentity();
testThiefSkipClosesStatsAttempt();
console.log('All tests passed.');
