# Places 重构（折叠 + 分页）可行性报告

> 状态：**已实施**（2026-10-27，未发布）。实施中的定案与偏差见文末
> 「九、实施记录」。
> 目标：把 Places 从「带滚动条的一列」改为「顶部操作栏 + 分页面板」：
> 收起/展开、内建终端入口移到顶栏、去掉滚动条、两部分分段分页、
> 手势/圆点翻页。

## 一、结论

**可行，但这不是纯 CSS 改动，属于中等偏大的交互重构，风险中高。**

| 维度 | 评价 |
| --- | --- |
| 图标轨道（收起态） | 简单：200px ↔ 88px 宽度过渡 + 图标化样式，无 App 改动 |
| 重渲染隔离 | 必须守住：`ExplorerTab` 未 memo，折叠/翻页状态不能进 App |
| 两按钮 + 圆点切换器 | 简单，纯 React/CSS |
| 分页（无滚动条） | 中等：需要尺寸测量 + 页数重算 + 焦点/翻页联动 |
| 滚轮/触控板/触摸翻页 | 中等：需要非 passive 监听 + 阈值/冷却防连翻 |
| 拖放兼容 | **高风险**：现有边缘自动滚动依赖 `scrollTop`，跨页拖放必须改成"边缘自动翻页" |
| 键盘分区 | 中等：现有 ↑/↓ 在全部条目上循环，需要按页裁剪 + 跨界自动翻页 |
| e2e | 中高：约 20+ 套用例涉及侧边栏，harness 两个辅助函数强依赖当前 DOM 结构 |

预计工作量：核心（折叠 + 分页 + 圆点 + 手势）1.5–2 人日；拖放/键盘/跨页与 e2e
回归 1–1.5 人日。建议按第六节分四步落地，每步单独可验收。

## 二、现状（代码定位）

| 位置 | 现状 |
| --- | --- |
| `src/components/Sidebar.tsx:953-1369` | 单个 `<aside>`，四个区块：位置 / 已固定 / 添加固定 / 设备 |
| `src/components/Sidebar.css:1-40` | `.sidebar { width: 200px; overflow-y: auto; scrollbar-width: thin }` |
| `src/components/Sidebar.css:49-55` | 首区块标题与标签条垂直对齐（32px 基准） |
| `src/components/Sidebar.tsx:134-145`, `355-410` | 拖拽边缘自动滚动：`EDGE_ZONE_PX` + `el.scrollTop += step` |
| `src/components/Sidebar.tsx:502-639` | 文档级 dragover/drop，`elementFromPoint` + `[data-sidebar-target]` 路由 |
| `src/components/Sidebar.tsx:769-951` | 固定项排序拖拽（`pinDrag.from/gap` 为全局索引） |
| `src/components/Sidebar.tsx:215-261` | 键盘分区：查询全部 `.sidebar-item`，↑/↓ 循环 |
| `src/App.tsx:2778-2819` | `.app-shell` = Sidebar + `.main-content`（`.tab-header-bar` + `.content-area`） |
| `src/index.css:156-192` | `.app-shell` flex 布局；`.main-content` flex:1 |
| `src/components/TabBar.css:1-16` | `.tab-bar { padding: 12px 8px 0 0; height: 44px; overflow-x: auto }` |
| `scripts/e2e/harness.cjs:1013-1027` | `openSettingsPage` 查 `.sidebar-section:first-of-type .sidebar-item` |
| `scripts/e2e/harness.cjs:1060-1075` | `clickPlace(win, ligature)` 同上 |

关键词：现有实现的最大依赖是**滚动容器**（拖拽自动滚动、滚动条、设备多时溢出）
和**平铺 DOM**（键盘循环、`elementFromPoint`、e2e 直接 `.click()`）。

## 三、设计裁决（需求里的歧义点，先定死再动手）

需求有两处需要明确，我给出推荐；若与预期不符请先纠正，否则实现会返工。

### 3.1 「Places 收起」后的几何形态（定案：图标轨道）

