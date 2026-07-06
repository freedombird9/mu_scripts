# MU BOSS Bot Design

## 目标

设计一个面向 MU H5 网页游戏的自动打 BOSS Bot。Bot 在游戏 iframe 内运行，负责低延迟观察、调度和执行；Agent 通过 Chrome DevTools 定期读取状态、查看日志、调整配置，只在不确定状态或策略调整时介入。

第一版目标是“自动闭环但保守”：Bot 可以自动进入地图、提前蹲刷新、按 Z 自动攻击、记录刷新时间、判断抢不过时撤退、穿插勇士任务和固定挂机点；但遇到低置信识别、执行确认失败、人工接管或未覆盖流程时必须暂停，不能猜测继续执行。

## 已确认需求

- 控制边界选择页面内 Bot + Agent 监督。
- 动作允许 UI 级动作和已验证的游戏前端对象方法，不直接构造网络包。
- BOSS 选择采用混合策略：手动配置优先；配置目标都不可用时，再从面板选择可解释的自动候选。
- 抢不过时可以撤退，但必须基于明确 UI 和保守启发式，不能单点误判。
- 默认刷新前 90 秒开始跑图；到达正确地图/区域后，等待刷新时可以先按 Z，让 BOSS 刷新后自动开打。
- 勇士任务和 BOSS 循环穿插执行：没有即将刷新或需要蹲点的重点 BOSS 时做勇士任务；接近重点 BOSS 窗口时由 BOSS 抢占。
- 抢不到 BOSS 或等待窗口过长时，到配置好的固定小怪挂机点挂机。
- 人工接管支持显式暂停/恢复，也自动检测人工操作并进入冷却；恢复前必须重新扫描状态。
- Bot 状态、配置和日志存在页面存储中，Agent 通过 9222 DevTools 读取和修改。
- 重新设计 Sensor Core；现有 `mu-boss-automation-observer.user.js` 只作为参考和可迁移代码，不作为不可替换依赖。
- Sensor 信息来源为 UI/FairyGUI 扫描和稳定运行时对象读取，不做协议/WebSocket 逆向监听。

## 非目标

- 第一版不 patch bundle。
- 第一版不直接构造、伪造或发送游戏网络协议。
- 第一版不做长期统计平台、本地 sidecar 服务或独立配置 Web UI。
- 第一版不自动学习大幅调整策略；凌晨/高峰成功率只记录，策略由配置和 Agent 调整。
- 第一版不把低置信 UI 推断当成高风险动作依据。

## 架构方案对比

### A. Minimal Loop

单脚本小循环：扫描 UI、看到目标就点、按 Z、记录简单结果。优点是快，缺点是不能可靠处理提前蹲点、人工接管、勇士任务、失败冷却和多目标调度。

### B. Modular Userscript Runtime

推荐方案。游戏 iframe 内运行模块化 userscript runtime，核心模块为 Sensor Core、Planner、Executor、State Log。Bot 负责实时状态机和动作执行；Agent 通过 DevTools 做监督和配置调整。该方案低延迟、可解释、可暂停，也能分阶段解锁动作。

### C. Local Control Platform

增加本地 sidecar、文件日志、长期统计、独立配置 UI。能力强，但第一版过重，会把主要风险转移到本地服务、通信和部署上。

## 推荐架构

采用 Modular Userscript Runtime：

- `Sensor Core`：输出统一快照，包含场景、玩家、BOSS 面板、左侧任务、战斗、刷新时间和置信度。
- `Planner`：根据配置、每日计数、刷新表、竞争状态、勇士任务和挂机 fallback 生成下一步 intent。
- `Executor`：只执行白名单动作，并等待确认条件。Executor 不自己选择目标。
- `State Log`：记录状态转移、动作、确认结果、失败原因、抢归属结果、刷新时间和每日计数。
- `Agent Bridge`：暴露 `window.__muBossBot` API，供 Agent 通过 DevTools 读取状态、导出日志、修改配置、暂停/恢复。

