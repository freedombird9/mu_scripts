# 多地图 BOSS 自动化 MVP — 设计文档

- 日期: 2026-07-16(2026-07-17 评审修订)
- 作者: Jack Zhang + Claude
- 状态: 待 plan(评审通过)

## 2026-07-17 评审修订摘要

对照实际源码 `mu-boss-trial-land-mvp.user.js`(2864 行)逐条核对后,做了以下 5 处修订。**下文各节已按此更新,本摘要仅作变更索引**:

1. **折返冷却(修复 §8.5 的折返 bug)**:魔晶菲尼斯无刷新记录时状态恒为 `READY_UNKNOWN_TIMER`,原设计会导致"进副本→发现没刷→退出→又想进"无限折返,直接违反需求"不能持续折返跑"。新增 `state.instanceCheckCooldown` + `config.instanceEmptyCooldownMs`(默认 15 分钟):进副本 scan 发现 BOSS 不在场则冷却,冷却内 `shouldEnterInstance` 返回 false,期间回四风 farming。见 §3/§4/§6/§8.5。
2. **坐标写死,删除运行时学习**:原 `executeScanMap` 只触发 overlay 采集刷新时间、**不解析坐标**(源码 L2264-2309 确认),spec §5.5 的"扫到 BOSS 行写入坐标"是要新写的逻辑,且 state 不持久化会导致每次重启重学。改为 CDP 探查一次拿固定坐标写死进 `purgatoryModule`,跟其他 7 个 BOSS 一致。删除 TBD/学习机制。见 §3/§5.5/§6.5/§6.6。
3. **爆率检查保留但依赖 CDP 验证**:需 CDP 验证"切苦难炼狱 tab 选中魔晶菲尼斯后 `BaolvIcon0` 是否反映其爆率";验证不成立则回退为"苦难炼狱不做爆率检查"。见 §5.6/§8.7。
4. **§4 调度器 3c 修正**(用户 2026-07-17 补充):勇者大陆/其他地图不再无脑传回四风平原,改为走统一的按优先级决策——副本模块 `shouldEnterInstance` 成立则直接 `enter_instance`(副本经挑战 BOSS 面板进入,无需先传送野外),否则野外模块 `teleport_to_module`。见 §4。
5. **旧脚本退役 + CDP 探查前置 Task**:新脚本是旧 `mu-boss-trial-land-mvp.user.js` 的超集,上线后旧脚本退役(手动 disable);两者不可同时启用。§9 新增 **Task 0:CDP 探查**(6 项实地数据),坐标/爆率/退出结构等占位项由此回填后才动后续编码。

**依赖 CDP 探查回填的占位项**(见 Task 0):魔晶菲尼斯固定坐标、副本内 `scanScene` 的 mapName 文本、退出按钮 `btnExit` 容器、副本内 M 大地图 BOSS 图标结构、`BaolvIcon0` 与魔晶菲尼斯的关联、苦难炼狱 tab 下 BOSS 行 `scrollName`/进入按钮 `togName` 实际值。

## 背景

`mu-boss-trial-land-mvp.user.js` 已实现"四风平原 + 试炼之地1"跨地图 BOSS 自动化。现需把功能扩展到"苦难炼狱2"地图,追踪并击杀"魔晶菲尼斯" BOSS。同时把"在哪些地图打哪些 BOSS"做成可扩展可拔插的模块化架构,后续可临时配置跳过某地图或加入新地图。

## CDP 探查事实(2026-07-16)

通过 Chrome DevTools Protocol 9222 实地验证,事实如下:

| 项目 | 值 |
|---|---|
| 挑战 BOSS 面板根节点 | `Instance_BossUI[3]` |
| 5 个 tab 名 | 野外BOSS / 福利BOSS / 首饰BOSS / 试炼之地 / 苦难炼狱 |
| tab 节点命名 | `bossBtnGroup_0..4[33..37]`,pkg `btnTabBrightN` |
| "苦难炼狱"tab(idx=4)选中后 BOSS 列表 | **`wildlevelScroll[6]`**(与野外 tab 共享同一 scroll),idx=3/4/5 = 魔晶菲尼斯 / 蛮横魔晶菲尼斯 / 邪恶魔晶菲尼斯 |
| "试炼之地"tab(idx=3)选中后 BOSS 列表 | `privatelevelScroll[19]` |
| 进入按钮(苦难炼狱) | `wildtog_mapName[5]/?[0..3]`,idx=0 文本 "苦难炼狱2 (126,95)" |
| 进入按钮(试炼之地) | `privatetog_mapName[18]/?[i]`,文本含 "试炼之地1 (x,y)" |
| 面板内 BaolvIcon0 | `Instance_BossUI[3]/?[0]/BaolvIcon0[15]`,url 如 `ui://InstanceBossWnd/txt_blg`(全局共享,跟 tab 无关) |
| BOSS 面板打开按钮 | `MainWnd[0]/?[0]/RightTop[3]/btnBigBoss[1]` |
| BOSS 行 pkg | `BtnBoss`,内部 `lab_name` 节点 |
| 进入按钮 pkg | `BtnBossMore`,内部 `lab_mapName` 节点 |
| 副本退出按钮 | `Damage list` 内 `btnExit`(同试炼之地) |
| 当前游戏角色 | 在勇者大陆 |
| Overlay 是否记录魔晶菲尼斯 | 取决于 candidates 配置(默认 `['傲之煞', '闪电巨人']`,不含魔晶菲尼斯);用户需通过 overlay 自身的 config UI 添加,不改 overlay 脚本 |

**关键发现**:用户最初描述"切到苦难炼狱 tab → 选魔晶菲尼斯 → 点击地图进入"在 CDP 探查中验证为:
1. 切到"苦难炼狱"tab(idx=4)
2. `wildlevelScroll` 滚动到 idx=3 "魔晶菲尼斯" 被选中
3. `wildtog_mapName` 显示 4 个按钮:苦难炼狱2 / 会员苦难炼狱2 / 会员苦难炼狱3 / 会员苦难炼狱4
4. 点击 idx=0 "苦难炼狱2 (126,95)" 按钮 → 传送进副本

**注意**:`wildlevelScroll` 和 `wildtog_mapName` 是野外 BOSS tab 和苦难炼狱 tab 共用的 UI 组件。BOSS 行的可见性和地图按钮的内容随 tab 切换变化。

**另一个发现**:tab "苦难炼狱"下还有一个 `KunDunBossPanel`(秘境玩法,显示咒怨魔王/冰后/秘境14层/累计击杀 BOSS 召唤)。这是另一个独立系统,**不是**本脚本目标。本脚本只处理"魔晶菲尼斯"在"苦难炼狱2"副本里的击杀。

## 用户决策汇总(brainstorming 过程)

