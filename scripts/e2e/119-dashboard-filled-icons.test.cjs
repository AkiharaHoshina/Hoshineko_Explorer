/**
 * e2e 119：仪表盘固定项 / 最近访问图标跟随「实心图标」设置。
 *
 * 缺陷：Dashboard 组件未接收 filledIcons，固定项与最近访问始终渲染描边
 * 图标；开启「设置 → 文件 → 外观 → 实心图标」后它们仍是空心。
 * 修复：Dashboard 新增 filledIcons prop（ExplorerTab 透传），固定项、
 * 最近访问与存储子区域条目的 <md-icon> 都带 filled 属性（v3.0.1039 起
 * 存储区也跟随，此前被排除）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('119 仪表盘图标跟随实心图标设置', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x', 'sub/.keep': '' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    const pinned = [
      { name: 'Home', path: '/home/hoshina', isDir: true },
      { name: 'sub', path: `${dir}/sub`, isDir: true },
      { name: 'a.txt', path: `${dir}/a.txt`, isDir: false },
    ];
    const recent = [
      { name: 'a.txt', path: `${dir}/a.txt`, isDirectory: false, size: 1, mtime: new Date().toISOString() },
      { name: 'sub', path: `${dir}/sub`, isDirectory: true, size: 0, mtime: new Date().toISOString() },
    ];
    const seed = async (filled) => {
      await h.js(win, `
        localStorage.setItem('settings.filledIcons', ${JSON.stringify(JSON.stringify(filled))});
        localStorage.setItem('dashboard.pinned', ${JSON.stringify(JSON.stringify(pinned))});
        localStorage.setItem('dashboard.recent', ${JSON.stringify(JSON.stringify(recent))});
        location.reload(); true`);
      await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 15000 });
    };

    /** 仪表盘各区域图标的 filled 属性统计 */
    const iconState = async () => (await h.js(win, `(() => {
      const filledOf = (el) => el.hasAttribute('filled');
      // 「添加」瓦片也用 .pinned-icon，但不是固定项图标（永不实心）
      const pinnedIcons = [...document.querySelectorAll('.pinned-icon md-icon')]
        .filter((el) => (el.textContent ?? '').trim() !== 'add');
      const recentIcons = [...document.querySelectorAll('.recent-item md-icon')];
      const storageIcons = [...document.querySelectorAll('.storage-sub-icon')];
      return {
        pinned: pinnedIcons.length,
        pinnedFilled: pinnedIcons.filter(filledOf).length,
        recent: recentIcons.length,
        recentFilled: recentIcons.filter(filledOf).length,
        storage: storageIcons.length,
        storageFilled: storageIcons.filter(filledOf).length,
      };
    })()`)).value;

    // ── 1) 开启实心图标：固定项与最近访问全部实心 ──
    await seed(true);
    await h.clickPlace(win, 'dashboard');
    await h.waitFor(win, `!!document.querySelector('.pinned-icon md-icon')`, { timeout: 8000 });
    await h.waitFor(win, `!!document.querySelector('.storage-sub-icon')`, { timeout: 15000 });
    await h.sleep(400);
    const on = await iconState();
    h.assert.strictEqual(on.pinned, pinned.length, `固定项图标数量应为 ${pinned.length}（实际 ${on.pinned}）`);
    h.assert.strictEqual(on.pinnedFilled, on.pinned, '开启实心后固定项图标应全部为实心');
    h.assert.ok(on.recent > 0, '最近访问应有图标');
    h.assert.strictEqual(on.recentFilled, on.recent, '开启实心后最近访问图标应全部为实心');
    h.assert.ok(on.storage > 0, '存储子区域应有图标');
    h.assert.strictEqual(on.storageFilled, on.storage, '开启实心后存储子区域图标也应全部为实心');

    // ── 2) 关闭实心图标：恢复描边 ──
    await seed(false);
    await h.clickPlace(win, 'dashboard');
    await h.waitFor(win, `!!document.querySelector('.pinned-icon md-icon')`, { timeout: 8000 });
    await h.sleep(400);
    const off = await iconState();
    h.assert.strictEqual(off.pinnedFilled, 0, '关闭实心后固定项图标应全部为描边');
    h.assert.strictEqual(off.recentFilled, 0, '关闭实心后最近访问图标应全部为描边');
    h.assert.strictEqual(off.storageFilled, 0, '关闭实心后存储子区域图标应全部为描边');
  });

  h.finish();
})();