系统不依赖旧 observer。旧 observer 中经过验证的 UI 扫描函数、fake UI 测试样本和配置经验可以迁移到 Sensor Core。

## 系统边界

- Bot 运行在游戏 iframe 内，作为 Tampermonkey userscript。
- Bot 不 patch bundle，不直接构造网络包。
- Sensor 只读 UI 和稳定前端运行时对象。
- Executor 的动作必须来自 Planner intent，且动作在白名单内。
- 所有高风险动作先 dry-run，再单独解锁。
- Agent 不持续盯屏，不负责低延迟点击；Agent 负责读日志、调配置和处理暂停决策。
- 日志必须脱敏，不记录完整登录 URL、token、uid 等敏感信息。

## 状态机

### `PAUSED`

手动暂停、人工接管冷却、识别不确定、执行错误或需要 Agent 决策。恢复时不能沿用旧状态，必须进入 `SYNC`。

### `SYNC`

重新扫描当前地图、坐标、自动攻击状态、目标、任务、BOSS 面板、刷新表、每日计数和配置版本。启动、恢复、跨日重置后都必须进入此状态。

### `PLAN`

生成候选任务队列。候选包括重点 BOSS、自动候选 BOSS、勇士任务、固定挂机点。

### `PREPARE_BOSS`

打开 BOSS 面板、切换 tab、确认可进入条件、选择目标。配置目标优先；配置都不可用时，才使用自动候选。

### `TRAVEL_TO_BOSS`

刷新前默认 90 秒开始跑图。试炼之地和福利 BOSS 优先点左侧任务面板；野外 BOSS 可以使用随机传送印章缩短距离。

### `WAIT_SPAWN`

已到目标地图/区域但 BOSS 未刷新。确认地图/区域正确后可以按 Z 进入自动攻击/待战状态，使 BOSS 刷新后自动开打。若地图不对、目标不对或处于人工接管冷却，则不按 Z。

### `ENGAGE`

按 Z 激活或维持自动攻击，定期检查当前目标、归属、伤害、血量、自动攻击状态和地图状态。

### `ABANDON`

确认抢不过、条件不满足、目标错误、动作超时或地图异常时撤退。撤退必须记录原因、证据和置信度。

### `LOOT_OR_VERIFY`

BOSS 死亡后等待短窗口，记录击杀、失败、掉落相关信号和下一次刷新时间。

### `WARRIOR_TASK`

执行勇士任务子流程。每天最多 4 次，按 UTC+8 00:00 重置。

### `FARM_FALLBACK`

没有合适 BOSS、连续抢不到、等待窗口过长或进入冷却时，前往固定挂机点并按 Z。

## 调度规则

- BOSS 爆率循环按 UTC+8 08:00 重置。
- 勇士任务按 UTC+8 00:00 重置。
- 手动配置目标优先，按 `priority`、刷新窗口、每日剩余次数和失败冷却排序。
- 自动候选只在配置目标都不可用时启用，且必须可解释：可进入、等级或优先级较高、置信度达标。
- 默认 `preWaitSeconds = 90`，表示刷新前 90 秒开始行动。
- 勇士任务可穿插执行，但接近重点 BOSS 刷新窗口时必须被 BOSS 抢占。
- 抢不到 BOSS 的冷却由配置控制，例如 `failWindowMinutes` 内 `contestedLost >= N` 后进入 `FARM_FALLBACK`。
- 凌晨人少可以作为策略配置依据，例如降低冷却或提高尝试频率；第一版只记录效果，不自动学习。
- 任一动作执行后必须等待确认条件。确认失败不连续猛点，进入 `PAUSED` 或 `ABANDON`。

## 配置模型

配置保存在页面存储中，建议使用 localStorage 起步，后续如日志量增加再迁移 IndexedDB。

