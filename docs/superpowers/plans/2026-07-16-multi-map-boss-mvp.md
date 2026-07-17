# 多地图 BOSS 自动化 MVP 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `mu-boss-multi-map-mvp.user.js`,模块化支持四风平原 / 试炼之地1 / 苦难炼狱2 三张地图的自动打 BOSS,新地图可插拔扩展。

**Architecture:** 单文件 Tampermonkey 脚本,通过 `MAP_MODULES` 数组注册地图模块对象;调度器按优先级遍历模块决定 intent;`enter_instance` / `exit_instance` / `teleport_to_module` / `executeTravel` 等 executor 参数化 module 字段复用。坐标写死,副本空场冷却防折返,副本内不直传。

**Tech Stack:** Tampermonkey userscript / 原生 JS / FairyGUI 节点操作 / Chrome DevTools Protocol 9222(开发期验证)

**Spec:** `docs/superpowers/specs/2026-07-16-multi-map-boss-mvp-design.md`

**参考源文件:** `mu-boss-trial-land-mvp.user.js`(2864 行,复制工具函数 + executor 逻辑来源)

**版本号约定:** 每次脚本修改后递增 `@version` 字段(语义化版本,详见 `CLAUDE.md` §11)

---

## 全局约定

- **代码复制来源**:本计划涉及大量"从原脚本移植"的函数,均指从 `mu-boss-trial-land-mvp.user.js` 复制对应函数到新脚本,函数体保持不变(除非计划明确说要改)。复制时**注意变量作用域**——原脚本所有函数都在 `injected` 闭包内,新脚本结构一致。
- **CDP 验证**:每个 Task 末尾有验证步骤,用 `node cdp_eval.js auto "<expr>"` 在浏览器游戏 iframe 里执行 JS 验证。
- **commit 风格**:每个 Task 末尾 commit,使用 `feat:`/`refactor:`/`docs:` 前缀,信息简明。
- **依赖顺序**:Task 0 必须最先做(CDP 探查回填 spec 占位符),Task 1-10 按顺序做,每个 Task 依赖前一个的代码基础。

## Task 0: CDP 探查苦难炼狱2(编码前置,需用户同意)

**目标:** 回填 spec §8.7 的 6 项实地数据,后续所有 Task 依赖这些值。

**Files:**
- Modify: `docs/superpowers/specs/2026-07-16-multi-map-boss-mvp-design.md`(回填占位符)
- 探查脚本: `cdp_eval.js`(已存在,直接用 `node cdp_eval.js auto "<expr>"`)

**前置条件:** 用户已同意 CDP 探查;Chrome 已以 `--remote-debugging-port=9222` 启动;游戏已登录并打开角色界面。

**重要:** 探查项 1/2/3/4 需角色实际进入"苦难炼狱2"副本。如果角色当前不在副本内,需先**请求用户配合**把角色弄进副本(用户在游戏里手动操作,或允许我们通过 CDP 点击 `wildtog_mapName[0]` 的"苦难炼狱2 (126,95)"按钮传送进去)。**不要擅自操作游戏**,先问用户。

### Step 0.1: 探查项 5 和 6(不需进副本,先做)

- [ ] **Step 0.1.1: 让用户在游戏里手动打开挑战 BOSS 面板,切到"苦难炼狱"tab,选中"魔晶菲尼斯"BOSS 行(让 wildtog_mapName 显示 4 个苦难炼狱2 按钮)**

跟用户说:"请在游戏里打开挑战 BOSS 面板,点'苦难炼狱'tab,然后点'魔晶菲尼斯'BOSS 行,让左侧出现苦难炼狱2 等按钮。完成后告诉我。"

- [ ] **Step 0.1.2: 探查项 5 — BaolvIcon0 是否反映魔晶菲尼斯爆率**

Run:
```bash
node cdp_eval.js auto "(() => {
  const g = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
  if (!g) return { error: 'no root' };
  let rateIcon = null;
  function walk(n, d, p) {
    if (!n || d > 22) return;
    if (n.name === 'BaolvIcon0' && n.visible !== false && n.internalVisible !== false) {
      rateIcon = { path: p, url: String(n.url||''), visible: n.visible !== false && n.internalVisible !== false };
    }
    const c = Number(n.numChildren)||0;
    for (let i=0;i<c;i++) walk(n.getChildAt(i), d+1, p+'/'+(n.getChildAt(i)&&n.getChildAt(i).name||'?')+'['+i+']');
  }
  walk(g, 0, 'root');
  return { rateIcon };
})()"
```

记录 `rateIcon.url`(应该是 `ui://InstanceBossWnd/txt_bld` / `txt_blz` / `txt_blg` 三者之一,分别对应低/中/高爆率)。

- [ ] **Step 0.1.3: 探查项 5 对照 — 切回"野外BOSS"tab 选中"傲之煞"看 BaolvIcon0 是否变化**

跟用户说:"请点'野外BOSS'tab,点'傲之煞'BOSS 行。完成后告诉我。"

然后重复 Step 0.1.2 的命令,记录 `rateIcon.url`。**对比两次结果**:
- 两次 URL 不同 → BaolvIcon0 反映当前选中 BOSS 爆率 → 探查项 5 成立,苦难炼狱纳入爆率检查
- 两次 URL 相同 → BaolvIcon0 不随 BOSS 选中变化 → 探查项 5 不成立,苦难炼狱不做爆率检查
- 把结论写进 spec §5.6(回填)

- [ ] **Step 0.1.4: 探查项 6 — 苦难炼狱 tab 下 BOSS 行 scrollName / 进入按钮 togName**

跟用户说:"请再切回'苦难炼狱'tab,选中'魔晶菲尼斯'行。完成后告诉我。"

Run:
```bash
node cdp_eval.js auto "(() => {
  const g = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
  if (!g) return { error: 'no root' };
  const out = { bossRows: [], enterButtons: [] };
  function walk(n, d, p, parentScrollName, parentTogName) {
    if (!n || d > 22) return;
    const cVis = n.visible !== false && n.internalVisible !== false;
    const name = String(n.name||'');
    const pkg = n.packageItem ? (n.packageItem.name||'') : '';
    // 记录 scroll 容器名
    let scrollName = parentScrollName;
    if (/Scroll$/.test(name) && cVis) scrollName = name;
    // 记录 tog 容器名
    let togName = parentTogName;
    if (/tog_mapName$/.test(name) && cVis) togName = name;
    if (cVis && pkg === 'BtnBoss') {
      const cc = Number(n.numChildren)||0;
      let labName = '';
      for (let i=0;i<cc;i++) {
        const ch = n.getChildAt(i);
        if (ch && String(ch.name||'') === 'lab_name') labName = String(ch.text||'');
      }
      out.bossRows.push({ path: p, labName, scrollName, selected: n.selected === true });
    }
    if (cVis && pkg === 'BtnBossMore') {
      const cc = Number(n.numChildren)||0;
      let labMapName = '';
      for (let i=0;i<cc;i++) {
        const ch = n.getChildAt(i);
        if (ch && String(ch.name||'') === 'lab_mapName') labMapName = String(ch.text||'');
      }
      out.enterButtons.push({ path: p, labMapName, togName });
    }
    const cc = Number(n.numChildren)||0;
    for (let i=0;i<cc;i++) walk(n.getChildAt(i), d+1, p+'/'+(n.getChildAt(i)&&n.getChildAt(i).name||'?')+'['+i+']', scrollName, togName);
  }
  walk(g, 0, 'root', null, null);
  // 过滤出魔晶菲尼斯相关行
  const mc = out.bossRows.filter(b => /魔晶菲尼斯/.test(b.labName));
  const pg = out.enterButtons.filter(b => /苦难炼狱/.test(b.labMapName));
  return { magicCrystalRows: mc, purgatoryButtons: pg };
})()"
```

预期:
- `magicCrystalRows[0].scrollName === 'wildlevelScroll'`
- `purgatoryButtons[0].togName === 'wildtog_mapName'`

记录实际值,写进 spec §3 purgatoryModule 注释(回填确认)。

### Step 0.2: 探查项 1/2/3/4(需进副本,问用户)

- [ ] **Step 0.2.1: 请求用户把角色弄进"苦难炼狱2"副本**

跟用户说:"我需要 CDP 探查苦难炼狱2 副本内的实地信息。请把角色送进副本——两种方式任选:(1) 你在游戏里手动打开挑战 BOSS 面板→苦难炼狱 tab→选魔晶菲尼斯→点'苦难炼狱2 (126,95)'按钮;(2) 允许我用 CDP 替你点击这个按钮。哪种?"

得到用户同意后再操作。如果用户选(2),执行:
```bash
# 先点 BOSS 行选中魔晶菲尼斯(若 Step 0.1 已选中可跳过)
node cdp_eval.js auto "(() => {
  const g = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
  if (!g) return { error: 'no root' };
  function find(n, p, matchName) {
    if (!n) return null;
    if (n.name === matchName && n.visible !== false) return { node: n, path: p };
    const c = Number(n.numChildren)||0;
    for (let i=0;i<c;i++) { const r = find(n.getChildAt(i), p+'/'+(n.getChildAt(i)&&n.getChildAt(i).name||'?')+'['+i+']', matchName); if (r) return r; }
    return null;
  }
  // 找 wildtog_mapName 下 labMapName='苦难炼狱2 (126,95)' 的按钮的父节点
  const tog = find(g, 'root', 'wildtog_mapName');
  if (!tog) return { error: 'no wildtog_mapName' };
  const cc = Number(tog.node.numChildren)||0;
  for (let i=0;i<cc;i++) {
    const ch = tog.node.getChildAt(i);
    const k = Number(ch.numChildren)||0;
    let labMapName = '';
    for (let j=0;j<k;j++) { const cc2 = ch.getChildAt(j); if (cc2 && String(cc2.name||'') === 'lab_mapName') labMapName = String(cc2.text||''); }
    if (/^苦难炼狱2/.test(labMapName)) {
      try {
        const ev = window.fgui.Events.createEvent(window.Laya.Event.CLICK, ch.displayObject);
        ch.displayObject.event(window.Laya.Event.CLICK, ev);
        return { clicked: true, btnText: labMapName };
      } catch(e) { return { error: e.message }; }
    }
  }
  return { error: 'no 苦难炼狱2 button found' };
})()"
```

然后等几秒角色传送到副本。

- [ ] **Step 0.2.2: 探查项 1 — 副本内 scanScene 的 mapName 文本**

Run:
```bash
node cdp_eval.js auto "(() => {
  const g = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
  if (!g) return { error: 'no root' };
  // 找所有 mapName 节点和包含 '苦难' 字样的节点
  const out = { mapNameNodes: [], kunanNodes: [] };
  function walk(n, d, p) {
    if (!n || d > 22) return;
    const cVis = n.visible !== false && n.internalVisible !== false;
    const name = String(n.name||'');
    const txt = String(n.text||n.title||'');
    if (name === 'mapName') out.mapNameNodes.push({ path: p, text: txt, visible: cVis });
    if (cVis && /苦难/.test(txt) && txt.length < 30) out.kunanNodes.push({ path: p, name, text: txt });
    const c = Number(n.numChildren)||0;
    for (let i=0;i<c;i++) walk(n.getChildAt(i), d+1, p+'/'+(n.getChildAt(i)&&n.getChildAt(i).name||'?')+'['+i+']');
  }
  walk(g, 0, 'root');
  return out;
})()"
```

预期:某个 `mapName` 节点 text 精确等于 `苦难炼狱2`(或类似)。把精确文本写进 spec §3 `purgatoryModule.mapName` 和 §5.10 `KNOWN_MAP_NAMES`(回填)。如果文本带数字 2,跟 spec 一致;如果叫别的,记下真实文本。

- [ ] **Step 0.2.3: 探查项 2 — 魔晶菲尼斯在副本内 M 大地图的固定坐标**

请用户在游戏里按 M 键打开大地图(或允许我们 CDP 点 btn_map 打开),然后扫描大地图 BOSS 行。

Run:
```bash
node cdp_eval.js auto "(() => {
  const g = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
  if (!g) return { error: 'no root' };
  // 找 MapDetialWnd 面板下的 List_right 和 RightLift 行
  const out = { panelFound: false, bossRows: [] };
  function walk(n, d, p) {
    if (!n || d > 22) return;
    const cVis = n.visible !== false && n.internalVisible !== false;
    const name = String(n.name||'');
    const pkg = n.packageItem ? (n.packageItem.name||'') : '';
    if (cVis && (name === 'MapDetialWnd' || pkg === 'MapDetialWnd')) out.panelFound = true;
    if (cVis && pkg === 'RightLift') {
      const cc = Number(n.numChildren)||0;
      let n0text = '', n16text = '';
      for (let i=0;i<cc;i++) {
        const ch = n.getChildAt(i);
        const cn = String(ch&&ch.name||'');
        const ct = String(ch&&ch.text||ch&&ch.title||'');
        if (cn === 'n0') n0text = ct;
        else if (cn === 'n16') n16text = ct;
      }
      out.bossRows.push({ path: p, n0text, n16text });
    }
    const c = Number(n.numChildren)||0;
    for (let i=0;i<c;i++) walk(n.getChildAt(i), d+1, p+'/'+(n.getChildAt(i)&&n.getChildAt(i).name||'?')+'['+i+']');
  }
  walk(g, 0, 'root');
  // 过滤含魔晶菲尼斯的行
  const mc = out.bossRows.filter(r => /魔晶菲尼斯/.test(r.n0text) || /魔晶菲尼斯/.test(r.n16text));
  return { panelFound: out.panelFound, allRowCount: out.bossRows.length, magicCrystalRows: mc, allRows: out.bossRows };
})()"
```

如果 `magicCrystalRows` 有结果,但坐标可能不直接显示在 RightLift 行里(原脚本是靠 BOSS 行点击导航,坐标靠 overlay 或扫到的)。这种情况下我们改用**坐标推断**:让用户在副本里走几步,记录角色当前坐标,再走几步记录变化,看看能不能在 M 大地图上看到 BOSS 图标位置。

如果上面没扫到坐标,改用方法 B:**让用户走过去站到魔晶菲尼斯旁边**,然后读角色坐标。

请用户:"请让你的角色走到魔晶菲尼斯旁边(或它死后墓碑位置)。完成后告诉我。"

Run:
```bash
node cdp_eval.js auto "(() => {
  const g = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
  if (!g) return { error: 'no root' };
  let coord = '';
  function walk(n, d) {
    if (!n || d > 22) return;
    const t = String(n.text||'');
    if (n.visible !== false && n.internalVisible !== false && /^\d{1,3},\d{1,3}$/.test(t)) coord = t;
    const c = Number(n.numChildren)||0;
    for (let i=0;i<c;i++) walk(n.getChildAt(i), d+1);
  }
  walk(g, 0);
  return { coord };
})()"
```

记录 `coord`(形如 `"126,95"`)。如果扫到的是按钮坐标 (126,95),问用户:"魔晶菲尼斯的固定坐标是不是就是 (126,95)?如果不是,你能告诉我副本里它的精确坐标吗?"

把确认的坐标写进 spec §3 `purgatoryModule.bosses[0].coordinate`(回填)。

- [ ] **Step 0.2.4: 探查项 3 — 副本内退出按钮 btnExit 容器**

请用户在副本里(如果刚才已退出,需要再进一次)观察左侧任务栏是否有"退出"按钮,或允许我们 CDP 扫一下。

Run:
```bash
node cdp_eval.js auto "(() => {
  const g = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
  if (!g) return { error: 'no root' };
  const out = { btnExitNodes: [], exitTextNodes: [] };
  function walk(n, d, p) {
    if (!n || d > 22) return;
    const cVis = n.visible !== false && n.internalVisible !== false;
    const name = String(n.name||'');
    const txt = String(n.text||n.title||'');
    if (cVis && name === 'btnExit') out.btnExitNodes.push({ path: p, parent: p.replace(/\/[^/]+$/, '') });
    if (cVis && /退出/.test(txt) && txt.length < 20) out.exitTextNodes.push({ path: p, name, text: txt });
    const c = Number(n.numChildren)||0;
    for (let i=0;i<c;i++) walk(n.getChildAt(i), d+1, p+'/'+(n.getChildAt(i)&&n.getChildAt(i).name||'?')+'['+i+']');
  }
  walk(g, 0, 'root');
  return out;
})()"
```

预期:`btnExitNodes[0].parent` 包含 `Damage list` 字样 → 跟试炼之地一致,`executeExitInstance` 可直接复用。如果不一致,记录实际父容器路径,后续 Task 7 需参数化退出按钮查找逻辑。写进 spec §5.2(回填)。

- [ ] **Step 0.2.5: 探查项 4 — 副本内 M 大地图 BOSS 图标/行结构(是否与四风平原一致)**

如果 Step 0.2.3 已开过 M 大地图,可直接复用扫描结果;否则请用户按 M 键。

Run:
```bash
node cdp_eval.js auto "(() => {
  const g = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
  if (!g) return { error: 'no root' };
  // 找 MapDetialWnd 面板内 List_right / leftlist / List_tree 结构
  const out = { panel: null, listRight: null, leftlist: null, listTree: null, rightLiftRows: [], leftitemRows: [] };
  function walk(n, d, p) {
    if (!n || d > 22) return;
    const cVis = n.visible !== false && n.internalVisible !== false;
    const name = String(n.name||'');
    const pkg = n.packageItem ? (n.packageItem.name||'') : '';
    if (cVis && (name === 'MapDetialWnd' || pkg === 'MapDetialWnd') && !out.panel) out.panel = { path: p };
    if (cVis && name === 'List_right' && !out.listRight) out.listRight = { path: p };
    if (cVis && (name === 'leftlist' || name === 'List_left') && !out.leftlist) out.leftlist = { path: p };
    if (cVis && name === 'List_tree' && !out.listTree) out.listTree = { path: p };
    if (cVis && pkg === 'RightLift') {
      const cc = Number(n.numChildren)||0;
      let n0text = '';
      for (let i=0;i<cc;i++) { const ch = n.getChildAt(i); if (ch && String(ch.name||'') === 'n0') n0text = String(ch.text||''); }
      out.rightLiftRows.push({ path: p, n0text });
    }
    if (cVis && (pkg === 'leftitem' || pkg === 'LeftItem')) {
      const cc = Number(n.numChildren)||0;
      let titleText = '';
      for (let i=0;i<cc;i++) { const ch = n.getChildAt(i); if (ch && String(ch.name||'') === 'title') titleText = String(ch.text||''); }
      out.leftitemRows.push({ path: p, titleText });
    }
    const c = Number(n.numChildren)||0;
    for (let i=0;i<c;i++) walk(n.getChildAt(i), d+1, p+'/'+(n.getChildAt(i)&&n.getChildAt(i).name||'?')+'['+i+']');
  }
  walk(g, 0, 'root');
  return out;
})()"
```

对比四风平原大地图结构(参考 spec CDP 探查事实表里的 `List_right` / `RightLift` / `leftlist` / `leftitem` 描述):
- 结构一致 → `executeTravel` 副本内导航可行,无需特殊处理
- 结构不一致 → 记录差异,Task 6 需要参数化 `executeTravel` 的 contentReady

写进 spec §5.4 和 §8.7(回填)。

- [ ] **Step 0.2.6: 让用户把角色退出副本回勇者大陆**

跟用户说:"探查完了,请把角色退出副本(或允许我用 CDP 点击 btnExit 退出)。"得到同意后,执行退出操作(参考 Step 0.2.4 找到的 btnExit 路径点击),或让用户手动退出。

### Step 0.3: 回填 spec + commit

- [ ] **Step 0.3.1: 把 6 项探查结论写进 spec**

修改 `docs/superpowers/specs/2026-07-16-multi-map-boss-mvp-design.md`,回填以下占位符:
- `purgatoryModule.bosses[0].coordinate` 改为 Step 0.2.3 拿到的真实坐标
- §5.6 标注"爆率检查成立/不成立"(根据 Step 0.1.3 结论)
- §5.2 标注"btnExit 容器与试炼之地一致/不一致"(根据 Step 0.2.4)
- §5.4 标注"副本内 M 大地图结构与四风平原一致/不一致"(根据 Step 0.2.5)
- §3 purgatoryModule 字段注释确认 `wildlevelScroll` / `wildtog_mapName`(根据 Step 0.1.4)
- §5.10 `KNOWN_MAP_NAMES` 确认苦难炼狱2文本(根据 Step 0.2.2)

- [ ] **Step 0.3.2: commit spec 回填**

