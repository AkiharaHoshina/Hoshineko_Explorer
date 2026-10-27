# Chrome 风格标签页可行性报告

> 状态：**已实施**（2026-10-27，v3.0.1003）。
> 目标：对齐 Chrome 的标签页视觉——选中页与文件区同色、标签条弱化、
> 去掉标签页/文件区分割线，并为第一个选中标签去掉左侧圆角过渡。

## 一、结论

**可行，主要是纯 CSS 改动，风险中低。**

- 不需要改标签页状态模型、拖放逻辑或标签标题解析。
- 现有 DOM（`.tab-bar` / `.tab-item` / `.tab-item.active` / `.tab-title` /
  `.tab-close-btn` / `.new-tab-btn`）可以原样保留，e2e 选择器不受影响。
- 唯一需要小心的不是逻辑，而是**视觉细节**：选中页底部与标签条的衔接、
  第一个标签的左侧规则、`overflow-x: auto` 对伪元素的裁切。

## 二、现状

| 元素 | 当前样式 |
| --- | --- |
| `.main-content`（含文件区） | `background: var(--md-sys-color-surface-container-low)` |
| `.tab-header-bar`（标签条外框） | 与文件区同色 `surface-container-low` + `border-bottom: 1px solid outline-variant` |
| `.tab-bar` | 透明、`padding: 12px 8px 0 0`、`height: 44px`、`overflow-x: auto` |
| `.tab-item` | `background: surface-container`、`border-radius: 12px 12px 0 0`、`flex: 1` |
| `.tab-item.active` | `background: surface-container-highest`、`on-surface` 文字 |
| `.tab-item:hover` | `surface-container-high` |

问题：

1. 标签条与文件区同色，选中页只能靠 `surface-container-highest` 区分，和
   Chrome「选中页 = 内容区、标签条 = 弱化色」相反。
2. 标签条底部分割线把标签页和文件区切断。
3. 未选中标签仍有完整胶囊底色，视觉权重过高。

## 三、目标视觉模型

定义两个语义变量（建议放在 `src/index.css` 的 `:root`）：

```css
:root {
  /* 文件区/选中标签页的“内容色”——必须与文件区完全一致 */
  --hoshineko-content-bg: var(--md-sys-color-surface-container-low);
  /* 标签条背景——比内容色弱一级 */
  --hoshineko-tabstrip-bg: var(--md-sys-color-surface-container);
}
```

所有标签页样式只引用这两个变量，不直接写 `surface-container-*`，这样：

- 12 套预设色盘、自定义 HCT、壁纸取色、matugen、DMS 继承都会自动跟随；
- 明暗切换时内容色与标签条色仍保持同一套 token 关系；
- 今后调整文件区背景，只需改一个变量。

### 3.1 标签条

```css
.tab-header-bar {
  background: var(--hoshineko-tabstrip-bg);
  border-bottom: 0; /* 删除分割线 */
}
```

`.tab-bar` 保持透明，透出标签条弱化色。

### 3.2 选中标签

```css
.tab-item {
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  border-radius: 10px 10px 0 0;
  transition: background-color .15s, color .15s, opacity .15s;
}

.tab-item:hover {
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 6%, transparent);
}

.tab-item.active {
  background: var(--hoshineko-content-bg);
  color: var(--md-sys-color-on-surface);
  position: relative;
  z-index: 1;
}
```

- 选中页底色 = 文件区底色，中间无分割线时视觉上直接连成一片。
- 未选中页去掉胶囊底色，只保留文字；悬停时加一层极浅的状态层。
- 可再加 `opacity: .78` 弱化未选中文字（是否使用由视觉验收决定）。

### 3.3 底部圆角过渡（Chrome 的关键）

Chrome 的选中页不是简单矩形：顶部圆角，底部两侧有**向外展开的
凹形过渡**。有两种实现路线：

**方案 A（稳）：只做顶部圆角，底部直接与文件区相接**

- 实现成本最低，零伪元素、零裁切风险；
- 视觉上接近「选中的圆角标签 + 无分割线」，但没有 Chrome 底部那对凹角；
- 适合先落地第一版。

**方案 B（推荐）：伪元素做底部凹角**

在选中页左右下角各放一个标签条色的方形，用圆角/遮罩切出凹形：

