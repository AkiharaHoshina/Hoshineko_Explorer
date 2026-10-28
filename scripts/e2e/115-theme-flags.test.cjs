/**
 * e2e 115：骄傲主题（v3.0.1027）。
 *
 * - 主题内容并入 settings://display（旧 settings://display/theme 归一）；
 * - 预设色盘不含旗帜；
 * - 「骄傲主题」：每次激活左侧栏条目，从该旗色库**随机**取一色给当前条目
 *   做容器色（相邻两次不同色），左上角显示斜向硬边旗标；切走复原；
 *   收起态不显示旗标；选「无」不着色；
 * - 换旗（设置更改）立即刷新当前条目，无需再点侧边栏；
 * - 切明暗主题时容器色即时重算、旗标保持旗色本色。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('115 骄傲主题：随机容器色 + 斜向旗标 + 即时刷新', async () => {
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

    const prideState = async (w = win) => (await h.js(w, `(() => {
      const marked = [...document.querySelectorAll('[data-pride-flag]')];
      const active = document.querySelector('.sidebar-item.active');
      const cs = active ? getComputedStyle(active) : null;
      const band = active ? getComputedStyle(active, '::before') : null;
      const disc = active ? getComputedStyle(active, '::after') : null;
      return {
        count: marked.length,
        flag: active?.dataset.prideFlag ?? null,
        color: active?.dataset.prideColor ?? null,
        icon: active?.querySelector('md-icon')?.textContent ?? null,
        fg: cs ? cs.color : null,
        bg: cs ? cs.backgroundColor : null,
        band: band ? band.backgroundImage : null,
        bandDisplay: band ? band.display : null,
        disc: disc ? disc.backgroundColor : null,
        discDisplay: disc ? disc.display : null,
        discZ: disc ? disc.zIndex : null,
        discBorderW: disc ? disc.borderTopWidth : null,
        discBorderC: disc ? disc.borderTopColor : null,
        surface: getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-surface').trim(),
      };
    })()`)).value;
    const stopCount = (g) => ((g ?? '').match(/(color|rgba?)\(/g) ?? []).length;
    const TG = ['#5BCEFA', '#F5A9B8', '#FFFFFF'];
    const PRIDE = ['#E40303', '#FF8C00', '#FFED00', '#008026', '#004DFF', '#750787'];

    // ── 1) 设置页：预设无旗帜；骄傲主题行选项齐全 ──
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
      `下拉应含 无/跨性别/骄傲（实际 ${JSON.stringify(ui.options.slice(0, 4))}…）`);
    h.assert.ok(ui.options.length >= 10, `应有多种旗帜可选（实际 ${ui.options.length}）`);

    // ── 2) 点击位置 → 随机容器色 + 斜向旗标（跨性别 5 条硬边） ──
    await h.clickPlace(win, 'image');
    await h.sleep(500);
    const s1 = await prideState();
    h.assert.strictEqual(s1.icon, 'image', '应切到图片位置');
    h.assert.strictEqual(s1.count, 1, '只应有当前条目带骄傲样式');
    h.assert.strictEqual(s1.flag, 'transgender', '条目应标记当前旗帜');
    h.assert.ok(TG.includes(s1.color), `随机色应取自跨性别库（实际 ${s1.color}）`);
    h.assert.ok(/linear-gradient/.test(s1.band ?? ''), '左上角应有旗标渐变');
    h.assert.ok(stopCount(s1.band) >= 10, `旗标应渲染 5 条硬边色带（色标 ${stopCount(s1.band)}）`);
    h.assert.ok(/^(rgb|color)\(/.test(s1.bg ?? ''), `容器色应为混色结果（实际 ${s1.bg}）`);
    // 图标圆形遮罩：位于旗标之上、图标之下，颜色 = 容器色加深一级
    h.assert.notStrictEqual(s1.discDisplay, 'none', '图标下应有圆形遮罩');
    h.assert.strictEqual(s1.discZ, '1', '遮罩层级应在旗标(0)与图标(2)之间');
    h.assert.notStrictEqual(s1.disc, s1.bg, `遮罩色应与容器色不同（浅一级，实际 ${s1.disc}）`);
    h.assert.ok(parseFloat(s1.discBorderW) > 0, `遮罩应有细描边（实际 ${s1.discBorderW}）`);
    h.assert.ok(parseFloat(s1.discBorderW) >= 2, '描边应加粗到 2px');
    h.assert.ok(/91, 206, 250|srgb 0\.357\w* 0\.808\w* 0\.98/.test(s1.discBorderC ?? ''),
      `描边应为旗条最外侧旗色（跨性别=#5BCEFA，实际 ${s1.discBorderC}）`);

    // ── 3) 相邻两次不同色：重复点同一位置必须换色 ──
    await h.clickPlace(win, 'image');
    await h.sleep(450);
    const s1b = await prideState();
    h.assert.ok(s1b.color !== s1.color, `重复点击同一位置必须换色（${s1.color} → ${s1b.color}）`);

    // ── 3b) 悬停不改变遮罩底色（遮罩只有一种状态） ──
    const rect = (await h.js(win, `(() => { const el = document.querySelector('.sidebar-item.active'); const r = el.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height}; })()`)).value;
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2) });
    await h.sleep(500);
    const hovered = (await h.js(win, `document.querySelector('.sidebar-item.active')?.matches(':hover') ?? false`)).value;
    const sHover = await prideState();
    h.assert.ok(hovered, '鼠标应已悬停在激活条目上');
    h.assert.strictEqual(sHover.disc, s1b.disc, '悬停不应改变遮罩底色');

    // ── 4) 切到另一位置 → 旧条目复原，新条目随机且与上一次不同 ──
    await h.clickPlace(win, 'description');
    await h.sleep(500);
    const s2 = await prideState();
    h.assert.strictEqual(s2.icon, 'description', '应切到文档位置');
    h.assert.strictEqual(s2.count, 1, '切走后旧条目不应保留样式');
    h.assert.ok(s2.color !== s1b.color, `切换后的颜色不得与切换前相同（${s1b.color} → ${s2.color}）`);

    // ── 4b) 冷启动/新窗口：落点是主页时，开机即着色（无需点击侧边栏） ──
    const winCold = await h.createTestWindow({ argv: ['electron', require('os').homedir()] });
    await h.waitFor(winCold, `!!document.querySelector('.file-list-item')`, { timeout: 15000 });
    await h.sleep(900);
    const sCold = await prideState(winCold);
    h.assert.strictEqual(sCold.flag, 'transgender', '冷启动激活条目应自动着色（无需点击）');
    h.assert.strictEqual(sCold.count, 1, '冷启动时只应有激活条目带样式');
    h.assert.strictEqual(sCold.icon, 'home', '冷启动落点为主页');
    winCold.destroy();

    // ── 5) 换旗即时刷新：只改设置，不点侧边栏 ──
    await h.openSettingsPage(win, /主题和显示|Theme & Display/);
    await h.waitFor(win, `!!document.querySelector('[data-settings-row="display-pride-theme"]')`, { timeout: 8000 });
    await h.sleep(400);
    const beforeSwitch = await prideState();
    h.assert.strictEqual(beforeSwitch.flag, 'transgender', '进设置页后当前条目仍是跨性别配色');
    await h.js(win, `(() => {
      const row = document.querySelector('[data-settings-row="display-pride-theme"]');
      const sel = row.querySelector('md-outlined-select');
      sel.value = 'pride';
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      return sel.value;
    })()`);
    await h.sleep(700);
    const afterSwitch = await prideState();
    h.assert.strictEqual(afterSwitch.flag, 'pride', '换旗后当前条目应立即改用新旗帜（无需再点击）');
    h.assert.ok(PRIDE.includes(afterSwitch.color), `换旗后随机色应取自骄傲库（实际 ${afterSwitch.color}）`);
    h.assert.ok(afterSwitch.color !== beforeSwitch.color, '换旗后颜色应刷新');
    h.assert.ok(/228, 3, 3|srgb 0\.894\w* 0\.012\w* 0\.012/.test(afterSwitch.discBorderC ?? ''),
      `换旗后描边应改为新旗最外侧色（骄傲=#E40303，实际 ${afterSwitch.discBorderC}）`);

    // ── 6) 切换明暗主题 → 容器色即时重算，旗标保持旗色本色 ──
    await h.js(win, `window.electron.setThemeSource('light'); true`);
    await h.sleep(900);
    const sLight = await prideState();
    h.assert.ok(sLight.surface !== afterSwitch.surface, '切换亮色后主题 surface 应变化');
    h.assert.ok(sLight.bg !== afterSwitch.bg, '切换亮色后容器色应重算');
    h.assert.ok(sLight.fg !== afterSwitch.fg, '文字色应随主题更新');
    h.assert.strictEqual(sLight.band, afterSwitch.band, '旗标是旗色本色，不应随主题变化');
    h.assert.strictEqual(sLight.discBorderC, afterSwitch.discBorderC, '描边是旗色本色，不应随主题变化');
    await h.js(win, `window.electron.setThemeSource('dark'); true`);
    await h.sleep(900);

    // ── 7) 收起态：旗标隐藏、容器色保留 ──
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
    h.assert.strictEqual(s3.count, 1, '收起态同样只应有当前条目带样式');
    h.assert.strictEqual(s3.bandDisplay, 'none', '收起态不应显示旗标');
    h.assert.strictEqual(s3.discDisplay, 'none', '收起态不应显示图标遮罩');
    h.assert.ok(/^(rgb|color)\(/.test(s3.bg ?? ''), '收起态仍应有容器色');

    // ── 8) 设为「无」→ 不再着色 ──
    await setPride(null);
    await h.clickPlace(win, 'home');
    await h.sleep(500);
    const s4 = await prideState();
    h.assert.strictEqual(s4.count, 0, '「无」时不应有任何骄傲样式');

    // ── 9) 旧子页链接归一 ──
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