- **架构方向**: 新建独立脚本 + 模块化地图插件,不动原 `mu-boss-trial-land-mvp.user.js`
- **可拔插配置形态**: 两者结合(地图级 `enabledMaps` 白名单 + BOSS 级 `enabledBosses`)
- **苦难炼狱优先级**: 可配置,默认 purgatory(30) > trial_land(20) > four_winds(10)
- **爆率检查**(2026-07-17 修订): 苦难炼狱是否做爆率检查取决于 Task 0 CDP 验证 BaolvIcon 关联;成立则低爆率回四风 farming(至下一 UTC+8 8am),不成立则回退为苦难炼狱不查爆率(见 §5.6)
- **苦难炼狱进入流程**: 复用 `executeEnterTrial` 流程,参数化 tab/scroll/tog/regex
- **苦难炼狱退出流程**: 完全复用 `executeExitTrial`,只换目标 mapName
- **副本内 BOSS 获取**: 完全走 M 大地图导航(跟四风平原一样)
- **苦难炼狱 BOSS 坐标**(2026-07-17 修订): CDP 探查一次拿固定坐标**写死**进模块,跟其他 7 个 BOSS 一致,不运行时学习
- **试炼之地 taskbar**: 取消 `executeTravelTrialBoss`,统一改用 M 大地图导航,所有副本内 BOSS 导航用同一套 `executeTravel`
- **苦难炼狱里只打魔晶菲尼斯**: 不打蛮横/邪恶两档
- **进入按钮选择**: 选第一个 "苦难炼狱2" 按钮
- **退出后状态机**(2026-07-17 修订): 退副本后到勇者大陆,**副本内不可直传**——必先 exit 回勇者大陆再传送;勇者大陆按优先级统一决策下一步(副本 enter / 野外 teleport),非无脑回四风
- **防折返**(2026-07-17 新增): 进副本发现 BOSS 不在场 → 写副本空场冷却(默认 15 分钟),冷却期回四风 farming 不反复进出
- **module 接口**: 对象 API(id/name/type/priority/enabled/bosses/enter/exit/teleportTo/navigateTo)
- **共存问题**: 跟原 trial-land 脚本同时安装时,Ctrl+N 冲突 — 文档说明"启用新脚本时需 disable 原脚本"
- **脚本文件名**: `mu-boss-multi-map-mvp.user.js`
- **守卫 marker**: `window.__muMultiMapBossMvp`

## §1 整体架构与文件布局

**新脚本**: `mu-boss-multi-map-mvp.user.js`(单文件,预计 ~2500 行)

**Tampermonkey metadata**:
- `@name 全民红月 - 多地图 BOSS 自动化 MVP`
- `@namespace codex.mu.multi-map-boss-mvp`
- `@version 0.1.0`
- `@match` 4 个域名(同原脚本)
- `@run-at document-start`,`@grant none`
- 注入守卫 marker `window.__muMultiMapBossMvp`

**文件结构(单文件内分节)**:

1. Constants & state(config defaults, storage key, targets registry)
2. Map modules(3 个模块对象,见 §3)
3. Scheduler:`chooseIntent` / `executeIntent` dispatch
4. Per-intent executors(复用从原脚本移植的逻辑,见 §5)
5. Shared utilities:`closePanelIfExists`, `ensureMapReady`, `ensureZKey`, `executeTravel`, `checkNavProgress`, `scanBossChallengePanel`, `scanMapPanel`, `scanCombat`, `scanScene`, `scanAutoBattle`, `collectNodes/walkNodes/findNodeByPath/activateNode/cleanText/...`
6. Target state & reconcile
7. Rate check
8. Map scan
9. Config & API(`window.__muMultiMapBossMvp.start/toggle/setConfig/...`)
10. Keyboard toggle(Ctrl+N)

**与原脚本关系**:
- 完全独立,可同时安装,但**只能启用一个**(两个都启用会抢 BOSS 面板/地图面板状态)
- 原 `mu-boss-trial-land-mvp.user.js` 保持不动,用户后续可手动 disable

**判定游戏 frame** 守卫、注入方式同原脚本(inject 函数 + isGameContext 检查 `window.fgui`)。

## §2 地图模块接口(Object API)

每个地图模块是一个**冻结对象**,通过 `MAP_MODULES` 数组注册。调度器遍历模块决定下一步动作。

### Module schema

```js
{
  id: 'four_winds',                // 唯一 id
  mapName: '四风平原',              // 场景 mapName(scanScene 返回值)
  type: 'wild',                    // 'wild' | 'instance'
  priority: 10,                    // 数字大优先级高(可被 config 覆盖)
  enabled: true,                   // 是否启用(可被 config 覆盖)
  
  // module 级别字段(整个模块共享,不在 bosses 表重复)
  bossRowTab: '野外BOSS',           // BOSS 行所在 tab(切到此 tab 才显示该 scroll)
  bossRowScroll: null,              // BOSS 行所在 scroll 节点名(野外模块用 overlay,可空)
  enterButtonTog: null,             // 进入按钮所在 tog 节点名(instance 才需要)
  enterButtonTextRegex: null,       // 进入按钮文本匹配正则(instance 才需要)
  hasTaskbar: false,                // 是否有副本内 taskbar(本设计统一为 false,走 M 大地图)
  
  bosses: [                         // 该地图的 BOSS 列表
    {
      id: 'ao-left',
      name: '傲之煞',
      coordinate: '77,145',
    },
    // ...
  ],
  
  farmTarget: { name: '1500级怪物' },  // farming 点(野外地图才有)
}
```

### 三个模块(精简版,字段细节见 §3)

1. `fourWindsModule` (type=wild, priority=10, bosses=4 个傲之煞系列, farmTarget=1500级怪物)
2. `trialLandModule` (type=instance, priority=20, bosses=3 个龙虾战士系列, enterTab='试炼之地', enterButtonTextRegex=/^试炼之地1/)
3. `purgatoryModule` (type=instance, priority=30, bosses=[魔晶菲尼斯], enterTab='苦难炼狱', enterButtonTextRegex=/^苦难炼狱2/)

**priority 默认**:purgatory(30) > trial_land(20) > four_winds(10),跟"苦难炼狱优先级最高"对齐。可通过 `config.mapPriorities` 覆盖。

### 模块的方法

模块对象**只含数据描述**,具体逻辑由通用 helper 函数根据 module 字段参数化执行。不把 enter/exit/navigateTo 写成模块方法 — 直接由调度器调 `executeEnterInstance(module, snapshot, ctx)` 等 helper。

设计理由:模块数据化、helper 通用化,加新地图时只需新增一个模块对象,不需写新 executor。

## §3 三个地图模块的具体内容

### Module 1: fourWindsModule

```js
{
  id: 'four_winds',
  mapName: '四风平原',
  type: 'wild',
  priority: 10,
  enabled: true,
  farmTarget: { name: '1500级怪物' },
  
  bossRowTab: '野外BOSS',         // 不需要切 tab(默认就开),仍记录
  bossRowScroll: null,            // 野外模块用 overlay 获取刷新,不需要点 BOSS 行
  enterButtonTog: null,           // 野外地图无进入按钮
  
  bosses: [
    { id: 'ao-left',   name: '傲之煞',       coordinate: '77,145' },
    { id: 'ao-right',  name: '傲之煞',       coordinate: '182,164' },
    { id: 'angry-ao',  name: '愤怒傲之煞',   coordinate: '179,79' },
    { id: 'rage-ao',   name: '狂暴傲之煞',   coordinate: '82,88' },
  ],
  
  hasTaskbar: false,
}
```

复用:
- `executeTravel`(M 大地图导航)
- `executeScanMap`(M 大地图扫描刷新时间)
- `executeTeleportToModule`(从勇者大陆传送)

### Module 2: trialLandModule

```js
{
  id: 'trial_land',
  mapName: '试炼之地1',
  type: 'instance',
  priority: 20,
  enabled: true,
  
  bossRowTab: '试炼之地',
  bossRowScroll: 'privatelevelScroll',
  enterButtonTog: 'privatetog_mapName',
  enterButtonTextRegex: /^试炼之地1/,
  
  bosses: [
    { id: 'lobster-1', name: '龙虾战士',       coordinate: '146,127', layer: 1 },
    { id: 'lobster-2', name: '邪恶龙虾战士',   coordinate: '79,68',   layer: 1 },
    { id: 'lobster-3', name: '咆哮龙虾战士',   coordinate: '122,33',  layer: 1 },
  ],
  
  hasTaskbar: false,   // 设计决策:取消 taskbar,统一走 M 大地图
}
```

