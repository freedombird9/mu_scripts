# 首饰BOSS副本（幻术秘境4）接入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `mu-boss-multi-map-mvp.user.js` 中新增 accessory（首饰BOSS / 幻术秘境4）副本模块，支持"卓越之境"中间弹窗确认流程，优先级 40（最高），爆率检查纳入，默认启用，版本号升到 0.2.0。

**Architecture:** 沿用现有 `MAP_MODULES` 可插拔架构新增 `accessoryModule`；在 `executeEnterInstance` 状态机的 `click_enter → waiting` 之间条件性插入 `waiting_for_intermediate` / `click_popup_enter` 两个新阶段，由 `module.hasIntermediatePopup` 标志位触发，不影响 purgatory/trial_land。新增辅助函数 `findIntermediatePopup` / `findPopupEnterButton` 用宽松兜底匹配，CDP 探查后回填精确节点条件。

**Tech Stack:** Tampermonkey UserScript（注入到 MU H5 游戏 iframe），FairyGUI + Laya 引擎，Chrome DevTools Protocol 9222 远程调试。无单测框架，用 `node --check` 语法检查 + CDP 实地验证替代 TDD。

**Spec:** `docs/superpowers/specs/2026-07-17-accessory-boss-instance-design.md`

---

## 文件结构

只改 1 个文件：
- **Modify**：`/Users/user/mu_scripts/mu-boss-multi-map-mvp.user.js`

模块定义/CONFIG_DEFAULTS/KNOWN_MAP_NAMES/RATE_CHECK/executeEnterInstance/辅助函数全部在这一个文件里。版本号 metadata 也在同文件顶部。

### 实现顺序

任务 1-7：纯代码改动（不依赖 CDP）
任务 8：`node --check` 整体语法校验 + 版本号升级 + commit
任务 9：CDP 探查 7 项，回填 TODO
任务 10：CDP 验证 + commit

---

## Task 1: 加 accessoryModule 模块定义 + 追加 MAP_MODULES

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js:106-108`（在第 106 行 `purgatoryModule` 定义结束的 `});` 之后、第 108 行 `MAP_MODULES` 数组之前插入 accessoryModule 定义）
- Modify: `mu-boss-multi-map-mvp.user.js:108`（`MAP_MODULES` 数组追加 `accessoryModule`）

- [ ] **Step 1: 在 purgatoryModule 定义之后追加 accessoryModule**

定位 `purgatoryModule` 定义结束的位置（第 106 行 `});` 之后），插入新模块定义：

```js
    const accessoryModule = Object.freeze({
      id: 'accessory',
      mapName: '幻术秘境4',
      type: 'instance',
      priority: 40,
      enabled: true,
      farmTarget: null,
      bossRowTab: '首饰BOSS',
      // TODO CDP 验证:首饰BOSS tab 下 BOSS 行 scroll 容器名(占位与 purgatory 一致)
      bossRowScroll: 'wildlevelScroll',
      enterButtonTog: 'wildtog_mapName',
      enterButtonTextRegex: /^幻术秘境4/,
      hasTaskbar: false,
      hasIntermediatePopup: true,
      intermediatePopupTitle: '卓越之境',         // TODO CDP 验证弹窗标题
      intermediatePopupButtonText: '进入',       // TODO CDP 验证按钮文字
      bosses: [
        // TODO CDP 探查幽灵巨人 BOSS 坐标后回填 coordinate
        { id: 'phantom-giant', name: '幽灵巨人', coordinate: 'TBD' },
      ],
    });
```

- [ ] **Step 2: 修改 MAP_MODULES 数组**

第 108 行：
```js
const MAP_MODULES = [fourWindsModule, trialLandModule, purgatoryModule];
```
改为：
```js
const MAP_MODULES = [fourWindsModule, trialLandModule, purgatoryModule, accessoryModule];
```

- [ ] **Step 3: 语法检查**

Run: `node --check mu-boss-multi-map-mvp.user.js`
Expected: 无输出（通过）

---

## Task 2: 修改 CONFIG_DEFAULTS 启用 accessory

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js:42-44`（`enabledMaps` / `mapPriorities` / `enabledBosses` 三行）

- [ ] **Step 1: 替换 enabledMaps / mapPriorities / enabledBosses 三行**