```bash
git add docs/superpowers/specs/2026-07-16-multi-map-boss-mvp-design.md
git commit -m "$(cat <<'EOF'
docs: fill in CDP-verified values for purgatory module

Task 0 CDP exploration results: boss coordinate, BaolvIcon0
association, btnExit container, in-instance map structure, scroll/tog
names, and exact 苦难炼狱2 map name text. Removes all
<Task0-CDP探查回填> placeholders from the spec.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Task 0 完成标准:** spec 无 `<Task0-CDP探查回填>` 占位符,6 项探查结论全部明确写入 spec 对应章节。

---

## Task 1: 脚本骨架 & 注入逻辑

**目标:** 创建 `mu-boss-multi-map-mvp.user.js`,含 Tampermonkey metadata、注入逻辑、所有 utility 函数、所有 scan 函数(含 `scanBossChallengePanel` 改造加 `scrollName`/`togName`),`state` 框架。Task 1 完成后,脚本可在游戏 iframe 内注入并暴露 `window.__muMultiMapBossMvp` 对象(但还不做任何事)。

**Files:**
- Create: `mu-boss-multi-map-mvp.user.js`

**参考源:** `mu-boss-trial-land-mvp.user.js`(直接复制大部分函数)

### Step 1.1: 创建脚本骨架(metadata + inject 函数 + isGameContext)

- [ ] **Step 1.1.1: 写入 metadata 和注入外壳**

完整内容写入 `mu-boss-multi-map-mvp.user.js`:

```js
// ==UserScript==
// @name         全民红月 - 多地图 BOSS 自动化 MVP
// @namespace    codex.mu.multi-map-boss-mvp
// @version      0.1.0
// @description  四风平原 + 试炼之地1 + 苦难炼狱2 模块化自动打 BOSS。地图可插拔扩展。
// @author       Codex
// @match        https://www.602.com/game/show/*
// @match        https://client.qj2h5.jiuxiaokj.cn/mu2h5/*
// @match        https://cdn.qj2h5.jiuxiaokj.cn/mu2h5/*
// @match        https://*.jiuxiaokj.cn/mu2h5/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const injected = function () {
    'use strict';

    if (window.__muMultiMapBossMvp) return;

    // === Constants ===
    const STORAGE_KEY = 'mu_multi_map_boss_mvp_v1';
    const TICK_MS = 1000;
    const ARRIVAL_THRESHOLD = 3;
    const MAX_LOGS = 200;
    const KNOWN_MAP_NAMES = ['四风平原', '试炼之地1', '苦难炼狱2', '勇者大陆'];

    // === CONFIG_DEFAULTS 占位,Task 2 填充 ===
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
      enabledMaps: ['four_winds', 'trial_land', 'purgatory'],
      mapPriorities: { four_winds: 10, trial_land: 20, purgatory: 30 },
      enabledBosses: [
        'ao-left','ao-right','angry-ao','rage-ao',
        'lobster-1','lobster-2','lobster-3',
        'magic-crystal'
      ],
      purgatoryMapChoice: '苦难炼狱2',
      instanceEmptyCooldownMs: 15 * 60 * 1000,
    });

    // === MAP_MODULES 占位,Task 3 填充 ===
    const MAP_MODULES = [];

    // === state 框架 ===
    const state = {
      enabled: false,
      dryRun: true,
      phase: 'SYNC',
      currentTargetId: '',
      currentAction: null,
      currentModuleId: '',
      currentIntent: null,
      lastIntent: null,
      lastError: null,
      lastActionAt: 0,
      lastSnapshot: null,
      ownerObservation: null,
      tickId: null,
      arrivalConfirmedAt: 0,
      holdStartedAt: 0,
      zKeySentAt: 0,
      zKeyRetryCount: 0,
      farmArrivedAt: 0,
      farmArrivedCoord: '',
      farmLastSeenFarmingAt: 0,
      farmTargetMissing: false,
      enterInstanceCtx: null,
      exitInstanceCtx: null,
      teleportCtx: null,
      navigationContext: null,
      mapScanContext: null,
      rateCheck: { phase: 'idle', targetModuleId: '', startedAt: 0, lastActionAt: 0 },
      rateResults: {},
      instanceCheckCooldown: {},
      lastMapScanAt: 0,
      lastCheckedAt: {},
      targets: [],
      logs: [],
      config: null,  // Task 2 初始化
      paused: false,
      pauseReason: '',
    };

    // === 占位:API 暴露(Task 2 填充) ===
    window.__muMultiMapBossMvp = {
      __placeholder: true,
    };

    // === 占位:scheduleTick(Task 5 填充) ===
    // === 占位:setupKeyboardToggle(Task 2 填充) ===

    // === Utility 函数(从原脚本复制) ===
    // 这里会放所有 cleanText/clone/clampNumber/readJson/writeJson/appendLog 等

    // === Scan 函数(从原脚本复制 + scanBossChallengePanel 改造) ===
    // 这里会放 scanScene/scanMapPanel/scanBossChallengePanel/scanCombat/scanAutoBattle 等

    // === Reconcile/Target state(Task 4 填充) ===
    // === Scheduler(Task 5 填充) ===
    // === Executors(Task 6/7 填充) ===
    // === Config & API(Task 2 填充) ===

  };

  function inject(fn) {
    const script = document.createElement('script');
    script.textContent = '(' + fn.toString() + ')();';
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  function isGameContext() {
    return window.top !== window || Boolean(window.fgui);
  }

  if (isGameContext()) inject(injected);
})();
```

- [ ] **Step 1.1.2: 验证脚本可注入**

在 Tampermonkey 里安装这个脚本(用户手动),或在 CDP 里直接 inject 测试。Run:
```bash
node cdp_eval.js auto "(() => {
  // 临时把脚本文件读进来 inject(模拟 Tampermonkey 行为)
  return { hasFgui: typeof window.fgui !== 'undefined', hasMarker: typeof window.__muMultiMapBossMvp };
})()"
```

注意:Step 1.1.2 只验证语法不报错。实际安装通过 Tampermonkey 后,在游戏 iframe 里 `window.__muMultiMapBossMvp.__placeholder` 应为 true。

### Step 1.2: 复制所有 utility 函数

- [ ] **Step 1.2.1: 在 `injected` 函数内的 `// === Utility 函数 ===` 占位处粘贴所有 utility 函数**

从 `mu-boss-trial-land-mvp.user.js` 复制以下函数,**完全不变**:

- `persist` (L2526-2528)
- `syncRuntimeFlags` (L2530-2533)
- `appendLog` (L2553-2560)
- `readJson` (L2590-2597)
- `writeJson` (L2599-2605)
- `cleanText` (L2607-2614)
- `clampNumber` (L2616-2620)
- `clone` (L2622-2624)
- `root` (L2626-2628)
- `readOverlay` (L2630-2639)
- `collectNodes` (L2641-2650)
- `walkNodes` (L2652-2663)
- `summarizeNode` (L2665-2680)
- `packageInfo` (L2682-2689)
- `getRect` (L2691-2701)
- `findNodeByPath` (L2703-2713)
- `nodeIsEffectivelyVisible` (L2715-2722)
- `findBigBtnChild` (L2724-2735)
- `activateNode` (L2737-2753)
- `normalizeCoordinate` (L2755-2758)
- `showToast` (L2836-2849)

**注意**:`syncRuntimeFlags` 原版同步 `state.enabled`/`state.dryRun`,保持不变;`persist` 同理。

### Step 1.3: 复制 scan 函数

- [ ] **Step 1.3.1: 在 `// === Scan 函数 ===` 占位处粘贴 scanScene**

从 `mu-boss-trial-land-mvp.user.js` L2314-2338 复制 `scanScene`,**完全不变**(`KNOWN_MAP_NAMES` 已包含苦难炼狱2)。

- [ ] **Step 1.3.2: 粘贴 scanMapPanel**

从 L2340-2419 复制 `scanMapPanel` + `mapRowSummary`(L2421-2426) + `descendantsOf`(L2428-2431) + `buttonSummaryWithPath`(L2433-2435),**完全不变**。

- [ ] **Step 1.3.3: 粘贴 scanCombat**

从 L2437-2457 复制 `scanCombat`。**需要改造**:`TARGET_TABLE` 原是模块级常量,新脚本里改为从 `MAP_MODULES` 动态生成。在函数顶部添加:

```js
function scanCombat(nodes) {
  const TARGET_TABLE = MAP_MODULES.flatMap(m => m.bosses.map(b => ({ name: b.name, mapName: m.mapName })));
  const target = nodes.find((item) => item.effectiveVisible && /Lv\s*\d+/i.test(item.text) && TARGET_TABLE.some((entry) => item.text.includes(entry.name)));
  // ... 其余逻辑同原 L2438-2457 不变
}
```

- [ ] **Step 1.3.4: 粘贴 scanAutoBattle**

从 L2459-2465 复制 `scanAutoBattle` + `isAutoFightOn`(L1820-1831),**完全不变**。

- [ ] **Step 1.3.5: 粘贴并改造 scanBossChallengePanel**

从 L2762-2817 复制 `scanBossChallengePanel`,**关键改造**:在 `bossRows` 和 `enterButtons` 的 `.map` 里加 `scrollName` 和 `togName` 字段。

替换原 L2775-2786 的 `bossRows` 块为:

```js
const bossRows = panelNodes
  .filter((item) => item.effectiveVisible && item.packageName === 'BtnBoss')
  .map((row) => {
    const children = descendantsOf(panelNodes, row).filter((item) => item.path !== row.path);
    const nameNode = children.find((item) => item.name === 'lab_name' && item.contentText);
    // 推断所属 scroll 容器名:沿 path 向上找第一个 *Scroll* 节点
    const scrollName = inferScrollName(row.path);
    return {
      name: nameNode ? cleanText(nameNode.contentText) : '',
      rect: row.rect,
      sourcePath: row.path,
      scrollName,
    };
  })
  .filter((row) => row.name);
```

替换原 L2789-2801 的 `enterButtons` 块为:

```js
const enterButtons = panelNodes
  .filter((item) => item.effectiveVisible && item.packageName === 'BtnBossMore')
  .map((row) => {
    const children = descendantsOf(panelNodes, row).filter((item) => item.path !== row.path);
    const mapNameNode = children.find((item) => item.name === 'lab_mapName' && item.contentText);
    const titleNode = mapNameNode || children.find((item) => item.contentText);
    // 推断所属 tog 容器名:沿 path 向上找第一个 *tog_mapName 节点
    const togName = inferTogName(row.path);
    return {
      text: titleNode ? cleanText(titleNode.contentText) : '',
      rect: row.rect,
      sourcePath: row.path,
      togName,
    };
  })
  .filter((btn) => btn.text);
```

在 `scanBossChallengePanel` 函数上方添加两个辅助函数:

```js
function inferScrollName(path) {
  // path 形如 'root/Instance_BossUI[3]/?[0]/wildlevelScroll[6]/?[3]'
  // 找最后一个 *Scroll* 段
  const parts = path.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    const name = parts[i].replace(/\[\d+\]$/, '');
    if (/Scroll$/.test(name)) return name;
  }
  return '';
}

function inferTogName(path) {
  // path 形如 'root/Instance_BossUI[3]/?[0]/wildtog_mapName[5]/?[0]'
  // 找最后一个 *tog_mapName 段
  const parts = path.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    const name = parts[i].replace(/\[\d+\]$/, '');
    if (/tog_mapName$/.test(name)) return name;
  }
  return '';
}
```

`tabs` 收集原 L2772-2773 正则 `野外BOSS|福利BOSS|首饰BOSS|试炼之地|苦难炼狱` 已经包含苦难炼狱,**不变**。其余 `close` / `openButton` / `mapNameNode` / `rateIcon` 等逻辑同原,**不变**。

- [ ] **Step 1.3.6: 不要复制 scanTrialTaskbar**

spec §5.10 明确**删除** taskbar 路径,不复制 `scanTrialTaskbar` 函数。

### Step 1.4: 验证 + commit

- [ ] **Step 1.4.1: 浏览器安装脚本,验证注入成功**

用户在 Tampermonkey 里创建新脚本,粘贴 `mu-boss-multi-map-mvp.user.js` 全文,保存。刷新游戏页面。

Run:
```bash
node cdp_eval.js auto "(() => ({
  hasMarker: typeof window.__muMultiMapBossMvp === 'object',
  markerKeys: window.__muMultiMapBossMvp ? Object.keys(window.__muMultiMapBossMvp) : null,
  fguiReady: typeof window.fgui !== 'undefined',
}))()"
```

Expected: `hasMarker: true`, `markerKeys: ['__placeholder']`, `fguiReady: true`。

- [ ] **Step 1.4.2: 验证 scanBossChallengePanel 改造正确**

让用户打开挑战 BOSS 面板(任意 tab)。Run:
```bash
node cdp_eval.js auto "(() => {
  const g = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
  if (!g) return { error: 'no root' };
  // 收集所有节点
  function collect(n, d, p, vis, out) {
    if (!n || d > 18) return;
    const selfVis = vis && n.visible !== false && n.internalVisible !== false;
    const item = { name: String(n.name||''), text: String(n.text||n.title||'').slice(0,80), path: p, effectiveVisible: selfVis !== false, packageName: n.packageItem ? (n.packageItem.name||'') : '', rect: { x: 0, y: 0, w: 0, h: 0 } };
    out.push(item);
    const c = Number(n.numChildren)||0;
    for (let i=0;i<c;i++) collect(n.getChildAt(i), d+1, p+'/'+(n.getChildAt(i)&&n.getChildAt(i).name||'?')+'['+i+']', selfVis, out);
  }
  const nodes = [];
  collect(g, 0, 'root', true, nodes);
  // 调用 scanBossChallengePanel(假设全局可访问,这里手动验证 inferScrollName/inferTogName)
  function inferScrollName(path) { const parts = path.split('/'); for (let i=parts.length-1;i>=0;i--) { const n=parts[i].replace(/\\[\\d+\\]$/, ''); if (/Scroll$/.test(n)) return n; } return ''; }
  function inferTogName(path) { const parts = path.split('/'); for (let i=parts.length-1;i>=0;i--) { const n=parts[i].replace(/\\[\\d+\\]$/, ''); if (/tog_mapName$/.test(n)) return n; } return ''; }
  const btnBoss = nodes.filter(n => n.packageName === 'BtnBoss' && n.effectiveVisible).slice(0, 5).map(n => ({ name: n.text, scrollName: inferScrollName(n.path) }));
  const btnBossMore = nodes.filter(n => n.packageName === 'BtnBossMore' && n.effectiveVisible).slice(0, 5).map(n => ({ text: n.text, togName: inferTogName(n.path) }));
  return { btnBossSample: btnBoss, btnBossMoreSample: btnBossMore };
})()"
```

Expected: `btnBossSample[*].scrollName` 不为空(形如 `wildlevelScroll` / `privatelevelScroll`),`btnBossMoreSample[*].togName` 不为空(形如 `wildtog_mapName` / `privatetog_mapName`)。

- [ ] **Step 1.4.3: commit Task 1**

```bash
git add mu-boss-multi-map-mvp.user.js
git commit -m "$(cat <<'EOF'
feat(multi-map-boss): scaffold new script with utilities and scan fns

Create mu-boss-multi-map-mvp.user.js skeleton with Tampermonkey
metadata, injection guard window.__muMultiMapBossMvp, all utility
functions (cleanText/clone/findNodeByPath/activateNode/...), all scan
functions copied from mu-boss-trial-land-mvp.user.js. scanBossChallengePanel
gains scrollName (on bossRows) and togName (on enterButtons) fields to
distinguish which scroll/tog each row/button belongs to — needed because
purgatory shares wildlevelScroll/wildtog_mapName with wild-tab bosses.
scanTrialTaskbar deliberately not copied (taskbar path removed in new
design). No scheduler/executors yet; script is inert placeholder.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Task 1 完成标准:** 脚本可注入,`window.__muMultiMapBossMvp.__placeholder === true`,`scanBossChallengePanel` 改造可识别 `scrollName`/`togName`。

---

## Task 2: Config & API

**目标:** 实现 `CONFIG_DEFAULTS` 完善、`normalizeConfig`、`syncRuntimeFlags`、`persist`、`getStatus`,暴露 `window.__muMultiMapBossMvp` 完整 API(start/toggle/pause/resume/status/setConfig/scanNow/getModule/getTargets),键盘 Ctrl+N 绑定。

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js`

### Step 2.1: 完善 CONFIG_DEFAULTS

- [ ] **Step 2.1.1: 检查 Task 1 的 CONFIG_DEFAULTS**

Task 1 已写入完整 CONFIG_DEFAULTS(包含所有原有 + 新增字段)。无需再改。**确认 `instanceEmptyCooldownMs` 字段存在**(防折返冷却)。

### Step 2.2: 实现 normalizeConfig

- [ ] **Step 2.2.1: 在 utility 区域添加 normalizeConfig**

```js
function normalizeConfig(input) {
  const source = input && typeof input === 'object' ? input : {};
  const config = {
    enabled: Boolean(source.enabled),
    dryRun: source.dryRun !== false,
    ownerName: cleanText(source.ownerName) || CONFIG_DEFAULTS.ownerName,
    preWaitSeconds: clampNumber(source.preWaitSeconds, 0, 3600, CONFIG_DEFAULTS.preWaitSeconds),
    ownerObserveSeconds: clampNumber(source.ownerObserveSeconds, 0, 3600, CONFIG_DEFAULTS.ownerObserveSeconds),
    contestedCooldownMs: clampNumber(source.contestedCooldownMs, 0, 24 * 60 * 60 * 1000, CONFIG_DEFAULTS.contestedCooldownMs),
    arrivalStallMs: clampNumber(source.arrivalStallMs, 0, 60 * 60 * 1000, CONFIG_DEFAULTS.arrivalStallMs),
    travelTimeoutMs: clampNumber(source.travelTimeoutMs, 0, 24 * 60 * 60 * 1000, CONFIG_DEFAULTS.travelTimeoutMs),
    farmTargetName: cleanText(source.farmTargetName) || CONFIG_DEFAULTS.farmTargetName,
    rateRecheckIntervalMs: clampNumber(source.rateRecheckIntervalMs, 60 * 1000, 60 * 60 * 1000, CONFIG_DEFAULTS.rateRecheckIntervalMs),
    trialPriorityWindowMs: clampNumber(source.trialPriorityWindowMs, 0, 10 * 60 * 1000, CONFIG_DEFAULTS.trialPriorityWindowMs),
    enabledMaps: Array.isArray(source.enabledMaps) && source.enabledMaps.length
      ? source.enabledMaps.map(cleanText).filter(Boolean)
      : clone(CONFIG_DEFAULTS.enabledMaps),
    mapPriorities: normalizeMapPriorities(source.mapPriorities),
    enabledBosses: Array.isArray(source.enabledBosses) && source.enabledBosses.length
      ? source.enabledBosses.map(cleanText).filter(Boolean)
      : clone(CONFIG_DEFAULTS.enabledBosses),
    purgatoryMapChoice: cleanText(source.purgatoryMapChoice) || CONFIG_DEFAULTS.purgatoryMapChoice,
    instanceEmptyCooldownMs: clampNumber(source.instanceEmptyCooldownMs, 60 * 1000, 24 * 60 * 60 * 1000, CONFIG_DEFAULTS.instanceEmptyCooldownMs),
  };
  return config;
}

function normalizeMapPriorities(input) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const module of MAP_MODULES) {
    const v = source[module.id];
    out[module.id] = (typeof v === 'number' && Number.isFinite(v)) ? v : module.priority;
  }
  return out;
}
```

`normalizeMapPriorities` 在 Task 3 之后才能完整工作(MAP_MODULES 为空时返回空对象,这没问题,Task 3 会填)。

### Step 2.3: 完善 syncRuntimeFlags 和初始化 state.config

- [ ] **Step 2.3.1: state.config 初始化**

在 `state` 对象定义之后(Task 1 已建),`MAP_MODULES` 定义之前,添加:

```js
state.config = normalizeConfig(readJson(STORAGE_KEY, CONFIG_DEFAULTS));
syncRuntimeFlags();
```

注意这两行必须在 `normalizeConfig` 和 `readJson` 和 `syncRuntimeFlags` 函数定义之后。JS 函数提升(hoisting)对 `function` 声明有效,所以即使这两行写在 `normalizeConfig` 函数定义之前也能调,但为了可读性,把它们放在 utility 函数之后、state 声明之后。

### Step 2.4: 实现 getStatus

- [ ] **Step 2.4.1: 添加 getStatus 函数**

```js
function getStatus() {
  return clone({
    enabled: state.enabled,
    dryRun: state.dryRun,
    phase: state.phase,
    currentTargetId: state.currentTargetId,
    currentAction: state.currentAction,
    currentModuleId: state.currentModuleId,
    ownerObserveSeconds: state.ownerObservation ? Math.floor((Date.now() - state.ownerObservation.observedAt) / 1000) : 0,
    targets: state.targets,
    logs: state.logs.slice(-100),
    paused: state.paused,
    pauseReason: state.pauseReason,
    config: state.config,
    lastError: state.lastError,
    navigationContext: clone(state.navigationContext),
    enterInstanceCtx: clone(state.enterInstanceCtx),
    exitInstanceCtx: clone(state.exitInstanceCtx),
    teleportCtx: clone(state.teleportCtx),
    mapScanContext: clone(state.mapScanContext),
    rateCheck: clone(state.rateCheck),
    rateResults: clone(state.rateResults),
    instanceCheckCooldown: clone(state.instanceCheckCooldown),
    zKeySentAt: state.zKeySentAt,
    zKeyRetryCount: state.zKeyRetryCount,
    arrivalConfirmedAt: state.arrivalConfirmedAt,
    currentIntent: clone(state.currentIntent),
  });
}
```

### Step 2.5: 实现完整 API 暴露

- [ ] **Step 2.5.1: 替换 Task 1 的占位 API 对象**

把 `window.__muMultiMapBossMvp = { __placeholder: true };` 替换为:

```js
window.__muMultiMapBossMvp = {
  start() {
    state.config.enabled = true;
    state.config.dryRun = false;
    syncRuntimeFlags();
    persist();
    appendLog('started', { dryRun: state.dryRun });
    return getStatus();
  },
  toggle() {
    if (state.config.enabled && !state.dryRun) {
      state.config.enabled = false;
      state.config.dryRun = true;
      syncRuntimeFlags();
      persist();
      resetAllContexts();
      releaseLockedTarget();
      appendLog('toggled_off', {});
    } else {
      state.config.enabled = true;
      state.config.dryRun = false;
      syncRuntimeFlags();
      persist();
      appendLog('toggled_on', {});
    }
    return getStatus();
  },
  pause(reason) {
    state.paused = true;
    state.pauseReason = cleanText(reason) || 'manual';
    state.phase = 'PAUSED';
    appendLog('paused', { reason: state.pauseReason });
    return getStatus();
  },
  resume() {
    state.paused = false;
    state.phase = 'SYNC';
    state.pauseReason = '';
    appendLog('resumed', {});
    return getStatus();
  },
  status: getStatus,
  setConfig(patch) {
    state.config = normalizeConfig({ ...state.config, ...(patch || {}) });
    syncRuntimeFlags();
    persist();
    appendLog('config_updated', { patch: clone(patch || {}) });
    return getStatus();
  },
  scanNow: readSnapshot,  // readSnapshot 在 Task 4 实现,这里前向声明,Task 4 完成后能调
  getModule(moduleId) {
    const m = MAP_MODULES.find(m => m.id === moduleId);
    return m ? clone(m) : null;
  },
  getTargets() {
    return clone(state.targets);
  },
  resetInstanceCooldown(moduleId) {
    if (moduleId && state.instanceCheckCooldown[moduleId]) {
      delete state.instanceCheckCooldown[moduleId];
      appendLog('instance_cooldown_reset', { moduleId });
    } else if (!moduleId) {
      state.instanceCheckCooldown = {};
      appendLog('instance_cooldown_reset_all', {});
    }
    return getStatus();
  },
};
```

`readSnapshot` 在 Task 4 实现;此时如果调用 `scanNow` 会报错(`readSnapshot is not defined`),但 hoisting 让 `function readSnapshot() {}` 在 Task 4 添加后能正确解析。先不动。

`resetAllContexts` 和 `releaseLockedTarget` 函数在 Task 4/5 实现。当前 API 里的 `toggle()` 会调它们,Task 4/5 完成后才能正常工作。**在 Task 4/5 完成前,用户不应调用 `toggle()`,只调用 `setConfig` 测试 config**。

### Step 2.6: 添加 resetAllContexts 占位

- [ ] **Step 2.6.1: 添加 resetAllContexts 函数**

```js
function resetAllContexts() {
  state.rateCheck = { phase: 'idle', targetModuleId: '', startedAt: 0, lastActionAt: 0 };
  state.rateResults = {};
  state.farmArrivedAt = 0;
  state.farmArrivedCoord = '';
  state.farmLastSeenFarmingAt = 0;
  state.holdStartedAt = 0;
  state.lastCheckedAt = {};
  state.lastMapScanAt = 0;
  state.mapScanContext = null;
  state.navigationContext = null;
  state.enterInstanceCtx = null;
  state.exitInstanceCtx = null;
  state.teleportCtx = null;
  state.zKeySentAt = 0;
  state.zKeyRetryCount = 0;
  state.arrivalConfirmedAt = 0;
  state.instanceCheckCooldown = {};
}
```

### Step 2.7: 实现键盘 Ctrl+N 绑定

- [ ] **Step 2.7.1: 添加 setupKeyboardToggle**

```js
function setupKeyboardToggle() {
  if (window.__muMultiMapBossToggleKeyBound) return;
  window.__muMultiMapBossToggleKeyBound = true;
  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      e.stopPropagation();
      if (window.__muMultiMapBossMvp && typeof window.__muMultiMapBossMvp.toggle === 'function') {
        const st = window.__muMultiMapBossMvp.toggle();
        showToast(st && st.enabled ? 'BOSS脚本 已开启' : 'BOSS脚本 已关闭');
      }
    }
  }, true);
}
```

在 `injected` 函数末尾(在所有函数定义之后、API 暴露之后)添加调用:

```js
setupKeyboardToggle();
```

### Step 2.8: 验证 + commit

- [ ] **Step 2.8.1: 验证 setConfig 工作正常**