复用:
- `executeEnterInstance`(七阶段状态机,参数化 module)
- `executeExitInstance`(五阶段状态机)
- `executeTravel`(M 大地图导航 — 跟 fourWinds 一致)

**取消 `executeTravelTrialBoss`**:试炼之地 BOSS 导航改用 `executeTravel`,跟所有 instance 模块一致。

### Module 3: purgatoryModule(新)

```js
{
  id: 'purgatory',
  mapName: '苦难炼狱2',
  type: 'instance',
  priority: 30,                   // 默认最高
  enabled: true,
  
  bossRowTab: '苦难炼狱',
  bossRowScroll: 'wildlevelScroll',   // 注:苦难炼狱 tab 共享 wildlevelScroll
  enterButtonTog: 'wildtog_mapName',  // 注:进入按钮在 wildtog_mapName(不在 privatetog)
  enterButtonTextRegex: /^苦难炼狱2/,
  
  bosses: [
    { id: 'magic-crystal', name: '魔晶菲尼斯', coordinate: '149,101' },  // Task 0 项 2 探查:角色站墓碑旁验证
    // 只打这一个 BOSS(用户明确"只打魔晶菲尼斯",不打蛮横/邪恶两档)
    // coordinate 由 Task 0 CDP 探查拿到固定坐标后写死,不用运行时学习
    // Task 0 项 2 探查结论:角色站墓碑旁亲自验证为 '149,101'(按钮上的 (126,95) 是按钮坐标,非 BOSS 坐标)
  ],
  
  hasTaskbar: false,              // 完全靠 M 大地图,跟 fourWinds 一样
}
```

**关键差异**:purgatoryModule 的 `bossRowScroll='wildlevelScroll'`、`enterButtonTog='wildtog_mapName'`,跟 trialLandModule 的 `privatelevelScroll` / `privatetog_mapName` 不同。这是 §2 接口要支持字段化切换的原因。

**退出后**:purgatoryModule exit 完成后角色在勇者大陆,调度器自动决定下一步(回四风平原 farming 或去其他副本打 BOSS),跟 trialLand 一致。

### `bosses` 表里的 `coordinate` 字段(2026-07-17 修订:写死,不再运行时学习)

- **魔晶菲尼斯坐标由 Task 0 的 CDP 探查一次拿到,写死进 `purgatoryModule.bosses[0].coordinate`**,跟其他 7 个 BOSS 完全一致(它们也是探查后硬编码的固定坐标)。
- 副本 BOSS 位置固定,无需运行时学习。
- **删除原设计的 TBD/学习机制**,理由:(1) 原 `executeScanMap` 只触发 overlay 采集刷新时间、**不解析坐标**(源码 L2264-2309),"扫到 BOSS 行写坐标"是要新写的逻辑,非复用;(2) state 不持久化,每次重启页面坐标又变 TBD,又得盲进副本重学。写死更简单可靠。
- `isAtTarget` 一律用写死的真坐标判定,无 TBD 特殊分支。

### Module 注册

`MAP_MODULES = [fourWindsModule, trialLandModule, purgatoryModule]`

调度器按 `effectivePriority` 排序:`effective = config.mapPriorities[module.id] || module.priority`
调度器遍历时跳过 `config.enabledMaps` 不包含的模块,以及 `enabled=false` 的模块。

### Config 新增字段

```js
config = {
  // 原有字段全部保留
  enabled, dryRun, ownerName, preWaitSeconds,
  ownerObserveSeconds, contestedCooldownMs, arrivalStallMs,
  travelTimeoutMs, farmTargetName, rateRecheckIntervalMs,
  trialPriorityWindowMs,
  
  // 新增
  enabledMaps: ['four_winds', 'trial_land', 'purgatory'],  // 启用的模块 id 白名单
  mapPriorities: { four_winds: 10, trial_land: 20, purgatory: 30 },  // 优先级覆盖
  enabledBosses: [                                          // 启用的 BOSS id 白名单(默认全部)
    'ao-left','ao-right','angry-ao','rage-ao',
    'lobster-1','lobster-2','lobster-3',
    'magic-crystal'
  ],
  purgatoryMapChoice: '苦难炼狱2',                          // "苦难炼狱2" 或 "会员苦难炼狱2" 等
  instanceEmptyCooldownMs: 15 * 60 * 1000,                 // 进副本发现 BOSS 不在场后的冷却(防折返)
}
```

API:`setConfig({ enabledMaps: ['four_winds', 'purgatory'] })` 临时跳过试炼之地。`setConfig({ enabledBosses: ['magic-crystal'] })` 只打魔晶菲尼斯。

### 副本空场冷却(防折返,2026-07-17 新增)

**问题**:魔晶菲尼斯无 overlay 刷新记录时状态恒为 `READY_UNKNOWN_TIMER`,`shouldEnterInstance` 会当作"有 BOSS 可进"。purgatory 优先级最高,于是"在四风 → 进苦难炼狱 → scan 发现没刷 → 退出 → 又变 UNKNOWN → 又进"无限折返,违反需求"不能持续折返跑"。野外地图不受此影响(走过去 hold 成本极低),但副本每次检查要进出一次,成本极高。

**机制**:
- `state.instanceCheckCooldown = {}`,形如 `{ [moduleId]: skipUntil }`(时间戳)。
- 进副本后走 `enter_instance`→`scan_map`,若判定魔晶菲尼斯**不在场**(overlay 无刷新记录且大地图无该 BOSS 图标/行),写入 `instanceCheckCooldown[moduleId] = now + config.instanceEmptyCooldownMs`,随即 `exit_instance` 回四风 farming。
- `shouldEnterInstance(module)` 在 `now < instanceCheckCooldown[module.id]` 时返回 false,期间调度器跳过该副本 → 角色在四风 farming,不折返。
- **解除条件**:冷却到期,或 `reconcileTargets` 发现该 module 的 BOSS 有了新的 overlay 刷新记录(说明 BOSS 已出现/即将刷新)→ 立即清除冷却,允许再次进入。
- **UTC+8 8am 重置**:与爆率 skipUntil 一样,凌晨 8am 全部重置冷却(所有地图统一)。

## §4 调度器状态机(Intent 列表)

`chooseIntent` 返回的 intent type 集合(沿用原脚本并参数化):

| Intent type | 触发条件 | Action | Locking? |
|---|---|---|---|
| `disabled` | config.enabled=false | none | no |
| `paused` | state.paused=true | none | no |
| `sync` | runtime 不可用 | none | no |
| `safe_wait` | 已 farming 或观察 owner | none | no |
| `check_rate` | 当前地图需要查爆率 | check_boss_rate | no |
| `enter_instance` | module.type=instance 且该副本有可打 BOSS,且不在副本内 | enter_instance | YES |
| `exit_instance` | 在副本内但无 BOSS 可打 | exit_instance | YES |
| `teleport_to_module` | 当前在勇者大陆或要切野外地图 | teleport_wild | YES |
| `travel_boss` | 在野外地图或在副本内有可打 BOSS | click_boss_target | YES |
| `travel_farm` | 无 BOSS 可打,需去 farming | click_farm_target | YES |
| `hold` | 到 BOSS 坐标,等刷新 | hold_position | YES |
| `engage` | BOSS 在视野内,可攻击 | ensure_auto_battle | YES |
| `observe_owner` | BOSS 被他人占据,观察 | observe_owner | YES |
| `scan_map` | 在野外地图或副本内,所有 BOSS 刷新时间未知 | open_map_scan | no |