```js
{
  enabled: false,
  dryRun: true,
  timezone: "Asia/Shanghai",
  bossResetHour: 8,
  warriorResetHour: 0,
  defaults: {
    preWaitSeconds: 90,
    engageKey: "KeyZ",
    actionConfirmTimeoutMs: 8000,
    scanIntervalMs: 1000,
    maxConsecutiveContestedLoss: 3,
    contestedCooldownMinutes: 30
  },
  targets: [
    {
      type: "试炼之地",
      name: "邪恶龙虾战士",
      enabled: true,
      priority: 80,
      dailyLimit: 3,
      preWaitSeconds: 90,
      allowAutoCandidateFallback: false,
      abandonPolicy: {
        enabled: true,
        minObserveSeconds: 15,
        minDamageRatio: 0.5
      }
    }
  ],
  fallbackFarmSpots: [
    {
      name: "默认挂机点",
      map: "",
      coordinate: "",
      priority: 10
    }
  ],
  warriorTask: {
    enabled: true,
    dailyLimit: 4,
    interruptibleByBoss: true,
    requiredStar: 3,
    taskType: "BOSS"
  }
}
```

`fallbackFarmSpots` 中的 `map` 和 `coordinate` 必须由用户填入实际挂机地图和坐标；为空时 Planner 不能进入 `FARM_FALLBACK` 自动执行，只能暂停或保持当前安全状态。

## Agent 接口

Bot 暴露：

```js
window.__muBossBot.getStatus()
window.__muBossBot.getConfig()
window.__muBossBot.setConfig(patch)
window.__muBossBot.pause(reason)
window.__muBossBot.resume()
window.__muBossBot.exportLogs()
window.__muBossBot.markManualResult(event)
```

Agent 定期通过 DevTools 调用这些接口，读取状态、查看日志、调整优先级、暂停高峰目标、切换挂机点或处理 `PAUSED_NEEDS_DECISION`。

## 日志模型

日志必须结构化，便于 Agent 判断和后续统计：

```js
{
  at: 1783340000000,
  dayKey: "2026-07-06",
  state: "ENGAGE",
  type: "boss_contested_lost",
  target: { type: "福利BOSS", name: "愤怒闪电巨人" },
  confidence: 0.82,
  evidence: ["owner_not_me", "damage_ratio_0.31"],
  action: "abandon"
}
```

日志类型至少包括：

- `state_transition`
- `intent_planned`
- `action_started`
- `action_confirmed`
- `action_failed`
- `boss_respawn_seen`
- `boss_engaged`
- `boss_killed`
- `boss_contested_lost`
- `warrior_task_accepted`
- `warrior_task_submitted`
- `farm_fallback_started`
- `manual_takeover_detected`
- `paused_needs_decision`

## Sensor Core

Sensor 输出统一快照：

```js
{
  scene: { mapName, coordinates, isMoving, autoBattleState },
  player: { name, levelText, rebirth, combatPower, inventoryHints },
  bossPanel: { open, selectedTab, tabs, rows, requirements, enterButtons },
  leftPanel: { bossEntries, warriorTaskEntries },
  taskPanel: { open, selectedTask, starFilters, acceptButton, submitButton },
  combat: { targetName, targetLevel, hpPercent, ownerName, damageBoard, confidence },
  timers: { knownRespawns, resetTimes },
  confidence: { scene, bossPanel, leftPanel, taskPanel, combat }
}
```

Sensor 来源：

- FairyGUI/UI 扫描：挑战 BOSS 面板、左侧任务、任务面板、血条、伤害榜、刷新时间、勇士任务。
- 稳定运行时对象探针：当前地图、玩家名、坐标、移动状态、当前目标、背包道具数量。

每个探针都必须可失败降级。低置信数据只能用于日志和观察，不能触发高风险动作。

## Executor 白名单

Executor 只接受 Planner intent。第一版动作白名单：

- `openBossPanel()`
- `selectBossTab(type)`
- `enterBossTarget(target)`
- `clickLeftPanelBoss(name)`
- `openTaskPanel()`
- `selectThreeStarBossTask()`
- `acceptWarriorTask()`
- `submitWarriorTask()`
- `useRandomTeleportSeal()`
- `pressAutoAttackZ()`
- `goToFarmSpot(spot)`
- `leaveOrFallback(reason)`
- `pause(reason)`