刷新游戏页面。Run:
```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  if (!api) return { error: 'no api' };
  // 测试 setConfig
  const st1 = api.setConfig({ enabledMaps: ['four_winds'] });
  const st2 = api.setConfig({ mapPriorities: { purgatory: 100 } });
  const st3 = api.setConfig({ instanceEmptyCooldownMs: 30 * 60 * 1000 });
  return {
    enabledMaps: st1.config.enabledMaps,
    mapPriorities: st2.config.mapPriorities,
    instanceEmptyCooldownMs: st3.config.instanceEmptyCooldownMs,
    hasStart: typeof api.start,
    hasToggle: typeof api.toggle,
    hasSetConfig: typeof api.setConfig,
    hasResetInstanceCooldown: typeof api.resetInstanceCooldown,
  };
})()"
```

Expected:
- `enabledMaps: ['four_winds']`
- `mapPriorities` 至少包含 `purgatory: 100`(其他字段因为 MAP_MODULES 空,可能未填,Task 3 后会补全)
- `instanceEmptyCooldownMs: 1800000`
- 4 个函数都是 `'function'`

- [ ] **Step 2.8.2: 验证 localStorage 持久化**

刷新页面,Run:
```bash
node cdp_eval.js auto "(() => ({
  stored: window.localStorage.getItem('mu_multi_map_boss_mvp_v1'),
}))"
```

Expected: `stored` 含上面 setConfig 的结果(JSON 字符串)。

- [ ] **Step 2.8.3: 测试 Ctrl+N 不会报错**

把 `enabledMaps` 重置为默认。Run:
```bash
node cdp_eval.js auto "(() => { window.__muMultiMapBossMvp.setConfig({ enabledMaps: ['four_winds','trial_land','purgatory'], mapPriorities: { four_winds: 10, trial_land: 20, purgatory: 30 } }); return { ok: true }; })()"
```

(用户在浏览器里按 Ctrl+N,应看到 toast "BOSS脚本 已开启",但因为还没装 scheduler 和 executors,脚本不会有动作。再按一次应看到 "已关闭"。)

- [ ] **Step 2.8.4: commit Task 2**

```bash
git add mu-boss-multi-map-mvp.user.js
git commit -m "$(cat <<'EOF'
feat(multi-map-boss): config normalization, API, keyboard toggle

Implement normalizeConfig with new fields (enabledMaps, mapPriorities,
enabledBosses, purgatoryMapChoice, instanceEmptyCooldownMs). Expose
window.__muMultiMapBossMvp with start/toggle/pause/resume/status/
setConfig/scanNow/getModule/getTargets/resetInstanceCooldown. Wire
Ctrl+N toggle (guarded by __muMultiMapBossToggleKeyBound). Config
persisted to localStorage mu_multi_map_boss_mvp_v1.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Task 2 完成标准:** `setConfig` 修改 config 生效 + 持久化;Ctrl+N 切换不报错。注意:scheduler/executors 还未实现,`toggle()` 切到 on 状态下不会有实际动作,但不会报错(resetAllContexts 和 releaseLockedTarget 已占位/定义)。

---

## Task 3: 三个地图模块对象

**目标:** 定义 `fourWindsModule` / `trialLandModule` / `purgatoryModule` 并注册到 `MAP_MODULES`。`state.targets` 从 `MAP_MODULES` 扁平化生成。`createTargetState` 占位定义(完整逻辑在 Task 4)。

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js`

### Step 3.1: 用真实模块定义替换空 MAP_MODULES

- [ ] **Step 3.1.1: 替换 MAP_MODULES 占位**

把 Task 1 的 `const MAP_MODULES = [];` 替换为(注意:模块定义必须在 `normalizeConfig` 函数之后,因为 `normalizeMapPriorities` 会读 `MAP_MODULES`):

```js
const fourWindsModule = Object.freeze({
  id: 'four_winds',
  mapName: '四风平原',
  type: 'wild',
  priority: 10,
  enabled: true,
  farmTarget: { name: '1500级怪物' },
  bossRowTab: '野外BOSS',
  bossRowScroll: null,
  enterButtonTog: null,
  enterButtonTextRegex: null,
  hasTaskbar: false,
  bosses: [
    { id: 'ao-left',   name: '傲之煞',       coordinate: '77,145' },
    { id: 'ao-right',  name: '傲之煞',       coordinate: '182,164' },
    { id: 'angry-ao',  name: '愤怒傲之煞',   coordinate: '179,79' },
    { id: 'rage-ao',   name: '狂暴傲之煞',   coordinate: '82,88' },
  ],
});

const trialLandModule = Object.freeze({
  id: 'trial_land',
  mapName: '试炼之地1',
  type: 'instance',
  priority: 20,
  enabled: true,
  farmTarget: null,
  bossRowTab: '试炼之地',
  bossRowScroll: 'privatelevelScroll',
  enterButtonTog: 'privatetog_mapName',
  enterButtonTextRegex: /^试炼之地1/,
  hasTaskbar: false,
  bosses: [
    { id: 'lobster-1', name: '龙虾战士',       coordinate: '146,127', layer: 1 },
    { id: 'lobster-2', name: '邪恶龙虾战士',   coordinate: '79,68',   layer: 1 },
    { id: 'lobster-3', name: '咆哮龙虾战士',   coordinate: '122,33',  layer: 1 },
  ],
});

const purgatoryModule = Object.freeze({
  id: 'purgatory',
  mapName: '苦难炼狱2',
  type: 'instance',
  priority: 30,
  enabled: true,
  farmTarget: null,
  bossRowTab: '苦难炼狱',
  bossRowScroll: 'wildlevelScroll',
  enterButtonTog: 'wildtog_mapName',
  enterButtonTextRegex: /^苦难炼狱2/,
  hasTaskbar: false,
  bosses: [
    // 坐标由 Task 0 CDP 探查写死;若 Task 0 结论为 (126,95) 则填入
    { id: 'magic-crystal', name: '魔晶菲尼斯', coordinate: '<填入 Task 0 探查值>' },
  ],
});

const MAP_MODULES = [fourWindsModule, trialLandModule, purgatoryModule];
```

**重要**:`purgatoryModule.bosses[0].coordinate` 必须用 Task 0 探查到的真实坐标替换占位符 `<填入 Task 0 探查值>`(例如 `'126,95'`)。**如果 Task 0 还没做或没拿到坐标,先用 `'126,95'` 作占位,Task 0 完成后回填**。

### Step 3.2: 实现 createTargetState 占位

- [ ] **Step 3.2.1: 添加 createTargetState 函数**

```js
function createTargetState(target) {
  return {
    ...target,
    refreshAt: null,
    lastRefreshAt: null,
    lastRecordAt: 0,
    cooldownUntil: 0,
    cooldownRefreshAt: null,
    status: 'UNKNOWN',
  };
}
```

### Step 3.3: 在 state 初始化时扁平化生成 state.targets

- [ ] **Step 3.3.1: 在 state 对象定义后添加 targets 初始化**

Task 1 的 state 对象里 `targets: []`。在 `state.config = normalizeConfig(...)` 之后,添加:

```js
state.targets = MAP_MODULES.flatMap(module =>
  module.bosses.map(boss => createTargetState({
    ...boss,
    moduleId: module.id,
    mapName: module.mapName,
  }))
);
```

### Step 3.4: 验证 + commit

- [ ] **Step 3.4.1: 验证 MAP_MODULES 注册正确**

刷新游戏页面。Run:
```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  if (!api) return { error: 'no api' };
  const fw = api.getModule('four_winds');
  const tl = api.getModule('trial_land');
  const pg = api.getModule('purgatory');
  const targets = api.getTargets();
  return {
    fourWindsBossCount: fw ? fw.bosses.length : null,
    trialLandBossCount: tl ? tl.bosses.length : null,
    purgatoryBossCount: pg ? pg.bosses.length : null,
    totalTargets: targets.length,
    targetIds: targets.map(t => t.id),
    purgatoryCoord: pg ? pg.bosses[0].coordinate : null,
    mapPriorities: api.status().config.mapPriorities,
  };
})()"
```

Expected:
- `fourWindsBossCount: 4`,`trialLandBossCount: 3`,`purgatoryBossCount: 1`
- `totalTargets: 8`
- `targetIds: ['ao-left','ao-right','angry-ao','rage-ao','lobster-1','lobster-2','lobster-3','magic-crystal']`
- `purgatoryCoord` 为 Task 0 填入的坐标字符串
- `mapPriorities: { four_winds: 10, trial_land: 20, purgatory: 30 }`(完整 3 个键)

- [ ] **Step 3.4.2: commit Task 3**

```bash
git add mu-boss-multi-map-mvp.user.js
git commit -m "$(cat <<'EOF'
feat(multi-map-boss): register three map modules

Define fourWindsModule (4 傲之煞 BOSS + farming), trialLandModule (3
龙虾 BOSS), purgatoryModule (1 魔晶菲尼斯, coordinate hardcoded from
Task 0 CDP exploration). state.targets flattened from MAP_MODULES (8
targets total). createTargetState adds refreshAt/cooldownUntil/status
fields per target.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Task 3 完成标准:** 8 个 targets 正确生成,3 个模块可通过 `getModule(id)` 查询。

---

## Task 4: Reconcile & Target State + readSnapshot

**目标:** 实现 `readSnapshot`(扫描整个 UI 状态)、`reconcileTargets`(从 overlay records 更新 targets 的 refreshAt/status)、`recordMatchesTarget`/`selectMatchingRecord`/`targetStatus`/`isCooling`/`markContested`/`validRefreshAt`/`validRecordAt`/`clearCooldown` 等辅助函数。

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js`

### Step 4.1: 实现 readSnapshot

- [ ] **Step 4.1.1: 添加 readSnapshot**

```js
function readSnapshot() {
  const gRoot = root();
  const nodes = gRoot ? collectNodes(gRoot) : [];
  const snapshot = {
    at: Date.now(),
    overlay: readOverlay(),
    scene: scanScene(nodes),
    mapPanel: scanMapPanel(nodes),
    combat: scanCombat(nodes),
    bossChallengePanel: scanBossChallengePanel(nodes),
    autoBattle: scanAutoBattle(nodes),
    fguiReady: Boolean(gRoot),
  };
  // 注:scanTrialTaskbar 删除,不读
  const farmTargetMissing = snapshot.mapPanel.open && !snapshot.mapPanel.farmTarget;
  if (farmTargetMissing && !state.farmTargetMissing) {
    appendLog('farm_target_missing', { reason: snapshot.mapPanel.farmTargetReason });
  }
  state.farmTargetMissing = farmTargetMissing;
  state.lastSnapshot = snapshot;
  return clone(snapshot);
}
```

跟原脚本 L191-212 几乎完全一致,**唯一区别**是去掉 `trialTaskbar: scanTrialTaskbar(nodes)` 一行。

### Step 4.2: 实现 reconcileTargets

- [ ] **Step 4.2.1: 添加 reconcileTargets**

```js
function reconcileTargets(snapshot) {
  const now = Number(snapshot && snapshot.at) || Date.now();
  const records = snapshot && snapshot.overlay && Array.isArray(snapshot.overlay.records)
    ? snapshot.overlay.records
    : [];
  const previousById = new Map(state.targets.map((target) => [target.id, target]));
  state.targets = MAP_MODULES.flatMap((module) => {
    // 过滤当前 module 在 enabledMaps 内才纳入 reconcile
    if (!state.config.enabledMaps.includes(module.id)) return [];
    return module.bosses.map((definition) => {
      const previous = previousById.get(definition.id) || createTargetState(definition);
      const target = { ...createTargetState(definition), ...clone(previous), ...definition, moduleId: module.id, mapName: module.mapName };
      const matchingRecord = selectMatchingRecord(records, target);
      if (matchingRecord) {
        const refreshAt = validRefreshAt(matchingRecord.refreshAt);
        if (refreshAt !== null) {
          target.refreshAt = refreshAt;
          target.lastRefreshAt = refreshAt;
          target.lastRecordAt = validRecordAt(matchingRecord.observedAt, now);
          // 有新 overlay 刷新记录 → 清除副本空场冷却(说明 BOSS 已刷新)
          if (state.instanceCheckCooldown[module.id] && state.instanceCheckCooldown[module.id] > now) {
            delete state.instanceCheckCooldown[module.id];
            appendLog('instance_cooldown_lifted', { moduleId: module.id, reason: 'overlay got refresh record' });
          }
        } else {
          target.refreshAt = null;
          target.lastRefreshAt = null;
          target.lastRecordAt = validRecordAt(matchingRecord.observedAt, now);
        }
      } else {
        if (!validRefreshAt(target.refreshAt)) {
          target.refreshAt = null;
          target.lastRefreshAt = null;
        }
        target.lastRecordAt = 0;
      }
      target.status = targetStatus(target, now);
      return target;
    });
  });
  return clone(state.targets);
}
```

跟原 L214-249 主要差异:
1. 用 `MAP_MODULES.flatMap` 替代硬编码 `TARGETS.map`
2. 跳过 `!enabledMaps.includes(module.id)` 的模块
3. 添加"overlay 拿到新记录 → 清除副本空场冷却"逻辑(防折返解除条件)

### Step 4.3: 实现辅助函数

- [ ] **Step 4.3.1: 添加匹配/状态/冷却函数**

```js
function recordMatchesTarget(record, target) {
  if (!record || !target) return false;
  if (cleanText(record.mapName) !== target.mapName) return false;
  if (cleanText(record.bossName) !== target.name) return false;
  const rawCoordinate = cleanText(record.bossCoordinate);
  if (!rawCoordinate) return true;
  const coordinate = normalizeCoordinate(rawCoordinate);
  if (!coordinate || !target.coordinate || target.coordinate === 'TBD') return true;
  return chebyshevDistance(coordinate, target.coordinate) <= 3;
}

function selectMatchingRecord(records, target) {
  return records
    .filter((record) => recordMatchesTarget(record, target))
    .sort((left, right) => {
      const coordinateDelta = Number(Boolean(normalizeCoordinate(right.bossCoordinate)))
        - Number(Boolean(normalizeCoordinate(left.bossCoordinate)));
      if (coordinateDelta) return coordinateDelta;
      return validRecordAt(right.observedAt, 0) - validRecordAt(left.observedAt, 0);
    })[0] || null;
}

function validRefreshAt(value) {
  const refreshAt = Number(value);
  return Number.isFinite(refreshAt) && refreshAt > 0 ? refreshAt : null;
}

function validRecordAt(value, fallback) {
  const recordAt = Number(value);
  return Number.isFinite(recordAt) && recordAt > 0 ? recordAt : fallback;
}

function clearCooldown(target) {
  target.cooldownUntil = 0;
  target.cooldownRefreshAt = null;
}

function isCooling(target, now) {
  return Boolean(target && Number(target.cooldownUntil) > now);
}

function markContested(target, now) {
  if (!target) return;
  const contestedAt = Number(now) || Date.now();
  target.cooldownUntil = contestedAt + state.config.contestedCooldownMs;
  target.cooldownRefreshAt = validRefreshAt(target.refreshAt);
  target.status = 'COOLING';
  state.currentTargetId = '';
  state.currentAction = null;
}

function targetStatus(target, now) {
  if (isCooling(target, now)) return 'COOLING';
  const refreshAt = validRefreshAt(target && target.refreshAt);
  if (refreshAt === null) return 'READY_UNKNOWN_TIMER';
  if (refreshAt <= now) return 'READY';
  if (refreshAt - now <= state.config.preWaitSeconds * 1000) return 'PREPARE';
  return 'WAITING_REFRESH';
}

function targetById(id) {
  return state.targets.find((target) => target.id === id) || null;
}

function chebyshevDistance(coordA, coordB) {
  const a = String(coordA).split(',').map(Number);
  const b = String(coordB).split(',').map(Number);
  if (a.length < 2 || b.length < 2 || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return Infinity;
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}
```

### Step 4.4: 实现 releaseLockedTarget

- [ ] **Step 4.4.1: 添加 releaseLockedTarget**

```js
function releaseLockedTarget() {
  state.currentTargetId = '';
  state.currentAction = null;
  state.currentIntent = null;
}
```

### Step 4.5: 实现 moduleByMapName helper

- [ ] **Step 4.5.1: 添加 moduleByMapName**

```js
function moduleByMapName(mapName) {
  if (!mapName) return null;
  return MAP_MODULES.find(m => m.mapName === mapName && state.config.enabledMaps.includes(m.id)) || null;
}

function moduleById(moduleId) {
  return MAP_MODULES.find(m => m.id === moduleId) || null;
}

function effectiveModulePriority(module) {
  if (!module) return 0;
  const override = state.config.mapPriorities && state.config.mapPriorities[module.id];
  return (typeof override === 'number' && Number.isFinite(override)) ? override : module.priority;
}

function isModuleEnabled(module) {
  return Boolean(module && module.enabled && state.config.enabledMaps.includes(module.id));
}

function isBossEnabled(target) {
  return Boolean(target && state.config.enabledBosses.includes(target.id));
}

function setInstanceCheckCooldown(moduleId, until) {
  state.instanceCheckCooldown[moduleId] = until;
  appendLog('instance_cooldown_set', { moduleId, until });
}

function isInstanceInCooldown(moduleId, now) {
  const until = Number(state.instanceCheckCooldown[moduleId]) || 0;
  return until > now;
}
```

### Step 4.6: 验证 + commit

- [ ] **Step 4.6.1: 验证 readSnapshot 和 reconcileTargets**

Run:
```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  if (!api) return { error: 'no api' };
  const snap = api.scanNow();
  return {
    fguiReady: snap.fguiReady,
    sceneMapName: snap.scene && snap.scene.mapName,
    overlayAvailable: snap.overlay && snap.overlay.available,
    overlayRecordsCount: snap.overlay && snap.overlay.records ? snap.overlay.records.length : 0,
    bossPanelOpen: snap.bossChallengePanel && snap.bossChallengePanel.open,
    mapPanelOpen: snap.mapPanel && snap.mapPanel.open,
  };
})()"
```

Expected: `fguiReady: true`,`sceneMapName` 反映当前角色所在地图,其他字段按游戏当前状态。

- [ ] **Step 4.6.2: 验证 reconcileTargets 不崩**

让脚本 tick 一次(虽然 Task 5 才装 scheduleTick,可手动调):
```bash
node cdp_eval.js auto "(() => {
  // 手动调 reconcileTargets 看是否崩。因为不是 tick 内部,无法直接调;通过 toggle 启停看日志
  const api = window.__muMultiMapBossMvp;
  api.start();  // enabled=true, dryRun=false
  return { started: true };
})()"
```

然后 `api.scanNow()` 多次,看是否有 tick_error 日志(在 `status().logs`)。Expected: 没有 tick_error。

- [ ] **Step 4.6.3: 关闭脚本避免后续 tick 干扰**

```bash
node cdp_eval.js auto "(() => { window.__muMultiMapBossMvp.setConfig({ enabled: false, dryRun: true }); return { ok: true }; })()"
```

- [ ] **Step 4.6.4: commit Task 4**

```bash
git add mu-boss-multi-map-mvp.user.js
git commit -m "$(cat <<'EOF'
feat(multi-map-boss): snapshot reading and target reconciliation

Implement readSnapshot (without trialTaskbar scan, removed in new
design). reconcileTargets now iterates MAP_MODULES (skipping modules
not in enabledMaps) and clears instanceCheckCooldown for a module when
overlay provides a fresh refresh record for that module's boss (防折返
解除条件). Add helpers: targetStatus/isCooling/markContested/
recordMatchesTarget/selectMatchingRecord/moduleByMapName/
effectiveModulePriority/isModuleEnabled/isBossEnabled/
setInstanceCheckCooldown/isInstanceInCooldown.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Task 4 完成标准:** `scanNow()` 不报错,`reconcileTargets` 不崩,`status().targets[*].status` 字段有合理值。

---

## Task 5: chooseIntent 调度核心 + tick 循环

**目标:** 实现 `tick` 主循环、`scheduleTick`、`chooseIntent` 主入口(按 §4 伪代码)、`chooseWildIntent`/`chooseInstanceIntent`/`intentForTarget`/`intentForLockedTarget`/`isLockingIntent`/`hasLockedValidTarget`/`isLockTargetEligible`/`applyIntent`/`makeIntent`/`shouldEnterInstance`/`shouldPrioritizeInstance`/`getAttackableTargets`/`isVisibleAndAttackable`/`isAlreadyFarming`/`isAtTarget`/`selectHighestPriorityTarget`/`selectInstanceTarget`/`findVisibleAttackableTarget`/`observeContestedOwner`/`resetOwnerObservation`/`hasVisibleHpBar`。**不**实现 executeIntent 的 dispatch(那是 Task 6),先在 tick 里占位调 `executeIntentPlaceholder`。

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js`

### Step 5.1: 实现 scheduleTick + tick

- [ ] **Step 5.1.1: 添加 scheduleTick + tick**

```js
function scheduleTick() {
  if (state.tickId !== null) return;
  state.tickId = window.setInterval(tick, TICK_MS);
}

function tick() {
  try {
    const snapshot = readSnapshot();
    reconcileTargets(snapshot);
    const intent = chooseIntent(snapshot);
    if (state.enabled && !state.dryRun && !state.paused) {
      return executeIntentPlaceholder(intent, snapshot);
    }
    return intent;
  } catch (error) {
    state.lastError = { at: Date.now(), message: error && error.message ? error.message : String(error) };
    appendLog('tick_error', { message: error && error.message ? error.message : String(error) });
    return null;
  }
}

function executeIntentPlaceholder(intent, snapshot) {
  // Task 6 会替换为真正 executeIntent
  appendLog('intent_placeholder', { type: intent && intent.type, reason: intent && intent.reason });
  return intent;
}
```

在 `setupKeyboardToggle()` 调用之后,添加 `scheduleTick();`。

### Step 5.2: 实现 makeIntent 和 applyIntent

- [ ] **Step 5.2.1: 添加 makeIntent + applyIntent**

```js
function makeIntent(type, targetId, reason, action, confidence) {
  return {
    type,
    targetId: targetId || null,
    reason: cleanText(reason),
    action: action || 'none',
    confidence: clampNumber(confidence, 0, 1, 0),
  };
}

function applyIntent(intent) {
  const next = clone(intent);
  const previousTargetId = state.currentTargetId;
  if (next.targetId) state.currentTargetId = next.targetId;
  else if (next.type !== 'safe_wait' && next.type !== 'enter_instance'
    && next.type !== 'exit_instance' && next.type !== 'teleport_to_module'
    && next.type !== 'scan_map') state.currentTargetId = '';
  if (state.currentTargetId && state.currentTargetId !== previousTargetId) {
    state.arrivalConfirmedAt = 0;
    state.zKeySentAt = 0;
    state.zKeyRetryCount = 0;
    state.holdStartedAt = 0;
  }
  state.currentAction = next.action === 'none' ? null : next.action;
  state.phase = next.type.toUpperCase();
  if (!isLockingIntent() && state.navigationContext) {
    appendLog('nav_context_cleared', { reason: 'intent not locking: ' + next.type });
    state.navigationContext = null;
  }
  state.lastIntent = next;
  state.currentIntent = next;
  return clone(next);
}
```

### Step 5.3: 实现 isLockingIntent / hasLockedValidTarget / isLockTargetEligible / releaseLockedTarget

- [ ] **Step 5.3.1: 添加这些函数**

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