**取消**的 intent(原 trial-land 脚本有,新脚本去掉):
- `enter_trial` → `enter_instance`(参数化 module)
- `exit_trial` → `exit_instance`
- `teleport_four_winds` → `teleport_to_module`
- `travel_trial_boss` → `travel_boss`(统一走 M 大地图,取消 taskbar 路径)

### Intent 调度核心逻辑(伪代码)

> **硬约束(2026-07-17 用户强调)**:角色在副本内时**绝不能**直接 `teleport_to_module`。副本无法直传,必须先 `exit_instance` 回勇者大陆,再由下一 tick 决策传送目标。下方 3a 保证副本内只会产出 `enter/exit/travel_boss/hold/engage/observe_owner/scan_map`,永不产出 teleport;`teleport_to_module` 只在野外/勇者大陆分支(3c)产生。原脚本已内建此约束,本设计保持并显式化。

```
chooseIntent(snapshot):
  // 1. 高优先级 lock 上下文优先
  if enterInstanceCtx active → enter_instance
  if exitInstanceCtx active → exit_instance
  if teleportCtx active → teleport_to_module
  if rateCheckCtx active → check_rate

  // 2. 已锁定的 target 优先(避免战斗中切换目标)
  if lockedTarget valid:
    return intentForLockedTarget(snapshot)

  // 3. 按 priority 遍历模块,选下一个意图
  const currentModule = moduleByMapName(snapshot.scene.mapName)

  // 3a. 当前在副本内:只看本副本 BOSS,绝不 teleport
  if currentModule && currentModule.type === 'instance':
    const attackable = currentModule.bosses.filter(b => isAttackable(b, snapshot))
    if attackable.length:
      const target = selectTrialTarget(attackable)
      return intentForTarget(target, currentModule, snapshot)   // → travel_boss/hold/engage/...
    // 本副本 BOSS 状态未知(UNKNOWN_TIMER)且刷新时间未扫过 → 先 scan 判空
    if needMapScan(currentModule, snapshot):
      return makeIntent('scan_map', null, 'scan instance for boss presence', currentModule)
    // scan 后确认无 BOSS → 写副本空场冷却 + 退出(不可直传,必须先退出)
    setInstanceCheckCooldown(currentModule.id, now + config.instanceEmptyCooldownMs)
    return makeIntent('exit_instance', null, 'no boss in instance, cooldown set', currentModule)

  // 3b. 当前在野外(四风平原):副本模块优先,再本地图 BOSS,再 farming
  if currentModule && currentModule.type === 'wild':
    for instModule in enabledInstancesSortedByPriority:
      if shouldEnterInstance(instModule, snapshot):
        return makeIntent('enter_instance', null, instModule.id + ' has boss', instModule)
    const target = selectHighestPriorityTarget(currentModule, snapshot)
    if target: return intentForTarget(target, currentModule, snapshot)
    if isAlreadyFarming: return safe_wait
    return travel_farm

  // 3c. 在勇者大陆或其他地图:统一按优先级决策去哪(不再无脑回四风)
  //     副本走 enter_instance(经挑战 BOSS 面板进,无需先传野外),野外走 teleport_to_module
  for instModule in enabledInstancesSortedByPriority:
    if shouldEnterInstance(instModule, snapshot):
      return makeIntent('enter_instance', null, instModule.id + ' has boss', instModule)
  const wildModule = selectHighestPriorityWildModule(snapshot)  // 有 BOSS 或需 farming 的野外图
  return makeIntent('teleport_to_module', wildModule.id, 'go to wild map', wildModule)
```

`shouldEnterInstance(module, snapshot)`:
- module.enabled && module.id in config.enabledMaps
- 该 module 至少有 1 个 BOSS 状态为 READY / READY_UNKNOWN_TIMER / PREPARE(且 BOSS id 在 enabledBosses 里)
- **`now >= instanceCheckCooldown[module.id]`(不在副本空场冷却内)** ← 2026-07-17 新增,防折返
- module.mapName 的爆率非 low(或在 cooldown 内未检查;若爆率检查回退则跳过此条)
- 不在另一个 instance ctx 内

`intentForTarget(target, module, snapshot)`(去 TBD,见 §6.5 完整伪代码):
- `observeContestedOwner` → safe_wait
- `isVisibleAndAttackable` → engage / observe_owner
- `atTarget` → hold
- 副本模块且不在该副本内 → enter_instance
- 已在正确地图未到坐标 → travel_boss(M 大地图导航)

### 状态字段(沿用原脚本 + 改名)

```js
state = {
  // 顶层
  enabled, dryRun, paused, pauseReason, phase,
  currentTargetId, currentAction, currentModuleId,
  currentIntent, lastIntent,
  lastError, lastActionAt,
  lastSnapshot,
  ownerObservation,
  tickId,
  
  // 锁定逻辑
  arrivalConfirmedAt,
  holdStartedAt,
  zKeySentAt, zKeyRetryCount,
  
  // Farming
  farmArrivedAt, farmArrivedCoord,
  farmLastSeenFarmingAt,
  farmTargetMissing,
  
  // 多地图 context(单例,跟原脚本一样不同时多个)
  enterInstanceCtx: null,    // { moduleId, phase, startedAt, selectedBossId, lastActionAt }
  exitInstanceCtx: null,      // { moduleId, phase, startedAt, lastActionAt, retried }
  teleportCtx: null,          // { moduleId, phase, startedAt, lastActionAt, mapOpenedAt, reopenClicked }
  navigationContext: null,    // { kind, targetId, startedAt, lastCoordinate, ... }
  mapScanContext: null,        // { startedAt, opened, closeClicked, openedAt }
  
  // 爆率
  rateCheck: { phase, targetModuleId, startedAt, lastActionAt },
  rateResults: {},             // { [moduleId]: { result, checkedAt, skipUntil, nextCheckAt } }
  
  // 副本空场冷却(防折返,2026-07-17 新增)
  instanceCheckCooldown: {},   // { [moduleId]: skipUntil } 进副本发现 BOSS 不在场 → 冷却期内不再进
  
  // Map scan
  lastMapScanAt: 0,
  lastCheckedAt: {},
  
  // Targets & logs
  targets: [],
  logs: [],
  config: ...,
};
```

### `isLockingIntent()` 更新

```js
function isLockingIntent() {
  return state.currentIntent
    && (state.currentIntent.type === 'travel_boss'
      || state.currentIntent.type === 'travel_farm'
      || state.currentIntent.type === 'hold'
      || state.currentIntent.type === 'engage'
      || state.currentIntent.type === 'observe_owner'
      || state.currentIntent.type === 'enter_instance'
      || state.currentIntent.type === 'exit_instance'
      || state.currentIntent.type === 'teleport_to_module');
}
```

## §5 核心 Executor 函数(复用 + 参数化)

### 5.1 `executeEnterInstance(module, snapshot, ctx)`

七阶段状态机(从原 `executeEnterTrial` 移植):

```
closing_panels → opening → waiting_for_open → select_tab → select_boss → click_enter → waiting
```

