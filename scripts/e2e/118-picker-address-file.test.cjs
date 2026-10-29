/**
 * e2e 118：选择器/保存器地址栏粘贴「完整文件路径」。
 *
 * 修复前：地址栏提交文件路径 → 后端 listDir(文件) 抛 ENOTDIR → 兜底返回
 * 父目录 + error → 选择器一律提示「权限不足」，且不选中文件；
 * 保存器也不会把文件名填进输入框。
 * 现在：先 stat——文件 → 进入父目录并选中（选择器）/ 填文件名（保存器），
 * 保存模式允许目标文件尚不存在；只有 EACCES/EPERM 才提示权限不足。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

/** 打开选择器窗口（mode 可为 file / items / save） */
async function openPickerWin(win, mode, label) {
  await h.js(win, `window.__pickerResult = window.electron.openPicker({ mode: ${JSON.stringify(mode)} }).then((p) => { window.__pickerResult = p; return p; }); true`);
  let picker = null;
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const wins = h.getWindows().filter((w) => w !== win && !w.isDestroyed());
    if (wins.length > 0) { picker = wins[0]; break; }
    await h.sleep(100);
  }
  h.assert.ok(picker, `${label}：应创建选择器窗口`);
  await h.waitFor(picker, `!!document.querySelector('.picker-topbar')`, { timeout: 8000 });
  await h.waitFor(picker, `!!document.querySelector('.file-list-item')`, { timeout: 8000 });
  return picker;
}

/** 地址栏粘贴路径并回车 */
async function pastePath(picker, p) {
  await h.clickEl(picker, '.omnibar-trigger');
  await h.waitFor(picker, `!!document.querySelector('.omnibar.mode-edit .omnibar-input')`, { timeout: 8000 });
  await h.setReactInput(picker, '.omnibar.mode-edit .omnibar-input', p);
  // React 受控输入的回调要等一次渲染才更新 inputValue——立即派发 Enter 会
  // 读到旧值（竞态）。先等一帧再派发。
  await h.sleep(250);
  // 保存器窗口在部分环境对 sendInputEvent 的 Enter 不可靠——直接向输入框
  // 派发合成 keydown（React onKeyDown 可达，与 harness 搜索输入同手法）
  await h.js(picker, `(() => {
    const el = document.querySelector('.omnibar.mode-edit .omnibar-input');
    el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`, true);
  await h.sleep(600);
}

(async () => {
  await h.setupApp();

  await h.run('118 选择器/保存器地址栏粘贴文件路径', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'a', 'b.txt': 'b', 'sub/.keep': '' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // ── 1) 选择器：粘贴文件完整路径 → 进入父目录并选中该文件 ──
    const picker = await openPickerWin(win, 'file', '文件模式');
    const target = path.join(dir, 'b.txt');
    await pastePath(picker, target);

    const after = (await h.js(picker, `(() => ({
      path: document.querySelector('.omnibar-trigger')?.textContent ?? '',
      selected: [...document.querySelectorAll('.file-list-item.selected')].map((e) => e.textContent.trim()),
      names: [...document.querySelectorAll('.file-list-item')].map((e) => e.textContent.trim()),
      permissionToast: (document.body.textContent ?? '').includes('权限不足'),
    }))()`)).value;
    h.assert.ok(after.names.some((n) => n.includes('a.txt')), `应列出父目录内容（实际 ${JSON.stringify(after.names)}）`);
    h.assert.strictEqual(after.selected.length, 1, `应恰好选中 1 个条目（实际 ${JSON.stringify(after.selected)}）`);
    h.assert.ok(after.selected[0].includes('b.txt'), `应选中粘贴的文件 b.txt（实际 ${after.selected[0]}）`);
    h.assert.ok(!after.permissionToast, '不应再提示「权限不足」');
    picker.destroy();

    // ── 2) 粘贴目录路径仍然正常进入目录 ──
    const picker2 = await openPickerWin(win, 'file', '目录模式');
    await pastePath(picker2, path.join(dir, 'sub'));
    const dirState = (await h.js(picker2, `(() => ({
      selected: document.querySelectorAll('.file-list-item.selected').length,
      names: [...document.querySelectorAll('.file-list-item')].map((e) => e.textContent.trim()),
    }))()`)).value;
    h.assert.strictEqual(dirState.selected, 0, '进入目录不应选中条目');
    h.assert.ok(dirState.names.some((n) => n.includes('.keep')), '应进入 sub 目录并列出其内容');
    picker2.destroy();

    // ── 3) 保存器：粘贴尚不存在的完整文件路径 → 父目录 + 文件名填入输入框 ──
    const saver = await openPickerWin(win, 'save', '保存模式');
    const future = path.join(dir, 'new-name.txt');
    await pastePath(saver, future);
    const saveState = (await h.js(saver, `(() => {
      const field = document.querySelector('md-outlined-text-field.picker-filter-select');
      const inner = field?.shadowRoot?.querySelector('input') ?? field?.querySelector('input');
      return {
        value: (field?.value ?? inner?.value ?? ''),
        names: [...document.querySelectorAll('.file-list-item')].map((e) => e.textContent.trim()),
      };
    })()`)).value;
    h.assert.strictEqual(saveState.value, 'new-name.txt', `文件名输入框应填入 new-name.txt（实际 ${saveState.value}）`);
    h.assert.ok(saveState.names.some((n) => n.includes('a.txt')), '保存器应进入父目录');
    saver.destroy();
  });

  h.finish();
})();