```css
.tab-item.active::before,
.tab-item.active::after {
  content: "";
  position: absolute;
  bottom: 0;
  width: 10px;
  height: 10px;
  background: var(--hoshineko-tabstrip-bg);
  pointer-events: none;
}

/* 左下：方形位于标签左侧，右下角切成圆弧 */
.tab-item.active::before {
  left: -10px;
  border-bottom-right-radius: 10px;
}

/* 右下：方形位于标签右侧，左下角切成圆弧 */
.tab-item.active::after {
  right: -10px;
  border-bottom-left-radius: 10px;
}
```

伪元素是**标签条色**，相当于从标签条的弱化色里「挖」出两个圆弧，
与选中页的内容色形成 Chrome 式过渡。需要：

- `.tab-item.active` 设 `overflow: visible`（默认）；
- 标签条不能裁切伪元素（见风险 §六）；
- 相邻未选中标签的层级低于选中页，避免伪元素压住文字。

### 3.4 第一个标签的左侧规则

用户明确：**选中的标签如果是第一个，左侧无圆角过渡**。

```css
.tab-item:first-child.active {
  border-top-left-radius: 0;
}

.tab-item:first-child.active::before {
  display: none; /* 左侧凹角也不画 */
}
```

当前 `.tab-bar` 左侧 `padding: 0`，首个标签本来就贴住内容区左缘，
只需去掉左侧补角，左上圆角保留，右侧仍保持正常过渡。

注意：这里指** DOM 第一个标签**，不是水平滚动后的第一个可见标签。
如果以后希望“滚动后第一个可见标签也无左侧过渡”，需要 JS 计算可见性，
不建议首版引入。

### 3.5 未选中标签的进一步弱化（可选）

Chrome 在未选中标签之间有一条极细的分隔线。可以选中实施：

```css
/* 只在两个相邻未选中标签之间画细线 */
.tab-item:not(.active) + .tab-item:not(.active)::before {
  content: "";
  position: absolute;
  left: -2px; /* 抵消 gap: 4px 的一半 */
  top: 25%;
  height: 50%;
  width: 1px;
  background: var(--md-sys-color-outline-variant);
  opacity: .5;
}
```

如果觉得与「进一步弱化」冲突，可以不做分隔线，只靠透明背景和文字色区分。

## 四、与主题/明暗的兼容性

- 选中页和文件区共用 `--hoshineko-content-bg`，保证**完全同色**，而不是
  两个碰巧相同的 token。
- 标签条用 `surface-container`：亮色下比 `low` 深一级，暗色下比 `low`
  浅一级，都是「弱化」关系；具体对比度需要在 12 套预设 + 明暗下截图验收。
- `color-mix` 悬停层使用 `on-surface` 的 6% 透明，亮暗都自然。
- 所有颜色都来自 CSS 变量，不引入 JS 主题判断。

## 五、e2e / 现有功能影响

DOM 和类名保持不变，以下逻辑不受影响：

- 标签点击、关闭、Ctrl+T/W/Tab；
- 标签页拖放（`resolveTabAt` 用 `.tab-item` 的 rect，形状不影响命中）；
- 键盘分区 `tabbar`、roving tabindex；
- 标签标题解析（搜索/对象/设置虚拟路径）；
- `drag-over` 高亮类仍存在，只是视觉上跟着新圆角走。
- 未发现 e2e 对标签页背景色/边框做 computed style 断言；主要是
  `.tab-item` / `.active` / `.tab-title` / `.tab-close-btn` 的存在与文本断言。
- **分割线删除会让内容区上移 1px**：当前 `.tab-header-bar` 的
  `border-bottom` 占 1px。建议在 header 上加 `padding-bottom: 1px` 或
  接受 1px 位移，然后跑 15 / 57 / 74 / 84 / 103 / 105 等几何相关用例。
- 选中页伪元素可能被 `.tab-bar` 的 `overflow-x: auto` 裁切（见风险）；
  若出现裁切，把水平滚动容器改成内层 `.tab-scroll`，外层保持
  `overflow: visible`，DOM/类名不变。