第 42-44 行：
```js
      enabledMaps: ['four_winds', 'trial_land', 'purgatory'],
      mapPriorities: { four_winds: 10, trial_land: 20, purgatory: 30 },
      enabledBosses: ['ao-left','ao-right','angry-ao','rage-ao','lobster-1','lobster-2','lobster-3','magic-crystal'],
```
改为：
```js
      enabledMaps: ['four_winds', 'trial_land', 'purgatory', 'accessory'],
      mapPriorities: { four_winds: 10, trial_land: 20, purgatory: 30, accessory: 40 },
      enabledBosses: ['ao-left','ao-right','angry-ao','rage-ao','lobster-1','lobster-2','lobster-3','magic-crystal','phantom-giant'],
```

- [ ] **Step 2: 语法检查**

Run: `node --check mu-boss-multi-map-mvp.user.js`
Expected: 通过

注：`normalizeMapPriorities`（第 444-452 行）已通过循环 `MAP_MODULES` 自动覆盖 accessory，无需改动。

---

## Task 3: KNOWN_MAP_NAMES 追加 幻术秘境4

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js:29`

- [ ] **Step 1: 追加地图名**

第 29 行：
```js
    const KNOWN_MAP_NAMES = ['四风平原', '试炼之地1', '苦难炼狱2', '勇者大陆'];
```
改为：
```js
    const KNOWN_MAP_NAMES = ['四风平原', '试炼之地1', '苦难炼狱2', '勇者大陆', '幻术秘境4'];
```

- [ ] **Step 2: 语法检查**

Run: `node --check mu-boss-multi-map-mvp.user.js`
Expected: 通过

---

## Task 4: 加 ACCESSORY_RATE_CHECK_ENABLED 常量 + rebuildRateCheckMaps 追加分支

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js:164-184`（常量声明区 + `rebuildRateCheckMaps` 函数）

- [ ] **Step 1: 在 PURGATORY_RATE_CHECK_ENABLED 之后加 ACCESSORY_RATE_CHECK_ENABLED**

第 166 行 `const PURGATORY_RATE_CHECK_ENABLED = true;` 之后插入一行：
```js
    const PURGATORY_RATE_CHECK_ENABLED = true;
    const ACCESSORY_RATE_CHECK_ENABLED = true;
```

- [ ] **Step 2: 在 rebuildRateCheckMaps 的 purgatory 跳过判断之后加 accessory 跳过判断**

第 176 行：
```js
        if (module.id === 'purgatory' && !PURGATORY_RATE_CHECK_ENABLED) continue;
```
之后插入一行：
```js
        if (module.id === 'purgatory' && !PURGATORY_RATE_CHECK_ENABLED) continue;
        if (module.id === 'accessory' && !ACCESSORY_RATE_CHECK_ENABLED) continue;
```

- [ ] **Step 3: 语法检查**

Run: `node --check mu-boss-multi-map-mvp.user.js`
Expected: 通过

注：`rebuildRateCheckMaps` 主体循环（第 177-182 行）已通过 `MAP_MODULES` 遍历自动为 accessory 生成 `RATE_CHECK_MAPS['幻术秘境4']` 条目，`tab:'首饰BOSS'`、`bossNames:['幽灵巨人']`、`mapMatch:'幻术秘境'`、`moduleId:'accessory'`。`executeCheckRate` 状态机数据驱动，无需改动。

---

## Task 5: state.enterInstanceCtx 追加 retried 字段

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js:2351-2357`（`state.enterInstanceCtx` 初始化处）

- [ ] **Step 1: 在 ctx 初始化对象末尾加 retried: false**

第 2351-2357 行：
```js
        state.enterInstanceCtx = {
          moduleId: targetModule.id,
          phase: 'closing_panels',
          startedAt: now,
          selectedBossId: state.currentTargetId || null,
          lastActionAt: 0,
        };
```
改为：
```js
        state.enterInstanceCtx = {
          moduleId: targetModule.id,
          phase: 'closing_panels',
          startedAt: now,
          selectedBossId: state.currentTargetId || null,
          lastActionAt: 0,
          retried: false,
        };
