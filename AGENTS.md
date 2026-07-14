# CLAUDE.md — MU H5 网页游戏 Tampermonkey 脚本开发指南

本目录是一组 Tampermonkey 用户脚本,用于在**客户端**修改 MU(奇迹)H5 网页游戏的 UI 与行为。
修改方式不是改服务器,而是**拦截并替换游戏前端 bundle**,或在运行时 hook 游戏对象。

---

## 1. 目录内容

| 文件 | 作用 |
|---|---|
| `bundle-ce1fb6e83f.js` | 游戏原始前端 bundle(~9.5MB,单行压缩+混淆),**只读参考**,用于定位要 patch 的代码片段。文件名里的 hash 会随游戏版本变化。 |
| `mu-no-autowalk-all.user.js` | 打怪/挂机防自动贴脸移动(合并版)。patch 两处移动逻辑。 |
| `manual-attack-no-autowalk.js` | 旧版,只防手动攻击移动。被上面的合并版取代。 |
| `mu-boss-only-collapsed.user.js` | BOSS 列表相关 UI 脚本。 |
| `camera_zoom.js` | 改相机 `fieldOfView` 实现视角缩放。纯渲染参数,**不碰任何游戏逻辑**。 |
| `mu-boss-four-winds-mvp.user.js` | 四风平原自动打 BOSS 脚本。状态机驱动:扫描 BOSS 面板 → 判定归属 → 导航 → ENGAGE 打 BOSS → HOLD 守点 → 切下一个。运行时 hook FairyGUI 节点,不改 bundle。 |
| `cdp_eval.js` | Chrome DevTools Protocol 远程调试工具。通过 CDP 9222 端口在游戏 iframe 中执行 JS,开发和验证脚本时使用。 |

---

## 2. 游戏运行环境(所有脚本通用)

- 游戏真正跑在 iframe 里,域名 `cdn.qj2h5.jiuxiaokj.cn`,路径含 `/mu2h5/h5-data/mu-release/`。
- 外层壳页是 `602.com/game/show/*`。脚本 `@match` 两者,但**只在游戏 frame 内执行实际逻辑**,靠这个守卫:
  ```js
  function isGameFrame(loc) {
    return loc.hostname === 'cdn.qj2h5.jiuxiaokj.cn'
      && loc.pathname.includes('/mu2h5/h5-data/mu-release/');
  }
  ```
- 游戏引擎是 **Laya**(`Laya.Camera` / `Laya.Point` / `Laya.stage` 等)。
- 统一用 `@grant unsafeWindow` + `@run-at document-start`,通过 `unsafeWindow` 访问页面真实 window。

---

## 3. 核心架构:bundle 拦截替换

改游戏逻辑(而非纯 UI)走这套模式,见 `mu-no-autowalk-all.user.js`:

1. **`document-start` 时 hook `Node.prototype.appendChild`**,拦截 `<script src=".../js/bundle-*.js">` 的插入。
2. 用 `fetch` 把原始 bundle 抓下来,做**字符串精确替换**注入补丁。
3. 把改过的源码包成 `Blob` → `URL.createObjectURL` → 改写 `script.src` 指向 blob,再放行 appendChild。
4. 给 patched script 挂 `onerror` 回退:加载失败就插回原始 src,保证游戏不被脚本搞崩。

关键正则:`/\/js\/bundle-[\w-]+\.js(?:$|\?)/`

### 设计原则(务必遵守)
- **patch 失败必须优雅降级**:找不到目标片段 / fetch 失败 → 加载原始脚本,不能让游戏白屏。
- **幂等**:patch 后的源码里埋一个 marker(如 `window.__MU_NO_AUTOWALK_ALL__`),`patchBundleSource` 先检查 marker,已 patch 就跳过。
- **开关 + 状态**:在 `window.<MARKER>` 上挂 `setEnabled/setDebug/status`,方便控制台调试。状态(enabled/debug)用 `localStorage` 持久化。

---

## 4. ⚠️ 最重要的约束:多脚本不能 patch 同一个 bundle

**两个脚本如果都用 appendChild hook + blob 替换同一个 bundle,会互相覆盖,最终只有一个生效。**
原因:后 hook 的脚本拿到的 `script.src` 已经是前一个生成的 blob URL,不再匹配 bundle 正则。