function hasLockedValidTarget(snapshot) {
  const target = targetById(state.currentTargetId);
  const now = Number(snapshot.at) || Date.now();
  if (!isLockingIntent()) return false;
  if (state.currentIntent.type === 'travel_farm') return false;
  if (state.currentAction === 'navigation_failed' || !isLockTargetEligible(target, now)) {
    releaseLockedTarget();
    return false;
  }
  if (state.currentIntent.type === 'engage' || state.currentIntent.type === 'observe_owner') {
    if (!target || isCooling(target, now)) {
      releaseLockedTarget();
      return false;
    }
    return true;
  }
  return !findVisibleAttackableTarget(snapshot, target.id);
}

function isLockTargetEligible(target, now) {
  if (!target) return false;
  const definition = MAP_MODULES.flatMap(m => m.bosses).find((item) => item.id === target.id);
  const allowedStatuses = ['READY_UNKNOWN_TIMER', 'READY', 'PREPARE'];
  return Boolean(definition
    && definition.name === target.name
    && !isCooling(target, now)
    && allowedStatuses.includes(target.status));
}

function findVisibleAttackableTarget(snapshot, excludedTargetId) {
  return state.targets.find((target) => target.id !== excludedTargetId
    && !isCooling(target, Number(snapshot.at) || Date.now())
    && isVisibleAndAttackable(target, snapshot)) || null;
}
```

### Step 5.4: 实现 chooseIntent 主入口

- [ ] **Step 5.4.1: 添加 chooseIntent**

```js
function chooseIntent(snapshot) {
  let intent;
  if (!state.config.enabled) {
    resetOwnerObservation();
    intent = makeIntent('disabled', null, 'config disabled', 'none', 1);
  } else if (state.paused) {
    resetOwnerObservation();
    intent = makeIntent('safe_wait', state.currentTargetId || null, state.pauseReason || 'paused', 'none', 1);
  } else if (!snapshot || !snapshot.fguiReady || !snapshot.overlay || !snapshot.overlay.available) {
    resetOwnerObservation();
    intent = makeIntent('sync', null, 'runtime unavailable', 'none', 0);
  } else if (state.enterInstanceCtx) {
    intent = makeIntent('enter_instance', state.enterInstanceCtx.selectedBossId || null,
      'entering instance: ' + state.enterInstanceCtx.phase, 'enter_instance', 0.95);
  } else if (state.exitInstanceCtx) {
    intent = makeIntent('exit_instance', null,
      'exiting instance: ' + state.exitInstanceCtx.phase, 'exit_instance', 0.95);
  } else if (state.teleportCtx) {
    intent = makeIntent('teleport_to_module', null,
      'teleporting to module: ' + state.teleportCtx.phase, 'teleport_wild', 0.95);
  } else if (needRateCheck(snapshot)) {
    resetOwnerObservation();
    intent = makeIntent('check_rate', null, 'boss rate check due', 'check_boss_rate', 0.96);
  } else if (hasLockedValidTarget(snapshot)) {
    intent = intentForLockedTarget(snapshot);
  } else {
    const mapName = (snapshot.scene || {}).mapName || '';
    const currentModule = moduleByMapName(mapName);
    if (currentModule && currentModule.type === 'instance') {
      intent = chooseInstanceIntent(snapshot, currentModule);
    } else if (currentModule && currentModule.type === 'wild') {
      intent = chooseWildIntent(snapshot, currentModule);
    } else {
      // 3c. 勇者大陆或其他地图:按优先级统一决策,不无脑回四风
      intent = chooseUnknownMapIntent(snapshot);
    }
  }

  // 爆率低优先级兜底
  if (!intent || intent.type === 'safe_wait' || intent.type === 'disabled' || intent.type === 'sync') {
    const currentMapName = (snapshot.scene || {}).mapName || '';
    const currentModule = moduleByMapName(currentMapName);
    if (currentModule && isMapRateLow(currentModule.mapName)) {
      resetOwnerObservation();
      releaseLockedTarget();
      if (isAlreadyFarming(snapshot)) {
        intent = makeIntent('safe_wait', null, 'boss rate low - already farming', 'none', 0.5);
      } else {
        intent = makeIntent('travel_farm', null, 'boss rate low - farming only', 'click_farm_target', 0.5);
      }
    }
  }

  return applyIntent(intent);
}
```

### Step 5.5: 实现 chooseInstanceIntent / chooseWildIntent / chooseUnknownMapIntent

- [ ] **Step 5.5.1: 添加 chooseInstanceIntent**

```js
function chooseInstanceIntent(snapshot, module) {
  const now = Number(snapshot.at) || Date.now();
  const attackable = getAttackableTargets(module, now);
  if (attackable.length) {
    const target = selectInstanceTarget(attackable, snapshot);
    return intentForTarget(target, module, snapshot);
  }
  // 本副本 BOSS 状态未知 → 先 scan 判空
  if (needMapScan(snapshot, module)) {
    return makeIntent('scan_map', null, 'scan instance for boss presence', 'open_map_scan', 0.85);
  }
  // scan 后确认无 BOSS → 写副本空场冷却 + 退出
  setInstanceCheckCooldown(module.id, now + state.config.instanceEmptyCooldownMs);
  return makeIntent('exit_instance', null, 'no boss in instance, cooldown set', 'exit_instance', 0.85);
}
```

- [ ] **Step 5.5.2: 添加 chooseWildIntent**

```js
function chooseWildIntent(snapshot, module) {
  const now = Number(snapshot.at) || Date.now();
  // 优先:实例模块可进
  const instances = MAP_MODULES
    .filter(m => m.type === 'instance' && isModuleEnabled(m))
    .sort((a, b) => effectiveModulePriority(b) - effectiveModulePriority(a));
  for (const instModule of instances) {
    if (shouldEnterInstance(instModule, snapshot, now)) {
      return makeIntent('enter_instance', null, instModule.id + ' has boss', 'enter_instance', 0.92);
    }
  }
  // 本野外地图 BOSS
  if (!isMapRateLow(module.mapName)) {
    const candidate = selectHighestPriorityTarget(snapshot, module);
    if (candidate) return intentForTarget(candidate, module, snapshot);
  }
  // farming
  resetOwnerObservation();
  if (isAlreadyFarming(snapshot)) return makeIntent('safe_wait', null, 'no boss work - already farming', 'none', 0.8);
  return makeIntent('travel_farm', null, 'no boss work', 'click_farm_target', 0.8);
}
```

- [ ] **Step 5.5.3: 添加 chooseUnknownMapIntent**

```js
function chooseUnknownMapIntent(snapshot) {
  const now = Number(snapshot.at) || Date.now();
  // 优先:实例模块可进(经挑战 BOSS 面板,不需要先传送野外)
  const instances = MAP_MODULES
    .filter(m => m.type === 'instance' && isModuleEnabled(m))
    .sort((a, b) => effectiveModulePriority(b) - effectiveModulePriority(a));
  for (const instModule of instances) {
    if (shouldEnterInstance(instModule, snapshot, now)) {
      return makeIntent('enter_instance', null, instModule.id + ' has boss', 'enter_instance', 0.92);
    }
  }
  // 否则:传送回优先级最高的野外模块
  const wildModule = selectHighestPriorityWildModule(snapshot);
  if (wildModule) {
    return makeIntent('teleport_to_module', null, 'go to wild map: ' + wildModule.id, 'teleport_wild', 0.85);
  }
  // 兜底:传送四风平原(默认)
  const fw = moduleById('four_winds');
  return makeIntent('teleport_to_module', null, 'fallback to four winds', 'teleport_wild', 0.8);
}

function selectHighestPriorityWildModule(snapshot) {
  const now = Number(snapshot.at) || Date.now();
  const wilds = MAP_MODULES
    .filter(m => m.type === 'wild' && isModuleEnabled(m))
    .sort((a, b) => effectiveModulePriority(b) - effectiveModulePriority(a));
  // 优先选有可打 BOSS 的野外图
  for (const m of wilds) {
    if (!isMapRateLow(m.mapName)) {
      const attackable = getAttackableTargets(m, now);
      if (attackable.length) return m;
    }
  }
  // 否则默认四风平原
  return wilds.find(m => m.id === 'four_winds') || wilds[0] || null;
}
```

### Step 5.6: 实现 intentForTarget / intentForLockedTarget

- [ ] **Step 5.6.1: 添加 intentForTarget**

```js
function intentForTarget(target, module, snapshot) {
  if (!target) return makeIntent('sync', null, 'target missing', 'none', 0);
  // 1. 被他人占据 → 观察
  if (observeContestedOwner(target, snapshot)) {
    return makeIntent('safe_wait', null, 'boss contested cooldown', 'none', 0.95);
  }
  // 2. 在视野内可攻击
  if (isVisibleAndAttackable(target, snapshot)) {
    const ownerName = cleanText(snapshot.combat && snapshot.combat.ownerName);
    if (ownerName && ownerName !== state.config.ownerName) {
      return makeIntent('observe_owner', target.id, 'visible boss owned by another player', 'observe_owner', 0.95);
    }
    return makeIntent('engage', target.id, 'visible boss is attackable', 'ensure_auto_battle', 1);
  }
  // 3. 已到坐标 → hold
  if (isAtTarget(target, snapshot)) {
    if (target.status === 'READY_UNKNOWN_TIMER') {
      if (!state.holdStartedAt) state.holdStartedAt = Number(snapshot.at) || Date.now();
      const HOLD_UNKNOWN_TIMEOUT_MS = 60 * 1000;
      const now = Number(snapshot.at) || Date.now();
      if (now - state.holdStartedAt > HOLD_UNKNOWN_TIMEOUT_MS) {
        appendLog('hold_timeout_unknown', { targetId: target.id, elapsedMs: now - state.holdStartedAt });
        state.lastCheckedAt[target.id] = now;
        releaseLockedTarget();
        state.holdStartedAt = 0;
        return makeIntent('safe_wait', null, 'hold timeout - boss not refreshing', 'none', 0.7);
      }
    } else {
      state.holdStartedAt = 0;
    }
    return makeIntent('hold', target.id, 'at boss coordinate', 'hold_position', 0.95);
  }
  // 4. 副本模块且当前不在该副本内 → enter_instance
  if (module.type === 'instance' && snapshot.scene.mapName !== module.mapName) {
    return makeIntent('enter_instance', null, module.id + ' has boss, need enter', 'enter_instance', 0.95);
  }
  // 5. 已在正确地图但未到坐标 → travel_boss
  return makeIntent('travel_boss', target.id, 'go to boss coord', 'click_boss_target', 0.9);
}

function intentForLockedTarget(snapshot) {
  const target = targetById(state.currentTargetId);
  if (!target) return makeIntent('sync', null, 'locked target missing', 'none', 0);
  const module = moduleById(target.moduleId);
  if (!module) return makeIntent('sync', null, 'module missing', 'none', 0);
  return intentForTarget(target, module, snapshot);
}
```

### Step 5.7: 实现 shouldEnterInstance / shouldPrioritizeInstance / getAttackableTargets / selectInstanceTarget

- [ ] **Step 5.7.1: 添加这些函数**

```js
function shouldEnterInstance(module, snapshot, now) {
  if (!isModuleEnabled(module)) return false;
  if (module.type !== 'instance') return false;
  if (isInstanceInCooldown(module.id, now)) return false;
  // 已在该副本内不算"应进入"(由 chooseInstanceIntent 处理)
  if (snapshot.scene && snapshot.scene.mapName === module.mapName) return false;
  // 至少有 1 个可打 BOSS
  const attackable = getAttackableTargets(module, now);
  if (!attackable.length) return false;
  // 爆率非 low(若该模块纳入爆率检查)
  if (RATE_CHECK_MAPS[module.mapName] && isMapRateLow(module.mapName)) return false;
  // 不在另一个 instance ctx 内
  if (state.enterInstanceCtx || state.exitInstanceCtx) return false;
  return true;
}

function shouldPrioritizeInstance(module, snapshot, now) {
  // 用于实例 vs 野外优先级比较;简化版:该模块有 READY/READY_UNKNOWN_TIMER 状态 BOSS 就优先
  if (!isModuleEnabled(module) || module.type !== 'instance') return false;
  if (isInstanceInCooldown(module.id, now)) return false;
  const attackable = getAttackableTargets(module, now);
  if (!attackable.length) return false;
  return attackable.some(t => {
    const st = targetStatus(t, now);
    return st === 'READY' || st === 'READY_UNKNOWN_TIMER';
  });
}

function getAttackableTargets(module, now) {
  if (!module) return [];
  if (isMapRateLow(module.mapName)) return [];
  if (!isModuleEnabled(module)) return [];
  return state.targets.filter((t) => {
    if (t.moduleId !== module.id) return false;
    if (!isBossEnabled(t)) return false;
    if (isCooling(t, now)) return false;
    const status = targetStatus(t, now);
    return status === 'READY' || status === 'READY_UNKNOWN_TIMER' || status === 'PREPARE';
  });
}

function selectInstanceTarget(attackable, snapshot) {
  const now = Number(snapshot.at) || Date.now();
  const visible = attackable.filter((t) => isVisibleAndAttackable(t, snapshot));
  if (visible.length) return visible[0];
  const knownTimer = attackable
    .filter((t) => validRefreshAt(t.refreshAt) !== null)
    .sort((a, b) => Number(a.refreshAt) - Number(b.refreshAt));
  if (knownTimer.length) return knownTimer[0];
  return attackable[0] || null;
}

function selectHighestPriorityTarget(snapshot, module) {
  const now = Number(snapshot.at) || Date.now();
  if (!module) return null;
  const lockedTarget = targetById(state.currentTargetId);
  const visibleInterrupt = lockedTarget && isLockingIntent()
    ? findVisibleAttackableTarget(snapshot, lockedTarget.id)
    : null;
  if (visibleInterrupt) return visibleInterrupt;
  const eligible = state.targets.filter((target) =>
    target.moduleId === module.id
    && isBossEnabled(target)
    && !isCooling(target, now)
    && !isMapRateLow(module.mapName));
  const visible = eligible.filter((target) => isVisibleAndAttackable(target, snapshot));
  if (visible.length) return visible[0];
  const soonToRefresh = eligible
    .filter((target) => {
      const refreshAt = validRefreshAt(target.refreshAt);
      return refreshAt !== null && refreshAt > now && refreshAt - now <= state.config.preWaitSeconds * 1000;
    })
    .sort((left, right) => Number(left.refreshAt) - Number(right.refreshAt));
  if (soonToRefresh.length) return soonToRefresh[0];
  const ready = eligible.filter((target) => {
    const refreshAt = validRefreshAt(target.refreshAt);
    return refreshAt !== null && refreshAt <= now;
  });
  if (ready.length) return ready[0];
  const RECHECK_COOLDOWN_MS = 3 * 60 * 1000;
  const unknown = eligible.filter((target) => {
    if (validRefreshAt(target.refreshAt) !== null) return false;
    const lastChecked = Number(state.lastCheckedAt[target.id]) || 0;
    return now - lastChecked > RECHECK_COOLDOWN_MS;
  });
  if (unknown.length) return unknown[0];
  return null;
}
```

### Step 5.8: 实现 isVisibleAndAttackable / isAtTarget / isAlreadyFarming / observeContestedOwner / resetOwnerObservation / hasVisibleHpBar

- [ ] **Step 5.8.1: 添加这些函数(沿用原 L621-754)**

```js
function isVisibleAndAttackable(target, snapshot) {
  const combat = snapshot && snapshot.combat;
  if (!combat || cleanText(combat.targetName) !== target.name) return false;
  if (!hasVisibleHpBar(combat) || Number(combat.hpPercent) === 0) return false;
  const scene = snapshot.scene || {};
  return !scene.mapName || scene.mapName === target.mapName;
}

function isAtTarget(target, snapshot) {
  const scene = snapshot && snapshot.scene;
  if (!scene || scene.mapName !== target.mapName || !scene.coordinate) return false;
  if (target.coordinate === 'TBD') return false;
  return chebyshevDistance(scene.coordinate, target.coordinate) <= ARRIVAL_THRESHOLD;
}

function isAlreadyFarming(snapshot) {
  if (!state.farmArrivedAt || !state.farmArrivedCoord) return false;
  if (state.navigationContext) return false;
  const autoBattle = snapshot && snapshot.autoBattle;
  if (autoBattle && autoBattle.enabled) {
    state.farmLastSeenFarmingAt = Date.now();
    return true;
  }
  if (state.farmLastSeenFarmingAt && Date.now() - state.farmLastSeenFarmingAt < 60000) return true;
  if (Date.now() - state.farmArrivedAt < 15000) return true;
  if (snapshot && snapshot.mapPanel && snapshot.mapPanel.open) return false;
  const coord = snapshot && snapshot.scene && snapshot.scene.coordinate;
  if (!coord) return true;
  return chebyshevDistance(coord, state.farmArrivedCoord) <= ARRIVAL_THRESHOLD;
}

function observeContestedOwner(target, snapshot) {
  const combat = snapshot && snapshot.combat;
  const ownerName = cleanText(combat && combat.ownerName);
  const isForeignOwner = Boolean(combat
    && cleanText(combat.targetName) === target.name
    && hasVisibleHpBar(combat)
    && ownerName
    && ownerName !== state.config.ownerName);
  if (!isForeignOwner) {
    resetOwnerObservation();
    return false;
  }
  const now = Number(snapshot.at) || Date.now();
  if (!state.ownerObservation || state.ownerObservation.targetId !== target.id) {
    state.ownerObservation = { targetId: target.id, observedAt: now };
    return false;
  }
  if (now - state.ownerObservation.observedAt < state.config.ownerObserveSeconds * 1000) return false;
  resetOwnerObservation();
  markContested(target, now);
  return true;
}

function resetOwnerObservation() {
  state.ownerObservation = null;
}

function hasVisibleHpBar(combat) {
  const hpPercent = combat && combat.hpPercent;
  return hpPercent !== null
    && hpPercent !== undefined
    && hpPercent !== ''
    && Number.isFinite(Number(hpPercent));
}
```

### Step 5.9: RATE_CHECK_MAPS 占位 + needRateCheck / needMapScan 占位

- [ ] **Step 5.9.1: 添加 RATE_CHECK_MAPS 和占位辅助**

```js
const RATE_URL_MAP = {
  'txt_bld': 'low',
  'txt_blz': 'medium',
  'txt_blg': 'high',
};

// Task 0 项 5 验证 BaolvIcon 关联后填:
// - 验证成立 → 包含 purgatory
// - 验证不成立 → 不含 purgatory(回退:苦难炼狱不做爆率检查)
const RATE_CHECK_MAPS = {};

function rebuildRateCheckMaps() {
  for (const key in RATE_CHECK_MAPS) delete RATE_CHECK_MAPS[key];
  for (const module of MAP_MODULES) {
    if (!isModuleEnabled(module)) continue;
    // 跳过 Task 0 决定不做爆率检查的模块
    if (module.id === 'purgatory' && !PURGATORY_RATE_CHECK_ENABLED) continue;
    RATE_CHECK_MAPS[module.mapName] = {
      tab: module.bossRowTab,
      bossNames: module.bosses.map(b => b.name),
      mapMatch: module.mapName.replace(/\d+$/, ''),
      moduleId: module.id,
    };
  }
}

// Task 0 项 5 结论回填(默认 false,Task 0 验证成立后改 true)
const PURGATORY_RATE_CHECK_ENABLED = false;
```

`needRateCheck` 和 `needMapScan` 在 Task 6 实现(因为涉及 `executeCheckRate`/`executeScanMap` 调度)。

- [ ] **Step 5.9.2: 在 state.config 初始化后调用 rebuildRateCheckMaps**

在 Task 4 的 `state.config = normalizeConfig(...)` 之后,添加:

```js
rebuildRateCheckMaps();
```

### Step 5.10: 实现 isMapRateLow / getRateResult / nextRateResetTimestamp 占位

- [ ] **Step 5.10.1: 添加爆率占位函数**

```js
function nextRateResetTimestamp() {
  const now = Date.now();
  const utc8Ms = now + 8 * 3600 * 1000;
  const utc8Date = new Date(utc8Ms);
  // UTC+8 凌晨 8am 重置 = UTC 0am 重置
  const utcMidnight = Date.UTC(utc8Date.getUTCFullYear(), utc8Date.getUTCMonth(), utc8Date.getUTCDate());
  return utcMidnight + 24 * 3600 * 1000;
}

function getRateResult(mapName) {
  if (!mapName) return null;
  // 用 moduleId 存,但兼容按 mapName 查
  const r = state.rateResults[mapName];
  if (!r) return null;
  const now = Date.now();
  if (r.result === 'low') {
    if (r.skipUntil && now < r.skipUntil) return r;
    return null;
  }
  if (r.nextCheckAt && now < r.nextCheckAt) return r;
  return null;
}

function isMapRateLow(mapName) {
  const r = getRateResult(mapName);
  return r && r.result === 'low' ? true : false;
}

function needRateCheck(snapshot) {
  // Task 6 完整实现,这里占位返回 false
  return false;
}

function needMapScan(snapshot, module) {
  // Task 6 完整实现,这里占位返回 false
  return false;
}
```

### Step 5.11: 验证 + commit

- [ ] **Step 5.11.1: 验证 chooseIntent 不崩**

刷新页面,启动脚本(在勇者大陆),Run:
```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  api.start();
  return { started: true };
})()"
# 等 2 秒让 tick 跑几次
sleep 2
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  const st = api.status();
  return {
    currentIntent: st.currentIntent,
    lastError: st.lastError,
    logsTail: st.logs.slice(-10).map(l => l.type + ':' + (l.details && l.details.reason || '')),
  };
})()"
```

Expected:在勇者大陆时 `currentIntent.type` 应为 `'teleport_to_module'`(因为副本没 BOSS + 不在野外),`lastError` 为 null 或仅占位 tick_error。logs 里有 `intent_placeholder:...`。

- [ ] **Step 5.11.2: 关脚本**

```bash
node cdp_eval.js auto "(() => { window.__muMultiMapBossMvp.setConfig({ enabled: false, dryRun: true }); return { ok: true }; })()"
```

- [ ] **Step 5.11.3: commit Task 5**

```bash
git add mu-boss-multi-map-mvp.user.js
git commit -m "$(cat <<'EOF'
feat(multi-map-boss): scheduler core - chooseIntent dispatch

Implement tick loop (readSnapshot → reconcileTargets → chooseIntent →
executeIntentPlaceholder). chooseIntent dispatches by context priority
(enter/exit/teleport ctx > rate check > locked target > current map
type > unknown map). In-instance: only looks at instance bosses, never
teleports. In-wild: tries to enter instance modules by priority first,
then local wild bosses, then farming. Unknown map (勇者大陆): tries
enter_instance first, else teleport_to_module to highest-priority
wild. Intent types use unified enter_instance/exit_instance/
teleport_to_module (replacing trial-specific names). applyIntent
clears arrival/zKey state on target switch. RATE_CHECK_MAPS rebuilt
dynamically from MAP_MODULES. needRateCheck/needMapScan still
placeholders (Task 6).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Task 5 完成标准:** 在勇者大陆时 `currentIntent.type === 'teleport_to_module'`;tick 不崩;切换 target 时清状态。

---

## Task 6: executeIntent dispatch + 通用 executor