> 2026-10-27 定案：收起**不是完全收起**，而是变成只显示图标的窄轨道，
> 且轨道恒定显示第一部分（固定快捷方式）。原「完全收起 / 顶栏浮层」方案作废。

- 展开：`.sidebar { width: 200px }`，头部 = 折叠按钮 + 终端按钮 + 圆点切换器；
  主体 = 分页面板。
- 收起：`.sidebar { width: 88px }`（= 16×2 padding + 56 图标胶囊），
  条目只显示图标（标签隐藏、胶囊变方形居中），区块标题隐藏；
  **圆点隐藏**（需求已定）；主体恒定渲染第一部分第 1 页，忽略当前页码。
- 已固定目录与设备在收起态不可达（按设计），恢复按钮回到展开态即可。
- 两个按钮留在窄轨道顶部（折叠后仍可见，符合「除了顶部按钮…」）；
  宽度 88 时两个 40px 按钮 + 8px 间距刚好放得下。
- **`main-content` 无需任何改动**：`.app-shell` 是 flex，侧边栏变窄后文件区
  与标签条自然左移，标签条左侧的空间正好由轨道占据——原需求里
  「标签页栏要给左侧 2 按钮留出空间」由布局天然满足。

### 3.1.1 收起态的溢出

第一部分共 11 条（仪表盘 + 7 个文件位置 + 设置 + 对象 + 回收站），
56px 胶囊 + 4px 间距 ≈ 660px，加头部 44px ≈ 704px。1080p/768p 窗口一般
放得下；窗口更矮或未来新增入口时会溢出。

建议：**收起态继续沿用翻页逻辑，只是不显示圆点**（滚轮/触控板仍可翻页），
不做条目缩小、也不恢复滚动条。若希望收起态永不翻页，则需把图标胶囊降到
48px 或隐藏部分入口——这一点待确认（见第八节）。

### 3.2 第一部分的条目范围（定案）

终端入口移到头部按钮后，第一部分为：**仪表盘 → 文件位置（主页/桌面/文档/
下载/音乐/图片/视频）→ 设置 → 对象面板 → 回收站**（沿用当前顺序，去掉终端）。

按 56px 条目 + 4px 间距、1080p 窗口侧边栏可用高度约 700px 计算，第一部分
最多 11 条 ≈ 660px——**在 768p 或开启标题栏/终端面板时第一页就会溢出**，
所以第一部分本身就需要分页，不能假设它总是 1 页。

### 3.3 其他默认决策（如无异议按此实现）

| 问题 | 默认 |
| --- | --- |
| 只有 1 页时圆点 | 隐藏（无信息量） |
| 收起时圆点 | 隐藏（需求已定） |
| 收起状态持久化 | `useLocalStorage("sidebar.collapsed")`；不加设置项 |
| 收起是否可用快捷键 | 本期不做 |
| 终端按钮显示 | 沿用现有设置 `settings.showTerminalPlace`（「显示内建终端」），关掉即隐藏头部按钮 |
| 拾取器（picker 变体） | 无折叠/终端按钮；仍有分页与圆点 |
| 跨页时区块标题 | 第 2 部分续页时在页首重复「已固定」「设备」标题 |
| 「添加固定」按钮 | 紧跟在最后一个固定项之后；若该位置放不下，落到下一页页首 |

## 四、实现方案

### 4.1 DOM 结构

```
.app-shell
└─ <aside .sidebar data-collapsed?>     ← 宽度 200 / 88 切换，全部状态留在组件内
     ├─ .sidebar-header
     │    ├─ 折叠按钮（IconButton, icon=keyboard_double_arrow_left / right）
     │    ├─ 终端按钮（IconButton, icon=terminal, active 态复用现有高亮）
     │    └─ 圆点切换器（role=tablist，收起时隐藏）
     └─ .sidebar-body
          └─ .sidebar-page[data-active] × N   （全部挂载，非当前页 display:none）
               └─ 现有条目（复用 .sidebar-item / data-sidebar-target 等既有类名）
```

头部**不需要上提到 App**：收起态宽度是 88px 而非 0，按钮留在 `<aside>` 内即可，
`overflow: hidden` 不会裁掉它们。

