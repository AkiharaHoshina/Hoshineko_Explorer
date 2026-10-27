/**
 * e2e 111：Places 分页与收起（图标轨道）。
 *
 * 覆盖：
 * - 第一部分（固定快捷方式）与第二部分（固定目录 + 设备）各自分页，
 *   不混页；页数 = 两组页数之和；
 * - 圆点数量 = 页数，点击圆点跳页；
 * - 滚轮在侧边栏主体上翻页（累计阈值 + 冷却）；
 * - 收起：宽度收到 88px、只显示图标、圆点隐藏、恒定第 0 页；
 *   再点恢复展开；
 * - 分页后没有滚动容器（overflow hidden）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('111 Places 分页/滚轮/圆点/收起', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'A/a.txt': 'a' });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 预置 25 个固定项：足够把第二部分撑成多页（窗口高度内每页
    // 只放得下十来条）
    const pins = Array.from({ length: 25 }, (_, i) => ({
      name: `P${i}`,
      path: `${dir}/P${i}`,
      isDir: true,
    }));
    await h.js(
      win,
      `localStorage.setItem('sidebar.pinned', JSON.stringify(${JSON.stringify(pins)})); true`,
    );
    win.webContents.reload();
    await h.waitFor(win, `document.querySelectorAll('.sidebar-pin-label').length === 25`, {
      timeout: 8000,
    });
    await h.sleep(600);

    // ── Tab 循环经过头部按钮（折叠 + 内建终端） ──
    await h.clickEl(win, '.file-list-item');
    // 第一次 Tab 可能先把焦点落到当前分区（files），再 Tab 才进侧边栏
    for (let i = 0; i < 3; i++) {
      const inSidebar = await h.js(win, `!!document.activeElement?.closest('.sidebar')`);
      if (inSidebar.value) break;
      await h.key(win, 'Tab');
      await h.sleep(200);
    }
    const tab1 = await h.js(win, `document.activeElement?.classList.contains('sidebar-collapse-btn')`);
    h.assert.ok(tab1.value, 'Tab 进入侧边栏应先落在折叠按钮');
    await h.key(win, 'Tab');
    await h.sleep(200);
    const tab2 = await h.js(win, `document.activeElement?.classList.contains('sidebar-terminal-btn')`);
    h.assert.ok(tab2.value, '再 Tab 应落在内建终端按钮');
    await h.key(win, 'Tab');
    await h.sleep(200);
    const tab3 = await h.js(win, `document.activeElement?.matches('.sidebar-page[data-active] .sidebar-item')`);
    h.assert.ok(tab3.value, '再 Tab 应落到 Places 条目');
    await h.key(win, 'Tab', ['shift']);
    await h.sleep(200);
    const tab4 = await h.js(win, `document.activeElement?.classList.contains('sidebar-terminal-btn')`);
    h.assert.ok(tab4.value, 'Shift+Tab 应退回内建终端按钮');

    // ── 分页结构 ──
    const layout = await h.js(win, `(() => {
      const pages = [...document.querySelectorAll('.sidebar-page')];
      return {
        pageCount: pages.length,
        dotCount: document.querySelectorAll('.sidebar-dot').length,
        activeIndex: pages.findIndex((p) => p.hasAttribute('data-active')),
        mixed: (() => {
          // 第一部分页：含 dashboard/settings/widgets 图标（固定快捷方式）；
          // 第二部分页不得出现这些图标，第一部分页不得出现固定项。
          const isFixedPage = (p) => {
            const icons = [...p.querySelectorAll('.sidebar-item md-icon')].map((i) => i.textContent);
            return icons.includes('dashboard') || icons.includes('settings') || icons.includes('widgets');
          };
          const fixedIdx = pages.map((p, i) => (isFixedPage(p) ? i : -1)).filter((i) => i >= 0);
          if (fixedIdx.length === 0) return -1;
          const lastFixed = Math.max(...fixedIdx);
          const fixedPageWithPin = pages.filter((p, i) => i <= lastFixed && p.querySelector('.sidebar-pin-label')).length;
          const pinPageWithFixed = pages.filter((p, i) => i > lastFixed && isFixedPage(p)).length;
          return fixedPageWithPin + pinPageWithFixed;
        })(),
        overflow: getComputedStyle(document.querySelector('.sidebar')).overflowY,
      };
    })()`);
    h.assert.ok(layout.value.pageCount >= 3, `25 个固定项应分成多页（实际 ${layout.value.pageCount}）`);
    h.assert.strictEqual(layout.value.dotCount, layout.value.pageCount, '圆点数量应等于页数');
    h.assert.strictEqual(layout.value.activeIndex, 0, '初始应停在第 1 页');
    h.assert.strictEqual(layout.value.mixed, 0, '第一部分与第二部分不得共享同一页');
    h.assert.strictEqual(layout.value.overflow, 'hidden', '分页后侧边栏不应再有滚动容器');

    // 折叠/展开按钮的图标与 Places 条目图标水平对齐（用户定案）
    const align = await h.js(win, `(() => {
      const btnIcon = document.querySelector('.sidebar-collapse-btn md-icon');
      const itemIcon = document.querySelector('.sidebar-page[data-active] .sidebar-item md-icon');
      if (!btnIcon || !itemIcon) return null;
      const a = btnIcon.getBoundingClientRect();
      const b = itemIcon.getBoundingClientRect();
      return { btn: a.x + a.width / 2, item: b.x + b.width / 2 };
    })()`);
    h.assert.ok(align.value, '应能取到折叠按钮与条目图标');
    h.assert.ok(
      Math.abs(align.value.btn - align.value.item) <= 2,
      `折叠按钮图标应与条目图标同列（差 ${Math.round(align.value.btn - align.value.item)}px）`,
    );

    const firstPageHasPin = await h.js(
      win,
      `!!document.querySelector('.sidebar-page[data-active] .sidebar-pin-label')`,
    );
    h.assert.strictEqual(firstPageHasPin.value, false, '第 1 页只能有第一部分内容');

    // ── 点击圆点跳页 ──
    await h.js(win, `document.querySelectorAll('.sidebar-dot')[1].click(); true`);
    await h.waitFor(
      win,
      `[...document.querySelectorAll('.sidebar-page')].findIndex((p) => p.hasAttribute('data-active')) === 1`,
      { timeout: 4000 },
    );

    // ── 滚轮翻页 ──
    const before = await h.js(
      win,
      `[...document.querySelectorAll('.sidebar-page')].findIndex((p) => p.hasAttribute('data-active'))`,
    );
    await h.js(
      win,
      `document.querySelector('.sidebar-body').dispatchEvent(
        new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
      ); true`,
    );
    await h.waitFor(
      win,
      `[...document.querySelectorAll('.sidebar-page')].findIndex((p) => p.hasAttribute('data-active')) > ${before.value}`,
      { timeout: 4000 },
    );

    // ── 触控板横向滑动翻页（deltaX，鼠标滚轮只认 deltaY） ──
    // 回到第一页再测横向滑动（正 deltaX = 下一页，与鼠标滚轮正 deltaY 同向）
    await h.js(win, `document.querySelectorAll('.sidebar-dot')[0].click(); true`);
    await h.sleep(400); // 等点页与上一页翻页冷却结束
    const beforeH = await h.js(
      win,
      `[...document.querySelectorAll('.sidebar-page')].findIndex((p) => p.hasAttribute('data-active'))`,
    );
    await h.js(
      win,
      `document.querySelector('.sidebar-body').dispatchEvent(
        new WheelEvent('wheel', { deltaX: 60, deltaY: 0, bubbles: true, cancelable: true })
      ); true`,
    );
    await h.waitFor(
      win,
      `[...document.querySelectorAll('.sidebar-page')].findIndex((p) => p.hasAttribute('data-active')) > ${beforeH.value}`,
      { timeout: 4000 },
    );
    // 触控板垂直滚动不应翻页（横向才是翻页手势）
    const beforeV = await h.js(
      win,
      `[...document.querySelectorAll('.sidebar-page')].findIndex((p) => p.hasAttribute('data-active'))`,
    );
    await h.js(
      win,
      `document.querySelector('.sidebar-body').dispatchEvent(
        new WheelEvent('wheel', { deltaX: 2, deltaY: 40, bubbles: true, cancelable: true })
      ); true`,
    );
    await h.sleep(400);
    const afterV = await h.js(
      win,
      `[...document.querySelectorAll('.sidebar-page')].findIndex((p) => p.hasAttribute('data-active'))`,
    );
    h.assert.strictEqual(afterV.value, beforeV.value, '触控板垂直滚动不应翻页');

    // ── 收起：图标轨道 ──
    await h.js(win, `document.querySelector('.sidebar-collapse-btn').click(); true`);
    await h.waitFor(win, `!!document.querySelector('.sidebar--collapsed')`, { timeout: 4000 });
    await h.sleep(300); // 等 180ms 宽度过渡结束
    const collapsed = await h.js(win, `(() => {
      const sb = document.querySelector('.sidebar');
      const pages = [...document.querySelectorAll('.sidebar-page')];
      return {
        width: Math.round(sb.getBoundingClientRect().width),
        labelDisplay: getComputedStyle(document.querySelector('.sidebar-page[data-active] .sidebar-label')).display,
        dotCount: document.querySelectorAll('.sidebar-dot').length,
        activeIndex: pages.findIndex((p) => p.hasAttribute('data-active')),
        iconVisible: !!document.querySelector('.sidebar-page[data-active] md-icon'),
      };
    })()`);
    h.assert.strictEqual(collapsed.value.width, 88, `收起后宽度应为 88px（实际 ${collapsed.value.width}）`);
    h.assert.strictEqual(collapsed.value.labelDisplay, 'none', '收起后应只显示图标');
    h.assert.strictEqual(collapsed.value.dotCount, 0, '收起后圆点应隐藏');
    h.assert.strictEqual(collapsed.value.activeIndex, 0, '收起后恒定显示第一页（第一部分）');
    h.assert.ok(collapsed.value.iconVisible, '收起后应仍显示图标');

    const collapsedAlign = await h.js(win, `(() => {
      const btnIcon = document.querySelector('.sidebar-collapse-btn md-icon');
      const itemIcon = document.querySelector('.sidebar-page[data-active] .sidebar-item md-icon');
      if (!btnIcon || !itemIcon) return null;
      const a = btnIcon.getBoundingClientRect();
      const b = itemIcon.getBoundingClientRect();
      return { btn: a.x + a.width / 2, item: b.x + b.width / 2 };
    })()`);
    // 收起态：折叠按钮与标签胶囊同高（顶部 12px 对齐）
    const vAlign = await h.js(win, `(() => {
      const btn = document.querySelector('.sidebar-collapse-btn').getBoundingClientRect();
      const tab = document.querySelector('.tab-item')?.getBoundingClientRect();
      if (!tab) return null;
      return { btnTop: Math.round(btn.top), tabTop: Math.round(tab.top) };
    })()`);
    h.assert.ok(vAlign.value, '应能取到折叠按钮与标签');
    h.assert.ok(
      Math.abs(vAlign.value.btnTop - vAlign.value.tabTop) <= 2,
      `收起态折叠按钮应与标签页顶部对齐（按钮 ${vAlign.value.btnTop} / 标签 ${vAlign.value.tabTop}）`,
    );

    h.assert.ok(collapsedAlign.value, '收起态应能取到按钮与条目图标');
    h.assert.ok(
      Math.abs(collapsedAlign.value.btn - collapsedAlign.value.item) <= 2,
      `收起态按钮图标应与图标列居中（差 ${Math.round(collapsedAlign.value.btn - collapsedAlign.value.item)}px）`,
    );

    const collapsedHasPin = await h.js(
      win,
      `!!document.querySelector('.sidebar-page[data-active] .sidebar-pin-label')`,
    );
    h.assert.strictEqual(collapsedHasPin.value, false, '收起后不显示固定目录（恒定第一部分）');

    // ── 恢复展开 ──
    await h.js(win, `document.querySelector('.sidebar-collapse-btn').click(); true`);
    await h.waitFor(win, `!document.querySelector('.sidebar--collapsed')`, { timeout: 4000 });
    await h.sleep(300);
    const expanded = await h.js(win, `(() => ({
      width: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
      dotCount: document.querySelectorAll('.sidebar-dot').length,
    }))()`);
    // box-sizing: content-box：200 内容宽 + 左右各 16 padding = 232 实际宽
    h.assert.strictEqual(expanded.value.width, 232, '恢复后应回到展开态宽度（232px）');
    h.assert.strictEqual(expanded.value.dotCount, layout.value.pageCount, '恢复后圆点应重新显示');

    // 清理：清掉固定项，避免污染后续用例
    await h.js(win, `localStorage.removeItem('sidebar.pinned'); true`);
  });

  h.finish();
})();
