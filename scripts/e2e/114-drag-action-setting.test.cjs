/**
 * e2e 114：设置「拖拽文件行为」（设置 → 文件 → 行为）。
 *
 * - `copy`：应用内拖到文件夹 → 不弹「移动/复制」询问，直接复制（源保留）；
 * - `move`：同上，直接移动（源消失）；
 * - `ask`（默认）：弹询问对话框；
 * - 设置持久化（localStorage `settings.dragFileAction`）。
 *
 * harness 无真实 OS 拖拽：用合成 DragEvent（dragstart 写 DragContext，
 * 再向文件区 `[data-drop-target="filelist"]` 派发 drop，坐标落在目标文件夹行）。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('114 拖拽文件行为设置（复制 / 移动 / 每次询问）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'FolderA/.keep': '',
      'plain.txt': 'p',
      'move-me.txt': 'm',
      'other.txt': 'o',
    });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    /** 设置值并重载（设置经 useLocalStorage 持久化） */
    const setAction = async (value) => {
      await h.js(
        win,
        // useLocalStorage 以 JSON 存储：字符串值需再 stringify 一层（双层）
        `localStorage.setItem('settings.dragFileAction', ${JSON.stringify(JSON.stringify(value))}); location.reload(); true`,
      );
      await h.waitFor(win, `!!document.querySelector('.file-list-item')`, { timeout: 8000 });
      await h.sleep(400);
    };

    /**
     * 把文件拖到文件夹行，返回对话框是否出现。
     *
     * 走应用真实的 Wayland 兜底路径：dragstart 后持续在目标行上派发
     * dragover（≥ HOVER_MS，光标静止），随后静默 ≥ 400ms 由
     * nativeDragTracker 合成 drop（真实原生拖拽无法在 harness 里发起）。
     */
    const dragToFolder = async (fileName, folderName) => {
      const filePath = path.join(dir, fileName);
      const out = await h.js(
        win,
        `(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const row = document.querySelector('.file-list-item[data-path=' + JSON.stringify(${JSON.stringify(filePath)}) + ']');
          if (!row) return { error: 'source row missing' };
          const dt = new DataTransfer();
          dt.setData('text/plain', ${JSON.stringify(filePath)});
          row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
          await sleep(60);
          const target = [...document.querySelectorAll('.file-list-item')]
            .find((el) => (el.dataset.path || '').endsWith('/' + ${JSON.stringify(folderName)}));
          if (!target) return { error: 'target row missing' };
          const r = target.getBoundingClientRect();
          const x = r.x + r.width / 2;
          const y = r.y + r.height / 2;
          for (let i = 0; i < 5; i++) {
            document.dispatchEvent(new DragEvent('dragover', {
              bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y,
            }));
            await sleep(40);
          }
          // 等 tracker 静默兜底合成 drop + 设置/任务处理
          await sleep(900);
          return { dialogs: document.querySelectorAll('md-dialog[open]').length };
        })()`,
      );
      return out.value;
    };

    const exists = (rel) => fs.existsSync(path.join(dir, rel));

    // ── 1) copy：不弹窗，直接复制（源保留） ──
    await setAction('copy');
    const rCopy = await dragToFolder('plain.txt', 'FolderA');
    h.assert.ok(!rCopy.error, `copy 场景拖放失败：${JSON.stringify(rCopy)}`);
    h.assert.strictEqual(rCopy.dialogs, 0, 'copy 设置下不应弹「移动/复制」询问');
    for (let i = 0; i < 40 && !exists('FolderA/plain.txt'); i++) await h.sleep(100);
    h.assert.ok(exists('FolderA/plain.txt'), 'copy 设置下应复制到目标文件夹');
    h.assert.ok(exists('plain.txt'), 'copy 后源文件应保留');

    // ── 2) move：不弹窗，直接移动（源消失） ──
    await setAction('move');
    const rMove = await dragToFolder('move-me.txt', 'FolderA');
    h.assert.ok(!rMove.error, `move 场景拖放失败：${JSON.stringify(rMove)}`);
    h.assert.strictEqual(rMove.dialogs, 0, 'move 设置下不应弹「移动/复制」询问');
    for (let i = 0; i < 40 && !exists('FolderA/move-me.txt'); i++) await h.sleep(100);
    h.assert.ok(exists('FolderA/move-me.txt'), 'move 设置下应移动到目标文件夹');
    h.assert.ok(!exists('move-me.txt'), 'move 后源文件应消失');

    // ── 3) ask（默认）：弹询问对话框 ──
    await setAction('ask');
    const rAsk = await dragToFolder('other.txt', 'FolderA');
    h.assert.ok(!rAsk.error, `ask 场景拖放失败：${JSON.stringify(rAsk)}`);
    h.assert.ok(rAsk.dialogs > 0, 'ask 设置下应弹出「移动/复制」询问对话框');
    // 关闭对话框（Esc 或取消按钮），避免影响后续
    await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await h.sleep(300);

    // ── 4) 设置页 UI：文件 → 行为 分区里的下拉选择行 ──
    await h.openSettingsPage(win, /文件|Files/i);
    await h.waitFor(win, `!!document.querySelector('[data-settings-row="files-drag-action"]')`, { timeout: 8000 });
    const rowInfo = (await h.js(win, `(() => {
      const row = document.querySelector('[data-settings-row="files-drag-action"]');
      const sel = row && row.querySelector('md-outlined-select');
      return {
        hasSelect: !!sel,
        value: sel ? sel.value : null,
        options: sel ? [...sel.querySelectorAll('md-select-option')].map((o) => o.value) : [],
      };
    })()`)).value;
    h.assert.ok(rowInfo.hasSelect, '「拖拽文件行为」行应渲染 md-outlined-select');
    h.assert.strictEqual(rowInfo.value, 'ask', '设置页下拉应反映当前值（每次询问）');
    h.assert.deepStrictEqual(rowInfo.options, ['ask', 'copy', 'move'], '下拉应有三项：每次询问 / 复制 / 移动');
  });

  h.finish();
})();