**全部页挂载、非当前页 `display:none`** 是关键决策：

- 现有 e2e 大量用 `el.click()` 直接点击，`display:none` 不影响程序化 click；
- 拖放的 `elementFromPoint` 与 `querySelectorAll` 命中面保持不变；
- 代价：不可聚焦（键盘需自行翻页）、不可测量高度（见 4.2）。

### 4.2 分页计算

两个逻辑组独立分页，互不混页：

```ts
type SidebarGroup = 'fixed' | 'pinned';
// 页 = fixed 组的 ceil(H_fixed / avail) 页 + pinned 组的 ceil(H_pinned / avail) 页
```

高度来源两个方案：

1. **定高常量 + 断言（推荐先行）**：条目 56、间距 4、设备组头 32。常量集中在
   `Sidebar.css` 与 TS 常量模块，启动时用首个渲染条目的 `offsetHeight` 校验，
   不一致时 `console.warn` 并回退到实测值。当前 CSS 全部定高，误差为零。
2. **隐藏测量容器（备选）**：`visibility:hidden; position:absolute` 的克隆容器
   渲染同一批条目，读真实高度。准确但 DOM 翻倍（条目数 < 40，代价可接受）。

重算触发点：`ResizeObserver`（rAF 节流）监听 `.sidebar-body`；`pinnedDirs` /
`devices` / `gvfsVolumes` / 显示开关（dashboard/objects/trash）变化；窗口缩放。

约束：
- 页尾必须整条容纳，不出现半条截断（累计高度 + 条目高 > 可用高 → 换页）；
- 页数减少时 `currentPage` 夹到最后一页；
- 组为空时跳过该组（第一页直接是另一组）。

### 4.3 折叠（图标轨道）

```css
.sidebar { width: 200px; transition: width 180ms cubic-bezier(.2,0,0,1); }
.sidebar[data-collapsed] { width: 88px; }
.sidebar[data-collapsed] .sidebar-label,
.sidebar[data-collapsed] .sidebar-title,
.sidebar[data-collapsed] .sidebar-feature { display: none; }
.sidebar[data-collapsed] .sidebar-item {
  padding: 0; justify-content: center; height: 56px; border-radius: 16px;
}
.sidebar[data-collapsed] .sidebar-page:not([data-active]) { display: none; }
@media (prefers-reduced-motion: reduce) { .sidebar { transition: none; } }
```

实现要点：

- 图标条目必须补 `title` / `aria-label`（收起后看不到文字，且 e2e 与无障碍都依赖）；
  文件位置条目当前没有 `title`，需补。
- 收起时强制 `currentPage = 0`（恒定第一部分第 1 页），展开时恢复上次页码。
- 折叠状态放 **Sidebar 内部**（`useLocalStorage` + 本地 state），不经过 App：
  `ExplorerTab` 是没有 `memo` 的巨型组件，App 任何 setState 都会重渲染所有标签页。
- 宽度过渡每帧触发布局（`.main-content` 里三个巨型组件），可能掉帧；
  实施时先做动画原型实测，掉帧则退到 `grid-template-columns` 过渡或瞬时切换 +
  150ms 淡出。**这是"标签页切换仍要顺滑"的主要隐患点。**
- 收起态背景仍用 `--hoshineko-places-bg`（与标签条同色），无需 App/index.css 改动。

### 4.4 翻页手势

- **滚轮/触控板**：`.sidebar-body` 上非 passive `wheel` 监听；`|deltaX| > |deltaY|`
  时用 deltaX（横向滑动），否则用 deltaY（垂直滚轮）。累积到阈值（≈48px）
  翻一页，翻页后 300ms 冷却；惯性尾流用衰减判定（连续同向且递减的 delta 不重复触发）。
- **触摸**：Pointer Events 记录按下点，横向位移 > 48px 且主导轴为 X 时翻页。
- **圆点**：`button` + `aria-current`，点击直接跳页。
- **键盘**：焦点在圆点上时 ←/→ 翻页；焦点在条目上时 ↑/↓ 越界**自动翻页**
  并聚焦邻页首/末条（2026-10-27 定案，替换现有 wrap-around 行为）。
