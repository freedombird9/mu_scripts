# 首饰BOSS副本（幻术秘境4）接入设计

**文件**: `mu-boss-multi-map-mvp.user.js`
**版本**: 0.1.0 → 0.2.0
**日期**: 2026-07-17
**状态**: 已通过 brainstorming，待写实现计划

---

## 1. 背景

`mu-boss-multi-map-mvp.user.js` 当前支持 3 个模块：`four_winds`（野外）、`trial_land`（试炼之地1 副本）、`purgatory`（苦难炼狱2 副本）。每个 instance 模块走相同的 `executeEnterInstance` 状态机：打开挑战 BOSS 面板 → 选 tab → 选 BOSS 行 → 点进入按钮 → 等待传送到达副本地图。

现需接入第 4 个模块 **accessory（首饰BOSS）**，地图为 **幻术秘境4**，BOSS 为 **幽灵巨人**。该模块的进入流程比 purgatory 多一步：点进入按钮后角色先被传送到中间地图并弹出"卓越之境"弹窗，需点击弹窗内"进入"按钮才会传送到幻术秘境4。到达副本后所有行为（打 BOSS、守点、爆率检查、退出）与 purgatory 完全一致。

## 2. 目标

- 新增 `accessory` 模块定义，优先级 40（高于 purgatory 的 30，成为最高优先级）
- `executeEnterInstance` 状态机支持"中间地图 + 弹窗确认"额外步骤，仅对 `hasIntermediatePopup:true` 的模块生效，不污染现有 purgatory/trial_land 流程
- 纳入爆率检查（与 purgatory 一致）
- 默认启用，用户开脚本即可使用
- CDP 探查后回填占位字段（BOSS 坐标、弹窗节点匹配等）

## 3. 非目标

- 不改 `mu-boss-respawn-overlay` 脚本（overlay 记录对 `coordinate:'TBD'` 宽容，自动兼容）
- 不改 bundle patch 脚本
- 不重构现有 `executeEnterInstance` 状态机结构（只在 `click_enter → waiting` 之间条件性插入新阶段）
- 不引入通用 `enterSteps` 抽象（YAGNI，当前只有 1 个特例）

## 4. 模块配置

### 4.1 新增 `accessoryModule`

```js
const accessoryModule = Object.freeze({
  id: 'accessory',
  mapName: '幻术秘境4',
  type: 'instance',
  priority: 40,
  enabled: true,
  farmTarget: null,
  bossRowTab: '首饰BOSS',
  bossRowScroll: 'wildlevelScroll',          // TODO CDP 验证
  enterButtonTog: 'wildtog_mapName',
  enterButtonTextRegex: /^幻术秘境4/,
  hasTaskbar: false,
  hasIntermediatePopup: true,
  intermediatePopupTitle: '卓越之境',         // TODO CDP 验证弹窗标题
  intermediatePopupButtonText: '进入',       // TODO CDP 验证按钮文字
  bosses: [
    { id: 'phantom-giant', name: '幽灵巨人', coordinate: 'TBD' },  // TODO CDP 探查坐标
  ],
});
```

`MAP_MODULES` 追加 `accessoryModule`：
```js
const MAP_MODULES = [fourWindsModule, trialLandModule, purgatoryModule, accessoryModule];
```

### 4.2 CONFIG_DEFAULTS 修改

```js
enabledMaps: ['four_winds', 'trial_land', 'purgatory', 'accessory'],
mapPriorities: { four_winds: 10, trial_land: 20, purgatory: 30, accessory: 40 },
enabledBosses: [
  'ao-left','ao-right','angry-ao','rage-ao',
  'lobster-1','lobster-2','lobster-3',
  'magic-crystal','phantom-giant'
],
```

`normalizeMapPriorities` 自动覆盖 accessory（已有循环逻辑按 `MAP_MODULES` 生成，无需改动）。

### 4.3 爆率检查

新增常量：
```js
const ACCESSORY_RATE_CHECK_ENABLED = true;
```

`rebuildRateCheckMaps` 追加分支：
```js
if (module.id === 'accessory' && !ACCESSORY_RATE_CHECK_ENABLED) continue;
RATE_CHECK_MAPS[module.mapName] = {
  tab: module.bossRowTab,                              // '首饰BOSS'
  bossNames: module.bosses.map((b) => b.name),         // ['幽灵巨人']
  mapMatch: module.mapName.replace(/\d+$/, ''),        // '幻术秘境'
  moduleId: module.id,
};
```

`executeCheckRate` 状态机无需改动，已通过 `RATE_CHECK_MAPS` 数据驱动。

### 4.4 KNOWN_MAP_NAMES

```js
const KNOWN_MAP_NAMES = ['四风平原', '试炼之地1', '苦难炼狱2', '勇者大陆', '幻术秘境4'];
```

## 5. 状态机改动

### 5.1 新增 2 个阶段

仅在 `currentModule.hasIntermediatePopup === true` 时生效，插入到现有 `click_enter` 与 `waiting` 之间：