```

- [ ] **Step 2: 语法检查**

Run: `node --check mu-boss-multi-map-mvp.user.js`
Expected: 通过

---

## Task 6: 新增辅助函数 findIntermediatePopup / findPopupEnterButton

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js`（在 `executeEnterInstance` 函数定义之前插入两个辅助函数。推荐位置：`closePanelIfExists`（第 1746 行）与 `closeMapPanel`（第 1796 行）之间的辅助函数区，或 `executeEnterInstance` 之前任意位置）

- [ ] **Step 1: 在 executeEnterInstance 之前插入两个辅助函数**

定位第 2332 行注释 `// --- enter_instance / exit_instance / teleport_to_module (Task 7) ---`，在其**之后**、`function executeEnterInstance` 之前插入：

```js
    // --- Intermediate popup helpers (accessory module) ---
    // CDP 探查前用宽松匹配:在 gRoot 全树找含 module.intermediatePopupTitle 文本的弹窗节点。
    // CDP 探查后回填精确 name/packageName 匹配条件(替换宽松匹配)。
    function findIntermediatePopup(nodes, module) {
      if (!nodes || !module || !module.intermediatePopupTitle) return null;
      const title = module.intermediatePopupTitle;
      // 精确匹配优先(CDP 探查后填):name/packageName/packageOwner 包含 '卓越之境' 或指定值
      const exact = nodes.find((item) => item.effectiveVisible
        && (item.name === title || item.packageName === title || item.packageOwner === title));
      if (exact) return exact;
      // 兜底:AlertWnd 或类似弹窗,且 contentText/text 含标题文本
      const fallback = nodes.find((item) => item.effectiveVisible
        && (item.name === 'AlertWnd' || /Alert|Popup|Tip|Wnd/i.test(item.name || ''))
        && (cleanText(item.text).includes(title) || cleanText(item.contentText).includes(title)));
      return fallback || null;
    }

    // CDP 探查前用宽松匹配:在弹窗户子树找 text 含 module.intermediatePopupButtonText 的可点击节点。
    // CDP 探查后回填精确 name 匹配条件。
    function findPopupEnterButton(popupChildren, module) {
      if (!popupChildren || !module || !module.intermediatePopupButtonText) return null;
      const buttonText = module.intermediatePopupButtonText;
      // 兜底:text/contentText 含按钮文字且可点击(常见按钮名:btn_ok/btn_enter/btnSure/btnOk)
      const candidate = popupChildren.find((item) => item.effectiveVisible
        && (cleanText(item.text).includes(buttonText) || cleanText(item.contentText).includes(buttonText))
        && /^(btn|button)/i.test(item.name || ''));
      return candidate || null;
    }

```

- [ ] **Step 2: 语法检查**

Run: `node --check mu-boss-multi-map-mvp.user.js`
Expected: 通过

---

## Task 7: executeEnterInstance 加 waiting_for_intermediate / click_popup_enter 两阶段 + click_enter 分支

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js:2516`（`click_enter` 末尾 `ctx.phase = 'waiting';` 改为分支）
- Modify: `mu-boss-multi-map-mvp.user.js:2518-2536`（在 `case 'click_enter'` 与 `case 'waiting'` 之间插入两个新 case）

- [ ] **Step 1: 修改 click_enter 末尾的 phase 赋值**

第 2514-2517 行：
```js
          ctx.lastActionAt = now;
          appendLog('enter_instance_clicked_enter', { text: enterBtn.text, method: action.method });
          ctx.phase = 'waiting';
          return { ok: true, method: action.method, reason: 'enter_clicked' };
```
改为：
```js
          ctx.lastActionAt = now;
          appendLog('enter_instance_clicked_enter', { text: enterBtn.text, method: action.method });
          ctx.phase = currentModule.hasIntermediatePopup ? 'waiting_for_intermediate' : 'waiting';
          return { ok: true, method: action.method, reason: 'enter_clicked' };