**规则:所有需要改 bundle 逻辑的补丁,必须合并进同一个脚本里,一次替换完成。**
(纯 UI / 运行时 hook 类脚本,如 `camera_zoom.js` 改 Laya 对象属性,不抢 bundle,不受此限。)

---

## 5. 混淆方案与解码方法

bundle 用了字符串数组混淆 + 数组洗牌,**同一含义的属性在不同函数里用不同的 decoder 别名**,但 key 值相同。

- 解码器:`function _0x2ffe(i)` 返回 `_0x4c5b()[i - 0x100]`。
- 字符串表:`function _0x4c5b()` 返回一个大数组。
- 数组在使用前被一个 rotation IIFE(`(function(a,b){...push(shift())...}(_0x4c5b,0xb9c65))`)旋转过,**必须先执行这个 IIFE 才能正确解码**。

### 解码实操(已验证可用)
用 Python 从 bundle 切出三段源码 → 拼成文件 → node 里 `eval` 执行(含 rotation)→ 调 `_0x2ffe(0xXXXX)`:
```
需要提取: function _0x2ffe(...){...}
          function _0x4c5b(){...大数组...}
          紧跟其后的 rotation IIFE: (function(...){...}(_0x4c5b,0xb9c65))
注意: 切 IIFE 时括号要配平; eval 前用括号计数补足缺失的 ')'。
```
解码混淆 key 时**优先用这个方法拿到真实字段名**,不要靠猜。我之前靠猜把 `releaseDistance` 说成"比施法距离短"是错的。

---

## 6. 已解码的游戏内部知识(行为树 / 战斗逻辑)

挂机由**行为树(behavior tree)**驱动,节点注册在 `this.api['节点名'] = _0x5bb43c[函数]`。已确认的关键节点与字段:

### 行为树节点(类 `_0x5bb43c`)
| 注册名 | 作用 |
|---|---|
| `MoveToTarget` (`btMoveToTarget`) | **挂机移动节点**。打怪和拾取共用它走向 target。 |
| `MoveToTargetEx` (`btMoveToTargetEx`) | 手动攻击触发的移动节点。 |
| `SelectDropItem` (`btSelectDropItem`) | 选掉落物:把 target 换成掉落物,并设 `range=0`。 |
| `PickUp` (`btPickUp`) | 拾取:到位后(原地)发 `PICKUP_DROP_ITEM` 事件,**本身不移动**。 |
| `selectSkill` | 每 tick 选当前要放的技能,并据此**重设 blackboard `range`**。 |

### 距离 / 范围判定(核心)
- blackboard 字段 `range` = 当前选中技能的 `releaseDistance`。
  `getSkillReleaseDistance(skill) = skill.summonId>0 ? 999 : skill.releaseDistance`
- `nearTarget(player, bb)` = `distOf(target.position, player.position) <= bb.range`
- `distOf(a,b)` = `floor( max( abs(a.x-b.x), abs(a.z-b.z) ) )`  → **切比雪夫距离,用实体世界坐标 x/z**。
- **攻击/施法没有独立的"攻击距离"字段**:能不能打 = `nearTarget` 同一套 `range`。
  → 移动判定与施法判定用的是同一个距离,不存在"两个距离不一致"。
- **`range` 会随每 tick 选中的技能变化**(法师多技能轮换时,不同技能 releaseDistance 不同 → range 抖动,可能是挂机"时而贴脸"的根因。releaseDistance 是服务器配置,bundle 里查不到,需运行时验证)。

### 移动函数
- `moveToTile(self, point, range)`(混淆 key `0x12e4`):真正发起移动。全 bundle **3 个调用点**:
  1. `btMoveToTargetEx` 内(手动攻击,用 `range`)
  2. `btMoveToTarget` 内(挂机打怪/拾取,用 `range`)← 拾取时 range=0
  3. 回城/返回出生点逻辑(`ReturnTime`/`nextReturnHomeTime`,与战斗无关)

### 拾取的关键事实
- 拾取移动复用 `MoveToTarget` 节点,但 `btSelectDropItem` 会把 `range` 强制设为 **0**。
- 因此可用 **`range > 0` 判定"正在打怪"、`range == 0` 判定"正在拾取"**。
  打怪时 range 是技能射程恒 > 0,绝不为 0,这个判别可靠。
- 共享掉落需移动拾取;非共享掉落走游戏自带的一键范围拾取(原地,不走 `MoveToTarget`)。