- 翻页动画：`transform: translateX()` 位移过渡 200ms；**拖拽期间禁用动画**
  （`elementFromPoint` 在动画中途会命中错误元素）。

注意：去掉 `overflow-y: auto` 后，wheel 不再被浏览器消费，必须保证 `wheel`
处理器在 `#root` 之外的侧边栏区域生效且不向文件区冒泡。

### 4.5 拖放（最高风险）

现状 `tickAutoScroll` 用 `scrollTop` 驱动，分页后必须替换为**边缘自动翻页**：

- `dragover` 进入上/下 96px 边缘区并持续 ≈450ms → 翻到上/下一页（带冷却）；
- 固定项排序拖拽跨页：`pinRenderList` 按页切片，`pinDrag.from/gap` 保持全局索引；
  悬停条目 → 用**全局索引**计算 gap，再映射回页内渲染位置；
- `elementFromPoint` 路由只命中当前页目标，跨页落点依赖自动翻页暴露目标——
  与现状体验一致（原来也是滚到目标再落）；
- 对象投影拖到「添加固定」按钮：可能需要先自动翻页到按钮所在页；
- 拖拽期间禁用移动端翻页手势与圆点点击（避免落点漂移）。

### 4.6 键盘与焦点

- `registerKeyboardZone.focus()` 与 ↑/↓ 查询范围改为 `.sidebar-page[data-active] .sidebar-item`；
- 焦点移动到页边界时自动翻页（`display:none` 元素不可聚焦，不翻页会"卡住"）；
- Ctrl+1..9 固定项跳转不受分页影响（按 `pinnedDirs` 索引，必要时先翻到对应页）。

### 4.7 设置与 i18n

- `showTerminalPlace` 设置语义不变，只是入口从列表项变成顶栏按钮；
  设置项描述文案需要微调（「显示内建终端」→ 语义仍成立，但位置变了）。
- 新增 i18n（12 语言）：`sidebar.collapse` / `sidebar.expand` / `sidebar.page_switcher`
  （圆点组无障碍标签）。
- 新增图标：折叠用的 `keyboard_double_arrow_left/right` 若不在子集内，需
  `npm run icons:subset`（新增图标必须重跑，见 AGENTS.md）。

### 4.8 重渲染隔离（"标签页切换仍要顺滑"的硬约束）

`ExplorerTab`（~3400 行）、`ObjectPanel`（~3170 行）都没有 `React.memo`，
它们的 props 含大量内联箭头函数，memo 也难命中。因此：

- **折叠状态、当前页码、测量结果全部留在 `Sidebar` 内部**，不提升到 App，
  不给 `Sidebar` 加会穿透到 App 的回调；
- 分页切换只改 `display`，不重挂条目组件树，也不触发 App 侧 state；
- 测量用 `ResizeObserver` + rAF 节流，避免每帧 setState；
- 验收标准：折叠动画期间连续切换标签页不卡顿，且标签切换的端到端耗时
  与重构前持平（可用 e2e 里现有的点击→渲染断言做回归对比）。

## 五、影响面清单

| 区域 | 影响 | 处理 |
| --- | --- | --- |
| `Sidebar.tsx` | 渲染树、滚动/自动滚动、键盘分区、拖放排序 | 大改，建议拆出 `SidebarHeader` + `SidebarPages` 两个组件 |
| `Sidebar.css` | 滚动条、标题对齐、区块外边距 | 重写头部与分页容器样式 |
| `App.tsx:2778-2819` | 无改动（折叠状态留在 Sidebar 内部） | 只需确认不新增 App state |
| `index.css` / `TabBar.css` | 无改动（轨道占据左侧，文件区自然左移） | — |
| `focusZones.ts` | 无变化（仍是 `sidebar` 分区） | 仅改查询范围 |
| e2e harness | `clickPlace` / `openSettingsPage` 强依赖 `.sidebar-section:first-of-type` | **必须同步**；建议改成按 `md-icon` ligature 全局查找 |
| e2e 用例 | 约 20+ 套涉及侧边栏（103/86/82/65/94/84/104/46/47/66…） | 全部挂载 + display:none 可保住大部分；跨页条目需新增 `ensureSidebarPage` 辅助 |
| 设置页 | 终端入口描述 | 文案微调 |
| 文档 | AGENTS.md、latest-updates、本报告 | 落地后同步 |