**目标:** 实现 `executeIntent` 主 dispatch、`executeHold`/`executeEngage`/`executeObserveOwner`/`executeCheckRate`/`executeScanMap`/`executeTravel`/`checkNavProgress`/`ensureAutoBattle`/`ensureZKey`/`toggleAutoFight`/`isAutoFightOn`/`closePanelIfExists`/`ensureMapReady`/`clickOpenMapButton`/`closeMapPanel`/`findNodeByPathSummary`/`needMapScan`/`needRateCheck`/`getRateResult`/`isMapRateLow`/`markRateCheckDone`/`parseCountdownMs`。这些函数大多从原脚本直接复制,`executeTravel` 加 `module` 参数用于 `contentReady`。

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js`

### Step 6.1: 替换 executeIntentPlaceholder 为真正 executeIntent

- [ ] **Step 6.1.1: 删除 executeIntentPlaceholder,添加 executeIntent**

```js
function executeIntent(intent, snapshot) {
  if (!intent) return null;
  state.currentAction = intent.action || intent.type;
  const now = Date.now();

  if (intent.action === 'none' || intent.type === 'sync' || intent.type === 'disabled' || intent.type === 'safe_wait') {
    appendLog('intent_' + intent.type, { reason: intent.reason, targetId: intent.targetId });
    return clone(intent);
  }

  if (now - state.lastActionAt < 500) {
    appendLog('action_throttled', { msSinceLast: now - state.lastActionAt });
    return clone(intent);
  }

  let result;
  switch (intent.type) {
    case 'travel_boss': result = executeTravel(intent, snapshot, 'boss'); break;
    case 'travel_farm': result = executeTravel(intent, snapshot, 'farm'); break;
    case 'hold': result = executeHold(intent, snapshot); break;
    case 'engage': result = executeEngage(intent, snapshot); break;
    case 'observe_owner': result = executeObserveOwner(intent, snapshot); break;
    case 'check_rate': result = executeCheckRate(intent, snapshot); break;
    case 'scan_map': result = executeScanMap(intent, snapshot); break;
    // enter_instance / exit_instance / teleport_to_module 在 Task 7 实现
    case 'enter_instance': result = { ok: true, reason: 'task7_pending' }; break;
    case 'exit_instance': result = { ok: true, reason: 'task7_pending' }; break;
    case 'teleport_to_module': result = { ok: true, reason: 'task7_pending' }; break;
    default:
      appendLog('intent_unknown', { type: intent.type });
      return clone(intent);
  }

  state.lastActionAt = now;
  if (result && result.ok) {
    appendLog('action_executed', { type: intent.type, method: result.method || '', reason: result.reason || '' });
  } else {
    appendLog('action_blocked', { type: intent.type, reason: result ? result.reason : 'unknown' });
    state.lastError = { at: now, message: result ? result.reason : 'unknown', type: intent.type };
  }
  return clone(intent);
}
```

### Step 6.2: 复制 ensureAutoBattle / ensureZKey / toggleAutoFight / isAutoFightOn

- [ ] **Step 6.2.1: 从原脚本 L1797-1877 复制这些函数(完全不变)**

```js
function ensureZKey(snapshot) {
  const now = Date.now();
  const autoBattle = snapshot.autoBattle;
  if (autoBattle && autoBattle.enabled) {
    state.zKeyRetryCount = 0;
    return { ok: true, reason: 'auto_battle_enabled' };
  }
  if (!state.arrivalConfirmedAt) return { ok: true, reason: 'not_arrived_yet' };
  if (now - state.arrivalConfirmedAt < 1500) return { ok: true, reason: 'waiting_post_arrival' };
  if (state.zKeySentAt && now - state.zKeySentAt > 15000) {
    state.zKeyRetryCount = 0;
  }
  if (now - state.zKeySentAt < 5000) return { ok: true, reason: 'z_key_throttled' };
  if (toggleAutoFight()) {
    state.zKeySentAt = now;
    state.zKeyRetryCount++;
    appendLog('z_key_sent', { method: 'laya_keydown', retry: state.zKeyRetryCount });
    return { ok: true, method: 'laya_keydown', reason: 'z_key_sent' };
  }
  state.zKeyRetryCount++;
  return { ok: true, reason: 'z_key_pending' };
}

function toggleAutoFight() {
  try {
    if (typeof Laya === 'undefined' || !Laya.stage || !Laya.stage._events || !Laya.stage._events.keydown) return false;
    const ev = new Laya.Event();
    ev.type = Laya.Event.KEYDOWN;
    ev.keyCode = 90;
    ev.nativeEvent = { keyCode: 90, key: 'z', code: 'KeyZ', preventDefault: function(){}, stopPropagation: function(){} };
    ev.target = Laya.stage;
    ev.currentTarget = Laya.stage;
    const kd = Laya.stage._events.keydown;
    const listener = Array.isArray(kd) ? kd[0] : kd;
    if (!listener || !listener.method || !listener.caller) return false;
    listener.method.call(listener.caller, ev);
    return true;
  } catch (e) {
    appendLog('toggle_auto_fight_error', { error: e.message });
    return false;
  }
}

function isAutoFightOn() {
  try {
    const gRoot = root();
    if (!gRoot || typeof gRoot.getChildAt !== 'function') return false;
    const mainWnd = gRoot.getChildAt(0);
    if (!mainWnd || !mainWnd.mMainBottom) return false;
    const st = mainWnd.mMainBottom.autoFightState;
    return !!st && st.selectedIndex === 2;
  } catch (_) {
    return false;
  }
}

function ensureAutoBattle(snapshot) {
  if (snapshot.autoBattle && snapshot.autoBattle.enabled) {
    state.zKeyRetryCount = 0;
    return { ok: true, reason: 'already_enabled' };
  }
  const zResult = ensureZKey(snapshot);
  if (zResult.ok) {
    return { ok: true, reason: 'z_key_safety_net: ' + zResult.reason };
  }
  return { ok: true, reason: 'z_key_safety_net_failed: ' + zResult.reason };
}
```

### Step 6.3: 复制 executeHold / executeEngage / executeObserveOwner

- [ ] **Step 6.3.1: 从原脚本 L1835-1910 复制这些函数(完全不变)**

```js
function executeHold(intent, snapshot) {
  const target = targetById(intent.targetId);
  if (!target) return { ok: false, reason: 'hold_target_missing' };
  if (!isAtTarget(target, snapshot)) {
    return { ok: false, reason: 'not_at_coordinate' };
  }
  if (!state.arrivalConfirmedAt) {
    state.arrivalConfirmedAt = Date.now();
  }
  const result = ensureAutoBattle(snapshot);
  if (!result.ok && result.reason === 'auto_battle_state_unknown') {
    appendLog('auto_battle_state_unknown', { targetId: intent.targetId, coordinate: snapshot.scene.coordinate });
  }
  return result;
}

function executeEngage(intent, snapshot) {
  const result = ensureAutoBattle(snapshot);
  if (!result.ok && result.reason === 'auto_battle_state_unknown') {
    appendLog('auto_battle_state_unknown', { targetId: intent.targetId });
  }
  return result;
}

function executeObserveOwner(intent, snapshot) {
  const target = targetById(intent.targetId);
  if (!target) return { ok: false, reason: 'observe_target_missing' };
  const combat = snapshot.combat;
  if (!combat || cleanText(combat.targetName) !== target.name) {
    resetOwnerObservation();
    return { ok: true, reason: 'boss_disappeared' };
  }
  if (!hasVisibleHpBar(combat)) {
    resetOwnerObservation();
    return { ok: true, reason: 'no_hp_bar' };
  }
  const ownerName = cleanText(combat.ownerName);
  const now = Number(snapshot.at) || Date.now();
  if (!ownerName || ownerName === state.config.ownerName) {
    resetOwnerObservation();
    return { ok: true, reason: 'owner_clear_or_self' };
  }
  if (!state.ownerObservation || state.ownerObservation.targetId !== target.id) {
    state.ownerObservation = { targetId: target.id, observedAt: now };
    appendLog('owner_observation_started', { targetId: target.id, ownerName });
    return { ok: true, reason: 'observing_owner' };
  }
  const elapsed = now - state.ownerObservation.observedAt;
  if (elapsed >= state.config.ownerObserveSeconds * 1000) {
    markContested(target, now);
    resetOwnerObservation();
    appendLog('owner_contested', { targetId: target.id, ownerName, elapsedMs: elapsed });
    return { ok: true, reason: 'contested_cooldown_set' };
  }
  return { ok: true, reason: 'observing_owner', elapsedSeconds: Math.floor(elapsed / 1000) };
}
```

### Step 6.4: 复制 closePanelIfExists / ensureMapReady / clickOpenMapButton / closeMapPanel / findNodeByPathSummary

- [ ] **Step 6.4.1: 从原脚本 L1914-1047 复制这些函数(完全不变)**

```js
function closePanelIfExists(panelName) {
  const gRoot = root();
  if (!gRoot) return { ok: true, reason: 'no_root' };
  const nodes = collectNodes(gRoot);
  const panelRoot = nodes.find((item) => item.effectiveVisible
    && (item.name === panelName || item.packageName === panelName || item.packageOwner === panelName));
  if (!panelRoot) return { ok: true, reason: 'already_closed' };
  const panelNodes = descendantsOf(nodes, panelRoot);
  const closeBtn = panelNodes.find((item) => item.effectiveVisible && item.name === 'btnClose');
  if (!closeBtn) {
    const panelNode = findNodeByPath(gRoot, panelRoot.path);
    if (panelNode) {
      if (typeof panelNode.hideImmediately === 'function') {
        try { panelNode.hideImmediately(); return { ok: true, method: 'hideImmediately', reason: 'closed' }; } catch (_) {}
      }
      if (typeof panelNode.removeFromParent === 'function') {
        try { panelNode.removeFromParent(); return { ok: true, method: 'removeFromParent', reason: 'closed' }; } catch (_) {}
      }
    }
    return { ok: false, reason: 'close_button_missing' };
  }
  const node = findNodeByPath(gRoot, closeBtn.path);
  if (!node || !nodeIsEffectivelyVisible(node)) {
    const panelNode2 = findNodeByPath(gRoot, panelRoot.path);
    if (panelNode2) {
      if (typeof panelNode2.hideImmediately === 'function') {
        try { panelNode2.hideImmediately(); return { ok: true, method: 'hideImmediately', reason: 'closed' }; } catch (_) {}
      }
      if (typeof panelNode2.removeFromParent === 'function') {
        try { panelNode2.removeFromParent(); return { ok: true, method: 'removeFromParent', reason: 'closed' }; } catch (_) {}
      }
    }
    return { ok: false, reason: 'close_node_unavailable' };
  }
  const action = activateNode(node);
  if (!action.ok) {
    const panelNode3 = findNodeByPath(gRoot, panelRoot.path);
    if (panelNode3) {
      if (typeof panelNode3.hideImmediately === 'function') {
        try { panelNode3.hideImmediately(); return { ok: true, method: 'hideImmediately', reason: 'closed' }; } catch (_) {}
      }
      if (typeof panelNode3.removeFromParent === 'function') {
        try { panelNode3.removeFromParent(); return { ok: true, method: 'removeFromParent', reason: 'closed' }; } catch (_) {}
      }
    }
    return { ok: false, reason: 'close_failed', method: action.method };
  }
  return { ok: true, method: action.method, reason: 'closed' };
}

function clickOpenMapButton(snapshot) {
  if (!snapshot.mapPanel.openButton) return { ok: false, reason: 'no_map_open_button' };
  const fresh = readSnapshot();
  if (!fresh.mapPanel.openButton) return { ok: false, reason: 'map_open_button_vanished' };
  const node = findNodeByPath(root(), fresh.mapPanel.openButton.sourcePath);
  if (!node) return { ok: false, reason: 'map_open_node_not_found' };
  if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'map_open_node_hidden' };
  const action = activateNode(node);
  if (!action.ok) return { ok: false, reason: action.reason };
  return { ok: true, method: action.method, reason: 'map_opened' };
}

function closeMapPanel(snapshot) {
  if (!snapshot.mapPanel.closeButton) return { ok: false, reason: 'no_close_button' };
  const fresh = readSnapshot();
  if (!fresh.mapPanel.closeButton) return { ok: false, reason: 'close_button_vanished' };
  const node = findNodeByPath(root(), fresh.mapPanel.closeButton.sourcePath);
  if (!node) return { ok: false, reason: 'close_node_not_found' };
  if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'close_node_hidden' };
  const action = activateNode(node);
  if (!action.ok) return { ok: false, reason: action.reason };
  if (state.navigationContext) state.navigationContext.closeClicked = true;
  return { ok: true, method: action.method, reason: 'map_closed' };
}

function findNodeByPathSummary(mapPanel, sourcePath, targetId) {
  if (!sourcePath) return null;
  const all = [...(mapPanel.bossTargets || []), mapPanel.farmTarget].filter(Boolean);
  return all.find((row) => row.sourcePath === sourcePath) || null;
}

function ensureMapReady(snapshot, ctx, contentReady, label) {
  const now = Date.now();
  const RENDER_WAIT_MS = 5000;
  if (snapshot.mapPanel.open) {
    if (!ctx.mapOpenedAt) ctx.mapOpenedAt = now;
    if (contentReady(snapshot)) {
      ctx.reopenClicked = false;
      return { ok: true, reason: 'ready' };
    }
    if (now - ctx.mapOpenedAt < RENDER_WAIT_MS) {
      return { ok: true, reason: 'waiting_for_content' };
    }
    if (!ctx.reopenClicked) {
      closePanelIfExists('MapDetialWnd');
      ctx.reopenClicked = true;
      ctx.mapOpenedAt = 0;
      appendLog(label + '_map_reopen_for_retry', {});
      return { ok: true, reason: 'map_reopen_for_retry' };
    }
    appendLog(label + '_map_give_up', {});
    return { ok: false, reason: 'map_give_up' };
  }
  const result = clickOpenMapButton(snapshot);
  if (result.ok) {
    ctx.mapOpenedAt = 0;
    ctx.reopenClicked = false;
    return { ok: true, reason: 'waiting_for_open' };
  }
  return { ok: false, reason: result.reason };
}
```

### Step 6.5: 复制 executeTravel + checkNavProgress(加 module 参数)

- [ ] **Step 6.5.1: 添加 executeTravel(从原 L805-896 移植,加 module 参数)**

```js
function executeTravel(intent, snapshot, kind) {
  const now = Date.now();
  const targetKey = intent.targetId || 'farm';
  let navCtx = state.navigationContext;
  const isSameNav = navCtx && navCtx.kind === kind && navCtx.targetId === targetKey;

  if (snapshot.bossChallengePanel && snapshot.bossChallengePanel.open) {
    closePanelIfExists('Instance_BossUI');
    return { ok: true, reason: 'closing_blocking_panel' };
  }

  if (!isSameNav) {
    state.navigationContext = {
      kind,
      targetId: targetKey,
      startedAt: now,
      lastCoordinate: '',
      lastCoordinateAt: 0,
      clicked: false,
      retried: false,
      mapOpenedAt: 0,
      reopenClicked: false,
    };
    navCtx = state.navigationContext;
  }

  if (navCtx.clicked) {
    if (snapshot.mapPanel.open) {
      if (navCtx.closeClicked) return { ok: true, reason: 'waiting_map_close' };
      return closeMapPanel(snapshot);
    }
    return checkNavProgress(navCtx, snapshot, intent, kind, now);
  }

  // contentReady:用 module 信息决定何时行就绪
  const target = intent.targetId ? targetById(intent.targetId) : null;
  const module = target ? moduleById(target.moduleId) : null;
  const contentReady = (snap) => {
    if (kind === 'boss') {
      if (!target) return false;
      const rows = snap.mapPanel.bossTargets || [];
      return Boolean(rows.find((r) => r.name === target.name)
        || rows.find((r) => r.targetId === intent.targetId));
    }
    return Boolean(snap.mapPanel.farmTarget);
  };

  const mapResult = ensureMapReady(snapshot, navCtx, contentReady, 'travel');
  if (!mapResult.ok) {
    appendLog('travel_give_up', { kind, targetId: targetKey, reason: mapResult.reason });
    state.navigationContext = null;
    releaseLockedTarget();
    return { ok: false, reason: 'target_row_render_timeout' };
  }
  if (mapResult.reason !== 'ready') {
    return mapResult;
  }

  let targetRow;
  if (kind === 'boss') {
    if (!target) return { ok: false, reason: 'boss_target_missing' };
    targetRow = snapshot.mapPanel.bossTargets.find((row) => row.name === target.name);
    if (!targetRow || targetRow.targetId !== intent.targetId) {
      targetRow = snapshot.mapPanel.bossTargets.find((row) => row.targetId === intent.targetId);
    }
    if (!targetRow) return { ok: false, reason: 'boss_row_not_found' };
  } else {
    targetRow = snapshot.mapPanel.farmTarget;
    if (!targetRow) return { ok: false, reason: 'farm_target_missing' };
  }

  const fresh = readSnapshot();
  if (!fresh.mapPanel.open) return { ok: false, reason: 'map_panel_closed' };
  const freshRow = findNodeByPathSummary(fresh.mapPanel, targetRow.sourcePath, targetKey);
  if (!freshRow) return { ok: false, reason: 'target_row_vanished' };

  const node = findNodeByPath(root(), targetRow.sourcePath);
  if (!node) return { ok: false, reason: 'target_node_not_found' };
  if (!nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'target_node_hidden' };
  const action = activateNode(node);
  if (!action.ok) return { ok: false, reason: action.reason };
  navCtx.clicked = true;
  appendLog('nav_target_clicked', { kind, targetId: targetKey, method: action.method });
  return { ok: true, method: action.method, reason: kind + '_row_clicked' };
}
```

- [ ] **Step 6.5.2: 添加 checkNavProgress(从原 L898-967 复制,完全不变)**

```js
function checkNavProgress(navCtx, snapshot, intent, kind, now) {
  if (now - navCtx.startedAt > state.config.travelTimeoutMs) {
    if (navCtx.retried) {
      appendLog('navigation_failed', { kind, targetId: intent.targetId, elapsed: now - navCtx.startedAt });
      state.navigationContext = null;
      state.currentTargetId = '';
      state.currentAction = 'navigation_failed';
      return { ok: false, reason: 'navigation_timeout' };
    }
    navCtx.retried = true;
    navCtx.startedAt = now;
    navCtx.lastCoordinate = '';
    navCtx.lastCoordinateAt = 0;
    navCtx.clicked = false;
    navCtx.closeClicked = false;
    navCtx.mapOpenedAt = 0;
    navCtx.reopenClicked = false;
    appendLog('navigation_retry', { kind, targetId: intent.targetId });
    return { ok: true, reason: 'retry_pending' };
  }

  const currentCoord = snapshot.scene.coordinate || '';
  if (!currentCoord) return { ok: true, reason: 'navigating' };

  const moved = currentCoord !== navCtx.lastCoordinate;
  if (moved) {
    navCtx.lastCoordinate = currentCoord;
    navCtx.lastCoordinateAt = now;
  }

  if (kind === 'boss' && intent.targetId) {
    const target = targetById(intent.targetId);
    if (target && target.coordinate !== 'TBD'
      && chebyshevDistance(currentCoord, target.coordinate) <= ARRIVAL_THRESHOLD) {
      appendLog('navigation_arrived', { kind, targetId: intent.targetId, coordinate: currentCoord, targetCoordinate: target.coordinate });
      state.arrivalConfirmedAt = now;
      state.navigationContext = null;
      return { ok: true, reason: 'arrived' };
    }
  }

  if (kind === 'farm' && !moved && now - navCtx.lastCoordinateAt > 5000) {
    appendLog('navigation_arrived', { kind: 'farm', targetId: 'farm', coordinate: currentCoord });
    state.farmArrivedAt = now;
    state.farmArrivedCoord = currentCoord;
    state.arrivalConfirmedAt = now;
    state.navigationContext = null;
    return { ok: true, reason: 'arrived' };
  }

  if (!moved && now - navCtx.lastCoordinateAt > state.config.arrivalStallMs) {
    if (!navCtx.retried) {
      navCtx.retried = true;
      navCtx.startedAt = now;
      navCtx.clicked = false;
      navCtx.closeClicked = false;
      navCtx.mapOpenedAt = 0;
      navCtx.reopenClicked = false;
      appendLog('navigation_retry_stall', { kind, targetId: intent.targetId, coordinate: currentCoord });
      return { ok: true, reason: 'retry_pending' };
    }
    appendLog('navigation_failed_stall', { kind, targetId: intent.targetId });
    state.navigationContext = null;
    state.currentTargetId = '';
    state.currentAction = 'navigation_failed';
    return { ok: false, reason: 'coordinate_stall_timeout' };
  }

  return { ok: true, reason: 'navigating' };
}
```

### Step 6.6: 复制 executeScanMap + needMapScan

- [ ] **Step 6.6.1: 添加 needMapScan + executeScanMap(从原 L2249-2309 改造)**

```js
const MAP_SCAN_COOLDOWN_MS = 60 * 1000;
const MAP_SCAN_OPEN_WAIT_MS = 2000;

function needMapScan(snapshot, module) {
  const now = Number(snapshot.at) || Date.now();
  if (state.mapScanContext) return true;
  if (state.navigationContext) return false;
  if (state.rateCheck.phase !== 'idle') return false;
  if (state.enterInstanceCtx || state.exitInstanceCtx || state.teleportCtx) return false;
  if (!module) return false;
  const eligible = state.targets.filter((target) =>
    target.moduleId === module.id
    && isBossEnabled(target)
    && !isCooling(target, now)
    && !isMapRateLow(module.mapName));
  if (!eligible.length) return false;
  const allUnknown = eligible.every((target) => validRefreshAt(target.refreshAt) === null);
  if (!allUnknown) return false;
  if (now - state.lastMapScanAt < MAP_SCAN_COOLDOWN_MS) return false;
  return true;
}

