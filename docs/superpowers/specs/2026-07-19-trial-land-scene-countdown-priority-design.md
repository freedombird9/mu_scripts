# 试炼之地 BOSS 倒计时优先以画面红色飘字为准

## 目标

修复 `mu-boss-respawn-overlay.user.js` 在试炼之地只通过任务栏(left panel + 顶部 taskbar 条目)获取 BOSS 刷新倒计时,导致任务栏显示「待击杀」时与画面红色飘字实际刷新倒时不一致的问题。

**核心需求**:

- 当画面中能看到红色 `mm:ss` 飘字时,刷新时间**总是**以飘字为准,覆盖任务栏记录(无视时间差)。
- 当画面中看不到飘字(没扫到 / 玩家未在 BOSS 附近 / 大地图未开)时,继续使用任务栏的刷新时间。
- 行为与其他地图保持一致:`scanSceneCountdowns` 在试炼之地也参与扫描,沿用 `recordFromCandidate` 已有的归因链路(`context.bossName` + `context.mapBossMarkers` + `findUniqueRecordByRefresh`)。

## 背景与根因

当前 `scanNow()` 在试炼之地走短路(mu-boss-respawn-overlay.user.js:218-224):

```js
const trialTaskbarOnly = isTrialLandMap(context.mapName);
const taskbarCandidates = scanTrialTaskbarCountdowns(context);
if (trialTaskbarOnly) removeTrialNonTaskbarRecords();
const candidates = annotateCountdownObservations(
  trialTaskbarOnly ? taskbarCandidates : scanSceneCountdowns().concat(taskbarCandidates),
);
```

`trialTaskbarOnly === true` 时完全不跑 `scanSceneCountdowns()`,即使画面里有红色飘字也不会被识别。`removeTrialNonTaskbarRecords()` 还会主动清掉试炼之地的非 taskbar 记录,等于双重排斥了飘字路径。

实际游戏现象:任务栏可能因延迟持续显示「待击杀」,但 BOSS 实际已死亡、画面已有红色飘字倒计时。两者不一致时无法以飘字为准。

## 设计

### 1. 解除试炼之地的 `trialTaskbarOnly` 短路

`scanNow()` 改为:

```js
const taskbarCandidates = scanTrialTaskbarCountdowns(context);
const candidates = annotateCountdownObservations(
  scanSceneCountdowns().concat(taskbarCandidates),
);
```

- 删除 `trialTaskbarOnly` 局部变量。
- 删除 `if (trialTaskbarOnly) removeTrialNonTaskbarRecords();` 调用。
- `removeTrialNonTaskbarRecords` 函数本体保留不调用(减少改动面),亦可一并删除。

### 2. 飘字 candidate 完整性门槛

在 `recordFromCandidate` 末尾(`return record` 之前)新增:

```js
if (isTrialLandMap(mapName)
    && cleanText(candidate.source) === 'laya_scene_countdown'
    && (!detectedBossName || !normalizeBossCoordinate(record.bossCoordinate))) {
  return null;
}
```

- 试炼之地的飘字 candidate 必须同时归因到 `bossName` 和 `bossCoordinate` 才接受。
- 任一缺失即丢弃该 candidate,任务栏记录照常存在(fallback)。
- 非试炼地图不受此门槛影响(沿用原行为)。

### 3. `canMergeRecords` 新增试炼飘字 vs 任务栏合并分支

在 `canMergeRecords` 中、`sameCountdownSource` 检查之前加入:

```js
if (isTrialLandMap(cleanText(left && left.mapName))
    && isTrialLandMap(cleanText(right && right.mapName))) {
  const leftIsScene = cleanText(left && left.source) === 'laya_scene_countdown';
  const rightIsScene = cleanText(right && right.source) === 'laya_scene_countdown';
  if (leftIsScene !== rightIsScene) {
    const lc = normalizeBossCoordinate(left && left.bossCoordinate);
    const rc = normalizeBossCoordinate(right && right.bossCoordinate);
    if (lc && rc && lc !== rc) return false; // 不同坐标 = 不同 BOSS
    if (recordNamesMergeable(left, right)) return true;
    if (lc && rc && lc === rc) return true;
    return false;
  }
}
```

- 仅当左右均为试炼之地、且一个飘字一个任务栏时进入此分支。
- 同 BOSS 名(经过 `recordNamesMergeable`)或同坐标即视为同一记录。
- 不同坐标直接拒绝合并(真实双 BOSS 保护)。
- 不要求 `withinRefreshWindow`,因为任务栏延迟可能远超 15 秒窗口。

### 4. `preferredRecordOnMerge` 飘字优先

```js
function preferredRecordOnMerge(previous, next) {
  if (sameTrialTaskbarBossRecord(previous, next)) {
    return Number(next.observedAt) >= Number(previous.observedAt) ? next : previous;
  }
  if (isTrialLandMap(cleanText(previous && previous.mapName))
      && isTrialLandMap(cleanText(next && next.mapName))) {
    const prevScene = cleanText(previous && previous.source) === 'laya_scene_countdown';
    const nextScene = cleanText(next && next.source) === 'laya_scene_countdown';
    if (nextScene && !prevScene) return next;
    if (prevScene && !nextScene) return previous;
  }
  return next;
}
```

