/**
 * e2e 112：侧边栏拖放高亮语义。
 *
 * - 文件/文件夹拖到普通落点（位置/设备）→ 实心边框高亮（移动/复制）；
 * - 文件夹拖到「固定文件夹」按钮 → 虚线边框（固定语义）；
 * - 文件拖到「固定文件夹」按钮 → 不高亮、不接受；
 * - 固定项排序拖拽 → 插入占位虚线高亮。
 *
 * harness 无法做真实 OS 拖拽，这里用合成 DragEvent：文件拖拽经
 * React 的 onFileDragStart 写入 DragContext，文档级 dragover 监听按
 * 坐标 elementFromPoint 命中落点。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('112 侧边栏拖放高亮（实线=移动/复制，虚线=固定）', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, {
      'FolderA/x.txt': 'x',
      'FolderB/y.txt': 'y',
      'plain.txt': 'p',
    });

    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 预置一个固定项（另需第二个固定项测排序占位）
    await h.js(win, `localStorage.setItem('sidebar.pinned', ${JSON.stringify(
      JSON.stringify([
        { name: 'FolderA', path: `${dir}/FolderA`, isDir: true },
        { name: 'FolderB', path: `${dir}/FolderB`, isDir: true },
      ]),
    )}); location.reload(); true`);
    await h.waitFor(win, `document.querySelectorAll('.sidebar-item[draggable="true"]').length === 2`);
    await h.sleep(500);

    const out = await h.js(win, `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const res = {};
      const dragOverAt = (el) => {
        const r = el.getBoundingClientRect();
        document.dispatchEvent(new DragEvent('dragover', {
          bubbles: true, cancelable: true, dataTransfer: new DataTransfer(),
          clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
        }));
      };
      const startFileDrag = async (path) => {
        const row = document.querySelector('.file-list-item[data-path="' + path + '"]');
        const dt = new DataTransfer();
        dt.setData('text/plain', path);
        row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        await sleep(120);
        return dt;
      };
      const endDrag = async () => {
        document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
        await sleep(120);
      };

      // 1) 文件拖到位置条目 → 实线
      await startFileDrag(${JSON.stringify(`${dir}/plain.txt`)});
      const home = [...document.querySelectorAll('.sidebar-page[data-active] .sidebar-item')]
        .find((x) => (x.querySelector('md-icon')?.textContent ?? '') === 'home');
      dragOverAt(home);
      await sleep(120);
      res.fileOnPlace = {
        cls: home.classList.contains('drag-over'),
        outline: getComputedStyle(home).outlineStyle,
      };
      await endDrag();

      // 切到含「固定文件夹」按钮的页（第二页起，第一部分页不含它）
      const pages = [...document.querySelectorAll('.sidebar-page')];
      const pinPageIdx = pages.findIndex((p) => p.querySelector('.sidebar-add-pin'));
      document.querySelectorAll('.sidebar-dot')[pinPageIdx]?.click();
      await sleep(300);

      // 2) 文件拖到「固定文件夹」按钮 → 不高亮
      const addPin = document.querySelector('.sidebar-add-pin');
      await startFileDrag(${JSON.stringify(`${dir}/plain.txt`)});
      dragOverAt(addPin);
      await sleep(120);
      res.fileOnPin = {
        cls: addPin.classList.contains('drag-over'),
        outline: getComputedStyle(addPin).outlineStyle,
      };
      await endDrag();

      // 3) 文件夹拖到「固定文件夹」按钮 → 虚线
      await startFileDrag(${JSON.stringify(`${dir}/FolderA`)});
      dragOverAt(addPin);
      await sleep(120);
      res.folderOnPin = {
        cls: addPin.classList.contains('drag-over'),
        outline: getComputedStyle(addPin).outlineStyle,
      };
      await endDrag();

      // 4) 固定项排序：源拖到另一项下半区 → 插入占位虚线
      const pins = [...document.querySelectorAll('.sidebar-item[draggable="true"]')];
      const src = pins[0];
      const dst = pins[1];
      const dt = new DataTransfer();
      dt.setData('text/plain', 'sidebar:0');
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await sleep(120);
      const dr = dst.getBoundingClientRect();
      dst.dispatchEvent(new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: dr.x + dr.width / 2, clientY: dr.y + dr.height - 4,
      }));
      await sleep(120);
      const gap = document.querySelector('.sidebar-pin-gap');
      res.reorderGap = gap ? getComputedStyle(gap).outlineStyle : 'missing';
      document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      return res;
    })()`);

    const r = out.value;
    h.assert.deepStrictEqual(
      { cls: r.fileOnPlace.cls, outline: r.fileOnPlace.outline },
      { cls: true, outline: 'solid' },
      `文件拖到位置条目应为实线高亮（实际 ${JSON.stringify(r.fileOnPlace)}）`,
    );
    h.assert.strictEqual(r.fileOnPin.cls, false, '文件拖到「固定文件夹」不应高亮');
    h.assert.deepStrictEqual(
      { cls: r.folderOnPin.cls, outline: r.folderOnPin.outline },
      { cls: true, outline: 'dashed' },
      `文件夹拖到「固定文件夹」应为虚线高亮（实际 ${JSON.stringify(r.folderOnPin)}）`,
    );
    h.assert.strictEqual(r.reorderGap, 'dashed', `排序插入占位应为虚线（实际 ${r.reorderGap}）`);
  });

  h.finish();
})();