function executeScanMap(intent, snapshot) {
  const now = Date.now();
  const ctx = state.mapScanContext;
  if (!ctx) {
    state.mapScanContext = { startedAt: now, opened: false, closeClicked: false, openedAt: 0 };
    appendLog('map_scan_start', {});
  }
  const scan = state.mapScanContext;

  if (snapshot.bossChallengePanel && snapshot.bossChallengePanel.open) {
    closePanelIfExists('Instance_BossUI');
    return { ok: true, reason: 'closing_blocking_panel' };
  }

  if (!snapshot.mapPanel.open) {
    if (!scan.opened) {
      const result = clickOpenMapButton(snapshot);
      if (result.ok) {
        scan.opened = true;
        scan.openedAt = now;
        appendLog('map_scan_opened', { method: result.method });
      }
      return result;
    }
    appendLog('map_scan_complete', {});
    state.lastMapScanAt = now;
    state.mapScanContext = null;
    return { ok: true, reason: 'map_scan_done' };
  }

  if (scan.opened && !scan.closeClicked && now - scan.openedAt >= MAP_SCAN_OPEN_WAIT_MS) {
    const result = closeMapPanel(snapshot);
    if (result.ok) {
      scan.closeClicked = true;
      appendLog('map_scan_closing', {});
    }
    return result;
  }

  return { ok: true, reason: 'map_scan_waiting' };
}
```

### Step 6.7: 复制 executeCheckRate + needRateCheck + markRateCheckDone + parseCountdownMs

- [ ] **Step 6.7.1: 添加 parseCountdownMs**

```js
function parseCountdownMs(text) {
  const s = cleanText(text);
  let totalMs = 0;
  let matched = false;
  const hourMatch = s.match(/(\d+)\s*小时/);
  const minMatch = s.match(/(\d+)\s*分/);
  const secMatch = s.match(/(\d+)\s*秒/);
  if (hourMatch) { totalMs += parseInt(hourMatch[1], 10) * 3600 * 1000; matched = true; }
  if (minMatch) { totalMs += parseInt(minMatch[1], 10) * 60 * 1000; matched = true; }
  if (secMatch) { totalMs += parseInt(secMatch[1], 10) * 1000; matched = true; }
  if (!matched) {
    const m = s.match(/(\d{1,2}):([0-5]\d)/);
    if (m) { totalMs = (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000; matched = true; }
  }
  return matched ? totalMs : 0;
}
```

- [ ] **Step 6.7.2: 替换 Task 5 的 needRateCheck 占位为真实实现**

```js
function needRateCheck(snapshot) {
  const now = Number(snapshot.at) || Date.now();
  const rc = state.rateCheck;
  if (rc.phase !== 'idle') return true;
  if (state.navigationContext) return false;
  if (state.mapScanContext) return false;
  if (state.enterInstanceCtx) return false;
  if (state.exitInstanceCtx) return false;
  if (state.teleportCtx) return false;
  const autoBattle = snapshot && snapshot.autoBattle;
  if (autoBattle && autoBattle.enabled) return false;
  const sceneMap = snapshot && snapshot.scene && snapshot.scene.mapName;
  if (!sceneMap || !RATE_CHECK_MAPS[sceneMap]) return false;
  // 用 mapName 查 rateResults(原脚本逻辑)
  return getRateResult(sceneMap) === null;
}

function markRateCheckDone(result, mapName) {
  const now = Date.now();
  state.rateCheck.phase = 'idle';
  state.rateCheck.targetModuleId = '';
  let nextCheckAt = 0;
  if (mapName) {
    nextCheckAt = result === 'low' ? nextRateResetTimestamp() : now + state.config.rateRecheckIntervalMs;
    state.rateResults[mapName] = {
      result: result,
      checkedAt: now,
      skipUntil: result === 'low' ? nextCheckAt : 0,
      nextCheckAt: nextCheckAt,
    };
  }
  if (result !== 'low') {
    state.farmArrivedAt = 0;
    state.farmArrivedCoord = '';
    state.farmLastSeenFarmingAt = 0;
  }
  appendLog('rate_check_done', { result, mapName, nextCheckAt });
}
```

- [ ] **Step 6.7.3: 添加 executeCheckRate(从原 L2047-2242 移植,加 module 查找)**

```js
function executeCheckRate(intent, snapshot) {
  const now = Date.now();
  const rc = state.rateCheck;
  const panel = snapshot.bossChallengePanel;

  if (rc.phase !== 'idle' && now - rc.startedAt > 60 * 1000) {
    appendLog('rate_check_timeout', { phase: rc.phase, elapsed: now - rc.startedAt });
    markRateCheckDone('unknown', rc.targetMap);
    return { ok: false, reason: 'rate_check_timeout' };
  }

  if (rc.phase === 'idle') {
    const sceneMap = (snapshot.scene || {}).mapName || '';
    const rateMap = RATE_CHECK_MAPS[sceneMap];
    if (!rateMap) return { ok: false, reason: 'no_rate_check_map' };
    rc.targetMap = sceneMap;
    rc.targetModuleId = rateMap.moduleId;
    rc.phase = 'closing_map';
    rc.startedAt = now;
    rc.lastActionAt = 0;
    appendLog('rate_check_start', { targetMap: sceneMap });
  }

  const MIN_ACTION_GAP = 800;
  if (now - rc.lastActionAt < MIN_ACTION_GAP) {
    return { ok: true, reason: 'rate_throttled' };
  }

  const rateMap = rc.targetMap ? RATE_CHECK_MAPS[rc.targetMap] : null;
  if (!rateMap) {
    appendLog('rate_check_no_map_config', { targetMap: rc.targetMap });
    markRateCheckDone('unknown', rc.targetMap);
    return { ok: false, reason: 'no_rate_check_map' };
  }

  switch (rc.phase) {
    case 'closing_map': {
      const freshSnap = readSnapshot();
      if (!freshSnap.mapPanel.open) {
        rc.phase = 'opening';
        rc.lastActionAt = now;
        return { ok: true, reason: 'map_closed_proceed' };
      }
      const closeBtn = freshSnap.mapPanel.closeButton;
      if (!closeBtn) {
        closePanelIfExists('MapDetialWnd');
        rc.lastActionAt = now;
        return { ok: true, reason: 'map_close_attempted' };
      }
      const closeNode = findNodeByPath(root(), closeBtn.sourcePath);
      if (!closeNode || !nodeIsEffectivelyVisible(closeNode)) {
        closePanelIfExists('MapDetialWnd');
        rc.lastActionAt = now;
        return { ok: true, reason: 'map_close_fallback' };
      }
      const closeAction = activateNode(closeNode);
      rc.lastActionAt = now;
      appendLog('rate_check_closed_map', { method: closeAction.method });
      return { ok: true, reason: 'map_closing' };
    }
    case 'opening': {
      if (panel && panel.open) {
        rc.phase = 'select_tab';
        rc.lastActionAt = now;
        return { ok: true, reason: 'panel_already_open' };
      }
      if (snapshot.mapPanel && snapshot.mapPanel.open) {
        rc.phase = 'closing_map';
        rc.lastActionAt = now;
        return { ok: true, reason: 'need_close_map_first' };
      }
      const btn = panel && panel.openButton;
      if (!btn) return { ok: false, reason: 'no_boss_challenge_button' };
      const fresh = readSnapshot();
      const freshBtn = fresh.bossChallengePanel && fresh.bossChallengePanel.openButton;
      if (!freshBtn) return { ok: false, reason: 'open_button_vanished' };
      const node = findNodeByPath(root(), freshBtn.sourcePath);
      if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'open_node_unavailable' };
      const action = activateNode(node);
      if (!action.ok) return { ok: false, reason: action.reason };
      rc.lastActionAt = now;
      rc.phase = 'waiting_for_open';
      appendLog('rate_check_opened_panel', { method: action.method });
      return { ok: true, method: action.method, reason: 'panel_opening' };
    }
    case 'waiting_for_open': {
      if (panel && panel.open) {
        rc.phase = 'select_tab';
        rc.lastActionAt = now;
        return { ok: true, reason: 'panel_opened' };
      }
      if (now - rc.lastActionAt > 3000) {
        rc.phase = 'opening';
        rc.lastActionAt = now;
        appendLog('rate_check_panel_open_retry', {});
        return { ok: true, reason: 'panel_open_timeout_retry' };
      }
      return { ok: true, reason: 'waiting_for_panel_open' };
    }
    case 'select_tab': {
      if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
      if (panel.selectedTab === rateMap.tab) {
        rc.phase = 'select_boss';
        rc.lastActionAt = now;
        return { ok: true, reason: 'tab_already_selected' };
      }
      const tab = panel.tabs.find((t) => t.text === rateMap.tab);
      if (!tab) return { ok: false, reason: 'target_tab_not_found:' + rateMap.tab };
      const fresh = readSnapshot();
      const freshPanel = fresh.bossChallengePanel;
      if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
      const freshTab = freshPanel.tabs.find((t) => t.text === rateMap.tab);
      if (!freshTab) return { ok: false, reason: 'tab_vanished' };
      const node = findNodeByPath(root(), freshTab.sourcePath);
      if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'tab_node_unavailable' };
      const action = activateNode(node);
      if (!action.ok) return { ok: false, reason: action.reason };
      rc.lastActionAt = now;
      appendLog('rate_check_selected_tab', { method: action.method, tab: rateMap.tab });
      return { ok: true, method: action.method, reason: 'tab_selected' };
    }
    case 'select_boss': {
      if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
      if (panel.mapName.includes(rateMap.mapMatch)) {
        rc.phase = 'read_rate';
        rc.lastActionAt = now;
        return { ok: true, reason: 'map_already_target' };
      }
      const bossRow = panel.bossRows.find((r) => rateMap.bossNames.includes(r.name));
      if (!bossRow) return { ok: false, reason: 'target_boss_not_found' };
      const fresh = readSnapshot();
      const freshPanel = fresh.bossChallengePanel;
      if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
      const freshRow = freshPanel.bossRows.find((r) => r.name === bossRow.name);
      if (!freshRow) return { ok: false, reason: 'boss_row_vanished' };
      const node = findNodeByPath(root(), freshRow.sourcePath);
      if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'boss_row_node_unavailable' };
      const action = activateNode(node);
      if (!action.ok) return { ok: false, reason: action.reason };
      rc.lastActionAt = now;
      appendLog('rate_check_selected_boss', { bossName: bossRow.name });
      return { ok: true, method: action.method, reason: 'boss_selected' };
    }
    case 'read_rate': {
      if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
      if (!panel.mapName.includes(rateMap.mapMatch)) {
        rc.phase = 'select_boss';
        rc.lastActionAt = now;
        return { ok: true, reason: 'map_not_target_retry' };
      }
      const rateUrl = panel.rateIconUrl || '';
      const rateKey = rateUrl.split('/').pop() || '';
      const rate = RATE_URL_MAP[rateKey] || null;
      if (!rate) {
        if (now - rc.startedAt > 10 * 1000) {
          markRateCheckDone('unknown', rc.targetMap);
          rc.phase = 'closing';
          rc.lastActionAt = now;
          return { ok: true, reason: 'rate_unknown_timeout' };
        }
        return { ok: true, reason: 'rate_not_ready' };
      }
      appendLog('rate_detected', { rate, url: rateUrl, mapName: rc.targetMap });
      markRateCheckDone(rate, rc.targetMap);
      rc.phase = 'closing';
      rc.lastActionAt = now;
      return { ok: true, reason: 'rate_read: ' + rate };
    }
    case 'closing': {
      if (!panel || !panel.open) {
        rc.phase = 'idle';
        rc.lastActionAt = now;
        return { ok: true, reason: 'panel_already_closed' };
      }
      const result = closePanelIfExists('Instance_BossUI');
      rc.lastActionAt = now;
      appendLog('rate_check_closed_panel', { reason: result.reason });
      return { ok: true, reason: 'panel_closing' };
    }
    default:
      rc.phase = 'idle';
      return { ok: false, reason: 'unknown_rate_phase' };
  }
}
```

### Step 6.8: 验证 + commit

- [ ] **Step 6.8.1: 验证 travel_boss / hold / engage 跑通**

请用户在游戏里把角色传送到四风平原(自动或手动)。脚本启动后 `currentIntent` 应变成 `travel_boss`(若附近有刷新 BOSS)或 `travel_farm`(无 BOSS)或 `check_rate`(从未查过爆率)。

Run(角色在四风平原时):
```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  api.start();
  return { started: true };
})()"
sleep 3
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  const st = api.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    currentIntent: st.currentIntent,
    lastError: st.lastError,
    logsTail: st.logs.slice(-15).map(l => l.type + ':' + (l.details && l.details.reason || '')),
  };
})()"
```

Expected: `sceneMap: '四风平原'`,`currentIntent.type` 为 `check_rate` / `travel_boss` / `travel_farm` / `safe_wait` 之一,无 tick_error。

- [ ] **Step 6.8.2: 关脚本,commit Task 6**

```bash
node cdp_eval.js auto "(() => { window.__muMultiMapBossMvp.setConfig({ enabled: false, dryRun: true }); return { ok: true }; })()"
```

```bash
git add mu-boss-multi-map-mvp.user.js
git commit -m "$(cat <<'EOF'
feat(multi-map-boss): executeIntent dispatch + generic executors

Implement executeIntent main dispatch (travel_boss/travel_farm/hold/
engage/observe_owner/check_rate/scan_map; enter/exit/teleport still
task7_pending). Copy from trial-land: executeHold/Engage/ObserveOwner,
ensureAutoBattle/ensureZKey/toggleAutoFight/isAutoFightOn,
closePanelIfExists/ensureMapReady/clickOpenMapButton/closeMapPanel/
findNodeByPathSummary, checkNavProgress, executeScanMap+needMapScan,
executeCheckRate+needRateCheck+markRateCheckDone+parseCountdownMs.
executeTravel gains module lookup via targetById(targetId).moduleId
for contentReady. RATE_CHECK_MAPS dynamically rebuilt from MAP_MODULES
with PURGATORY_RATE_CHECK_ENABLED toggle (default false, Task 0 may
flip to true).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Task 6 完成标准:** 在四风平原时 `currentIntent.type` 为 check_rate/travel_boss/travel_farm/safe_wait 之一,无 tick_error。

---

## Task 7: executeEnterInstance / executeExitInstance / executeTeleportToModule

