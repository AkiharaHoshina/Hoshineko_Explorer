/**
 * e2e 117：主题特殊颜色卡的选中态（壁纸取色 vs 自定义图片取色）。
 *
 * 缺陷：两类壁纸主题都会保存 `kind: 'wallpaper'`，设置页两张卡此前都用
 * `selectedKind === 'wallpaper'` 判定选中 → 壁纸取色成功后「自定义图片取色」
 * 也会亮起。修复：ThemeConfig 新增 `wallpaperSource: 'auto' | 'pick'`，
 * 两张卡分别按来源高亮；旧配置无该字段视为 `'auto'`。
 *
 * 同时覆盖副标题对称规则（v3.0.1035）：谁生效谁显示路径，其余卡恢复介绍文案；
 * Matugen 卡改为 selecting 配置文件（文件/目录）后显示实际文件路径，
 * 以及 `theme:load-matugen` 的目录查找 / 颜色 JSON 转换 / 失败返回。
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

    /** 某张特殊卡的副标题文本 */
    const descOf = async (key) => (await h.js(win,
      `document.querySelector('[data-theme-special="${key}"] .theme-color-special-desc')?.textContent ?? ''`)).value;

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

    // ── 5) 副标题对称：谁生效谁显示路径，其余恢复介绍 ──
    const wpPath = path.join(h.tempDir(), 'wallpaper.png');
    fs.writeFileSync(wpPath, Buffer.from(h.PNG_1PX_BASE64, 'base64'));

    // 先取「无主题生效」时的介绍文案作为基线
    await setTheme({ kind: 'preset', seed: '#6750A4', presetId: 'purple' });
    await h.openSettingsPage(win, /主题和显示|Theme & Display/);
    await h.waitFor(win, `!!document.querySelector('[data-theme-special="custom"]')`, { timeout: 8000 });
    const baseDescs = {
      auto: await descOf('wallpaper-auto'),
      pick: await descOf('wallpaper-pick'),
      matugen: await descOf('matugen'),
    };
    h.assert.ok(baseDescs.auto && baseDescs.pick && baseDescs.matugen, '三张卡的介绍文案应存在');
    h.assert.notStrictEqual(baseDescs.auto, baseDescs.pick, '自动/手动两张卡的介绍文案应不同');

    // 手动选图生效：pick 卡显示路径，auto 卡恢复介绍
    await setTheme({ kind: 'wallpaper', seed: '#383e58', wallpaperSource: 'pick', wallpaperPath: wpPath });
    await h.openSettingsPage(win, /主题和显示|Theme & Display/);
    await h.waitFor(win, `!!document.querySelector('[data-theme-special="custom"]')`, { timeout: 8000 });
    h.assert.strictEqual(await descOf('wallpaper-pick'), wpPath, '手动选图生效时图片卡应显示路径');
    h.assert.strictEqual(await descOf('wallpaper-auto'), baseDescs.auto, '手动选图生效时自动卡应恢复介绍');

    // 自动生效：auto 卡显示路径，pick 卡恢复介绍
    await setTheme({ kind: 'wallpaper', seed: '#383e58', wallpaperSource: 'auto', wallpaperPath: wpPath });
    await h.openSettingsPage(win, /主题和显示|Theme & Display/);
    await h.waitFor(win, `!!document.querySelector('[data-theme-special="custom"]')`, { timeout: 8000 });
    h.assert.strictEqual(await descOf('wallpaper-auto'), wpPath, '自动取色生效时自动卡应显示路径');
    h.assert.strictEqual(await descOf('wallpaper-pick'), baseDescs.pick, '自动取色生效时图片卡应恢复介绍');

    // ── 6) Matugen 卡：生效显示配置文件路径，换主题恢复介绍 ──
    const matuCss = ':root { --md-sys-color-primary: #112233; }\n@media (prefers-color-scheme: light) { :root { --md-sys-color-primary: #332211; } }\n';
    const matuFile = path.join(h.tempDir(), 'theme.css');
    fs.writeFileSync(matuFile, matuCss);
    await setTheme({ kind: 'matugen', matugenPath: matuFile });
    await h.openSettingsPage(win, /主题和显示|Theme & Display/);
    await h.waitFor(win, `!!document.querySelector('[data-theme-special="matugen"]')`, { timeout: 8000 });
    h.assert.strictEqual(await descOf('matugen'), matuFile, 'Matugen 生效时副标题应显示配置文件路径');
    await h.sleep(600);
    const matuPrimary = (await h.js(win,
      `getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim()`)).value;
    h.assert.strictEqual(matuPrimary.toLowerCase(), '#112233', `Matugen 主题应按所选文件生效（实际 ${matuPrimary}）`);
    h.assert.strictEqual(await descOf('wallpaper-auto'), baseDescs.auto, 'Matugen 生效时壁纸卡应是介绍');

    await setTheme({ kind: 'preset', seed: '#6750A4', presetId: 'purple' });
    await h.openSettingsPage(win, /主题和显示|Theme & Display/);
    await h.waitFor(win, `!!document.querySelector('[data-theme-special="matugen"]')`, { timeout: 8000 });
    h.assert.strictEqual(await descOf('matugen'), baseDescs.matugen, '切到其他主题后 Matugen 卡应恢复介绍');

    // ── 7) theme:load-matugen：目录查找 / 颜色 JSON / 失败 ──
    const loadMatugen = async (p) => (await h.js(win, `window.electron.loadMatugen(${JSON.stringify(p)})`)).value;

    // 目录内 theme.css 优先
    const cssDir = h.tempDir();
    fs.writeFileSync(path.join(cssDir, 'theme.css'), matuCss);
    fs.writeFileSync(path.join(cssDir, 'colors.json'), '{}');
    const fromDir = await loadMatugen(cssDir);
    h.assert.ok(fromDir?.success, `目录选择应成功（${JSON.stringify(fromDir)}）`);
    h.assert.strictEqual(fromDir?.path, path.join(cssDir, 'theme.css'), '目录内应优先命中 theme.css');

    // 只有颜色 JSON 的目录（DMS/matugen 产物）
    const jsonDir = h.tempDir();
    fs.writeFileSync(path.join(jsonDir, 'colors.json'), JSON.stringify({
      colors: {
        dark: { primary: '#101010', surface: '#000000', on_surface: '#ffffff' },
        light: { primary: '#f0f0f0', surface: '#ffffff', on_surface: '#000000' },
      },
    }));
    const fromJson = await loadMatugen(jsonDir);
    h.assert.ok(fromJson?.success, '颜色 JSON 应能转换为主题');
    h.assert.ok(/--md-sys-color-on-surface/.test(fromJson?.css ?? ''), '转换结果应含 M3 角色变量');
    h.assert.strictEqual(fromJson?.path, path.join(jsonDir, 'colors.json'), '应报告实际命中的 JSON 文件');

    // 空目录 / 不存在 / 无效 JSON
    h.assert.strictEqual((await loadMatugen(h.tempDir()))?.success, false, '空目录应失败');
    h.assert.strictEqual((await loadMatugen(path.join(h.tempDir(), 'nope.css')))?.success, false, '不存在的文件应失败');
    const badDir = h.tempDir();
    fs.writeFileSync(path.join(badDir, 'colors.json'), '{"foo":1}');
    h.assert.strictEqual((await loadMatugen(badDir))?.success, false, '无效 JSON 应失败');
  });

  h.finish();
})();
