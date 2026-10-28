/**
 * e2e 115：骄傲主题（v3.0.1019）。
 *
 * - 主题内容并入 settings://display（旧 settings://display/theme 归一）；
 * - 预设色盘不含旗帜；
 * - 「骄傲主题」设置项：激活左侧栏条目时，当前条目铺满该旗的**硬边条纹**
 *   （无随机、渲染确定）；切走复原；收起态同样生效；选「无」不着色；
 * - 切明暗主题时底纹必须即时重算（内容由 CSS 变量求值）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('115 骄傲主题：整面旗条纹 + 主题切换刷新', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);
    await h.sleep(400);

    /** 写设置（useLocalStorage 以 JSON 存储：字符串值需双层 stringify） */
    const setPride = async (flagId) => {
      await h.js(
        win,
        `localStorage.setItem('settings.prideAccent', ${JSON.stringify(JSON.stringify(flagId))}); location.reload(); true`,
      );
      await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 8000 });
      await h.sleep(400);
    };

    /** 当前带骄傲底纹的条目信息 */
    const prideState = async () => (await h.js(win, `(() => {
      const marked = [...document.querySelectorAll('[data-pride-flag]')];
      const active = document.querySelector('.sidebar-item.active');
      const cs = active ? getComputedStyle(active) : null;
      const bar = active ? getComputedStyle(active, '::after') : null;
      return {
        count: marked.length,
        flag: active?.dataset.prideFlag ?? null,
        icon: active?.querySelector('md-icon')?.textContent ?? null,
        fg: cs ? cs.color : null,
        bg: cs ? cs.backgroundColor : null,
        bar: bar ? bar.backgroundImage : null,
        barDisplay: bar ? bar.display : null,
        surface: getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-surface').trim(),
      };
    })()`)).value;
    const stopCount = (g) => ((g ?? '').match(/(color|rgba?)\(/g) ?? []).length;

    // ── 1) 设置页：旗帜不再是预设；骄傲主题行存在且选项齐全 ──
    await setPride('transgender');
    await h.openSettingsPage(win, /主题和显示|Theme & Display/);
    await h.waitFor(win, `!!document.querySelector('[data-settings-row="display-pride-theme"]')`, { timeout: 8000 });
    const ui = (await h.js(win, `(() => {
      const row = document.querySelector('[data-settings-row="display-pride-theme"]');
      const sel = row?.querySelector('md-outlined-select');
      return {
        flags: document.querySelectorAll('.theme-color-preset--flag').length,
        options: sel ? [...sel.querySelectorAll('md-select-option')].map((o) => o.value) : [],
        value: sel ? sel.value : null,
      };
    })()`)).value;
    h.assert.strictEqual(ui.flags, 0, '预设色盘不应再有旗帜');
    h.assert.ok(ui.options.includes('') && ui.options.includes('transgender') && ui.options.includes('pride'),
      `骄傲主题下拉应含 无/跨性别/骄傲（实际 ${JSON.stringify(ui.options.slice(0, 4))}…）`);
    h.assert.ok(ui.options.length >= 10, `骄傲主题应有多种旗帜可选（实际 ${ui.options.length}）`);
    h.assert.strictEqual(ui.value, 'transgender', '下拉应反映当前设置');

    // ── 2) 点击位置 → 当前条目铺上整面旗（跨性别 5 条硬边色带） ──
    await h.clickPlace(win, 'image');
    await h.sleep(500);
    const s1 = await prideState();
    h.assert.strictEqual(s1.icon, 'image', '应切到图片位置');
    h.assert.strictEqual(s1.count, 1, '只应有当前条目带骄傲底纹');
    h.assert.strictEqual(s1.flag, 'transgender', '条目应标记当前旗帜 id');
    // 方案 A+C：左侧 5px 旗条（全饱和条纹）+ 容器色
    h.assert.ok(/linear-gradient/.test(s1.bar ?? ''), '条目应有左侧旗条渐变');
    h.assert.ok(stopCount(s1.bar) >= 10, `旗条应渲染 5 条硬边色带（色标 ${stopCount(s1.bar)}）`);
    h.assert.ok(/^(rgb|color)\(/.test(s1.bg ?? ''), `容器色应为混色结果（实际 ${s1.bg}）`);
    h.assert.strictEqual(s1.barDisplay, 'block', '展开态旗条应可见');

    // ── 3) 渲染确定：重复点同一位置，底纹不变（无随机） ──
    await h.clickPlace(win, 'image');
    await h.sleep(400);
    const s1b = await prideState();
    h.assert.strictEqual(s1b.bar, s1.bar, '同一旗帜下重复点击旗条应完全一致（无随机）');
    h.assert.strictEqual(s1b.bg, s1.bg, '同一旗帜下重复点击容器色应一致');

    // ── 4) 切到另一位置 → 旧条目复原，新条目同样铺满整面旗 ──
    await h.clickPlace(win, 'description');
    await h.sleep(500);
    const s2 = await prideState();
    h.assert.strictEqual(s2.icon, 'description', '应切到文档位置');
    h.assert.strictEqual(s2.count, 1, '切走后旧条目不应保留底纹');
    h.assert.strictEqual(s2.bar, s1.bar, '同一旗帜下不同条目旗条一致');
    h.assert.strictEqual(s2.bg, s1.bg, '同一旗帜下不同条目容器色一致');

    // ── 5) 切换明暗主题 → 底纹与文字色必须立刻刷新 ──
    await h.js(win, `window.electron.setThemeSource('light'); true`);
    await h.sleep(900);
    const sLight = await prideState();
    h.assert.ok(sLight.surface !== s2.surface, '切换亮色后主题 surface 应变化');
    h.assert.ok(sLight.bg !== s2.bg, '切换亮色后容器色应重算（不能沿用暗色值）');
    h.assert.ok(sLight.fg !== s2.fg, '文字色应随主题更新');
    h.assert.strictEqual(sLight.bar, s2.bar, '旗条是旗色本色，不应随主题变化');
    await h.js(win, `window.electron.setThemeSource('dark'); true`);
    await h.sleep(900);
    const sBack = await prideState();
    h.assert.ok(sBack.bg !== sLight.bg, '切回暗色后容器色应再次重算');

    // ── 6) 收起态（图标轨道）同样生效 ──
    await h.clickEl(win, '.sidebar-collapse-btn');
    await h.sleep(400);
    h.assert.ok(
      (await h.js(win, `!!document.querySelector('.sidebar--collapsed')`)).value,
      '侧边栏应已收起',
    );
    await h.clickPlace(win, 'image');
    await h.sleep(500);
    const s3 = await prideState();
    h.assert.strictEqual(s3.icon, 'image', '收起态也应能切换位置');
    h.assert.strictEqual(s3.count, 1, '收起态同样只应有当前条目带底纹');
    h.assert.strictEqual(s3.flag, 'transgender', '收起态同样应用当前旗帜');
    // 收起态不显示旗条，但容器色保留
    h.assert.strictEqual(s3.barDisplay, 'none', '收起态不应显示彩条');
    h.assert.ok(/^(rgb|color)\(/.test(s3.bg ?? ''), '收起态仍应有容器色');

    // ── 7) 设为「无」→ 不再着色 ──
    await setPride(null);
    await h.clickPlace(win, 'home');
    await h.sleep(500);
    const s4 = await prideState();
    h.assert.strictEqual(s4.count, 0, '「无」时不应有任何骄傲底纹');

    // ── 8) 旧子页链接归一（settings://display/theme → settings://display） ──
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