## 六、实施步骤（建议）

1. **结构与折叠**：`SidebarHeader`（两按钮 + 圆点占位）、图标轨道收起态与
   状态持久化、容器尺寸无关的标题对齐。验收：折叠/恢复无跳变、收起态只显示
   图标且恒为第一部分、e2e 全绿。
2. **分页核心**：两组独立分页、尺寸测量、圆点、页数重算、`currentPage` 夹取。
   验收：新增 e2e（页数、截断、两部分不混页、圆点跳转）。
3. **手势翻页**：wheel/触控板/触摸 + 冷却；键盘翻页与焦点跨界。验收：e2e 注入
   wheel 事件翻页；手动触控板验证。
4. **拖放迁移**：删 `tickAutoScroll` → 边缘自动翻页；排序拖拽全局索引改造；
   对象投影落点。验收：现有拖放用例 + 新增跨页拖放用例。

前两步可独立交付（此时功能可用），后两步是体验完整性；建议四步都做完再发版。

## 七、风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 宽度动画掉帧 | 折叠卡顿、标签切换不顺滑 | 原型实测；退路见 4.3 |
| 尺寸测量与实际不符 | 条目被截断/空白过多 | 定高常量 + 首项实测断言；e2e 校验页尾整条 |
| 滚轮连翻多页 | 难以停住 | 阈值 + 300ms 冷却 + 惯性衰减判定 |
| 拖拽跨页无法完成 | 核心操作退化 | 边缘自动翻页（必须做，非可选） |
| 排序拖拽全局/页内索引混淆 | 固定项顺序错乱 | gap 全程用全局索引，页内渲染时投影 |
| harness 断链 | 大面积 e2e 失败 | 第一步就同步 `clickPlace`/`openSettingsPage` |
| 折叠 state 误提升到 App | 所有标签页重渲染，切换变卡 | 状态锁在 Sidebar 内（4.8） |
| 收起态图标缺少可读名称 | 无障碍/e2e 退化 | 图标条目补 `title` + `aria-label` |

## 八、待确认

已定案：收起 = 图标轨道（88px，恒显第一部分）；第一部分顺序为
仪表盘 → 文件位置 → 设置 → 对象 → 回收站；键盘越界自动翻页；
终端按钮受设置「显示内建终端」控制；标签页切换性能为验收项。

仅剩一项：

1. 收起态第一部分放不下时：**沿用翻页（圆点隐藏，滚轮/键盘仍可翻）**
   还是把图标胶囊压到 48px 保证一页装下？（推荐前者，与展开态逻辑一致）

## 九、实施记录（2026-10-27）

与原设计的偏差（用户评审后定案）：

1. **收起 = 图标轨道**（88px），不是完全收起；恒定显示第一部分第 1 页，
   已固定与设备在收起态不可达。两个按钮留在轨道顶部。
2. **第一部分顺序**：仪表盘 → 文件位置 → 设置 → 对象 → 回收站；终端入口
   移到头部按钮，受 `showTerminalPlace` 控制。
3. **键盘**：↑/↓ 越界自动翻页；进入 Places 分区先落头部按钮，Tab 在
   折叠 → 终端 → 条目之间推进后再放行到 tabbar。
4. **手势**：鼠标滚轮（deltaY）与触控板（deltaX）分开处理；触摸拖动跟手
   并带动画。
5. **收起态条目高度 44px**（原 56px），分页常量随 `collapsed` 切换。

实测结论：宽度过渡未出现可见掉帧（ExplorerTab 未重渲染——折叠/分页状态
全部留在 Sidebar 内部）；行高常量与 CSS 一致。