## 六、风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| `overflow-x: auto` 裁切底部伪元素 | 选中页底部凹角消失 | 外层 `.tab-bar` 保持 visible，内层滚动；或首版用方案 A |
| 伪元素压住相邻未选中标签文字 | 文字被标签条色遮住 | 选中页 `z-index: 1`；伪元素只占底部 10px；必要时给相邻标签加内边距 |
| 删除 1px 分割线导致布局位移 | 几何 e2e 差 1px | header `padding-bottom: 1px` 补偿，或更新用例 |
| 多主题对比度不稳定 | 某些色盘下选中/未选中区分弱 | 明暗 × 预设截图验收；必要时给未选中文字加 opacity/状态层 |
| 首个标签规则与滚动 | 滚动后“首个可见”不适用 | 首版只按 DOM 第一个；后续再评估 JS |
| 标签很多时 `flex: 1` 拉伸 | Chrome 标签通常固定宽、可滚动 | 本次不改宽度策略；如需要另立设计 |

## 七、实施步骤（建议）

1. `src/index.css`：新增 `--hoshineko-content-bg`、`--hoshineko-tabstrip-bg`；
   `.tab-header-bar` 改弱化背景、删除 `border-bottom`。
2. `src/components/TabBar.css`：
   - 未选中：透明背景、弱化文字、悬停状态层；
   - 选中：内容色背景、顶部圆角、底部凹角伪元素（方案 B）；
   - `:first-child.active` 去掉左侧圆角与左伪元素；
   - 可选：未选中标签之间的细分隔线。
3. 截图验收：亮色/暗色各一张，至少 3 套预设色盘，检查选中页与文件区
   是否严格同色、首个标签左侧是否平直、标签多时是否出现裁切。
4. e2e：先跑 15 / 57 / 74 / 84 / 103 / 105，再跑全量；重点看标签点击、
   拖放、几何断言。
5. 文档：更新 `AGENTS.md`（标签页视觉约定与“首个标签”规则）、
   `docs/latest-updates.md`。

工作量预估：CSS 改造 0.5 天，视觉微调 + e2e 回归 0.5–1 天。

## 八、已定案（2026-10-27）

1. **底部做 Chrome 凹角**：选中标签本体用内容色，底部左右各放一个
   内容色补角伪元素，用 `mask: radial-gradient(circle at
   0 0 / 100% 0, transparent, #000)` 只保留靠标签底角的圆弧片。
   **圆心必须在外上角、内容色在圆外**——这样圆弧与标签侧边、底边都
   相切，才是参考图的平滑内凹；若圆心在内下角（内容色在圆内），
   曲线会在标签侧边留下折角。首个选中标签不生成左补角。
2. **未选中标签之间要细竖线分隔**：1px `outline-variant`，位于 gap 中，
   相邻标签悬停时淡出。
3. **未选中标签不保留胶囊轮廓**：静止态背景透明，只留弱化文字；
   悬停时才出现 `on-surface` 6% 的极淡状态层。选中页用不透明内容色，
   过渡 `background-color/color/opacity` 0.18s。
4. **标签宽度规则不变**：仍为 `min-width:120 / max-width:240 / flex:1`。
5. **上下圆角统一**：顶部圆角与底部凹角共用 `--tab-radius: 12px`，
   不再分别使用 10px/14px。

### 实施落点

- `src/index.css`：`--hoshineko-places-bg` 改用 `surface-container-high`
  （与文件区拉开色差），`--hoshineko-tabstrip-bg` 直接引用 Places 变量；
  `.main-content` 与选中页共用内容色变量；`.tab-header-bar` 删除
  `border-bottom`。
- `src/components/TabBar.css`：未选中标签静止态透明、无轮廓，仅悬停
  淡状态层；相邻未选中标签保留分隔线；选中页本体内容色 + 左右 12px
  补角伪元素（mask 只保留底角圆弧片），顶部圆角同为 12px；
  `:first-child.active` 只去左补角（左上圆角保留）；横向滚动条隐藏
  （避免切断凹角视觉），但标签栏支持滚轮横向滚动（`TabBar.tsx` wheel
  监听，e2e 110）；新建标签时自动滚到末尾使新标签可见。补角会叠到
  相邻标签底部（Chrome 同样如此），
  靠 `z-index:1` 保证选中页在上层。
- 验证：深色/亮色截图通过；`57-newtab-trash-path` 等标签相关 e2e 通过；
  受本机 1280×800 显示限制的坐标类用例如前所述仍可能受环境影响。

原待拍板问题已全部关闭；后续如需调整，只改上述两个 CSS 文件与两个变量。
