/**
 * e2e 120：设置主页分类卡片的「N 个项目」计数。
 *
 * 缺陷：计数硬编码在 SETTINGS_CATEGORIES，新增设置项后忘记同步——
 * 「文件」显示 10（实际 12）、「主题和显示」显示 3（实际 6）。
 * 修复：计数从设置搜索索引 SETTINGS_SEARCH_INDEX 派生（新增/删除设置项
 * 登记索引即同步），「关于」是信息展示页固定 2。
 */
const h = require('./harness.cjs');

/** 各分类期望的项目数（= 搜索索引里该分类的行数；about 固定 2） */
const EXPECTED = {
  navigation: 8,
  files: 12,
  display: 6,
  search: 4,
  portal: 3,
  shortcut: 2,
  i18n: 1,
  defaultrecovery: 1,
  about: 2,
};

(async () => {
  await h.setupApp();

  await h.run('120 设置主页分类计数与索引一致', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'x.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    await h.openSettingsPage(win);
    await h.waitFor(win, `!!document.querySelector('[data-settings-cat]')`, { timeout: 8000 });

    const counts = (await h.js(win, `(() => {
      const out = {};
      for (const card of document.querySelectorAll('[data-settings-cat]')) {
        const id = card.dataset.settingsCat;
        const text = card.querySelector('.settings-category-count')?.textContent ?? '';
        out[id] = Number((text.match(/(\\d+)/) ?? [])[1]);
      }
      return out;
    })()`)).value;

    for (const [id, n] of Object.entries(EXPECTED)) {
      h.assert.strictEqual(counts[id], n, `分类 ${id} 计数应为 ${n}（实际 ${counts[id]}）`);
    }

    // 深色模式行已登记索引：设置搜索「深色」应能命中并落到显示页
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`, { timeout: 8000 });
    await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', 'settingssearch://display?q=深色');
    await h.sleep(200);
    await h.js(win, `(() => {
      const el = document.querySelector('.omnibar.mode-edit .omnibar-input');
      el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('.settings-search-count, .object-search-group')`, { timeout: 8000 });
    await h.sleep(300);
    const hit = (await h.js(win, `document.body.textContent.includes('黑暗主题')`)).value;
    h.assert.ok(hit, '设置搜索「深色」应命中黑暗主题设置');
  });

  h.finish();
})();