### 5. 合并字段跟随 `preferred`

`upsertRecord` 与 `pruneRecords` 内部的合并赋值需要让 `bossName`/`bossNameSource`/`detectedBossName`/`mapName`/`bossCoordinate`/`monsterId` 等**优先跟随 `preferred`** 而不是被 `chooseMergedBossName` 等独立选优:

```js
state.records[existingIndex] = {
  ...prev,
  ...next,
  id: preferred.id || prev.id || next.id,
  bossName: preferred.bossName || chooseMergedBossName(prev, next),
  bossNameSource: preferred.bossNameSource || chooseMergedBossNameSource(prev, next),
  detectedBossName: preferred.detectedBossName || chooseBetterText(prev.detectedBossName, next.detectedBossName, ''),
  nameChoiceConfirmed: Boolean(prev.nameChoiceConfirmed) || Boolean(next.nameChoiceConfirmed),
  nameChoice: prev.nameChoiceConfirmed ? prev.nameChoice : next.nameChoice,
  mapName: preferred.mapName || chooseBetterText(prev.mapName, next.mapName, '未知地图'),
  mapSource: next.mapName ? next.mapSource : prev.mapSource,
  bossCoordinate: preferred.bossCoordinate || chooseBetterCoordinate(prev.bossCoordinate, next.bossCoordinate),
  monsterId: preferred.monsterId || chooseBetterMonsterId(prev.monsterId, next.monsterId),
  // ...rest unchanged...
};
```

- 当 `preferred` 是飘字版本时,所有字段用飘字的。
- 当 `preferred` 是任务栏版本(画面没飘字)时,所有字段用任务栏的。
- `upsertRecord` 和 `pruneRecords` 两处合并代码同步修改。

## 边界情况

- **任务栏「待击杀」状态**:`parseTaskbarCountdownSeconds` 在 `isTrialTaskbarLiveBossStatus` 命中时返回 `null`,本来就不生成 candidate,无需额外处理。
- **退出试炼之地**:不调用 `removeTrialNonTaskbarRecords`,记录保留至 `EXPIRED_KEEP_MS`(刷新后 30 秒),与其他地图行为一致。
- **localStorage 旧数据**:无需迁移。新代码运行后,旧任务栏记录在下次扫描中通过 `upsertRecord` 与新飘字/任务栏 candidate 合并,自然被覆盖或保留。
- **飘字误识别**:`scanSceneCountdowns` 已有 `color === '#ff0000' / '#dd201a'` + 排除 `textTimeCount|mainTipUIPanel|小怪|保护|btnAddTime` 过滤;再加上 `recordFromCandidate` 的完整性门槛(bossName + 坐标),误识别的飘字归因失败会被丢弃。
- **画面里只显示一个 BOSS / 一个飘字**(已确认):`scanSceneCountdowns().slice(0, 1)` 不会丢失飘字。

## 失败模式与降级

- `scanSceneCountdowns` 找不到飘字 → 返回空数组,任务栏 candidate 照常 upsert。✅
- 飘字归因失败(bossName 或坐标缺失)→ candidate 在 `recordFromCandidate` 被丢弃,任务栏记录保留。✅
- `context.mapBossMarkers` 大地图未开读不到 → 飘字归因依赖 `context.bossName`(combat target),若两者都为空 → 飘字 candidate 被完整性门槛丢弃 → 任务栏 fallback。✅

## 验证

- `node --check mu-boss-respawn-overlay.user.js`。
- `git diff --check`。

通过 Chrome CDP 9222 在试炼之地验证:

| 场景 | 预期 |
|---|---|
| BOSS A 死了,画面飘字 `01:30`,任务栏也显示 A 倒计时 `01:30` | 浮层 A 剩余 90 秒,无重复 |
| BOSS A 死了,画面飘字 `01:30`,任务栏显示 A 「待击杀」 | 浮层 A 剩余 90 秒(飘字) |
| BOSS A 死了,画面飘字 `01:30`,任务栏显示 A 倒计时 `02:00`(延迟) | 浮层 A 剩余 90 秒(飘字覆盖任务栏) |
| 玩家走过已死 BOSS A(飘字已过),画面无飘字,任务栏显示 A `05:00` | 浮层 A 剩余 300 秒(任务栏 fallback) |
| 飘字归因失败(没在打 BOSS、大地图未开) | 不生成飘字 record,任务栏照常 |
| A、B 都在倒计时,画面只看到 A,飘字显示 A | 浮层显示 A(飘字) + B(任务栏) |

回归测试:四风平原、幻术秘境等非试炼地图行为应不变,对比改前改后浮层记录一致。

CDP 验证命令:

```bash
node cdp_eval.js auto "JSON.stringify(window.__muBossRespawnOverlay.status().lastDetected, null, 2)"
node cdp_eval.js auto "JSON.stringify(window.__muBossRespawnOverlay.getRecords(), null, 2)"
```

## 版本号

`@version 0.2.2` → `0.3.0`(行为变更,次版本号上升)。