每个动作都有确认条件：

- 打开面板后必须看到对应面板。
- 切 tab 后必须看到选中 tab 或列表变化。
- 进入地图后必须看到地图或坐标变化。
- 点击左侧 BOSS 后必须看到寻路、地图变化、目标变化或自动攻击状态变化。
- 按 Z 后必须看到自动攻击、目标或战斗状态之一变化；否则只重试有限次数。
- 使用随机传送印章后必须看到坐标变化；否则记录失败，不循环点击。
- 领取/提交勇士任务后必须看到任务状态或完成次数变化。

## 勇士任务子流程

勇士任务不是普通左侧任务点击，必须作为独立子流程：

```text
openTaskPanel
-> selectThreeStarBossTask
-> acceptTask
-> travelOrEngage
-> verifyComplete
-> submitTask
-> repeatUntilDailyLimit
```

约束：

- 只选择三星 BOSS 任务。
- 每天最多 4 次，按 UTC+8 00:00 重置。
- 领取、完成、提交、次数变化都要有 UI 确认。
- 接近重点 BOSS 刷新窗口时，勇士任务可被中断或延后。
- 如果任务面板识别不稳定，进入 `PAUSED_NEEDS_DECISION`，不猜测点击。

## 人工接管

Bot 提供显式暂停/恢复，同时检测人工操作：

- 用户点击、按键、地图变化或非 Bot 发起的 UI 操作可触发人工接管冷却。
- 冷却期间 Bot 不执行新动作，只记录状态。
- 恢复前进入 `SYNC`，重新扫描地图、目标、任务和配置。
- Bot 不能从暂停前的旧 intent 继续执行。

## 分阶段上线

### Phase 0: Sensor Core dry-run

只扫描，不执行。输出快照、置信度和下一步 intent。验证 BOSS 面板、左侧任务、任务面板、战斗归属、地图坐标、自动攻击状态。

### Phase 1: Planner dry-run

启用调度器，但所有动作只写日志。验证每日重置、90 秒提前量、勇士任务穿插、fallback 决策和自动候选目标选择。

### Phase 2: 低风险动作

解锁 `pressAutoAttackZ`、打开面板、切 tab、读取/点击左侧已刷新 BOSS。仍不自动进入高风险地图或提交任务。

### Phase 3: 单目标闭环

只配置 1 个低风险 BOSS，启用进图、等待刷新、按 Z、记录刷新、失败撤退和回挂机点。

### Phase 4: 多目标 + 勇士任务

启用目标优先级、每日次数、凌晨/高峰策略、勇士任务三星 BOSS 领取/提交循环。

## 测试策略

- Node `vm` 单元测试：状态机、Planner 排序、UTC+8 每日重置、失败冷却、配置归一化。
- Fake UI 测试：BOSS 面板、左侧刷新、任务面板三星 BOSS、伤害榜和归属文本。
- Action dry-run 测试：每个 intent 输出动作和确认条件，不触发真实点击。
- 现场验证清单：每个 Executor action 先单独 dry-run，再单独 unlock。
- 回归测试：确保新 Bot 不抢 bundle patch，不影响现有 UI 脚本和 no-autowalk 脚本。

## 未验证风险

- 游戏运行时对象名和结构可能随版本变化。
- FairyGUI 文本节点可能包含图片字、富文本或重复噪音，导致识别置信度不足。
- 伤害榜和归属 UI 未必稳定，撤退策略需要现场校准。
- 随机传送印章可能没有稳定 UI 入口或快捷入口。
- 勇士任务领取/提交流程可能有额外确认弹窗或奖励弹窗。
- 自动攻击按 Z 的状态反馈可能不唯一，需要结合目标、地图和血条确认。
- Tampermonkey 多脚本加载顺序可能影响模块初始化，需要设计等待和重试机制。

## 下一步

设计确认后，进入实现计划阶段。计划应先实现 Sensor Core dry-run 和 Planner dry-run，再逐个解锁 Executor 动作，避免一次性上全自动闭环。