参数化:
- `module.bossRowTab` = "试炼之地" 或 "苦难炼狱"
- `module.bossRowScroll` = "privatelevelScroll" 或 "wildlevelScroll"
- `module.enterButtonTog` = "privatetog_mapName" 或 "wildtog_mapName"
- `module.enterButtonTextRegex` = `/^试炼之地1/` 或 `/^苦难炼狱2/`
- `module.mapName` = "试炼之地1" 或 "苦难炼狱2"
- `target.name` = 龙虾战士系列 或 "魔晶菲尼斯"

**关键改动点**:
- `select_tab` 阶段:`panel.tabs.find(t => t.text === module.bossRowTab)` 而非硬编码"试炼之地"
- `select_boss` 阶段:`panel.bossRows.find(r => r.name === target.name)`,但需过滤只看 `module.bossRowScroll` 容器下的 BOSS 行(原 `scanBossChallengePanel` 收集所有 BtnBoss 行,需扩展区分所属 scroll)
- `click_enter` 阶段:`panel.enterButtons.find(b => module.enterButtonTextRegex.test(b.text) && b.togName === module.enterButtonTog)`(过滤 togName + 文本)

**scanBossChallengePanel 改造**:
- BOSS 行(`BtnBoss` pkg)加 `scrollName` 字段,标记所属 scroll 容器名(`wildlevelScroll` / `privatelevelScroll` 等)
- 进入按钮(`BtnBossMore` pkg)加 `togName` 字段,标记所属 tog 容器名(`wildtog_mapName` / `privatetog_mapName` 等)

### 5.2 `executeExitInstance(module, snapshot, ctx)`

五阶段状态机(从原 `executeExitTrial` 移植):

```
closing_panels → waiting_for_close → click_exit → confirm → waiting
```

参数化:
- `module.mapName` = "试炼之地1" 或 "苦难炼狱2"
- 退出按钮位置:`btnExit` 在 `Damage list` 内(同试炼之地,假设苦难炼狱副本内也是此结构 — 待 Task 9 验证)
- AlertWnd 弹窗 rightCallback(同试炼之地)
- waiting 阶段判定:`mapName !== module.mapName` 即退出完成

**2026-07-17 Task 0 项 3 探查结论:`btnExit` 在 `Damage list[9]` 容器内**(同试炼之地),原 `executeExitTrial` 的 `/Damage list/i.test(item.path)` 正则可直接复用,无需参数化退出按钮路径。注意:同一 activityInfoCom 下有多个 `btnExit`(bloodCastle/unionBoss/wolfFort/tower/pagoda/kalunte 等),`Damage list` 过滤是必要条件。

### 5.3 `executeTeleportToModule(module, snapshot, ctx)`

从原 `executeTeleportFourWinds` 移植,参数化:
- `module.mapName` = "四风平原"(目前只用于 wild module)
- 流程:opening_map → select_map → select_submap → closing_map → waiting
- 子弹窗 List_tree 里点击文本匹配 `module.mapName`

### 5.4 `executeTravel(target, module, snapshot, kind)`

复用原 `executeTravel`(M 大地图导航),不分 module — 所有 BOSS 导航走同一逻辑。
- `kind='boss'`:用 wildtog_mapName 行点击(野外)或 M 大地图点击(副本内)
- `kind='farm'`:用 wildtog_mapName 的 farming 行点击
- 内容就绪判定 `contentReady` 用 module 信息(`target.name` + module.bosses)

苦难炼狱副本内走 M 大地图导航 → 跟 fourWinds 完全一致。试炼之地副本内也走这个(取消 taskbar 路径)。

**2026-07-17 Task 0 项 4 探查结论**:副本内大地图外层节点是 `Main_MapDetailUI[3]`,但其内部第一个子节点 `?[0]` 的 `packageName === 'MapDetialWnd'`(跟野外大地图同一 pkg)。`scanMapPanel` 找 `packageName === 'MapDetialWnd'` 仍能匹配到副本内大地图(命中 `Main_MapDetailUI[3]/?[0]`),`closePanelIfExists('MapDetialWnd')` 同理。**无需改造 scanMapPanel 或 closePanelIfExists**。副本内 `List_right` 下 `RightLift` 行从 idx=1 开始(idx=0 空行),`scanMapPanel` 用 `pkgName === 'RightLift'` filter 自动跳过空行;BOSS 名在 `n16`(`mapRowSummary` 已处理:先找 n16 再找 n0)。副本内 `leftlist` 的 `leftitem.title` 文本为空(副本内不显示地图名列表),但 `executeTravel` 在副本内只走 `List_right`+RightLift,不依赖 `leftitem`。**`executeTravel` 可直接复用,无需修改**。

### 5.5 `executeScanMap(snapshot, ctx)`(2026-07-17 修订:恢复原职责,不写坐标)

**完全沿用原逻辑,不改**:开 M 大地图 → 等 `MAP_SCAN_OPEN_WAIT_MS` → 关图,让 overlay 采集器读到刷新时间。函数自身**不解析坐标、不写坐标**(原源码 L2264-2309 就是如此)。

- 坐标已由 Task 0 CDP 探查写死,无需 scan 学习(删除原设计的 `boss_coord_learned` 逻辑)。
- **苦难炼狱副本内也用此函数**触发 overlay 采集刷新时间——但更重要的用途是**判定 BOSS 是否在场**:进副本后 scan_map,若既无 overlay 记录、大地图又无该 BOSS 图标,则判定"不在场",写副本空场冷却并退出(见 §8.5 / 副本空场冷却)。
- `needMapScan` 原仅针对四风平原硬编码,需扩展为对所有当前所在地图(含苦难炼狱2)生效。

### 5.6 `executeCheckRate(module, snapshot, ctx)`(2026-07-17 修订:苦难炼狱爆率依赖 CDP 验证)

沿用原 `executeCheckRate`,参数化:
- `rateMap.tab` = module.bossRowTab
- `rateMap.bossNames` = module.bosses.map(b => b.name)
- `rateMap.mapMatch` = module.mapName 的子串(如 "苦难炼狱2" → "苦难炼狱",用 `module.mapName.replace(/\d+$/, '')`)
- BaolvIcon0 读取逻辑不变(全局共享)

> ⚠️ **CDP 验证前提(Task 0)**:原爆率逻辑对四风/试炼有效,但苦难炼狱只有魔晶菲尼斯一个 BOSS,`BaolvIcon0` 是否随"切苦难炼狱 tab 选中魔晶菲尼斯"而反映**该 BOSS 的**爆率,尚未验证(icon 是全局共享节点)。Task 0 必须验证:切 tab 选中魔晶菲尼斯后 `BaolvIcon0.url` 是否变化为其爆率状态。
> - **验证成立** → 苦难炼狱纳入爆率检查,低爆率跳过回四风 farming(与试炼一致)。
> - **验证不成立**(icon 与魔晶菲尼斯无关联)→ **回退**:苦难炼狱不做爆率检查,`purgatoryModule` 不进 `RATE_CHECK_MAPS`。此时进不进副本仅由 BOSS 状态 + 副本空场冷却决定。

**2026-07-17 Task 0 项 5 探查结论:验证成立**。CDP 实测:魔晶菲尼斯(高爆率)时 `BaolvIcon0.url = "ui://InstanceBossWnd/txt_blg"`,傲之煞(低爆率)时 `url = "ui://InstanceBossWnd/txt_bld"`。两次 URL 不同,证实 BaolvIcon0 反映当前选中 BOSS 爆率。→ `PURGATORY_RATE_CHECK_ENABLED = true`,苦难炼狱纳入爆率检查。

