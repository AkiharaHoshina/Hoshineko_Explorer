/**
 * e2e 117：主题特殊颜色卡的选中态（壁纸取色 vs 自定义图片取色）。
 *
 * 缺陷：两类壁纸主题都会保存 `kind: 'wallpaper'`，设置页两张卡此前都用
 * `selectedKind === 'wallpaper'` 判定选中 → 壁纸取色成功后「自定义图片取色」
 * 也会亮起。修复：ThemeConfig 新增 `wallpaperSource: 'auto' | 'pick'`，
 * 两张卡分别按来源高亮；旧配置无该字段视为 `'auto'`。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('117 主题壁纸卡片选中态（自动 / 手动区分）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'x.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    /** 写入 settings.theme（useLocalStorage：对象单层 stringify）并重载 */
    const setTheme = async (cfg) => {
      await h.js(
        win,
        `localStorage.setItem('settings.theme', ${JSON.stringify(JSON.stringify(cfg))}); location.reload(); true`,
      );
      await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 15000 });
    };

    /** 当前高亮的特殊颜色卡（data-theme-special） */
    const selectedSpecials = async () => (await h.js(win, `(() => [...document.querySelectorAll('.theme-color-special')]
      .filter((e) => e.classList.contains('theme-color-special--selected'))
      .map((e) => e.dataset.themeSpecial))()`)).value;

    const check = async (cfg, expected, label) => {
      await setTheme(cfg);
      await h.openSettingsPage(win, /主题和显示|Theme & Display/);
      await h.waitFor(win, `!!document.querySelector('.theme-color-special')`, { timeout: 8000 });
      await h.sleep(400);
      h.assert.deepStrictEqual(await selectedSpecials(), expected, label);
    };

    // ── 1) 旧配置（无 wallpaperSource）→ 只亮自动探测卡 ──
    await check({ kind: 'wallpaper', seed: '#383e58' }, ['wallpaper-auto'],
      '无来源字段的旧壁纸配置应只高亮「壁纸取色」');

    // ── 2) 手动选图 → 只亮自定义图片卡 ──
    await check({ kind: 'wallpaper', seed: '#383e58', wallpaperSource: 'pick' }, ['wallpaper-pick'],
      '手动选图应只高亮「自定义图片取色」');

    // ── 3) 预设 / matugen 不误亮壁纸卡 ──
    await check({ kind: 'preset', seed: '#6750A4', presetId: 'purple' }, [],
      '预设主题不应高亮任何特殊颜色卡');
    await check({ kind: 'matugen' }, ['matugen'],
      'matugen 主题应只高亮 Matugen 卡');

    // ── 4) 自动探测流程：成功取色后只亮自动卡，且记录 wallpaperSource=auto ──
    const base = h.tempDir();
    const stateDms = path.join(base, 'state', 'dms');
    fs.mkdirSync(stateDms, { recursive: true });
    const img = path.join(base, 'wallpaper.png');
    fs.writeFileSync(img, Buffer.from(h.PNG_1PX_BASE64, 'base64'));
    fs.writeFileSync(path.join(stateDms, 'session.json'),
      JSON.stringify({ wallpaperPath: img, configVersion: 7 }));

    const prevStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = path.join(base, 'state');
    try {
      await setTheme({ kind: 'preset', seed: '#6750A4', presetId: 'purple' });
      await h.openSettingsPage(win, /主题和显示|Theme & Display/);
      await h.waitFor(win, `!!document.querySelector('[data-theme-special="wallpaper-auto"]')`, { timeout: 8000 });
      await h.clickEl(win, '[data-theme-special="wallpaper-auto"]');
      await h.waitFor(
        win,
        `document.querySelector('[data-theme-special="wallpaper-auto"]').classList.contains('theme-color-special--selected')`,
        { timeout: 20000 },
      );
      await h.sleep(300);

      const cfg = (await h.js(win, `JSON.parse(localStorage.getItem('settings.theme') || 'null')`)).value;
      h.assert.strictEqual(cfg?.kind, 'wallpaper', `自动取色后主题应为 wallpaper（实际 ${cfg?.kind}）`);
      h.assert.strictEqual(cfg?.wallpaperSource, 'auto', '自动取色应记录 wallpaperSource=auto');
      h.assert.strictEqual(cfg?.wallpaperPath, img, '应使用 DMS 会话里的壁纸路径');
      h.assert.deepStrictEqual(await selectedSpecials(), ['wallpaper-auto'],
        '壁纸取色成功后不应错误点亮「自定义图片取色」');
    } finally {
      if (prevStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = prevStateHome;
    }
  });

  h.finish();
})();