```
click_enter
  ↓ 点击"幻术秘境4"进入按钮
  ↓ hasIntermediatePopup ? waiting_for_intermediate : waiting
waiting_for_intermediate  (新增)
  ↓ 检测 scene.mapName 非空(已到中间地图) + 弹窗出现 → click_popup_enter
  ↓ 10s 超时未出现:首次回退 click_enter 重点 enter 按钮;二次报错
click_popup_enter  (新增)
  ↓ 点击弹窗内"进入"按钮 → waiting
waiting  (沿用现有阶段,不改)
  ↓ 沿用现有逻辑:scene.mapName === module.mapName('幻术秘境4') → arrived_instance
```

### 5.2 `click_enter` 末尾分支

```js
// 现有
ctx.phase = 'waiting';
// 改为
ctx.phase = currentModule.hasIntermediatePopup ? 'waiting_for_intermediate' : 'waiting';
```

### 5.3 `waiting_for_intermediate` 实现

判定条件：
- 中间地图出现：`const sceneMap = (snapshot.scene || {}).mapName || ''; Boolean(sceneMap)`（只看非空，不强制 ≠ 目标地图）
- 弹窗出现：CDP 探查后填精确匹配条件；探查前用宽松兜底——在 `gRoot` 子树找含 `intermediatePopupTitle` 文本的 AlertWnd 或类似弹窗节点
- 超时基准：`ctx.lastActionAt` 在进入 `waiting_for_intermediate` 时被设为当前时刻（见 5.2 末尾），用 `now - ctx.lastActionAt > 10_000` 判定

伪代码：
```js
case 'waiting_for_intermediate': {
  const sceneMap = (snapshot.scene || {}).mapName || '';
  if (!sceneMap) return { ok: true, reason: 'waiting_for_teleport' };
  const gRoot = root();
  const allNodes = gRoot ? collectNodes(gRoot) : [];
  const popup = findIntermediatePopup(allNodes, currentModule);  // CDP 探查前宽松匹配
  if (!popup) {
    if (now - ctx.lastActionAt > 10 * 1000) {  // lastActionAt = 进入本阶段时刻
      if (!ctx.retried) {
        ctx.retried = true;
        ctx.phase = 'click_enter';
        ctx.lastActionAt = 0;  // 让下一 tick 节流通过后重新点 enter
        appendLog('intermediate_popup_timeout_retry', {});
        return { ok: true, reason: 'retry_click_enter' };
      }
      appendLog('intermediate_popup_failed', {});
      closePanelIfExists('Instance_BossUI');
      state.enterInstanceCtx = null;
      releaseLockedTarget();
      return { ok: false, reason: 'intermediate_popup_timeout' };
    }
    return { ok: true, reason: 'waiting_for_popup' };
  }
  ctx.phase = 'click_popup_enter';
  // lastActionAt 不重置:click_popup_enter 内 5s 超时基准沿用本时刻
  appendLog('intermediate_popup_appeared', {});
  return { ok: true, reason: 'popup_detected' };
}
```

注：`ctx.lastActionAt` 在 `click_enter` 末尾被设为点击 enter 按钮的时刻，进入 `waiting_for_intermediate` 后沿用此值作为 10s 超时基准。`click_popup_enter` 内的 5s 按钮查找超时沿用同一 `lastActionAt`，进入 `waiting` 时再重置。

### 5.4 `click_popup_enter` 实现

```js
case 'click_popup_enter': {
  const gRoot = root();
  const allNodes = gRoot ? collectNodes(gRoot) : [];
  const popup = findIntermediatePopup(allNodes, currentModule);
  if (!popup) {
    // 弹窗消失(可能已被自动点击或加载抖动)
    ctx.phase = 'waiting_for_intermediate';
    ctx.lastActionAt = now;
    return { ok: true, reason: 'popup_vanished_back_to_wait' };
  }
  const popupObj = findNodeByPath(gRoot, popup.path);
  if (!popupObj) return { ok: false, reason: 'popup_node_unavailable' };
  const popupChildren = descendantsOf(allNodes, popup).filter((item) => item.path !== popup.path);
  // 精确匹配(CDP 探查后填) + 兜底匹配(文本含 intermediatePopupButtonText)
  const btnNode = findPopupEnterButton(popupChildren, currentModule);  // TODO CDP 精确
  if (!btnNode) {
    if (now - ctx.lastActionAt > 5 * 1000) {
      ctx.phase = 'waiting_for_intermediate';
      ctx.lastActionAt = now;
      appendLog('popup_enter_button_not_found_retry', {});
      return { ok: true, reason: 'button_not_found_back_to_wait' };
    }
    return { ok: true, reason: 'waiting_for_button' };
  }
  const node = findNodeByPath(gRoot, btnNode.path);
  if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'button_node_unavailable' };
  const action = activateNode(node);
  if (!action.ok) return { ok: false, reason: action.reason };
  ctx.lastActionAt = now;
  ctx.phase = 'waiting';
  appendLog('enter_instance_clicked_popup_enter', { method: action.method });
  return { ok: true, method: action.method, reason: 'popup_enter_clicked' };
}
```