`RATE_CHECK_MAPS` 改成从 `MAP_MODULES` 动态生成(苦难炼狱是否加入取决于上述验证):
```js
const RATE_CHECK_MAPS = {};
for (const module of MAP_MODULES) {
  if (module.enabled && config.enabledMaps.includes(module.id)) {
    RATE_CHECK_MAPS[module.mapName] = {
      tab: module.bossRowTab,
      bossNames: module.bosses.map(b => b.name),
      mapMatch: module.mapName.replace(/\d+$/, ''),
    };
  }
}
```

### 5.7 `executeHold / executeEngage / executeObserveOwner`

完全沿用原逻辑,无参数化(通用 BOSS 战斗逻辑)。

### 5.8 `ensureZKey / toggleAutoFight / isAutoFightOn / ensureAutoBattle`

完全沿用原逻辑。

### 5.9 `closePanelIfExists / ensureMapReady / clickOpenMapButton / closeMapPanel`

完全沿用原 helper 函数。

### 5.10 Scan 函数

- `scanScene`(通用,加 `'苦难炼狱2'` 到 `KNOWN_MAP_NAMES`)
- `scanMapPanel`(通用,无需改)
- `scanCombat`(通用,需把所有 BOSS 名字加入 `TARGET_TABLE` — 从 `MAP_MODULES` 动态生成)
- `scanAutoBattle`(通用,无需改)
- `scanTrialTaskbar` — **删除**(设计决策:取消 taskbar 路径)
- `scanBossChallengePanel`(改造:BOSS 行加 `scrollName`,enterButton 加 `togName`)

## §6 目标状态管理 & 数据流

### 6.1 Target state(reconcileTargets)

沿用原 `reconcileTargets`,但 `state.targets` 来自 `MAP_MODULES` 扁平化:

```js
state.targets = MAP_MODULES.flatMap(module => 
  module.bosses.map(boss => createTargetState({
    ...boss,
    moduleId: module.id,
    mapName: module.mapName,
  }))
);
```

### 6.2 recordMatchesTarget

沿用,匹配字段:`record.mapName === target.mapName && record.bossName === target.name`。
苦难炼狱 BOSS 没有 overlay 记录时,`refreshAt` 保持 null,状态为 `READY_UNKNOWN_TIMER`。

### 6.3 targetStatus(target, now)

完全沿用:`COOLING / READY_UNKNOWN_TIMER / READY / PREPARE / WAITING_REFRESH`。

### 6.4 isCooling / markContested

沿用。

### 6.5 isAtTarget

完全沿用:`scene.mapName === target.mapName && chebyshevDistance <= ARRIVAL_THRESHOLD`。坐标已写死,无 TBD 分支。

`intentForTarget(target, module, snapshot)`(2026-07-17 修订:去掉 TBD 分支):

```js
function intentForTarget(target, module, snapshot) {
  // 1. 被他人占据 → 观察
  if (observeContestedOwner(...)) return safe_wait;
  // 2. BOSS 在视野内可攻击 → engage / observe_owner
  if (isVisibleAndAttackable(target, snapshot)) return engage 或 observe_owner;
  // 3. 已到坐标 → hold 守点
  if (isAtTarget(target, snapshot)) return hold;
  // 4. 还没进副本(副本模块且当前不在该副本内)→ 先 enter_instance
  if (module.type === 'instance' && snapshot.scene.mapName !== module.mapName) {
    return makeIntent('enter_instance', null, module.id + ' has boss, need enter', module, 0.95);
  }
  // 5. 已在正确地图但未到坐标 → travel_boss(M 大地图导航)
  return makeIntent('travel_boss', target.id, 'go to boss coord', ...);
}
```

**副本内 scan 判空**:进副本后由调度器发 `scan_map`(见 §5.5),而非 `intentForTarget`。scan 后判定 BOSS 不在场 → 写副本空场冷却 + `exit_instance`(见副本空场冷却)。

### 6.6 (删除)运行时坐标写入

原设计的"scan 到 BOSS 行写入 coordinate"已删除——坐标由 Task 0 CDP 探查写死。见 §5.5。

### 6.7 状态字段全集

见 §4 已列出。

### 6.8 Tick 流程

完全沿用原 `tick`:`readSnapshot → reconcileTargets → chooseIntent → executeIntent`。

## §7 Config & API

### 7.1 默认 config

```js
const CONFIG_DEFAULTS = Object.freeze({
  enabled: false,
  dryRun: true,
  ownerName: '普尔赫达',
  preWaitSeconds: 90,
  ownerObserveSeconds: 10,
  contestedCooldownMs: 5 * 60 * 1000,
  arrivalStallMs: 15 * 1000,
  travelTimeoutMs: 180 * 1000,
  farmTargetName: '1500级怪物',
  rateRecheckIntervalMs: 15 * 60 * 1000,
  trialPriorityWindowMs: 60 * 1000,
  
  // 新增
  enabledMaps: ['four_winds', 'trial_land', 'purgatory'],
  mapPriorities: { four_winds: 10, trial_land: 20, purgatory: 30 },
  enabledBosses: [
    'ao-left','ao-right','angry-ao','rage-ao',
    'lobster-1','lobster-2','lobster-3',
    'magic-crystal'
  ],
  purgatoryMapChoice: '苦难炼狱2',
});
```

### 7.2 暴露的 API(`window.__muMultiMapBossMvp`)

沿用原 API,功能等价:

```js
{
  start()               // enabled=true, dryRun=false
  toggle()              // 切换 on/off
  pause(reason)
  resume()
  status                // getStatus()
  setConfig(patch)      // 改 config,如 { enabledMaps: ['four_winds', 'purgatory'] }
  scanNow()             // 立即读一次 snapshot
}
```

### 7.3 键盘开关

`Ctrl+N` 切换,跟原脚本一致(同 `toggle()`)。守卫变量改为 `__muMultiMapBossToggleKeyBound`,避免与原脚本冲突。

**共存问题**:用户同时装了原 trial-land 脚本和新脚本时,Ctrl+N 会触发两个。文档说明"启用新脚本时需 disable 原脚本"。

### 7.4 持久化

沿用 `localStorage`,`mu_multi_map_boss_mvp_v1` 存 config。其他运行时 state 不持久化。

### 7.5 showToast

沿用原 showToast 实现。

### 7.6 调试用 API

增加 `getModule(moduleId)`、`getTargets()` 便于控制台调试(可选,不影响主流程)。

## §8 错误处理 / 降级 / 边界

### 8.1 失败可降级原则

- `readSnapshot` 异常 → tick_error 日志,不崩
- `scanBossChallengePanel` 找不到 BOSS 行 → enter_instance 重试,3 次失败放弃
- `ensureMapReady` 失败 → 5 秒重开兜底,2 次失败放弃 navigationContext
- 任何 intent 失败 → releaseLockedTarget + safe_wait,不卡死

### 8.2 单面板约束(沿用)

- 进入/退出 instance 前先 `closePanelIfExists('MapDetialWnd')` 和 `closePanelIfExists('Instance_BossUI')`
- 在副本内开 M 大地图前先关 Instance_BossUI

### 8.3 异步等待(沿用)

- 所有点击 → `waiting_for_open` / `waiting_for_close` 中间阶段
- 3 秒超时回退重试
- 60 秒总超时放弃

### 8.4 苦难炼狱特殊边界