**目标:** 从原 `executeEnterTrial` / `executeExitTrial` / `executeTeleportFourWinds` 移植,参数化 module。这三个 executor 在 `executeIntent` dispatch 里挂上。完成后试炼之地1 进出跑通。

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js`

### Step 7.1: 实现并挂上 executeEnterInstance

- [ ] **Step 7.1.1: 添加 executeEnterInstance**

```js
function executeEnterInstance(intent, snapshot) {
  const module = state.enterInstanceCtx ? moduleById(state.enterInstanceCtx.moduleId) : null;
  const now = Date.now();
  if (!state.enterInstanceCtx) {
    // 从 intent 拿 module 或从 currentModuleId
    const moduleId = state.currentModuleId || (intent && intent.targetId);
    // intent 不直接带 module;currentModuleId 是 chooseIntent 设的(实际上 enter_instance intent 不带 module 信息,需从 chooseIntent 传 ctx)
    // 简化:从 state.currentTargetId 反查 module
    const target = state.currentTargetId ? targetById(state.currentTargetId) : null;
    const targetModule = target ? moduleById(target.moduleId) : null;
    if (!targetModule) {
      // 退化:遍历 instance 模块找第一个 shouldEnterInstance 成立的
      const inst = MAP_MODULES.find(m => m.type === 'instance' && shouldEnterInstance(m, snapshot, now));
      if (!inst) return { ok: false, reason: 'no instance to enter' };
      state.enterInstanceCtx = {
        moduleId: inst.id,
        phase: 'closing_panels',
        startedAt: now,
        selectedBossId: null,
        lastActionAt: 0,
      };
    } else {
      state.enterInstanceCtx = {
        moduleId: targetModule.id,
        phase: 'closing_panels',
        startedAt: now,
        selectedBossId: state.currentTargetId,
        lastActionAt: 0,
      };
    }
    appendLog('enter_instance_start', { moduleId: state.enterInstanceCtx.moduleId });
  }

  const ctx = state.enterInstanceCtx;
  const currentModule = moduleById(ctx.moduleId);
  if (!currentModule) {
    state.enterInstanceCtx = null;
    return { ok: false, reason: 'module_missing: ' + ctx.moduleId };
  }

  if (now - ctx.startedAt > 60 * 1000) {
    appendLog('enter_instance_timeout', { phase: ctx.phase, elapsed: now - ctx.startedAt });
    closePanelIfExists('Instance_BossUI');
    closePanelIfExists('MapDetialWnd');
    state.enterInstanceCtx = null;
    releaseLockedTarget();
    return { ok: false, reason: 'enter_instance_timeout' };
  }

  const MIN_ACTION_GAP = 800;
  if (now - ctx.lastActionAt < MIN_ACTION_GAP) {
    return { ok: true, reason: 'enter_instance_throttled' };
  }

  const panel = snapshot.bossChallengePanel;

  switch (ctx.phase) {
    case 'closing_panels': {
      const closeResult = closePanelIfExists('MapDetialWnd');
      closePanelIfExists('Instance_BossUI');
      ctx.phase = 'opening';
      ctx.lastActionAt = now;
      appendLog('enter_instance_panels_closed', { reason: closeResult.reason });
      return { ok: true, reason: 'panels_closed' };
    }
    case 'opening': {
      if (panel && panel.open) {
        ctx.phase = 'select_tab';
        ctx.lastActionAt = now;
        return { ok: true, reason: 'panel_already_open' };
      }
      if (snapshot.mapPanel && snapshot.mapPanel.open) {
        ctx.phase = 'closing_panels';
        ctx.lastActionAt = now;
        return { ok: true, reason: 'need_close_map_first' };
      }
      const btn = panel && panel.openButton;
      if (!btn) return { ok: false, reason: 'no_boss_challenge_button' };
      const fresh = readSnapshot();
      const freshBtn = fresh.bossChallengePanel && fresh.bossChallengePanel.openButton;
      if (!freshBtn) return { ok: false, reason: 'open_button_vanished' };
      const node = findNodeByPath(root(), freshBtn.sourcePath);
      if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'open_node_unavailable' };
      const action = activateNode(node);
      if (!action.ok) return { ok: false, reason: action.reason };
      ctx.lastActionAt = now;
      ctx.phase = 'waiting_for_open';
      appendLog('enter_instance_opened_panel', { method: action.method });
      return { ok: true, method: action.method, reason: 'panel_opening' };
    }
    case 'waiting_for_open': {
      if (panel && panel.open) {
        ctx.phase = 'select_tab';
        ctx.lastActionAt = now;
        return { ok: true, reason: 'panel_opened' };
      }
      if (now - ctx.lastActionAt > 3000) {
        ctx.phase = 'opening';
        ctx.lastActionAt = now;
        appendLog('enter_instance_panel_open_retry', {});
        return { ok: true, reason: 'panel_open_timeout_retry' };
      }
      return { ok: true, reason: 'waiting_for_panel_open' };
    }
    case 'select_tab': {
      if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
      if (panel.selectedTab === currentModule.bossRowTab) {
        ctx.phase = 'select_boss';
        ctx.lastActionAt = now;
        return { ok: true, reason: 'tab_already_selected' };
      }
      const tab = panel.tabs.find((t) => t.text === currentModule.bossRowTab);
      if (!tab) return { ok: false, reason: 'tab_not_found:' + currentModule.bossRowTab };
      const fresh = readSnapshot();
      const freshPanel = fresh.bossChallengePanel;
      if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
      const freshTab = freshPanel.tabs.find((t) => t.text === currentModule.bossRowTab);
      if (!freshTab) return { ok: false, reason: 'tab_vanished' };
      const node = findNodeByPath(root(), freshTab.sourcePath);
      if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'tab_node_unavailable' };
      const action = activateNode(node);
      if (!action.ok) return { ok: false, reason: action.reason };
      ctx.lastActionAt = now;
      appendLog('enter_instance_selected_tab', { method: action.method, tab: currentModule.bossRowTab });
      return { ok: true, method: action.method, reason: 'tab_selected' };
    }
    case 'select_boss': {
      if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
      const now2 = Date.now();
      const attackable = getAttackableTargets(currentModule, now2);
      if (!attackable.length) {
        appendLog('enter_instance_no_attackable', { moduleId: currentModule.id });
        state.enterInstanceCtx = null;
        return { ok: false, reason: 'no_attackable_boss' };
      }
      const candidate = selectInstanceTarget(attackable, snapshot);
      if (!candidate) return { ok: false, reason: 'no_selectable_boss' };
      ctx.selectedBossId = candidate.id;
      state.currentTargetId = candidate.id;

      // 在指定 scrollName 下找 BOSS 行(scanBossChallengePanel 改造已加 scrollName)
      const bossRow = panel.bossRows.find((r) => r.name === candidate.name
        && (!currentModule.bossRowScroll || r.scrollName === currentModule.bossRowScroll));
      if (!bossRow) return { ok: false, reason: 'boss_row_not_found' };
      const fresh = readSnapshot();
      const freshPanel = fresh.bossChallengePanel;
      if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
      const freshRow = freshPanel.bossRows.find((r) => r.name === candidate.name
        && (!currentModule.bossRowScroll || r.scrollName === currentModule.bossRowScroll));
      if (!freshRow) return { ok: false, reason: 'boss_row_vanished' };
      const node = findNodeByPath(root(), freshRow.sourcePath);
      if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'boss_row_node_unavailable' };
      const action = activateNode(node);
      if (!action.ok) return { ok: false, reason: action.reason };
      ctx.lastActionAt = now;
      appendLog('enter_instance_selected_boss', { bossName: candidate.name, moduleId: currentModule.id });
      ctx.phase = 'click_enter';
      return { ok: true, method: action.method, reason: 'boss_selected' };
    }
    case 'click_enter': {
      if (!panel || !panel.open) return { ok: false, reason: 'panel_closed_unexpectedly' };
      // 找 module.enterButtonTog + module.enterButtonTextRegex 匹配的按钮
      const enterButtons = (panel.enterButtons || []).filter((b) =>
        (!currentModule.enterButtonTog || b.togName === currentModule.enterButtonTog)
        && currentModule.enterButtonTextRegex && currentModule.enterButtonTextRegex.test(b.text));
      if (!enterButtons.length) {
        appendLog('enter_instance_no_enter_button', { moduleId: currentModule.id });
        ctx.phase = 'waiting';
        ctx.lastActionAt = now;
        return { ok: true, reason: 'no_enter_button_proceed_to_wait' };
      }
      const enterBtn = enterButtons[0];
      const fresh = readSnapshot();
      const freshPanel = fresh.bossChallengePanel;
      if (!freshPanel || !freshPanel.open) return { ok: false, reason: 'panel_closed' };
      const freshBtn = (freshPanel.enterButtons || []).find((b) => b.sourcePath === enterBtn.sourcePath);
      if (!freshBtn) return { ok: false, reason: 'enter_button_vanished' };
      const node = findNodeByPath(root(), freshBtn.sourcePath);
      if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'enter_node_unavailable' };
      const action = activateNode(node);
      if (!action.ok) return { ok: false, reason: action.reason };
      ctx.lastActionAt = now;
      appendLog('enter_instance_clicked_enter', { text: enterBtn.text, method: action.method });
      ctx.phase = 'waiting';
      return { ok: true, method: action.method, reason: 'enter_clicked' };
    }
    case 'waiting': {
      const mapName = (snapshot.scene || {}).mapName || '';
      if (mapName === currentModule.mapName) {
        appendLog('enter_instance_arrived', { mapName, moduleId: currentModule.id });
        closePanelIfExists('Instance_BossUI');
        state.enterInstanceCtx = null;
        state.currentTargetId = ctx.selectedBossId || '';
        state.arrivalConfirmedAt = 0;
        state.zKeyRetryCount = 0;
        return { ok: true, reason: 'arrived_instance' };
      }
      if (panel && panel.open && now - ctx.lastActionAt > 3000) {
        return { ok: true, reason: 'waiting_for_teleport' };
      }
      return { ok: true, reason: 'waiting_for_teleport' };
    }
    default:
      state.enterInstanceCtx = null;
      return { ok: false, reason: 'unknown_enter_phase' };
  }
}
```

- [ ] **Step 7.1.2: 修改 executeIntent dispatch 替换 task7_pending**

在 `executeIntent` 的 switch 里,把:
```js
case 'enter_instance': result = { ok: true, reason: 'task7_pending' }; break;
case 'exit_instance': result = { ok: true, reason: 'task7_pending' }; break;
case 'teleport_to_module': result = { ok: true, reason: 'task7_pending' }; break;
```
替换为:
```js
case 'enter_instance': result = executeEnterInstance(intent, snapshot); break;
case 'exit_instance': result = executeExitInstance(intent, snapshot); break;
case 'teleport_to_module': result = executeTeleportToModule(intent, snapshot); break;
```

### Step 7.2: 实现 executeExitInstance

- [ ] **Step 7.2.1: 添加 executeExitInstance**

```js
function executeExitInstance(intent, snapshot) {
  const now = Date.now();
  if (!state.exitInstanceCtx) {
    const currentMap = (snapshot.scene || {}).mapName || '';
    const module = moduleByMapName(currentMap) || MAP_MODULES.find(m => m.type === 'instance' && m.mapName === currentMap);
    if (!module) {
      return { ok: false, reason: 'not_in_instance' };
    }
    state.exitInstanceCtx = {
      moduleId: module.id,
      phase: 'closing_panels',
      startedAt: now,
      lastActionAt: 0,
      retried: false,
    };
    appendLog('exit_instance_start', { moduleId: module.id });
  }

  const ctx = state.exitInstanceCtx;
  const module = moduleById(ctx.moduleId);
  if (!module) {
    state.exitInstanceCtx = null;
    return { ok: false, reason: 'module_missing' };
  }

  if (now - ctx.startedAt > 30 * 1000) {
    if (!ctx.retried) {
      ctx.retried = true;
      ctx.phase = 'closing_panels';
      ctx.startedAt = now;
      ctx.lastActionAt = 0;
      appendLog('exit_instance_retry_timeout', {});
      return { ok: true, reason: 'retry_pending' };
    }
    appendLog('exit_instance_failed_timeout', {});
    state.exitInstanceCtx = null;
    return { ok: false, reason: 'exit_instance_timeout' };
  }

  const mapName = (snapshot.scene || {}).mapName || '';
  if (mapName !== module.mapName) {
    appendLog('exit_instance_done', { mapName });
    state.exitInstanceCtx = null;
    return { ok: true, reason: 'exited_instance' };
  }

  const MIN_ACTION_GAP = 800;
  if (now - ctx.lastActionAt < MIN_ACTION_GAP) {
    return { ok: true, reason: 'exit_instance_throttled' };
  }

  const gRoot = root();
  const nodes = gRoot ? collectNodes(gRoot) : [];

  switch (ctx.phase) {
    case 'closing_panels': {
      const closeResult = closePanelIfExists('Instance_BossUI');
      closePanelIfExists('MapDetialWnd');
      ctx.phase = 'waiting_for_close';
      ctx.lastActionAt = now;
      appendLog('exit_instance_panels_closed', { reason: closeResult.reason });
      return { ok: true, reason: 'panels_closing' };
    }
    case 'waiting_for_close': {
      const bossOpen = snapshot.bossChallengePanel && snapshot.bossChallengePanel.open;
      const mapOpen = snapshot.mapPanel && snapshot.mapPanel.open;
      if (!bossOpen && !mapOpen) {
        ctx.phase = 'click_exit';
        ctx.lastActionAt = now;
        return { ok: true, reason: 'panels_closed' };
      }
      if (now - ctx.lastActionAt > 3000) {
        ctx.phase = 'closing_panels';
        ctx.lastActionAt = now;
        appendLog('exit_instance_close_retry', {});
        return { ok: true, reason: 'close_retry' };
      }
      return { ok: true, reason: 'waiting_for_panels_close' };
    }
    case 'click_exit': {
      // btnExit 在 Damage list 内(假设 Task 0 项 3 验证成立)
      const exitNode = nodes.find((item) =>
        item.effectiveVisible && item.name === 'btnExit'
        && /Damage list/i.test(item.path))
        || nodes.find((item) =>
        item.effectiveVisible && /退出/.test(item.contentText))
        || nodes.find((item) =>
        item.effectiveVisible && /btnExit|btn_exit|exitBtn/i.test(item.name));
      if (!exitNode) return { ok: false, reason: 'exit_button_not_found' };
      const node = findNodeByPath(gRoot, exitNode.path);
      if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'exit_node_unavailable' };
      const action = activateNode(node);
      if (!action.ok) return { ok: false, reason: action.reason };
      ctx.lastActionAt = now;
      ctx.phase = 'confirm';
      appendLog('exit_instance_clicked_exit', { method: action.method });
      return { ok: true, method: action.method, reason: 'exit_clicked' };
    }
    case 'confirm': {
      const alertNode = nodes.find((item) =>
        item.effectiveVisible && item.name === 'AlertWnd');
      if (!alertNode) {
        if (now - ctx.lastActionAt > 3000) {
          ctx.phase = 'click_exit';
          ctx.lastActionAt = now;
          appendLog('exit_instance_popup_timeout_retry', {});
          return { ok: true, reason: 'popup_not_found_retry' };
        }
        return { ok: true, reason: 'waiting_for_popup' };
      }
      const alertObj = findNodeByPath(gRoot, alertNode.path);
      if (!alertObj || !nodeIsEffectivelyVisible(alertObj)) {
        return { ok: false, reason: 'alert_node_unavailable' };
      }
      try {
        const params = alertObj.params;
        if (params && typeof params.rightCallback === 'function') {
          params.rightCallback();
        } else if (params && typeof params.leftCallback === 'function') {
          params.leftCallback();
        }
        if (typeof alertObj.hideImmediately === 'function') {
          alertObj.hideImmediately();
        }
      } catch (error) {
        return { ok: false, reason: 'alert_callback_error: ' + (error && error.message ? error.message : String(error)) };
      }
      ctx.lastActionAt = now;
      ctx.phase = 'waiting';
      appendLog('exit_instance_confirmed', { method: 'params.rightCallback + hideImmediately' });
      return { ok: true, method: 'params.rightCallback', reason: 'confirmed' };
    }
    case 'waiting': {
      if (mapName !== module.mapName) {
        appendLog('exit_instance_arrived', { mapName });
        state.exitInstanceCtx = null;
        return { ok: true, reason: 'exited' };
      }
      return { ok: true, reason: 'waiting_for_exit' };
    }
    default:
      state.exitInstanceCtx = null;
      return { ok: false, reason: 'unknown_exit_phase' };
  }
}
```

### Step 7.3: 实现 executeTeleportToModule

- [ ] **Step 7.3.1: 添加 executeTeleportToModule**

```js
function executeTeleportToModule(intent, snapshot) {
  const now = Date.now();
  // 确定目标 module
  let targetModule = state.teleportCtx ? moduleById(state.teleportCtx.moduleId) : null;
  if (!state.teleportCtx) {
    // 从 currentModuleId(chooseIntent 在 chooseUnknownMapIntent 设置过)或默认四风
    const moduleId = state.currentModuleId || 'four_winds';
    targetModule = moduleById(moduleId) || moduleById('four_winds');
    if (!targetModule) return { ok: false, reason: 'no_target_module' };
    state.teleportCtx = {
      moduleId: targetModule.id,
      phase: 'opening_map',
      startedAt: now,
      lastActionAt: 0,
      mapOpenedAt: 0,
      reopenClicked: false,
    };
    appendLog('teleport_start', { moduleId: targetModule.id });
  }

  const ctx = state.teleportCtx;
  const module = targetModule || moduleById(ctx.moduleId);
  if (!module) {
    state.teleportCtx = null;
    return { ok: false, reason: 'module_missing' };
  }

  if (now - ctx.startedAt > 60 * 1000) {
    appendLog('teleport_timeout', { phase: ctx.phase, elapsed: now - ctx.startedAt });
    closePanelIfExists('MapDetialWnd');
    state.teleportCtx = null;
    return { ok: false, reason: 'teleport_timeout' };
  }

  const MIN_ACTION_GAP = 800;
  if (now - ctx.lastActionAt < MIN_ACTION_GAP) {
    return { ok: true, reason: 'teleport_throttled' };
  }

  const mapName = (snapshot.scene || {}).mapName || '';
  if (mapName === module.mapName) {
    appendLog('teleport_arrived', { mapName });
    state.teleportCtx = null;
    state.farmArrivedAt = 0;
    state.farmArrivedCoord = '';
    return { ok: true, reason: 'arrived_module_map' };
  }

  switch (ctx.phase) {
    case 'opening_map': {
      const bossOpen = snapshot.bossChallengePanel && snapshot.bossChallengePanel.open;
      if (bossOpen) {
        closePanelIfExists('Instance_BossUI');
        ctx.lastActionAt = now;
        return { ok: true, reason: 'closing_blocking_panel' };
      }
      ctx.phase = 'select_map';
      ctx.lastActionAt = now;
      return { ok: true, reason: 'proceed_to_select_map' };
    }
    case 'select_map': {
      const contentReady = (snap) => {
        const entries = (snap.mapPanel && snap.mapPanel.mapEntries) || [];
        return entries.some((e) => cleanText(e.name) === module.mapName
          || cleanText(e.name).includes(module.mapName));
      };
      const mapResult = ensureMapReady(snapshot, ctx, contentReady, 'teleport');
      if (!mapResult.ok) {
        appendLog('teleport_give_up', { reason: mapResult.reason });
        state.teleportCtx = null;
        return { ok: false, reason: 'teleport_map_give_up' };
      }
      if (mapResult.reason !== 'ready') {
        return mapResult;
      }
      const fresh = readSnapshot();
      if (!fresh.mapPanel.open) {
        ctx.phase = 'opening_map';
        ctx.lastActionAt = now;
        return { ok: true, reason: 'map_closed_retry' };
      }
      const targetEntry = (fresh.mapPanel.mapEntries || []).find((e) =>
        cleanText(e.name) === module.mapName || cleanText(e.name).includes(module.mapName));
      if (!targetEntry) return { ok: false, reason: 'map_not_in_list: ' + module.mapName };
      const gRoot = root();
      const node = findNodeByPath(gRoot, targetEntry.sourcePath);
      if (!node || !nodeIsEffectivelyVisible(node)) return { ok: false, reason: 'map_entry_node_unavailable' };
      const bigBtn = findBigBtnChild(gRoot, node);
      const clickTarget = bigBtn || node;
      const action = activateNode(clickTarget);
      if (!action.ok) return { ok: false, reason: action.reason };
      ctx.lastActionAt = now;
      ctx.phase = 'select_submap';
      appendLog('teleport_clicked_module', { method: action.method, module: module.id });
      return { ok: true, method: action.method, reason: 'module_clicked' };
    }
    case 'select_submap': {
      const gRoot = root();
      const allNodes = gRoot ? collectNodes(gRoot) : [];
      const listTree = allNodes.find((item) =>
        item.effectiveVisible && item.name === 'List_tree');
      if (!listTree) {
        if (now - ctx.lastActionAt > 3000) {
          ctx.phase = 'closing_map';
          ctx.lastActionAt = now;
          appendLog('teleport_submap_timeout', {});
          return { ok: true, reason: 'submap_not_found_retry' };
        }
        return { ok: true, reason: 'waiting_for_submap' };
      }
      const treeChildren = allNodes.filter((item) =>
        item.effectiveVisible && item.path !== listTree.path
        && item.path.startsWith(listTree.path + '/')
        && item.packageName === 'smallitemBtn');
      const targetSubItem = treeChildren.find((row) => {
        const kids = descendantsOf(allNodes, row).filter((item) => item.path !== row.path);
        const titleNode = kids.find((item) => item.name === 'title' && item.contentText);
        return titleNode && cleanText(titleNode.contentText) === module.mapName;
      });
      if (!targetSubItem) return { ok: false, reason: 'submap_not_found: ' + module.mapName };
      const subNode = findNodeByPath(gRoot, targetSubItem.path);
      if (!subNode || !nodeIsEffectivelyVisible(subNode)) return { ok: false, reason: 'submap_node_unavailable' };
      const action = activateNode(subNode);
      if (!action.ok) return { ok: false, reason: action.reason };
      ctx.lastActionAt = now;
      ctx.phase = 'closing_map';
      appendLog('teleport_clicked_submap', { method: action.method });
      return { ok: true, method: action.method, reason: 'submap_clicked' };
    }
    case 'closing_map': {
      if (!snapshot.mapPanel.open) {
        ctx.phase = 'waiting';
        ctx.lastActionAt = now;
        return { ok: true, reason: 'map_closed_proceed' };
      }
      const result = closePanelIfExists('MapDetialWnd');
      ctx.lastActionAt = now;
      ctx.phase = 'waiting';
      appendLog('teleport_closing_map', { reason: result.reason });
      return { ok: true, reason: 'map_closed' };
    }
    case 'waiting': {
      if (mapName === module.mapName) {
        appendLog('teleport_arrived', { mapName });
        state.teleportCtx = null;
        state.farmArrivedAt = 0;
        state.farmArrivedCoord = '';
        return { ok: true, reason: 'arrived' };
      }
      return { ok: true, reason: 'waiting_for_teleport' };
    }
    default:
      state.teleportCtx = null;
      return { ok: false, reason: 'unknown_teleport_phase' };
  }
}
```

### Step 7.4: chooseIntent 设置 currentModuleId 给 enter_instance intent

- [ ] **Step 7.4.1: 在 chooseWildIntent 和 chooseUnknownMapIntent 里发 enter_instance 前设置 currentModuleId**

修改 `chooseWildIntent` 里发 enter_instance 的部分:
```js
for (const instModule of instances) {
  if (shouldEnterInstance(instModule, snapshot, now)) {
    state.currentModuleId = instModule.id;  // ← 新增
    return makeIntent('enter_instance', null, instModule.id + ' has boss', 'enter_instance', 0.92);
  }
}
```

`chooseUnknownMapIntent` 同样:
```js
for (const instModule of instances) {
  if (shouldEnterInstance(instModule, snapshot, now)) {
    state.currentModuleId = instModule.id;  // ← 新增
    return makeIntent('enter_instance', null, instModule.id + ' has boss', 'enter_instance', 0.92);
  }
}
```

`chooseUnknownMapIntent` 发 teleport_to_module 也设:
```js
if (wildModule) {
  state.currentModuleId = wildModule.id;  // ← 新增
  return makeIntent('teleport_to_module', null, 'go to wild map: ' + wildModule.id, 'teleport_wild', 0.85);
}
```

`intentForTarget` 里发 enter_instance 也设:
```js
if (module.type === 'instance' && snapshot.scene.mapName !== module.mapName) {
  state.currentModuleId = module.id;  // ← 新增
  return makeIntent('enter_instance', null, module.id + ' has boss, need enter', 'enter_instance', 0.95);
}
```

`executeEnterInstance` 第一段 fallback 也用 `state.currentModuleId`(已在 Step 7.1.1 里用了)。

### Step 7.5: 验证 + commit

- [ ] **Step 7.5.1: 在勇者大陆上验证能进入试炼之地1**

请用户把角色留在勇者大陆(或四风平原)。让 overlay candidates 里有"龙虾战士"(用户手动加)或临时把 trial_land 的 BOSS 状态从 `READY_UNKNOWN_TIMER` 让 shouldEnterInstance 成立(没有 overlay 记录时它默认成立,只要不在冷却内)。

Run:
```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  api.start();
  return { started: true };
})()"
sleep 5
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  const st = api.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    currentIntent: st.currentIntent,
    enterInstanceCtx: st.enterInstanceCtx,
    logsTail: st.logs.slice(-20).map(l => l.type + ':' + (l.details && l.details.reason || '')),
  };
})()"
```

Expected:在四风平原时 `currentIntent.type === 'enter_instance'`(因 trial_land 的 BOSS 状态是 READY_UNKNOWN_TIMER,shouldEnterInstance 成立);`enterInstanceCtx` 显示 `moduleId: 'trial_land', phase: 'closing_panels' → ... → 'waiting'`。

继续等几秒,角色应被传送到试炼之地1。

- [ ] **Step 7.5.2: 验证试炼之地1 内 BOSS 导航**

`scan_map` 触发 → overlay 拿刷新时间 → `travel_boss` 用 M 大地图导航。watch logs:
```bash
sleep 5
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    currentIntent: st.currentIntent,
    targetsInTrial: st.targets.filter(t => t.moduleId === 'trial_land').map(t => ({ id: t.id, status: t.status, refreshAt: t.refreshAt })),
    logsTail: st.logs.slice(-20).map(l => l.type + ':' + (l.details && l.details.reason || '')),
  };
})()"
```

Expected:`sceneMap: '试炼之地1'`,`currentIntent.type` 为 `scan_map` / `travel_boss` / `hold`,无 tick_error。

- [ ] **Step 7.5.3: 验证退出试炼之地1**

等 BOSS 都不在场(scan 判空 → 写冷却 → exit_instance):
```bash
sleep 5
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    currentIntent: st.currentIntent,
    exitInstanceCtx: st.exitInstanceCtx,
    instanceCheckCooldown: st.instanceCheckCooldown,
    logsTail: st.logs.slice(-20).map(l => l.type + ':' + (l.details && l.details.reason || '')),
  };
})()"
```

Expected:如果 BOSS 都不在,`instanceCheckCooldown.trial_land` 被设,`exitInstanceCtx` 推进,角色最终回到勇者大陆。

- [ ] **Step 7.5.4: 关脚本,commit Task 7**

```bash
node cdp_eval.js auto "(() => { window.__muMultiMapBossMvp.setConfig({ enabled: false, dryRun: true }); return { ok: true }; })()"
```

```bash
git add mu-boss-multi-map-mvp.user.js
git commit -m "$(cat <<'EOF'
feat(multi-map-boss): enter/exit/teleport executors parameterized

Implement executeEnterInstance (7-phase state machine ported from
executeEnterTrial): closing_panels → opening → waiting_for_open →
select_tab → select_boss → click_enter → waiting. Tab name, boss row
scroll filter (module.bossRowScroll), enter button tog + regex
(module.enterButtonTog + module.enterButtonTextRegex) all
parameterized. scanBossChallengePanel's new scrollName/togName fields
used in select_boss and click_enter filtering. executeExitInstance
(5-phase) and executeTeleportToModule (5-phase with List_tree
sub-popup) similarly parameterized by module.mapName. chooseIntent
sets state.currentModuleId before dispatching enter/teleport so
executors can recover the target module. Trial-land enter/exit/teleport
end-to-end verified.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Task 7 完成标准:** 角色从勇者大陆/四风平原自动进试炼之地1、scan、(若有 BOSS)导航,scan 判空后写冷却退出回勇者大陆。

---

## Task 8: purgatory 模块集成

**目标:** 验证 `purgatoryModule`(已在 Task 3 注册)端到端工作:`shouldEnterInstance(purgatoryModule)` 成立 → `enter_instance` 进苦难炼狱2 → (Task 0 已填坐标)`travel_boss` 导航到魔晶菲尼斯。副本空场冷却检查。

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js`(可能需要根据 Task 0 探查结果微调 purgatoryModule 字段或 RATE_CHECK_MAPS 配置)

### Step 8.1: 确认 purgatoryModule 配置与 Task 0 一致

- [ ] **Step 8.1.1: 检查 purgatoryModule 的 coordinate 字段**

打开 `mu-boss-multi-map-mvp.user.js`,找到 `purgatoryModule` 定义,确认 `bosses[0].coordinate` 已是 Task 0 项 2 探查到的真实坐标(如 `'126,95'`),不是占位符。

- [ ] **Step 8.1.2: 检查 PURGATORY_RATE_CHECK_ENABLED**

确认 `PURGATORY_RATE_CHECK_ENABLED` 常量值与 Task 0 项 5 结论一致:
- Task 0 项 5 验证成立(魔晶菲尼斯爆率反映在 BaolvIcon0) → `const PURGATORY_RATE_CHECK_ENABLED = true;`
- Task 0 项 5 验证不成立 → `const PURGATORY_RATE_CHECK_ENABLED = false;`(默认值,无需改)

如果改了 `PURGATORY_RATE_CHECK_ENABLED`,在 `state.config = normalizeConfig(...)` 和 `rebuildRateCheckMaps()` 之间无需额外动作(rebuildRateCheckMaps 会读这个常量)。

### Step 8.2: 清除试炼之地冷却(避免影响测试)

- [ ] **Step 8.2.1: 启动前清冷却**

```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  api.resetInstanceCooldown();  // 清所有冷却
  return api.status().instanceCheckCooldown;
})()"
```

Expected: `{}`。

### Step 8.3: 验证 shouldEnterInstance(purgatory) 成立

- [ ] **Step 8.3.1: 启动脚本,观察 intent**

请用户把角色留在勇者大陆(若在副本内,先退出来)。

```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  api.resetInstanceCooldown();
  api.start();
  return { started: true };
})()"
sleep 3
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    currentIntent: st.currentIntent,
    currentModuleId: st.currentModuleId,
    targets: st.targets.filter(t => t.moduleId === 'purgatory').map(t => ({ id: t.id, status: t.status, refreshAt: t.refreshAt, coordinate: t.coordinate })),
    logsTail: st.logs.slice(-10).map(l => l.type + ':' + (l.details && l.details.reason || '')),
  };
})()"
```

Expected: `currentModuleId: 'purgatory'`,`currentIntent.type === 'enter_instance'`(因 purgatory 优先级最高,无 overlay 记录时状态 `READY_UNKNOWN_TIMER`,shouldEnterInstance 成立)。如果 currentIntent 是 `enter_instance` 但 `currentModuleId` 不是 'purgatory'(比如是 'trial_land'),说明优先级没生效,检查 `effectiveModulePriority` 和 `shouldEnterInstance`。

### Step 8.4: 验证进入苦难炼狱2 副本

- [ ] **Step 8.4.1: 等几秒观察 enter_instance 推进**

```bash
sleep 5
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    enterInstanceCtx: st.enterInstanceCtx,
    logsTail: st.logs.slice(-25).map(l => l.type + ':' + (l.details && (l.details.phase || l.details.reason || ''))),
  };
})()"
```

Expected:`enterInstanceCtx.moduleId === 'purgatory'`,phase 推进到 `select_tab` → `select_boss` → `click_enter` → `waiting`。最终 `sceneMap === '苦难炼狱2'`(或 Task 0 项 1 拿到的真实 mapName)。

如果 phase 卡在 `select_boss` 报 `boss_row_not_found`:
- 检查 `scanBossChallengePanel` 是否正确加了 `scrollName`,purgatory 的 `bossRowScroll='wildlevelScroll'`
- 让用户在游戏里手动切到"苦难炼狱"tab 选中魔晶菲尼斯,然后 Run:
  ```bash
  node cdp_eval.js auto "(() => {
    const g = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
    function collect(n, d, p, out) {
      if (!n || d > 18) return;
      const pkg = n.packageItem ? (n.packageItem.name||'') : '';
      if (pkg === 'BtnBoss' && n.visible !== false && n.internalVisible !== false) {
        let labName = '';
        const k = Number(n.numChildren)||0;
        for (let i=0;i<k;i++) { const ch = n.getChildAt(i); if (ch && String(ch.name||'') === 'lab_name') labName = String(ch.text||''); }
        // inferScrollName
        let scrollName = '';
        const parts = p.split('/');
        for (let i=parts.length-1;i>=0;i--) { const nn = parts[i].replace(/\\[\\d+\\]$/, ''); if (/Scroll$/.test(nn)) { scrollName = nn; break; } }
        out.push({ path: p, labName, scrollName, selected: n.selected === true });
      }
      const c = Number(n.numChildren)||0;
      for (let i=0;i<c;i++) collect(n.getChildAt(i), d+1, p+'/'+(n.getChildAt(i)&&n.getChildAt(i).name||'?')+'['+i+']', out);
    }
    const out = [];
    collect(g, 0, 'root', out);
    return out.filter(r => /魔晶菲尼斯/.test(r.labName));
  })()"
  ```
  检查返回的 `scrollName` 是不是 `'wildlevelScroll'`。如果是,但 `executeEnterInstance` 没找到,说明改造的过滤条件 `r.scrollName === currentModule.bossRowScroll` 没匹配,检查字符串完全相等(注意大小写、空格)。

如果 phase 卡在 `click_enter` 报 `enter_button_vanished`:
- 检查 `wildtog_mapName` 里的"苦难炼狱2 (126,95)"按钮的 `togName` 是否真是 `'wildtog_mapName'`(Task 0 项 6 应该确认过)
- 让用户手动切 tab 选中魔晶菲尼斯,Run:
  ```bash
  node cdp_eval.js auto "(() => {
    const g = window.fgui && window.fgui.GRoot && window.fgui.GRoot.inst;
    function collect(n, d, p, out) {
      if (!n || d > 22) return;
      const pkg = n.packageItem ? (n.packageItem.name||'') : '';
      if (pkg === 'BtnBossMore' && n.visible !== false && n.internalVisible !== false) {
        let labMapName = '';
        const k = Number(n.numChildren)||0;
        for (let i=0;i<k;i++) { const ch = n.getChildAt(i); if (ch && String(ch.name||'') === 'lab_mapName') labMapName = String(ch.text||''); }
        let togName = '';
        const parts = p.split('/');
        for (let i=parts.length-1;i>=0;i--) { const nn = parts[i].replace(/\\[\\d+\\]$/, ''); if (/tog_mapName$/.test(nn)) { togName = nn; break; } }
        out.push({ path: p, labMapName, togName });
      }
      const c = Number(n.numChildren)||0;
      for (let i=0;i<c;i++) collect(n.getChildAt(i), d+1, p+'/'+(n.getChildAt(i)&&n.getChildAt(i).name||'?')+'['+i+']', out);
    }
    const out = [];
    collect(g, 0, 'root', out);
    return out.filter(r => /苦难炼狱/.test(r.labMapName));
  })()"
  ```
  检查 `togName` 和 `labMapName`。如果 `labMapName` 不以 `苦难炼狱2` 开头(比如带"会员"前缀),需要调整 `enterButtonTextRegex` 或在 `executeEnterInstance.click_enter` 里增加 fallback 选第一个 `苦难炼狱` 按钮(不强求文本完全匹配 `苦难炼狱2`)。

### Step 8.5: 修复任何 Step 8.4 发现的不一致

- [ ] **Step 8.5.1: 根据探查结果修复**

如果 Step 8.4 发现任何不一致(scrollName/togName/regex 不匹配),修改 `purgatoryModule` 字段或 `executeEnterInstance` 的过滤逻辑。**不要改试炼之地相关字段**,只动 purgatory。

### Step 8.6: commit Task 8

- [ ] **Step 8.6.1: 关脚本,commit**

```bash
node cdp_eval.js auto "(() => { window.__muMultiMapBossMvp.setConfig({ enabled: false, dryRun: true }); return { ok: true }; })()"
```

```bash
git add mu-boss-multi-map-mvp.user.js
git commit -m "$(cat <<'EOF'
feat(multi-map-boss): integrate purgatory module end-to-end