### 5.5 `state.enterInstanceCtx` 字段

现有：
```js
{ moduleId, phase, startedAt, selectedBossId, lastActionAt }
```

新增 `retried` 字段（如果还没有）：
```js
{ moduleId, phase, startedAt, selectedBossId, lastActionAt, retried: false }
```

### 5.6 总超时

保持 60s 不变：
```js
if (now - ctx.startedAt > 60 * 1000) { ... }
```

## 6. 错误处理与降级

| 场景 | 降级动作 |
|---|---|
| `waiting_for_intermediate` 10s 未见弹窗 | 首次：回退 `click_enter`，重置 `ctx.retried=true, ctx.lastActionAt=0`，下一 tick 节流后重点 enter 按钮<br>二次：`closePanelIfExists('Instance_BossUI')`，清 ctx，`releaseLockedTarget()`，报错 `intermediate_popup_timeout` |
| `click_popup_enter` 找不到"进入"按钮 5s | 回退 `waiting_for_intermediate`，等弹窗重新出现 |
| `click_popup_enter` activateNode 失败 | 直接 `{ok:false}` 报错，ctx 不清（下一 tick 重试时回到 `waiting_for_intermediate`） |
| 中间地图传送异常 60s 总超时 | 沿用现有 `enter_instance_timeout` 清理逻辑 |
| CDP 探查前精确匹配未填 | 走兜底宽松匹配（弹窗标题文本、按钮文本含"进入"），脚本不崩 |
| `hasIntermediatePopup` 模块外（purgatory/trial_land） | 完全不受影响，`click_enter → waiting` 原路径 |

## 7. CDP 探查清单

写完代码框架后，通过 `node cdp_eval.js auto "<expr>"` 验证以下 7 项并回填 TODO：

| # | 探查项 | 用途 | 默认占位 |
|---|---|---|---|
| 1 | `首饰BOSS` tab 选中后 BOSS 行 scroll 容器名 | `bossRowScroll` | `'wildlevelScroll'` |
| 2 | `幻术秘境4` 进入按钮文本格式 | 验证 `enterButtonTextRegex=/^幻术秘境4/` | `/^幻术秘境4/` |
| 3 | 进入副本后 `mapName` 节点文本 | 验证 `mapName='幻术秘境4'` | `'幻术秘境4'` |
| 4 | 中间地图 `scene.mapName` 值 | 验证中间地图存在且非空 | — |
| 5 | "卓越之境"弹窗节点 name/packageName/title | `intermediatePopupTitle` 精确匹配 | `'卓越之境'` 文本匹配 |
| 6 | 弹窗内"进入"按钮节点 name/path | `findPopupEnterButton` 精确匹配 | 文本含 `'进入'` 兜底 |
| 7 | 幽灵巨人 BOSS 坐标 | `phantom-giant` 的 `coordinate` | `'TBD'` |

## 8. 验证清单

实现 + CDP 回填后手动测试：

1. 开启脚本 → `chooseIntent` 在 accessory 模块可打时优先选 `enter_instance`
2. `executeEnterInstance` 走完整流程：选 `首饰BOSS` tab → 选 `幽灵巨人` → 点 `幻术秘境4` 进入按钮 → 等中间地图 → 等"卓越之境"弹窗 → 点"进入" → 到 `幻术秘境4` → `engage`/`hold` 打 BOSS
3. 爆率 low 时跳过 accessory 模块（`getAttackableTargets` 返回空）
4. 退出副本（`executeExitInstance`）正常工作
5. 现有 purgatory/trial_land/four_winds 流程无回归
6. 总耗时 < 60s

## 9. 版本号

`@version 0.1.0` → `0.2.0`（新增地图 + 新状态机阶段属次版本）

## 10. 实现步骤概览

1. 加 `accessoryModule` 模块定义 + 追加 `MAP_MODULES`
2. 修改 `CONFIG_DEFAULTS.enabledMaps/enabledBosses/mapPriorities`
3. 加 `ACCESSORY_RATE_CHECK_ENABLED=true` + `rebuildRateCheckMaps` 追加 accessory 分支
4. `KNOWN_MAP_NAMES` 追加 `'幻术秘境4'`
5. `executeEnterInstance` 加 `waiting_for_intermediate` / `click_popup_enter` 两阶段 + `click_enter` 分支
6. `state.enterInstanceCtx` 追加 `retried` 字段
7. 新增辅助函数 `findIntermediatePopup` / `findPopupEnterButton`（CDP 探查前宽松兜底）
8. CDP 探查 7 项，回填 `bossRowScroll` / `intermediatePopupTitle` 精确匹配 / `findPopupEnterButton` 精确匹配 / `coordinate`
9. 手动测试验证清单
10. 升版本号 `0.2.0` 并 commit

详细实现拆分由 writing-plans 阶段生成。