- `bossRowScroll='wildlevelScroll'`:这个 scroll 同时用于野外 BOSS tab 和苦难炼狱 tab。`scanBossChallengePanel` 收集 BOSS 行时需按 `scrollName` 过滤
- `enterButtonTog='wildtog_mapName'`:同样共享,需按 `enterButtonTextRegex` + `togName` 过滤"苦难炼狱2"开头的按钮
- "切 tab" 操作必须先到苦难炼狱 tab,否则 wildtog_mapName 显示的是别的地图(亚特兰蒂斯等)
- 切 tab 后 game UI 自己滚动 wildlevelScroll 到魔晶菲尼斯(idx=3)被选中

### 8.5 overlay 不记录魔晶菲尼斯的边界(2026-07-17 修订:靠冷却防折返)

- 当 overlay.records 里没有魔晶菲尼斯时,本脚本靠 `READY_UNKNOWN_TIMER` 驱动。
- 进副本 → scan_map → 判定 BOSS 是否在场:
  - **在场**(大地图有图标 / overlay 检测到倒计时写入 records)→ 导航过去打 → 下次 tick `reconcileTargets` 拿到 refreshAt → 转 PREPARE / READY。
  - **不在场**(无图标、无 records)→ 写 `instanceCheckCooldown[purgatory]`(默认 15 分钟)→ `exit_instance` 回四风 farming(见"副本空场冷却")。
- **不再是"每次都进副本检查"**:原设计这么写会导致无限折返(违反需求注意事项 4)。冷却机制保证冷却期内在四风 farming、不反复进出副本。
- **文档说明**:用户可通过 overlay 的 config UI 添加"魔晶菲尼斯"到 candidates,让本脚本提前 90 秒去守(否则只能现进现打)。加入 candidates 后,overlay 有刷新记录会立即解除冷却(见解除条件)。

### 8.6 退出苦难炼狱失败

- 找不到 btnExit → 3 秒重试
- AlertWnd 不弹 → 3 秒重试
- mapName 不变 → 30 秒重试,2 次失败放弃(`exitInstanceCtx=null`),下次 tick 重新发起 exit

### 8.7 CDP 验证清单(= Task 0,编码前必须先探查回填)

| # | 探查项 | 用途 / 回填目标 | Task 0 探查结论 |
|---|---|---|---|
| 1 | 苦难炼狱2 副本内 `scanScene` 返回的 mapName 文本是否精确等于 `苦难炼狱2` | `KNOWN_MAP_NAMES` + 到达/退出判定 | ✅ 精确等于 `'苦难炼狱2'`(`MiniMapPart[0]/mapName[2]` visible=false 但 text 正确) |
| 2 | 魔晶菲尼斯在副本内 M 大地图的固定坐标 | 写死进 `purgatoryModule.bosses[0].coordinate` | ✅ `'149,101'`(用户角色站墓碑旁亲自验证;副本任务栏 secretBoss 不显示该 BOSS,任务栏里的"寒霜魔王扎坎"是另一套玩法,不是目标 BOSS) |
| 3 | 副本内退出按钮 `btnExit` 是否也在 `Damage list` 容器 | 复用 `executeExitInstance` 的前提 | ✅ 在 `Damage list[9]/btnExit[0]`,跟试炼之地完全一致,`executeExitInstance` 可直接复用 |
| 4 | 副本内 M 大地图 BOSS 图标/行结构(与四风平原是否一致) | 确认 `executeTravel` 副本内导航可行 | ✅ 外层 `Main_MapDetailUI` 但内部 `?[0]` pkg=`MapDetialWnd`,`List_right`+`RightLift` 行结构跟野外一致,BOSS 名在 `n16`,`executeTravel` 可直接复用,无需改 scanMapPanel |
| 5 | 切苦难炼狱 tab 选中魔晶菲尼斯后 `BaolvIcon0.url` 是否反映该 BOSS 爆率 | 决定爆率检查成立 or 回退(见 §5.6) | ✅ 反映:魔晶菲尼斯(高)`txt_blg`、傲之煞(低)`txt_bld`,`PURGATORY_RATE_CHECK_ENABLED = true` |
| 6 | 苦难炼狱 tab 下 BOSS 行 `scrollName`、进入按钮 `togName` 实际值 | 验证 `scanBossChallengePanel` 改造的 scroll/tog 归属正确 | ✅ `scrollName = 'wildlevelScroll'`、`togName = 'wildtog_mapName'`,跟 spec 一致 |

**探查 1/2/3/4 需角色实际进入苦难炼狱2 副本;5/6 只需打开挑战 BOSS 面板切 tab。探查结论逐项回填本 spec 对应占位符后,才进入后续编码 Task。**

**Task 0 新发现补充(2026-07-17)**:
- 副本内 BOSS 坐标无法通过大地图扫描自动拿到(RightLift 行只有 n0/n16 文本,不含坐标数字);**坐标必须由用户探查写死**,跟 Task 0 项 2 一致
- 副本内 `secretBoss` 任务栏显示的是另一套玩法(寒霜魔王扎坎),不是目标 BOSS;`Damage list` 任务栏显示试炼之地 BOSS 也不是目标 — 这些任务栏**不应**作为副本内 BOSS 信息来源,只用来找 `btnExit`

## §9 实施任务拆分(给 coding agent 用)

按依赖顺序拆成 11 个子任务(Task 0 ~ Task 10),每个独立可验证。coding agent 按序做完一个再做下一个,每个完成后审查。**Task 0 必须最先做且经用户同意后执行**——它回填后续所有 Task 依赖的实地数据。

### Task 0:CDP 探查苦难炼狱2(编码前置,需用户同意)

- 通过 CDP 9222 探查 §8.7 清单的 6 项实地数据
- 探查 1/2/3/4 需角色进入苦难炼狱2 副本(可能需用户配合把角色弄进副本)
- 逐项把结论回填到 spec 的占位符:
  - `purgatoryModule.bosses[0].coordinate`(项 2)
  - `KNOWN_MAP_NAMES` 的苦难炼狱2 文本(项 1)
  - 退出按钮路径是否复用(项 3)
  - 爆率检查成立 or 回退(项 5)
  - scanBossChallengePanel 的 scrollName/togName 预期值(项 6)
- **验证**:6 项全部有明确结论,spec 无剩余 `<Task0-CDP探查回填>` 占位符

### Task 1:脚本骨架 & 注入逻辑

- 创建 `mu-boss-multi-map-mvp.user.js`,含 Tampermonkey metadata、inject 函数、isGameContext、`window.__muMultiMapBossMvp` 守卫 marker
- 复制原脚本 utility 层:`cleanText / clone / clampNumber / readJson / writeJson / root / collectNodes / walkNodes / summarizeNode / packageInfo / getRect / findNodeByPath / nodeIsEffectivelyVisible / findBigBtnChild / activateNode / normalizeCoordinate / appendLog / showToast / setupKeyboardToggle`
- 复制 scan 函数:`scanScene / scanMapPanel / scanBossChallengePanel / scanCombat / scanAutoBattle / mapRowSummary / descendantsOf / buttonSummaryWithPath`
- scanBossChallengePanel 改造:BOSS 行加 `scrollName`,enterButton 加 `togName`
- KNOWN_MAP_NAMES 加 `'苦难炼狱2'`
- `state` 框架
- **验证**:浏览器控制台 `typeof window.__muMultiMapBossMvp` 返回 'object',不报错

### Task 2:Config & API

- CONFIG_DEFAULTS(含 enabledMaps / mapPriorities / enabledBosses / purgatoryMapChoice)
- normalizeConfig / persist / syncRuntimeFlags / getStatus
- `window.__muMultiMapBossMvp` 暴露 start/toggle/pause/resume/setConfig/scanNow
- **验证**:`__muMultiMapBossMvp.setConfig({enabledMaps:['four_winds']})` 不报错,status 返回正确