---

## 7. 现有 no-autowalk 补丁怎么改的(参考实现)

`mu-no-autowalk-all.user.js` 改两处:
- **Patch 1**(`btMoveToTargetEx` 的超范围 else 分支):站桩开启时直接 `setStatus(FAILED); return`,不移动。
- **Patch 2**(`btMoveToTarget` 里的 `moveToTile` 赋值):
  ```js
  _0x2cfbf0 = (range > 0 && shouldBlock())
                ? (notify('auto'), true)      // 跳过移动,且强制置 true = "已到位"
                : moveToTile(self, point, range);
  ```
  - **强制置 `true` 是关键**:下游有 `if(!_0x2cfbf0) return ...丢目标...`,若只是不调用 move 会清掉攻击目标导致站着发呆。置 true 让行为树继续走到施法判定 → 原地施法。
  - **`range > 0` 守卫**:只拦打怪移动,放行拾取移动(range==0),保证捡得到东西。

---

## 8. 修改 bundle 补丁的验证流程(必做)

改 bundle patch 片段后,**务必**:

1. **唯一性检查**:目标片段(`TARGET`)在 bundle 中 `count == 1`。多于 1 或等于 0 都说明片段选错/游戏版本变了。
2. **应用替换 + 语法检查**:把 patch 套到 bundle 副本上,`node --check` 通过(替换不能破坏 JS 结构)。
3. **userscript 自身** `node --check` 通过。
4. patch 字符串里的混淆变量别名(如 `_0x569830` / `_0x1233a6`)是**该函数局部的 decoder 别名**,必须和目标片段所在函数一致,否则注入的代码引用错变量。

游戏版本升级 → bundle hash 和混淆别名都会变 → 需重新提取片段、重新对齐别名。补丁要对"片段找不到"有降级处理。

---

## 9. 通用约定

- 中文回复;对需求和我的判断保持质疑,不确定的地方明确标注"推断 / 未验证"。
- 不靠猜混淆字段含义,用第 5 节的解码方法拿真名。
- 任何 bundle patch 都要保证**失败可降级**,绝不让游戏崩。
- 新增"改游戏逻辑"的功能 → 合并进已有的 bundle-patch 脚本,不要新开会抢 bundle 的脚本(见第 4 节)。
- **单面板约束(极其重要)**:游戏每次只允许同时打开一个面板(挑战 BOSS、大地图、勇士任务等)。在打开任何新面板之前,**必须先检查并关闭当前已打开的面板**(如果有),否则按钮被隐藏、点击无效,脚本会卡死。所有涉及面板操作的状态机都要遵守"先关再开"的原则。
- **面板操作异步等待(通用约束)**:游戏所有 UI 面板的打开和关闭都是**异步**的——点击按钮(如"挑战 BOSS"按钮、面板关闭按钮、试炼之地退出按钮等)后,面板不会在同一 tick 内立即出现或消失。如果在点击后的下一个 tick 立即检测面板状态并继续操作,失败率极高(面板可能还没弹出,或者还没关闭完成,导致按钮找不到、状态判断错误、状态机卡死)。所有涉及面板操作的状态机必须采用 **`waiting_for_open` / `waiting_for_close` 中间阶段**:点击按钮后先进入等待阶段,下一 tick 检测面板是否已到达目标状态(已开或已关),确认后才跳到下一步;超时(建议 3 秒)则回退重试。不要在点击的同一 case 里直接跳到下一个操作阶段。同理,关闭面板后也要等待面板真正关闭再继续(参考 `executeCheckRate` 的 `closing_map` 阶段:先检测 `mapPanel.open` 是否已变为 false,没关才点关闭按钮)。
- **Bug 修复流程(必须遵守)**:修复任何 bug 时,先根据现象分析 root cause 并等待用户确认,再列出修复方案并等待用户确认,最后才开始修改代码。不要跳过确认环节直接改代码。

---

## 10. Chrome 远程调试(CDP 9222)开发模式

开发和验证脚本时,**始终通过 Chrome Remote Debugging Port 9222 获取游戏页面信息和操控页面**,不需要手动在浏览器控制台操作。Shell 沙箱默认禁止网络访问,执行 CDP 命令时需用 `sandbox_permissions: "require_escalated"` 绕过。

### 启动与连接

