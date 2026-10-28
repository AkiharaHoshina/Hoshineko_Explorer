/**
 * e2e 115：主题改版（v3.0.1015）。
 *
 * - 主题内容并入 settings://display（旧 settings://display/theme 归一）；
 * - 预设新增两面旗帜（跨性别 / 骄傲），点击应用并持久化 kind='flag'；
 * - 特殊颜色为 4 张大卡片，系统主题已移除。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('115 主题：旗帜预设 + 特殊颜色 4 卡 + 旧子页归一', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(400);

    await h.openSettingsPage(win, /主题和显示|Theme & Display/);
    await h.waitFor(win, `!!document.querySelector('.theme-color-preset--flag')`, { timeout: 8000 });

    const themeCss = async () => (await h.js(
      win,
      `document.getElementById('app-theme')?.textContent ?? ''`,
    )).value;
    const storedConfig = async () => (await h.js(
      win,
      `(() => { try { return JSON.parse(localStorage.getItem('settings.theme') ?? 'null'); } catch { return null; } })()`,
    )).value;

    // 1) 单色预设 12 + 旗帜 2
    const counts = (await h.js(win, `({
      seeds: document.querySelectorAll('.theme-color-preset:not(.theme-color-preset--flag)').length,
      flags: document.querySelectorAll('.theme-color-preset--flag').length,
      specials: document.querySelectorAll('.theme-color-special').length,
    })`)).value;
    h.assert.strictEqual(counts.seeds, 12, '单色预设应为 12 个');
    h.assert.strictEqual(counts.flags, 2, '旗帜预设应为 2 个（跨性别 / 骄傲）');
    h.assert.strictEqual(counts.specials, 4, '特殊颜色应为 4 张大卡片');

    // 2) 系统主题已移除（不再有该卡片/文案）
    const hasSystem = (await h.js(
      win,
      `[...document.querySelectorAll('.theme-color-special-title')].some((el) => /系统主题|System theme/.test(el.textContent ?? ''))`,
    )).value;
    h.assert.strictEqual(hasSystem, false, '系统主题卡片应已移除');

    const before = await themeCss();

    // 3) 跨性别旗 → kind='flag'
    await h.js(win, `document.querySelectorAll('.theme-color-preset--flag')[0].click(); true`);
    await h.sleep(600);
    const cfgTg = await storedConfig();
    h.assert.strictEqual(cfgTg?.kind, 'flag', '选择旗帜后应持久化 kind=flag');
    h.assert.strictEqual(cfgTg?.presetId, 'transgender', '第一面旗帜应为跨性别');
    const cssTg = await themeCss();
    h.assert.ok(cssTg.length > 0 && cssTg !== before, '应注入旗帜主题 CSS');
    h.assert.ok(cssTg.includes('--md-sys-color-primary'), '主题 CSS 应包含 M3 角色变量');

    // 4) 骄傲旗 → presetId 切换且配色不同
    await h.js(win, `document.querySelectorAll('.theme-color-preset--flag')[1].click(); true`);
    await h.sleep(600);
    const cfgPride = await storedConfig();
    h.assert.strictEqual(cfgPride?.presetId, 'pride', '第二面旗帜应为骄傲');
    const cssPride = await themeCss();
    h.assert.ok(cssPride !== cssTg, '两面旗帜应生成不同配色');

    // 5) 旧子页链接归一（settings://display/theme → settings://display）
    await h.js(win, `location.reload(); true`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 8000 });
    await h.sleep(400);
    await h.clickEl(win, '.omnibar-trigger');
    await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`);
    await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', 'settings://display/theme');
    await h.key(win, 'Enter');
    await h.waitFor(win, `!!document.querySelector('.theme-color-preset-grid')`, { timeout: 8000 });
    const title = (await h.js(win, `document.querySelector('.settings-page .object-panel-title')?.textContent ?? ''`)).value;
    h.assert.ok(/主题和显示|Theme & Display/.test(title), `旧子页链接应落到显示页（实际 ${title}）`);
  });

  h.finish();
})();