### Task 3:三个地图模块对象

- fourWindsModule(4 个傲之煞 BOSS + farming)
- trialLandModule(3 个龙虾 BOSS,无 taskbar)
- purgatoryModule(1 个魔晶菲尼斯,坐标用 Task 0 CDP 探查值写死)
- MAP_MODULES 数组注册
- state.targets 从 MAP_MODULES 扁平化生成
- **验证**:`window.__muMultiMapBossMvp.status().targets.length === 8`(4+3+1)

### Task 4:reconcile & target state

- reconcileTargets / recordMatchesTarget / selectMatchingRecord
- targetStatus / isCooling / markContested / validRefreshAt / clearCooldown
- createTargetState
- **验证**:启动脚本,targets 状态正确(从 overlay 读 records)

### Task 5:chooseIntent 调度核心

- chooseIntent 主入口(按 §4 伪代码)
- chooseWildIntent / chooseInstanceIntent / intentForTarget / intentForLockedTarget
- isLockingIntent / hasLockedValidTarget / isLockTargetEligible / releaseLockedTarget
- applyIntent / makeIntent
- shouldEnterInstance / shouldPrioritizeInstance(从原 shouldPrioritizeTrial 改造,加 module 参数)
- getAttackableTargets(过滤 enabledMaps 和 enabledBosses)
- isVisibleAndAttackable / isAlreadyFarming / isAtTarget / chebyshevDistance
- **验证**:`window.__muMultiMapBossMvp.status().currentIntent` 在不同场景下返回正确意图

### Task 6:executeIntent dispatch + 通用 executor

- executeIntent 主 dispatch
- executeHold / executeEngage / executeObserveOwner / executeCheckRate / executeScanMap(直接复制原脚本)
- ensureAutoBattle / ensureZKey / toggleAutoFight / isAutoFightOn(直接复制)
- closePanelIfExists / ensureMapReady / clickOpenMapButton / closeMapPanel(直接复制)
- executeTravel / checkNavProgress(直接复制,加 module 参数用于 contentReady)
- **验证**:在四风平原上测试 travel_boss / hold / engage 跑通

### Task 7:executeEnterInstance / executeExitInstance / executeTeleportToModule

- 从原 executeEnterTrial / executeExitTrial / executeTeleportFourWinds 移植,参数化 module
- 七阶段 / 五阶段状态机
- 状态字段:`enterInstanceCtx` / `exitInstanceCtx` / `teleportCtx`(替换 enterTrialContext 等)
- scanBossChallengePanel 改造验证:enterButtons 带 togName
- **验证**:在勇者大陆上,启动脚本后能进入试炼之地1,然后退出

### Task 8:purgatory 模块集成

- purgatoryModule 配置填好(bossRowTab='苦难炼狱'、bossRowScroll='wildlevelScroll'、enterButtonTog='wildtog_mapName'、enterButtonTextRegex=/^苦难炼狱2/、coordinate 用 Task 0 探查值)
- purgatoryMapChoice 用上(enterButton 首选文本匹配)
- 调度器:shouldEnterInstance(purgatoryModule) 判定(含副本空场冷却检查)
- 进副本流程测试(实际跑一次)
- **验证**:启动脚本后,在勇者大陆上自动进苦难炼狱2 副本

### Task 9:苦难炼狱副本内打 BOSS + 空场冷却 + 退出

- 用写死坐标 isAtTarget 导航到魔晶菲尼斯(M 大地图,同四风)
- ensureZKey 开挂打 BOSS
- **副本空场判定**:scan_map 后若 BOSS 不在场 → 写 `instanceCheckCooldown[purgatory]` → exit_instance
- 退出副本(复用 executeExitInstance,btnExit 路径按 Task 0 项 3 结论)
- **验证**:完整跑通"勇者大陆 → 进苦难炼狱2 → 打魔晶菲尼斯 / 或 BOSS 没刷则写冷却退出 → 回勇者大陆"

### Task 10:边界 case、防折返 & 旧脚本退役

- **防折返验证(重点)**:魔晶菲尼斯无刷新记录时,进苦难炼狱 scan 判空 → 写冷却 → 回四风 farming;冷却期内**不再反复进副本**(反复进出 = bug)
- **副本内不直传验证**:副本内需切换地图时,状态机先 exit 回勇者大陆,再传送,绝不在副本内 teleport
- 测试苦难炼狱无 BOSS → 回四风 farming
- 测试临时跳过试炼之地:`setConfig({enabledMaps:['four_winds','purgatory']})` 后状态机不进试炼之地
- 测试苦难炼狱低爆率跳过(若爆率检查成立)→ 回四风 farming
- Ctrl+N 切换不冲突(守卫变量 `__muMultiMapBossToggleKeyBound`)
- **旧脚本退役**:文档/README 写明新脚本取代 `mu-boss-trial-land-mvp.user.js`,上线后手动在 Tampermonkey disable 旧脚本;两者不可同时启用(会抢 BOSS 面板/大地图状态)
- **验证**:各种边界 case 跑通,尤其防折返

## 附录:跟原 trial-land 脚本的差异速查

| 原脚本 | 新脚本 |
|---|---|
| `enter_trial` / `exit_trial` / `teleport_four_winds` intent | `enter_instance` / `exit_instance` / `teleport_to_module`(加 moduleId) |
| `travel_trial_boss` intent + taskbar 路径 | 删除,统一用 `travel_boss` + M 大地图导航 |
| `executeEnterTrial`(七阶段,硬编码"试炼之地") | `executeEnterInstance(module)`(参数化 tab/scroll/tog/regex) |
| `executeExitTrial` | `executeExitInstance(module)` |
| `executeTeleportFourWinds` | `executeTeleportToModule(module)` |
| `executeTravelTrialBoss` | 删除,统一 `executeTravel(target, module, snapshot, kind)` |
| `scanTrialTaskbar` | 删除 |
| `TARGETS` 数组硬编码 | `MAP_MODULES` 扁平化生成 |
| `KNOWN_MAP_NAMES` 3 个 | 4 个(加 `'苦难炼狱2'`) |
| `RATE_CHECK_MAPS` 硬编码 | 从 `MAP_MODULES` 动态生成 |
| `state.enterTrialContext` / `exitTrialContext` / `teleportContext` | `state.enterInstanceCtx` / `exitInstanceCtx` / `teleportCtx` |
| `window.__muTrialLandBossMvp` | `window.__muMultiMapBossMvp` |
| `STORAGE_KEY='mu_trial_land_boss_mvp_v1'` | `'mu_multi_map_boss_mvp_v1'` |
| `__muBossToggleKeyBound` 守卫 | `__muMultiMapBossToggleKeyBound` |
| `scanBossChallengePanel` 收集 BOSS 行不区分 scroll | 加 `scrollName` 字段 |
| `scanBossChallengePanel` enterButton 不区分 tog | 加 `togName` 字段 |
| 无副本空场冷却 | 新增 `state.instanceCheckCooldown` + `config.instanceEmptyCooldownMs`(防折返)|
| BOSS 坐标全硬编码 | 保持全硬编码(魔晶菲尼斯坐标 CDP 探查后写死,**不**运行时学习)|
| 勇者大陆 → 无脑传回四风 | 勇者大陆 → 按优先级统一决策(副本 enter / 野外 teleport)|
| 单脚本(四风+试炼) | 超集脚本,上线后旧 trial-land 脚本退役 |