```

- [ ] **Step 2: 在 click_enter case 结束后、waiting case 之前插入两个新 case**

定位第 2518 行 `case 'waiting': {`，在其**之前**插入：

```js
        case 'waiting_for_intermediate': {
          const sceneMap = (snapshot.scene || {}).mapName || '';
          if (!sceneMap) return { ok: true, reason: 'waiting_for_teleport' };
          const gRoot = root();
          const allNodes = gRoot ? collectNodes(gRoot) : [];
          const popup = findIntermediatePopup(allNodes, currentModule);
          if (!popup) {
            if (now - ctx.lastActionAt > 10 * 1000) {
              if (!ctx.retried) {
                ctx.retried = true;
                ctx.phase = 'click_enter';
                ctx.lastActionAt = 0;  // 让下一 tick 节流通过后重新点 enter
                appendLog('intermediate_popup_timeout_retry', { moduleId: currentModule.id });
                return { ok: true, reason: 'retry_click_enter' };
              }
              appendLog('intermediate_popup_failed', { moduleId: currentModule.id });
              closePanelIfExists('Instance_BossUI');
              state.enterInstanceCtx = null;
              releaseLockedTarget();
              return { ok: false, reason: 'intermediate_popup_timeout' };
            }
            return { ok: true, reason: 'waiting_for_popup' };
          }
          ctx.phase = 'click_popup_enter';
          // lastActionAt 不重置:click_popup_enter 内 5s 超时基准沿用本时刻
          appendLog('intermediate_popup_appeared', { moduleId: currentModule.id });
          return { ok: true, reason: 'popup_detected' };
        }

        case 'click_popup_enter': {
          const gRoot = root();
          const allNodes = gRoot ? collectNodes(gRoot) : [];
          const popup = findIntermediatePopup(allNodes, currentModule);
          if (!popup) {
            // 弹窗消失(可能已被自动点击或加载抖动)
            ctx.phase = 'waiting_for_intermediate';
            ctx.lastActionAt = now;
            appendLog('popup_vanished_back_to_wait', { moduleId: currentModule.id });
            return { ok: true, reason: 'popup_vanished_back_to_wait' };
          }
          const popupChildren = descendantsOf(allNodes, popup).filter((item) => item.path !== popup.path);
          const btnNode = findPopupEnterButton(popupChildren, currentModule);
          if (!btnNode) {
            if (now - ctx.lastActionAt > 5 * 1000) {
              ctx.phase = 'waiting_for_intermediate';
              ctx.lastActionAt = now;
              appendLog('popup_enter_button_not_found_retry', { moduleId: currentModule.id });
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
          appendLog('enter_instance_clicked_popup_enter', { method: action.method, moduleId: currentModule.id });
          return { ok: true, method: action.method, reason: 'popup_enter_clicked' };
        }

```

- [ ] **Step 3: 语法检查**

Run: `node --check mu-boss-multi-map-mvp.user.js`
Expected: 通过

---

## Task 8: 升级版本号 + commit

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js:4`（`@version` 行）

- [ ] **Step 1: 升级 @version**

第 4 行：
```js
// @version      0.1.0
```
改为：
```js
// @version      0.2.0
```

- [ ] **Step 2: 整体语法检查**

Run: `node --check mu-boss-multi-map-mvp.user.js`
Expected: 通过

- [ ] **Step 3: 提交代码框架**

Run:
```bash
git add mu-boss-multi-map-mvp.user.js
git commit -m "$(cat <<'EOF'
feat(multi-map-boss): add accessory boss instance (幻术秘境4) skeleton

新增 accessoryModule 模块定义(优先级 40,最高),默认启用,
纳入爆率检查。executeEnterInstance 状态机加 waiting_for_intermediate
/ click_popup_enter 两阶段处理"卓越之境"中间弹窗,由 module
.hasIntermediatePopup 标志位触发,不影响 purgatory/trial_land。
坐标/弹窗节点匹配条件待 CDP 探查后回填。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```
Expected: 1 file changed

---

## Task 9: CDP 探查 7 项 + 回填 TODO

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js`（根据探查结果回填 Task 1 / Task 6 的 TODO 占位）

**前置条件:**
- Chrome 已以 `--remote-debugging-port=9222` 启动
- 已登录游戏,角色在野外或城镇可打开挑战 BOSS 面板
- `cdp_eval.js` 在仓库根目录

- [ ] **Step 1: 探查项 1 - 首饰BOSS tab 下 BOSS 行 scroll 容器名**

在 Chrome 中手动打开挑战 BOSS 面板，选中"首饰BOSS"tab。

Run:
```bash
node cdp_eval.js auto "JSON.stringify((function(){var g=window.fgui.GRoot.inst;var nodes=[];function walk(n,d){if(!n||d>18)return;var cn=Number(n.numChildren)||0;for(var i=0;i<cn;i++){var c=n.getChildAt(i);nodes.push({name:c.name,pkg:(c.packageItem&&c.packageItem.name)||'',path:(n.name||'')+'/'+c.name+'['+i+']'});walk(c,d+1);}}walk(g,0);return nodes.filter(function(n){return n.name==='BtnBoss'||/Scroll$/.test(n.name);}).slice(0,20);})())"
```
Expected: JSON 数组，含 BOSS 行路径（如 `xxx/wildlevelScroll[0]/BtnBoss[3]`）和 scroll 容器名

记录 scroll 容器名（路径中 BtnBoss 之前的 `xxxScroll`），更新 `accessoryModule.bossRowScroll`。

- [ ] **Step 2: 探查项 2 - 幻术秘境4 进入按钮文本格式**

仍在"首饰BOSS"tab，选中"幽灵巨人"BOSS 行后，观察底部进入按钮。

Run:
```bash
node cdp_eval.js auto "JSON.stringify((function(){var g=window.fgui.GRoot.inst;var nodes=[];function walk(n,d){if(!n||d>18)return;var cn=Number(n.numChildren)||0;for(var i=0;i<cn;i++){var c=n.getChildAt(i);nodes.push({name:c.name,text:String(c.text||c.title||''),pkg:(c.packageItem&&c.packageItem.name)||''});walk(c,d+1);}}walk(g,0);return nodes.filter(function(n){return n.pkg==='BtnBossMore'||/tog_mapName/.test(n.name||'');}).map(function(n){return n.text;});})())"
```
Expected: JSON 数组，含进入按钮文本（如 `"幻术秘境4 (149,101)"`）

验证 `enterButtonTextRegex=/^幻术秘境4/` 是否匹配；如文本带"4"以外的数字后缀（如 `幻术秘境4层`），需调整 regex。

- [ ] **Step 3: 探查项 3 + 7 - 进入副本后的地图名 + 幽灵巨人坐标**

在游戏中手动走完整流程（点进入按钮 → 中间地图 → 点弹窗"进入" → 到幻术秘境4），到达后角色跑到 BOSS 旁。

Run:
```bash
node cdp_eval.js auto "JSON.stringify((function(){var g=window.fgui.GRoot.inst;var nodes=[];function walk(n,d){if(!n||d>18)return;var cn=Number(n.numChildren)||0;for(var i=0;i<cn;i++){var c=n.getChildAt(i);nodes.push({name:c.name,text:String(c.text||c.title||'')});walk(c,d+1);}}walk(g,0);return {mapName:(nodes.find(function(n){return n.name==='mapName';})||{}).text,coord:(nodes.find(function(n){return /^\(?[0-9]{1,3},[0-9]{1,3}\)?$/.test((n.text||'').replace(/坐标[:：]?\s*/,''));})||{}).text};})())"
```
Expected: JSON 含 `{"mapName":"幻术秘境4","coord":"149,101"}`

- 验证 `accessoryModule.mapName='幻术秘境4'` 正确
- 用 coord 值回填 `phantom-giant` 的 `coordinate`（去掉括号空格）

- [ ] **Step 4: 探查项 4 + 5 - 中间地图名 + "卓越之境"弹窗节点结构**

在中间地图时（点进入按钮后、点弹窗"进入"按钮前），快速执行：

Run:
```bash
node cdp_eval.js auto "JSON.stringify((function(){var g=window.fgui.GRoot.inst;var nodes=[];function walk(n,d,p){if(!n||d>18)return;var cn=Number(n.numChildren)||0;for(var i=0;i<cn;i++){var c=n.getChildAt(i);nodes.push({name:c.name,text:String(c.text||c.title||''),pkg:(c.packageItem&&c.packageItem.name)||'',owner:(c.packageItem&&c.packageItem.owner&&c.packageItem.owner.name)||'',path:p+'/'+c.name+'['+i+']'});walk(c,d+1,path);}var path='';walk(g,0,path);return {mapName:(nodes.find(function(n){return n.name==='mapName';})||{}).text,popupCandidates:nodes.filter(function(n){return /卓越之境/.test(n.text)||/Alert|Popup|Tip|Wnd/.test(n.name||'');}).slice(0,10)};})())"
```
Expected: JSON 含中间地图 `mapName` 和弹窗候选节点列表（含 name/pkg/owner/path/text）

记录：
- 中间地图 `mapName` 值（用于确认非空）
- "卓越之境"弹窗的 `name` / `pkg` / `owner` 三者中匹配最稳的一个，用于 `findIntermediatePopup` 精确匹配条件

- [ ] **Step 5: 探查项 6 - 弹窗内"进入"按钮节点结构**

仍在中间地图弹窗打开时，针对上一步找到的弹窗节点 path 扫其子树：

Run（把 `<POPUP_PATH>` 替换为上一步记录的弹窗 path）:
```bash
node cdp_eval.js auto "JSON.stringify((function(){var g=window.fgui.GRoot.inst;var allNodes=[];function walk(n,d,p){if(!n||d>18)return;var cn=Number(n.numChildren)||0;for(var i=0;i<cn;i++){var c=n.getChildAt(i);allNodes.push({name:c.name,text:String(c.text||c.title||''),path:p+'/'+c.name+'['+i+']'});walk(c,d+1,allNodes[allNodes.length-1].path);}walk(g,0,'');var popup=allNodes.filter(function(n){return /卓越之境/.test(n.text);})[0];if(!popup)return null;var popupPath=popup.path.split('/').slice(0,-1).join('/');return allNodes.filter(function(n){return n.path.startsWith(popupPath+'/')&&/进入/.test(n.text);}).slice(0,10);})()"
```
Expected: JSON 数组，含按钮节点 name 和 path（如 `{"name":"btn_ok","text":"进入","path":"..."}`）

记录按钮 `name`，用于 `findPopupEnterButton` 精确匹配。

- [ ] **Step 6: 回填 accessoryModule.bossRowScroll**

用 Step 1 探查结果更新 Task 1 Step 1 中的 `bossRowScroll` 值。

把探查到的 scroll 容器名记为 `<SCROLL_NAME>`（如 `'privatelevelScroll'` 或 `'wildlevelScroll'`）。

Edit `mu-boss-multi-map-mvp.user.js` 中 Task 1 Step 1 插入的 accessoryModule 的这一行：
```js
      bossRowScroll: 'wildlevelScroll',
```
改为：
```js
      bossRowScroll: '<SCROLL_NAME>',
```
（把 `<SCROLL_NAME>` 替换为探查到的实际值）

- [ ] **Step 7: 回填 accessoryModule.intermediatePopupTitle 精确匹配条件**

把探查到的弹窗稳定标识（优先 packageName，其次 name，最后 owner）记为 `<POPUP_IDENTIFIER>`。如 packageName='XYZWnd'。

如探查发现弹窗 `name` 就是 `'卓越之境'`，无需改 `intermediatePopupTitle`，且 `findIntermediatePopup` 的精确匹配分支已能命中（`item.name === title`）。

否则（packageName 更稳定），更新 Task 6 Step 1 中的 `findIntermediatePopup` 精确匹配分支：

```js
      const exact = nodes.find((item) => item.effectiveVisible
        && (item.name === title || item.packageName === title || item.packageOwner === title));
```
改为（用 packageName 精确匹配，把 title 用作文本兜底）:
```js
      const exact = nodes.find((item) => item.effectiveVisible
        && (item.packageName === '<POPUP_IDENTIFIER>' || item.name === title || item.packageOwner === title));
```
（把 `<POPUP_IDENTIFIER>` 替换为探查到的 packageName 实际值）

- [ ] **Step 8: 回填 findPopupEnterButton 精确匹配条件**

把探查到的按钮 name 记为 `<ENTER_BTN_NAME>`（如 `'btnEnter'` / `'btn_ok'`）。

Edit Task 6 Step 1 中的 `findPopupEnterButton`：
```js
      const candidate = popupChildren.find((item) => item.effectiveVisible
        && (cleanText(item.text).includes(buttonText) || cleanText(item.contentText).includes(buttonText))
        && /^(btn|button)/i.test(item.name || ''));
```
改为（精确 name 优先 + 兜底）:
```js
      const candidate = popupChildren.find((item) => item.effectiveVisible
        && (item.name === '<ENTER_BTN_NAME>'
          || ((cleanText(item.text).includes(buttonText) || cleanText(item.contentText).includes(buttonText))
              && /^(btn|button)/i.test(item.name || ''))));
```
（把 `<ENTER_BTN_NAME>` 替换为探查到的按钮 name 实际值）

- [ ] **Step 9: 回填 phantom-giant coordinate**

把 Step 3 探查到的坐标记为 `<BOSS_COORD>`（如 `'149,101'`，去掉括号和空格，保留 `x,y` 格式）。

Edit Task 1 Step 1 中的 `coordinate` 字段：
```js
        { id: 'phantom-giant', name: '幽灵巨人', coordinate: 'TBD' },
```
改为：
```js
        { id: 'phantom-giant', name: '幽灵巨人', coordinate: '<BOSS_COORD>' },
```
（把 `<BOSS_COORD>` 替换为探查到的坐标）

- [ ] **Step 10: 语法检查**

Run: `node --check mu-boss-multi-map-mvp.user.js`
Expected: 通过

- [ ] **Step 11: 提交 CDP 回填**

Run:
```bash
git add mu-boss-multi-map-mvp.user.js
git commit -m "$(cat <<'EOF'
fix(multi-map-boss): backfill accessory instance CDP-verified values

回填 幻术秘境4 BOSS 行 scroll 容器名、幽灵巨人坐标、"卓越之境"
弹窗精确匹配条件、弹窗内"进入"按钮精确 name。基于 CDP 实测。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```
Expected: 1 file changed

---

## Task 10: CDP 实地验证完整流程

**前置条件:**
- Task 9 全部完成，TODO 全部回填
- Chrome 已登录游戏，角色在野外
- `mu-boss-multi-map-mvp.user.js` 已通过 Tampermonkey 加载（或通过 `cdp_inject.js` 热注入）

- [ ] **Step 1: 启用脚本**

Run:
```bash
node cdp_eval.js auto "window.__muMultiMapBossMvp && window.__muMultiMapBossMvp.start() && JSON.stringify(window.__muMultiMapBossMvp.status().enabled)"
```
Expected: `true`

- [ ] **Step 2: 验证 accessory 模块默认启用**

Run:
```bash
node cdp_eval.js auto "JSON.stringify(window.__muMultiMapBossMvp.status().config.enabledMaps)"
```
Expected: 含 `'accessory'`

- [ ] **Step 3: 观察 chooseIntent 是否优先选 enter_instance（accessory）**

观察脚本日志：

Run:
```bash
node cdp_eval.js auto "JSON.stringify(window.__muMultiMapBossMvp.status().logs.slice(-30).map(function(l){return l.type+':'+JSON.stringify(l.details);}))"
```
Expected: 含 `enter_instance_start` 日志，`moduleId:'accessory'`

- [ ] **Step 4: 验证完整 enter_instance 流程**

持续监控日志（每 5s 一次，直到出现 `enter_instance_arrived` 或超时 60s）:

Run:
```bash
node cdp_eval.js auto "JSON.stringify(window.__muMultiMapBossMvp.status().logs.slice(-50).filter(function(l){return /enter_instance|intermediate_popup|popup_enter|click_enter/.test(l.type);}).map(function(l){return l.type+':'+JSON.stringify(l.details);}))"
```
Expected: 日志序列应包含：
- `enter_instance_start` (moduleId: accessory)
- `enter_instance_selected_tab` (tab: 首饰BOSS)
- `enter_instance_selected_boss` (bossName: 幽灵巨人)
- `enter_instance_clicked_enter` (text: 幻术秘境4...)
- `intermediate_popup_appeared`
- `enter_instance_clicked_popup_enter`
- `enter_instance_arrived` (mapName: 幻术秘境4)

- [ ] **Step 5: 验证到达 幻术秘境4 后 engage/hold**

Run:
```bash
node cdp_eval.js auto "JSON.stringify({phase:window.__muMultiMapBossMvp.status().phase,currentTargetId:window.__muMultiMapBossMvp.status().currentTargetId,scene:window.__muMultiMapBossMvp.status().navigationContext})"
```
Expected: `phase` 为 `ENGAGE` 或 `HOLD`，`currentTargetId` 为 `phantom-giant`

- [ ] **Step 6: 验证爆率检查纳入 accessory**

Run:
```bash
node cdp_eval.js auto "JSON.stringify(Object.keys(window.__muMultiMapBossMvp.status().rateCheck))"
```
（注：rateCheck 是 phase 状态，rateResults 是结果）

Run:
```bash
node cdp_eval.js auto "JSON.stringify(window.__muMultiMapBossMvp.status().rateResults)"
```
Expected: rateResults 在爆率检查后应含 `'幻术秘境4'` key

- [ ] **Step 7: 验证退出副本正常**

如已在 幻术秘境4 内打完 BOSS 或手动触发退出，观察日志：

Run:
```bash
node cdp_eval.js auto "JSON.stringify(window.__muMultiMapBossMvp.status().logs.slice(-30).filter(function(l){return /exit_instance/.test(l.type);}).map(function(l){return l.type+':'+JSON.stringify(l.details);}))"
```
Expected: 含 `exit_instance_start` / `exit_instance_done` 日志

- [ ] **Step 8: 验证现有模块无回归**

切回四风平原或试炼之地，观察日志是否仍正常打 BOSS。

Run:
```bash
node cdp_eval.js auto "JSON.stringify(window.__muMultiMapBossMvp.status().logs.slice(-30).filter(function(l){return /enter_instance|navigation_arrived|engage/.test(l.type);}).map(function(l){return l.type+':'+JSON.stringify(l.details);}))"
```
Expected: purgatory/trial_land/four_winds 模块的日志正常出现，无 `intermediate_popup` 相关日志（因为 `hasIntermediatePopup` 为 false）

- [ ] **Step 9: 关闭脚本**

Run:
```bash
node cdp_eval.js auto "JSON.stringify(window.__muMultiMapBossMvp.toggle().enabled)"
```
Expected: `false`（dryRun 模式）

- [ ] **Step 10: 验证完成总结**

确认以下全部通过：
- [ ] 脚本启动无报错
- [ ] accessory 默认启用
- [ ] chooseIntent 优先选 accessory 的 enter_instance
- [ ] 完整流程日志含 7 个关键节点
- [ ] 到达 幻术秘境4 后进入 ENGAGE/HOLD
- [ ] 爆率检查纳入 accessory
- [ ] 退出副本正常
- [ ] 现有模块无回归
- [ ] 脚本可正常关闭

---

## Self-Review 检查

实现完所有任务后，对照 spec 检查：

**Spec coverage:**
- §4.1 accessoryModule 定义 → Task 1 ✓
- §4.1 MAP_MODULES 追加 → Task 1 ✓
- §4.2 CONFIG_DEFAULTS 三项 → Task 2 ✓
- §4.2 normalizeMapPriorities 无需改动 → Task 2 注释已说明 ✓
- §4.3 ACCESSORY_RATE_CHECK_ENABLED + rebuildRateCheckMaps → Task 4 ✓
- §4.4 KNOWN_MAP_NAMES → Task 3 ✓
- §5.1 2 个新阶段 → Task 7 ✓
- §5.2 click_enter 分支 → Task 7 Step 1 ✓
- §5.3 waiting_for_intermediate → Task 7 Step 2 ✓
- §5.4 click_popup_enter → Task 7 Step 2 ✓
- §5.5 enterInstanceCtx.retried → Task 5 ✓
- §5.6 总超时 60s 不变 → 无需改动（现有代码已 60s）✓
- §6 错误处理 → Task 7 内联 ✓
- §7 CDP 探查 7 项 → Task 9 ✓
- §8 验证清单 6 项 → Task 10 ✓
- §9 版本号 0.2.0 → Task 8 ✓

**Placeholder scan:** 无 "TBD"/"TODO" 未对应探查项的残留。Task 1 中的 TODO 占位（bossRowScroll/intermediatePopupTitle/intermediatePopupButtonText/coordinate）全部在 Task 9 有对应回填步骤。

**Type consistency:** `findIntermediatePopup(nodes, module)` / `findPopupEnterButton(popupChildren, module)` 在 Task 6 定义、Task 7 Step 2 调用，签名一致。`ctx.retried` 在 Task 5 初始化、Task 7 读写，字段名一致。`module.hasIntermediatePopup` 在 Task 1 定义、Task 7 读取，字段名一致。`module.intermediatePopupTitle` / `intermediatePopupButtonText` 同样一致。
