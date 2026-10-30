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
  display: 5,
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

    // ── 实验设置：无常规入口，只能经地址栏进入 ──
    const noCard = (await h.js(win, `document.querySelectorAll('[data-settings-cat="experimental"]').length`)).value;
    h.assert.strictEqual(noCard, 0, '设置主页不应出现「实验设置」卡片');

    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`, { timeout: 8000 });
    await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', 'settings://experimental');
    await h.sleep(150);
    await h.js(win, `(() => {
      const el = document.querySelector('.omnibar.mode-edit .omnibar-input');
      el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('[data-settings-row="display-pride-theme"]')`, { timeout: 8000 });
    const expTitle = (await h.js(win, `document.querySelector('.settings-page .object-panel-title')?.textContent ?? ''`)).value;
    h.assert.ok(/实验设置|Experimental/.test(expTitle), `实验设置页标题应正确（实际 ${expTitle}）`);

    // 面包屑：设置胶囊右键 → 通用跳转菜单含「转到设置」，且位于「转到对象面板」下方
    await h.js(win, `(() => {
      const chip = document.querySelector('.breadcrumb-settings-chip');
      chip?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
      return true;
    })()`, true);
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length > 0`, { timeout: 5000 });
    const labels = (await h.js(win, `(() => [...document.querySelectorAll('.context-menu md-list-item')]
      .map((li) => (li.querySelector('[slot="headline"]')?.textContent ?? li.textContent ?? '').trim()))()`)).value;
    const iObj = labels.indexOf('转到对象面板');
    const iSet = labels.indexOf('转到设置');
    h.assert.ok(iObj >= 0 && iSet >= 0, `跳转菜单应同时含对象面板与设置（实际 ${JSON.stringify(labels)}）`);
    h.assert.ok(iSet === iObj + 1, '「转到设置」应紧跟「转到对象面板」下方');
    await h.js(win, `(() => {
      const items = [...document.querySelectorAll('.context-menu md-list-item')];
      items.find((li) => (li.querySelector('[slot="headline"]')?.textContent ?? '').trim() === '转到设置')?.click();
      return true;
    })()`, true);
    await h.waitFor(win, `!!document.querySelector('[data-settings-cat]')`, { timeout: 8000 });
    h.assert.ok((await h.js(win, `document.querySelector('.settings-page .object-panel-title')?.textContent ?? ''`)).value.includes('设置'),
      '点击「转到设置」应回到设置根页');

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
