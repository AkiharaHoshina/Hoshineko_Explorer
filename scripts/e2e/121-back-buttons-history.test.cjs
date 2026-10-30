/**
 * e2e 121：返回按钮（撤回 / 返回上级）、每标签页浏览历史与新窗口/新标签页菜单。
 *
 * - 设置 → 文件 → 外观「返回按钮设置」多选：默认仅勾选「返回上级」；
 * - 撤回按钮位于返回上级按钮左侧；无历史时置灰；根目录时返回上级置灰；
 * - 历史仅内存、按标签页隔离（新标签页为空）；上限 5–30，超限丢最旧；
 * - 文件夹右键新增「在新标签页打开 / 在新窗口打开」，新标签页历史为空。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('121 返回按钮 / 浏览历史 / 新窗口新标签页菜单', async () => {
    const dir = h.tempDir();
    fs.mkdirSync(path.join(dir, 'A'));
    fs.mkdirSync(path.join(dir, 'B'));
    fs.writeFileSync(path.join(dir, 'A', 'insideA.txt'), 'a');
    fs.writeFileSync(path.join(dir, 'B', 'insideB.txt'), 'b');
    fs.writeFileSync(path.join(dir, 'root.txt'), 'r');
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    /** 顶栏返回区按钮信息（按 aria-label 识别） */
    const zoneButtons = async () => (await h.js(win, `(() => {
      // 隐藏标签页 DOM 常驻——只取当前可见（有布局盒）的返回区
      const z = [...document.querySelectorAll('[data-kb-zone="topbar-up"]')]
        .find((el) => el.getClientRects().length > 0);
      const btns = z ? [...z.querySelectorAll('md-icon-button')] : [];
      return btns.map((b) => ({
        icon: b.textContent.trim(),
        label: b.getAttribute('aria-label'),
        disabled: b.hasAttribute('disabled'),
      }));
    })()`)).value;

    const listNames = async () => (await h.js(win,
      `[...document.querySelectorAll('.file-list-item')].map((e) => e.textContent.trim())`)).value;

    const activeTabTitle = async () => (await h.js(win,
      `document.querySelector('.tab-item.active')?.textContent ?? ''`)).value;

    /** 地址栏导航（合成 Enter；受控输入需等一次渲染，失败重试） */
    const nav = async (p, expectLabel) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await h.clickEl(win, '.omnibar-trigger');
        await h.waitFor(win, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`, { timeout: 8000 });
        await h.setReactInput(win, '.omnibar.mode-edit .omnibar-input', p);
        await h.sleep(250);
        await h.js(win, `(() => {
          const el = document.querySelector('.omnibar.mode-edit .omnibar-input');
          el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          return true;
        })()`, true);
        await h.sleep(600);
        if (!expectLabel || (await activeTabTitle()).includes(expectLabel)) return;
      }
      throw new Error(`导航到 ${p} 失败（tab 标题 ${await activeTabTitle()}）`);
    };

    const clickZoneButton = async (label) => {
      await h.js(win, `(() => {
        // 隐藏标签页 DOM 常驻——只取当前可见（有布局盒）的返回区
      const z = [...document.querySelectorAll('[data-kb-zone="topbar-up"]')]
        .find((el) => el.getClientRects().length > 0);
        const b = [...(z?.querySelectorAll('md-icon-button') ?? [])]
          .find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)});
        b?.click();
        return !!b;
      })()`, true);
      await h.sleep(800);
    };

    const clickMenuItem = async (src) => (await h.js(win, `(() => {
      const re = new RegExp(${JSON.stringify(src)}, 'i');
      const menus = document.querySelectorAll('.context-menu');
      const menu = menus[menus.length - 1];
      if (!menu) return false;
      const target = [...menu.querySelectorAll('md-list-item')].find((li) =>
        re.test((li.querySelector('[slot="headline"]')?.textContent ?? li.textContent ?? '').trim()));
      if (!target) return false;
      target.click();
      return true;
    })()`, true)).value;

    const menuLabels = async () => (await h.js(win, `(() => {
      const menus = document.querySelectorAll('.context-menu');
      const menu = menus[menus.length - 1];
      return menu ? [...menu.querySelectorAll('md-list-item')]
        .map((li) => (li.querySelector('[slot="headline"]')?.textContent ?? '').trim()) : [];
    })()`)).value;

    // ── 1) 设置默认值与多选 ──
    await h.openSettingsPage(win, /文件|Files/);
    await h.waitFor(win, `!!document.querySelector('[data-settings-row="files-back-buttons"]')`, { timeout: 8000 });
    const rows = (await h.js(win, `(() => {
      const row = document.querySelector('[data-settings-row="files-back-buttons"]');
      const opts = [...(row?.querySelectorAll('.settings-checkbox-option') ?? [])];
      const limit = document.querySelector('[data-settings-row="files-back-history-limit"]');
      return {
        count: opts.length,
        states: opts.map((o) => ({ checked: o.getAttribute('aria-checked') === 'true', text: o.textContent.trim() })),
        limitValue: limit?.querySelector('md-outlined-text-field')?.value ?? null,
      };
    })()`)).value;
    h.assert.strictEqual(rows.count, 2, '应有两个返回按钮选项');
    h.assert.strictEqual(rows.states[0].checked, true, '默认应勾选「返回上级」');
    h.assert.strictEqual(rows.states[1].checked, false, '默认不应勾选「撤回」');
    h.assert.strictEqual(rows.limitValue, '10', '浏览记录上限默认应为 10');
    // 宽度与上方「拖拽文件行为」下拉框一致
    const widths = (await h.js(win, `(() => {
      const sel = document.querySelector('[data-settings-row="files-drag-action"] md-outlined-select');
      const inp = document.querySelector('[data-settings-row="files-back-history-limit"] md-outlined-text-field');
      return { sel: sel?.getBoundingClientRect().width ?? 0, inp: inp?.getBoundingClientRect().width ?? 0 };
    })()`)).value;
    h.assert.strictEqual(widths.inp, widths.sel, `上限输入框应与上方选择框同宽（${widths.inp} vs ${widths.sel}）`);

    // 勾选「撤回」→ 立即生效并持久化
    await h.js(win, `(() => {
      const row = document.querySelector('[data-settings-row="files-back-buttons"]');
      row?.querySelectorAll('.settings-checkbox-option')[1]?.click();
      return true;
    })()`, true);
    await h.sleep(300);
    const stored = (await h.js(win, `JSON.parse(localStorage.getItem('settings.backButtons') || 'null')`)).value;
    h.assert.deepStrictEqual(stored, ['up', 'undo'], `勾选后应持久化两项（实际 ${JSON.stringify(stored)}）`);

    // 上限输入：非法值不写入、失焦回退；合法值立即生效
    const limitField = '[data-settings-row="files-back-history-limit"] md-outlined-text-field';
    await h.setReactInput(win, limitField, '3');
    await h.js(win, `(() => {
      const f = document.querySelector(${JSON.stringify(limitField)});
      f?.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`, true);
    await h.sleep(300);
    const afterInvalid = await h.js(win, `(() => ({
      limit: JSON.parse(localStorage.getItem('settings.backHistoryLimit') || 'null'),
      value: document.querySelector(${JSON.stringify(limitField)})?.value ?? '',
    }))()`);
    h.assert.strictEqual((await h.js(win, `JSON.parse(localStorage.getItem('settings.backHistoryLimit') || 'null')`)).value, null,
      '非法上限（3）不应写入设置');
    h.assert.strictEqual((await h.js(win, `document.querySelector(${JSON.stringify(limitField)})?.value ?? ''`)).value, '10',
      '非法上限失焦/提交后应回退为 10');
    await h.setReactInput(win, limitField, '15');
    await h.sleep(300);
    h.assert.strictEqual((await h.js(win, `JSON.parse(localStorage.getItem('settings.backHistoryLimit') || 'null')`)).value, 15,
      '合法上限（15）应立即生效');

    // ── 2) 按钮顺序与历史回退 ──
    await h.clickPlace(win, 'home'); // 回到真实目录上下文
    await nav(dir, path.basename(dir));
    let btns = await zoneButtons();
    h.assert.deepStrictEqual(btns.map((b) => b.label), ['撤回', '返回上级'], '撤回应在返回上级左侧');
    h.assert.deepStrictEqual(btns.map((b) => b.icon), ['undo', 'arrow_upward'], '撤回使用 undo 图标、返回上级使用向上箭头');
    // 此时历史含 home 与 dir，撤回可用
    h.assert.strictEqual(btns[0].disabled, false, '有历史时撤回可用');

    await nav(path.join(dir, 'A'), 'A');
    await nav(path.join(dir, 'B'), 'B');
    h.assert.ok((await listNames()).some((n) => n.includes('insideB.txt')), '应已进入 B');
    await clickZoneButton('撤回');
    h.assert.ok((await listNames()).some((n) => n.includes('insideA.txt')), '第一次撤回应回到 A');
    await clickZoneButton('撤回');
    h.assert.ok((await listNames()).some((n) => n.includes('root.txt')), '第二次撤回应回到原目录');
    // 继续撤回到无历史 → 置灰
    let guard = 0;
    while (guard++ < 10) {
      const b = await zoneButtons();
      if (b[0].disabled) break;
      await clickZoneButton('撤回');
    }
    btns = await zoneButtons();
    h.assert.strictEqual(btns[0].disabled, true, '无历史时撤回应置灰');

    // 根目录：返回上级置灰
    await nav('/', '/');
    btns = await zoneButtons();
    h.assert.strictEqual(btns[1].disabled, true, '根目录时返回上级应置灰');

    // ── 3) 右键菜单：新标签页 / 新窗口 ──
    await nav(dir, path.basename(dir));
    await h.rightClickEl(win, '.file-list-item', { index: 0 });
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length > 0`, { timeout: 5000 });
    const labels = await menuLabels();
    const iTab = labels.findIndex((l) => /在新标签页打开|Open in new tab/.test(l));
    const iWin = labels.findIndex((l) => /在新窗口打开|Open in new window/.test(l));
    h.assert.ok(iTab >= 0 && iWin >= 0, `文件夹菜单应含两项（实际 ${JSON.stringify(labels)}）`);
    h.assert.ok(iTab === iWin + 1 || iWin === iTab + 1, '两项应相邻');

    h.assert.ok(await clickMenuItem('在新标签页打开|Open in new tab'), '应能点击「在新标签页打开」');
    await h.waitFor(win, `document.querySelectorAll('.tab-item').length === 2`, { timeout: 8000 });
    await h.sleep(800);
    h.assert.ok((await listNames()).some((n) => n.includes('insideA.txt')), '新标签页应打开所选文件夹');
    const newTabBtns = await zoneButtons();
    h.assert.strictEqual(newTabBtns[0].disabled, true, '新标签页的浏览历史应为空（撤回置灰）');

    // 回第一个标签页，右键「在新窗口打开」
    await h.clickEl(win, '.tab-item', { index: 0 });
    await h.sleep(500);
    await nav(dir, path.basename(dir));
    await h.rightClickEl(win, '.file-list-item', { index: 0 });
    await h.waitFor(win, `document.querySelectorAll('.context-menu md-list-item').length > 0`, { timeout: 5000 });
    h.assert.ok(await clickMenuItem('在新窗口打开|Open in new window'), '应能点击「在新窗口打开」');
    await h.sleep(400);
    h.assert.strictEqual(h.newWindowCalls[h.newWindowCalls.length - 1], path.join(dir, 'A'),
      `新窗口应携带所选目录（实际 ${JSON.stringify(h.newWindowCalls)}）`);

    // ── 4) 上限截断：上限 5 时最多回退 4 次 ──
    const chainRoot = h.tempDir();
    let cur = chainRoot;
    const chain = [];
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      cur = path.join(cur, name);
      fs.mkdirSync(cur);
      fs.writeFileSync(path.join(cur, `${name}.txt`), name);
      chain.push(cur);
    }
    // 设置值经 useLocalStorage 在启动时读取——写入后重载生效
    await h.js(win, `localStorage.setItem('settings.backHistoryLimit', '5'); location.reload(); true`);
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 15000 });
    await h.sleep(500);
    await nav(chain[0], 'a');
    for (const p of chain.slice(1)) await nav(p, path.basename(p));
    h.assert.ok((await listNames()).some((n) => n.includes('g.txt')), '应进入最深层 g');
    let steps = 0;
    while (steps < 10) {
      const b = await zoneButtons();
      if (b[0].disabled) break;
      await clickZoneButton('撤回');
      steps += 1;
    }
    h.assert.strictEqual(steps, 4, `上限 5 时最多回退 4 步（实际 ${steps}）`);

    // ── 5) 带启动路径的新窗口（「在新窗口打开」底层链路）：应直接落在该目录，
    //       标签页处于激活态且有内容（历史为空）──
    const win2 = await h.createTestWindow({ argv: ['hoshinekofm', path.join(dir, 'A')] });
    await h.waitFor(win2, `!!document.querySelector('.file-list-item')`, { timeout: 15000 });
    await h.sleep(800);
    const win2State = (await h.js(win2, `(() => ({
      activeTab: document.querySelector('.tab-item.active')?.textContent ?? null,
      displays: [...document.querySelectorAll('.content-area > div')].map((d) => getComputedStyle(d).display),
      names: [...document.querySelectorAll('.file-list-item')].map((e) => e.textContent.trim()),
    }))()`)).value;
    h.assert.ok(win2State.activeTab && win2State.activeTab.includes('A'), `新窗口应有激活的 A 标签页（实际 ${win2State.activeTab}）`);
    h.assert.ok(win2State.displays.includes('block'), `新窗口内容区应可见（实际 ${JSON.stringify(win2State.displays)}）`);
    h.assert.ok(win2State.names.some((n) => n.includes('insideA.txt')), `新窗口应加载该目录内容（实际 ${JSON.stringify(win2State.names)}）`);
    win2.destroy();
  });

  h.finish();
})();