purgatoryModule (苦难炼狱2 / 魔晶菲尼斯) verified end-to-end:
shouldEnterInstance chooses purgatory by priority 30 over trial_land
(20) and four_winds (10); executeEnterInstance navigates tab "苦难炼
狱" → BOSS row in wildlevelScroll (filter by scrollName) → enter button
in wildtog_mapName matching ^苦难炼狱2 → teleport to instance. Any
scrollName/togName/regex mismatches surfaced by CDP during Task 8
verification fixed. PURGATORY_RATE_CHECK_ENABLED set per Task 0 项 5
conclusion.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Task 8 完成标准:** 角色自动进入苦难炼狱2 副本,`sceneMap` 变为 `'苦难炼狱2'`。

---

## Task 9: 苦难炼狱副本内打 BOSS + 空场冷却 + 退出

**目标:** 进副本后 `scan_map` 判定 BOSS 在场 → `travel_boss` 用写死坐标导航到魔晶菲尼斯 → `hold`/`engage` → `ensureZKey` 开挂打 BOSS。BOSS 不在场 → 写副本空场冷却 → `exit_instance` 退出回勇者大陆。完整跑通一次"勇者大陆 → 进苦难炼狱2 → 打/不打 → 退出 → 回勇者大陆"。

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js`

### Step 9.1: 验证副本内 scan_map 触发

- [ ] **Step 9.1.1: 角色在苦难炼狱2 副本内,启动脚本**

请用户把角色留在苦难炼狱2 副本内(Task 8 已进),或重新启动脚本让 Task 8 自动送进去。

```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  api.resetInstanceCooldown();
  api.start();
  return { started: true };
})()"
sleep 5
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    sceneCoord: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.coordinate,
    currentIntent: st.currentIntent,
    mapScanContext: st.mapScanContext,
    logsTail: st.logs.slice(-20).map(l => l.type + ':' + (l.details && l.details.reason || '')),
  };
})()"
```

Expected:`sceneMap: '苦难炼狱2'`,`currentIntent.type === 'scan_map'`(因魔晶菲尼斯无 overlay 记录,状态 `READY_UNKNOWN_TIMER`,`needMapScan` 返回 true),`mapScanContext` 推进。

### Step 9.2: 验证 scan 后判空逻辑

- [ ] **Step 9.2.1: 等 scan 完成,观察 intent**

```bash
sleep 10
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    currentIntent: st.currentIntent,
    instanceCheckCooldown: st.instanceCheckCooldown,
    targets: st.targets.filter(t => t.moduleId === 'purgatory').map(t => ({ id: t.id, status: t.status, refreshAt: t.refreshAt })),
    logsTail: st.logs.slice(-25).map(l => l.type + ':' + (l.details && (l.details.reason || l.details.moduleId || ''))),
  };
})()"
```

Expected:
- **场景 A:魔晶菲尼斯在场**(大地图有图标或 overlay 检测到倒计时):`currentIntent.type === 'travel_boss'`,targets[0].status 可能变为 `PREPARE` / `READY`(overlay 写入)。导航往坐标走。
- **场景 B:魔晶菲尼斯不在场**(scan 后无刷新记录):`currentIntent.type === 'exit_instance'`,`instanceCheckCooldown.purgatory` 被设为 `now + 15min`。角色准备退出。

如果是场景 A:跳到 Step 9.3。如果是场景 B:跳到 Step 9.4。

### Step 9.3: 验证副本内 travel_boss 导航(场景 A)

- [ ] **Step 9.3.1: 观察导航推进**

```bash
sleep 10
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    sceneCoord: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.coordinate,
    currentIntent: st.currentIntent,
    navigationContext: st.navigationContext,
    combat: st.lastSnapshot && st.lastSnapshot.combat,
    autoBattle: st.lastSnapshot && st.lastSnapshot.autoBattle,
    arrivalConfirmedAt: st.arrivalConfirmedAt,
    zKeySentAt: st.zKeySentAt,
    logsTail: st.logs.slice(-20).map(l => l.type + ':' + (l.details && (l.details.reason || l.details.coordinate || ''))),
  };
})()"
```

Expected:角色坐标向魔晶菲尼斯坐标(Task 0 项 2 探查值,如 (126,95))靠拢。`navigationContext.clicked: true`。到达后 `arrivalConfirmedAt` 被设,`currentIntent.type` 变 `hold` 或 `engage`(若 BOSS 在视野)。

- [ ] **Step 9.3.2: 验证 ensureZKey 开挂**

到达后:
```bash
sleep 3
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    currentIntent: st.currentIntent,
    autoBattle: st.lastSnapshot && st.lastSnapshot.autoBattle,
    zKeySentAt: st.zKeySentAt,
    zKeyRetryCount: st.zKeyRetryCount,
    logsTail: st.logs.slice(-10).map(l => l.type),
  };
})()"
```

Expected:`autoBattle.enabled: true`(或 z_key_sent 日志显示已尝试),`currentIntent.type === 'hold'` 或 `engage`。

### Step 9.4: 验证副本空场冷却 + 退出(场景 B)

- [ ] **Step 9.4.1: 观察冷却和退出推进**

```bash
sleep 10
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    currentIntent: st.currentIntent,
    exitInstanceCtx: st.exitInstanceCtx,
    instanceCheckCooldown: st.instanceCheckCooldown,
    logsTail: st.logs.slice(-25).map(l => l.type + ':' + (l.details && (l.details.reason || l.details.moduleId || ''))),
  };
})()"
```

Expected:`exitInstanceCtx` 推进 `closing_panels` → `click_exit` → `confirm` → `waiting`。最终 `sceneMap` 变为 `'勇者大陆'`,`exitInstanceCtx: null`,`instanceCheckCooldown.purgatory` 已设。

### Step 9.5: 验证防折返(冷却期内不再进副本)

- [ ] **Step 9.5.1: 在勇者大陆上观察 intent**

角色退到勇者大陆后:
```bash
sleep 3
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    currentIntent: st.currentIntent,
    instanceCheckCooldown: st.instanceCheckCooldown,
    logsTail: st.logs.slice(-15).map(l => l.type + ':' + (l.details && l.details.reason || '')),
  };
})()"
```

Expected:`sceneMap: '勇者大陆'`,`currentIntent.type === 'teleport_to_module'`(回四风平原 farming),**不是** `'enter_instance'`。`instanceCheckCooldown.purgatory` 仍为冷却时间戳。

**关键检查**:此时如果 currentIntent 是 `enter_instance` 且 moduleId 是 purgatory,说明冷却没生效,有折返 bug,需修。

- [ ] **Step 9.5.2: 主动模拟冷却解除**

测试 `resetInstanceCooldown`:
```bash
node cdp_eval.js auto "(() => {
  window.__muMultiMapBossMvp.resetInstanceCooldown('purgatory');
  return window.__muMultiMapBossMvp.status().instanceCheckCooldown;
})()"
```

Expected:`{}`。下一次 tick `shouldEnterInstance(purgatory)` 应再次成立(若 BOSS 状态仍 READY_UNKNOWN_TIMER),`currentIntent.type === 'enter_instance'`。

**但实际游戏里不要让角色反复进出** — 验证冷却解除即可,验证完关脚本:
```bash
node cdp_eval.js auto "(() => { window.__muMultiMapBossMvp.setConfig({ enabled: false, dryRun: true }); return { ok: true }; })()"
```

### Step 9.6: 修复任何发现的 bug

- [ ] **Step 9.6.1: 修复发现的 bug(如有)**

如果 Step 9.2 场景 B 没触发 `exit_instance`(仍然显示 `scan_map` 或卡在某个 intent),检查:
- `needMapScan` 在 instance 内是否生效(原 `needMapScan` 可能只针对 four_winds 硬编码,Task 6 实现里改成按 module 通用,验证一下)
- scan 后 `chooseInstanceIntent` 的判空逻辑是否对(看 `getAttackableTargets(module)` 在没 overlay 记录时返回空数组 → 走 `scan_map` 分支,scan 后还是空 → 走 `exit_instance` 分支)

如果 Step 9.3 导航卡死(`navigation_failed`),可能 `executeTravel` 在副本内的 contentReady 没正确识别 BOSS 行,检查 `scanMapPanel` 是否扫到副本内 M 大地图的 BOSS 行。

### Step 9.7: commit Task 9

- [ ] **Step 9.7.1: commit**

```bash
git add mu-boss-multi-map-mvp.user.js
git commit -m "$(cat <<'EOF'
feat(multi-map-boss): in-instance boss fight + empty cooldown + exit

Purgatory end-to-end: scan_map determines 魔晶菲尼斯 presence;
if present, executeTravel navigates to hardcoded coordinate, hold/
engage triggers, ensureZKey activates auto-battle. If absent,
setInstanceCheckCooldown(purgatory, now+15min) + exit_instance back
to 勇者大陆. Cooldown prevents re-entry for 15 minutes (防折返);
lifted automatically when overlay records a fresh refresh timer for
the boss, or manually via resetInstanceCooldown(). Verified:
勇者大陆 → enter_instance → (scan → fight or cooldown+exit) → 勇者大陆
full loop.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Task 9 完成标准:** 完整跑通一次"勇者大陆 → 进苦难炼狱2 → 打魔晶菲尼斯(或 BOSS 没刷则写冷却退出)→ 回勇者大陆",防折返冷却工作正常。

---

## Task 10: 边界 case、防折返 & 旧脚本退役

**目标:** 验证所有边界 case(临时跳过试炼之地、苦难炼狱低爆率跳过、副本内不直传);更新 README/CLAUDE.md 说明新脚本取代旧脚本。这是收尾任务。

**Files:**
- Modify: `mu-boss-multi-map-mvp.user.js`(`@version` 递增到 `0.1.1` 或更高)
- Modify: `CLAUDE.md`(在 §1 目录内容表添加新脚本说明,标注旧脚本退役)
- Optional: 修改 `README`(如有)

### Step 10.1: 验证临时跳过试炼之地

- [ ] **Step 10.1.1: setConfig 跳过 trial_land**

请用户把角色留在勇者大陆。Run:
```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  api.resetInstanceCooldown();
  api.setConfig({ enabledMaps: ['four_winds', 'purgatory'] });  // 跳过 trial_land
  api.start();
  return { enabledMaps: api.status().config.enabledMaps };
})()"
sleep 5
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    currentIntent: st.currentIntent,
    currentModuleId: st.currentModuleId,
    logsTail: st.logs.slice(-10).map(l => l.type + ':' + (l.details && l.details.reason || '')),
  };
})()"
```

Expected:`currentModuleId` 不是 `'trial_land'`(任何场景),`currentIntent` 应为 `enter_instance`(purgatory,无冷却时)或 `teleport_to_module`(purge 在冷却则去四风)。

**关键检查**:不应出现 `enter_instance` 且 `currentModuleId === 'trial_land'`,跳过机制工作。

- [ ] **Step 10.1.2: 恢复 enabledMaps**

```bash
node cdp_eval.js auto "(() => { window.__muMultiMapBossMvp.setConfig({ enabledMaps: ['four_winds','trial_land','purgatory'] }); return { ok: true }; })()"
```

### Step 10.2: 验证 enabledBosses 单 BOSS 跳过

- [ ] **Step 10.2.1: 只打 magic-crystal 跳过其他**

```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  api.setConfig({ enabledBosses: ['magic-crystal'] });
  return { enabledBosses: api.status().config.enabledBosses };
})()"
sleep 3
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    targets: st.targets.map(t => ({ id: t.id, moduleId: t.moduleId, status: t.status })),
    logsTail: st.logs.slice(-5).map(l => l.type),
  };
})()"
```

Expected:`enabledBosses: ['magic-crystal']`。`getAttackableTargets(trialLand)` 应返回空(因 lobster-* 不在 enabledBosses),`chooseInstanceIntent(trial_land)` 走 scan → 判空 → 退出。`getAttackableTargets(fourWinds)` 也空(ao-* 不在 enabledBosses)。

- [ ] **Step 10.2.2: 恢复 enabledBosses**

```bash
node cdp_eval.js auto "(() => {
  window.__muMultiMapBossMvp.setConfig({ enabledBosses: ['ao-left','ao-right','angry-ao','rage-ao','lobster-1','lobster-2','lobster-3','magic-crystal'] });
  return { ok: true };
})()"
```

### Step 10.3: 验证副本内不直传

- [ ] **Step 10.3.1: 让角色进苦难炼狱2,观察 intent**

```bash
node cdp_eval.js auto "(() => {
  const api = window.__muMultiMapBossMvp;
  api.resetInstanceCooldown();
  api.start();
  return { started: true };
})()"
sleep 8
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    currentIntent: st.currentIntent,
  };
})()"
```

等角色进入苦难炼狱2(`sceneMap === '苦难炼狱2'`),然后:

```bash
sleep 5
node cdp_eval.js auto "(() => {
  const st = window.__muMultiMapBossMvp.status();
  return {
    sceneMap: st.lastSnapshot && st.lastSnapshot.scene && st.lastSnapshot.scene.mapName,
    currentIntent: st.currentIntent,
    teleportCtx: st.teleportCtx,
    logsTail: st.logs.slice(-10).map(l => l.type + ':' + (l.details && l.details.reason || '')),
  };
})()"
```

Expected:在副本内时 `currentIntent.type` 应为 `scan_map` / `travel_boss` / `hold` / `engage` / `exit_instance` 之一,**绝不应是** `teleport_to_module`(副本内不直传硬约束)。`teleportCtx` 在副本内应保持 `null`。

### Step 10.4: 验证苦难炼狱低爆率跳过(若 PURGATORY_RATE_CHECK_ENABLED=true)

- [ ] **Step 10.4.1: 跳过此步若 PURGATORY_RATE_CHECK_ENABLED=false**

如果 `PURGATORY_RATE_CHECK_ENABLED === false`,跳过 Step 10.4,直接到 Step 10.5。

- [ ] **Step 10.4.2: 模拟低爆率,观察跳过**

通过手动设置 `state.rateResults['苦难炼狱2'] = { result: 'low', skipUntil: <未来时间>, nextCheckAt: ... }`,Run:
```bash
node cdp_eval.js auto "(() => {
  // 直接修改内部 state(只用于测试)
  const api = window.__muMultiMapBossMvp;
  const st = api.status();
  // 通过 setConfig 触发,但没有直接 set rateResults 的 API;改用 toggle + 重新走爆率检查更复杂。
  // 简化:让用户在游戏里手动查爆率,如果当前爆率是 low,观察行为
  return { hint: '让用户在游戏里手动观察苦难炼狱 tab 的 BaolvIcon0 颜色/形状,确认爆率 low,然后启动脚本看是否跳过' };
})()"
```

实际验证:
1. 让用户在游戏挑战 BOSS 面板苦难炼狱 tab 选中魔晶菲尼斯,看 BaolvIcon0 的 url
2. 如果 url 是 `ui://InstanceBossWnd/txt_bld`(low),启动脚本观察 `currentIntent` — 应该是 `teleport_to_module`(回四风)或 `safe_wait`(若已 farming),不是 `enter_instance`
3. 如果不是 low,跳过此验证(实际游戏中爆率会变,后续验证)

### Step 10.5: 验证 Ctrl+N 切换不冲突

- [ ] **Step 10.5.1: 测试 Ctrl+N**

确保原 `mu-boss-trial-land-mvp.user.js` 已在 Tampermonkey 里 disable(用户手动),只启用新脚本。

用户在游戏页面按 Ctrl+N,应看到 toast "BOSS脚本 已开启"。再按一次,应看到 "BOSS脚本 已关闭"。

如果原脚本未 disable,Ctrl+N 会同时触发两个脚本的 toggle,toast 可能闪烁或显示冲突。**这是预期行为,文档说明需 disable 旧脚本**。

### Step 10.6: 递增版本号

- [ ] **Step 10.6.1: 改 @version**

在 `mu-boss-multi-map-mvp.user.js` 顶部 metadata,把 `@version 0.1.0` 改为 `@version 0.1.1`(修订号递增一次,代表完成第一轮集成 + 边界验证)。

### Step 10.7: 更新 CLAUDE.md

- [ ] **Step 10.7.1: 在 CLAUDE.md §1 目录内容表添加新脚本**

打开 `/Users/user/mu_scripts/CLAUDE.md`,在 §1 表格末尾添加两行:

```markdown
| `mu-boss-multi-map-mvp.user.js` | 多地图 BOSS 自动化(四风平原 + 试炼之地1 + 苦难炼狱2),模块化可插拔架构。**取代 `mu-boss-trial-land-mvp.user.js`,后者已退役,在 Tampermonkey 中 disable 旧脚本。** |
```

并在 `mu-boss-trial-land-mvp.user.js` 行(如有)后添加备注"已退役,见新脚本"。或者保留原行不变,只在末尾添加新脚本行说明取代关系。

- [ ] **Step 10.7.2: 更新版本号管理约定**

如果 CLAUDE.md §11 没有特别说明多脚本情况,无需改。已经在每个 Task 末尾要求递增 @version,符合 §11 约定。

### Step 10.8: 最终 commit

- [ ] **Step 10.8.1: commit Task 10 + 文档**

```bash
git add mu-boss-multi-map-mvp.user.js CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(multi-map-boss): v0.1.1 - edge cases verified, old script retired

Verified: temporary skip via setConfig({enabledMaps:[...]}) and
{enabledBosses:[...]}; in-instance hard constraint (never
teleport_to_module while inside an instance); Ctrl+N toggle (when
old script disabled); purgatory low-rate skip (if rate check enabled).
Bump version to 0.1.1. CLAUDE.md updated: new script supersedes
mu-boss-trial-land-mvp.user.js (manually disable old script in
Tampermonkey; do not run both simultaneously — they fight over BOSS
panel and map panel state).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

**Task 10 完成标准:** 所有边界 case 通过验证,CLAUDE.md 标注新脚本取代旧脚本,版本号递增到 0.1.1。

---

## Plan 完成标准

- [x] Task 0:CDP 探查回填 spec 占位符
- [x] Task 1:脚本骨架 + utility + scan 函数(含 scanBossChallengePanel 改造)
- [x] Task 2:Config & API + 键盘绑定
- [x] Task 3:三个地图模块对象
- [x] Task 4:reconcile & target state + readSnapshot
- [x] Task 5:chooseIntent 调度核心 + tick 循环
- [x] Task 6:executeIntent dispatch + 通用 executor(travel/hold/engage/check_rate/scan_map)
- [x] Task 7:executeEnterInstance / executeExitInstance / executeTeleportToModule(试炼之地端到端跑通)
- [x] Task 8:purgatory 模块集成(进入苦难炼狱2)
- [x] Task 9:副本内打 BOSS + 空场冷却 + 退出(端到端跑通)
- [x] Task 10:边界 case 验证 + 旧脚本退役 + 文档更新

最终:`mu-boss-multi-map-mvp.user.js` 取代 `mu-boss-trial-land-mvp.user.js`,支持四风平原 / 试炼之地1 / 苦难炼狱2 三张地图,地图模块可插拔扩展。

---

## 附录:常用 CDP 验证命令速查

| 用途 | 命令 |
|---|---|
| 检查脚本是否加载 | `node cdp_eval.js auto "({ hasMarker: typeof window.__muMultiMapBossMvp === 'object' })"` |
| 读当前 intent | `node cdp_eval.js auto "window.__muMultiMapBossMvp.status().currentIntent"` |
| 读当前地图 | `node cdp_eval.js auto "window.__muMultiMapBossMvp.status().lastSnapshot.scene.mapName"` |
| 读所有 targets 状态 | `node cdp_eval.js auto "window.__muMultiMapBossMvp.status().targets.map(t => ({id:t.id, status:t.status, refreshAt:t.refreshAt}))"` |
| 读 enter context | `node cdp_eval.js auto "window.__muMultiMapBossMvp.status().enterInstanceCtx"` |
| 读副本冷却 | `node cdp_eval.js auto "window.__muMultiMapBossMvp.status().instanceCheckCooldown"` |
| 读最近日志 | `node cdp_eval.js auto "window.__muMultiMapBossMvp.status().logs.slice(-20).map(l => l.type + ':' + (l.details && l.details.reason || ''))"` |
| 启动脚本 | `node cdp_eval.js auto "window.__muMultiMapBossMvp.start()"` |
| 关闭脚本 | `node cdp_eval.js auto "window.__muMultiMapBossMvp.setConfig({ enabled: false, dryRun: true })"` |
| 重置副本冷却 | `node cdp_eval.js auto "window.__muMultiMapBossMvp.resetInstanceCooldown()"` |
| 设置 enabledMaps | `node cdp_eval.js auto "window.__muMultiMapBossMvp.setConfig({ enabledMaps: ['four_winds','purgatory'] })"` |