- Chrome 以 `--remote-debugging-port=9222` 启动后,`http://localhost:9222/json` 返回所有页面/iframe target 列表。
- 游戏 iframe 的 URL 包含 `jiuxiaokj.cn`,通过 `type=iframe` 筛选。
- 用 WebSocket 连接 target 的 `webSocketDebuggerUrl`,发送 `Runtime.evaluate` 方法可在游戏 iframe 上下文中执行任意 JS。

### cdp_eval.js 用法

仓库中 `cdp_eval.js` 封装了上述流程:

```bash
# 自动找到游戏 iframe 并执行表达式
node cdp_eval.js auto "<expr>"

# 示例:读取当前 BOSS 面板内容
node cdp_eval.js auto "document.title"

# 示例:检查脚本是否已加载
node cdp_eval.js auto "typeof window.__muFourWindsBossMvp"
```

### 热更新脚本(不刷新页面)

通过 CDP 注入更新脚本,无需刷新游戏页面:

```js
delete window.__muFourWindsBossMvp;  // 清除旧实例
// 然后把脚本全文作为表达式注入
```

### 四风平原 BOSS MVP 开发踩坑总结

以下问题在开发 `mu-boss-four-winds-mvp.user.js` 时遇到过,记录在此避免重蹈覆辙:

**FairyGUI 节点扫描**
- FairyGUI 富文本用 `[color=#FF2323]...[/color]` 方括号标签,不是 HTML 的 `<font>` 或尖括号标签。`cleanText` 必须同时处理 `<[^>]+>`、`\[\/?[^\]]*\]` 以及 HTML 实体 `&[a-z]+;`,否则 BOSS 名字、归属等字段会带标签残留导致匹配失败。
- BOSS 面板结构:`bossSelectUI[2]/view[0]/nameText[13]` 是 BOSS 名字+归属节点,`percentText[12]` 是 HP 百分比节点,两者是同级兄弟。HP 不在 nameText 的 text 里,必须单独查找 `percentText` 节点。
- 归属信息格式是 `Lv1500 狂暴傲之煞  普尔赫达`,归属名直接跟在 BOSS 名字后面,没有"归属:"前缀。解析时去掉 `Lv\d+` 和 BOSS 名字后剩余部分即为归属。
- 挂机状态检测:`autoFightDataTip` 下 `dataList[0]` 的 `AutoStatusItem` 子项计数 > 0 表示挂机已激活。移动中 AutoStatusItem 可能短暂消失,导致 `enabled` 闪烁为 false。

**导航与到达判定**
- 游戏寻路只到最近可行走格子,不会精确到达目标坐标。目标 `82,88`,角色可能到 `83,88`(差 1 格)。`isAtTarget` 必须用切比雪夫距离 ≤ 阈值(3 格),不能用精确坐标匹配。
- 地图面板打开时角色坐标不可见(被面板遮挡),必须先关地图才能读到坐标。
- 点击大地图右栏图标后角色自动寻路,**到达后游戏内置机制会自动开启 farming**,脚本不需要也不应该发 Z 键。Z 键是 toggle,如果每 tick 发送会反复开关挂机。
- 关闭地图按钮点击后地图关闭是异步的,下一 tick 地图可能还开着。需要 `closeClicked` 标记防止重复点击关闭按钮。
- farming 导航没有固定坐标,不能用 `isAtTarget` 判断到达。改为检测坐标稳定 5 秒判定到达。否则 stall 超时会触发重试 → 重新开地图 → 关地图 → 循环开关地图。

**状态机与目标锁定**
- `isLockingIntent()` 必须包含 `engage` 和 `observe_owner`,否则战斗中每 tick 会重新选目标,其他 `READY_UNKNOWN_TIMER` 的 BOSS 会打断当前战斗导致中途离开。
- ENGAGE 期间不应被其他可见 BOSS 打断(plan 规定只有守点状态可被打断)。
- `isLockTargetEligible` 的 `allowedStatuses` 不包含 `WAITING_REFRESH`,如果在战斗中 overlay 更新了刷新时间导致状态变化,会释放锁定。ENGAGE 期间应放宽状态检查,只看 `isCooling`。
- 日志缓冲区(200 条)容易被高频事件(如 `key_z_sent`、`map_closed`)填满,把关键日志挤掉。应避免每 tick 产生日志,或增大缓冲区。
