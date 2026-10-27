/**
 * e2e 110：标签栏滚轮横向滚动。
 *
 * 横向滚动条已隐藏（Chrome 风格选中页底部需要无缝衔接），溢出标签
 * 改由滚轮查看：纵向滚轮映射为横向滚动、触控板 deltaX 直接生效。
 * 用例通过合成 WheelEvent 验证（真实滚轮在软件渲染下不可注入）。
 */
const h = require('./harness.cjs');

(async () => {
  await h.setupApp();

  await h.run('110 标签栏滚轮横向滚动', async () => {
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 造足够多的标签，保证标签栏溢出（min-width 120px × 16）
    for (let i = 2; i <= 16; i++) {
      await h.hotkey(win, 'T', ['control']);
      await h.waitFor(win, `document.querySelectorAll('.tab-item').length === ${i}`, { timeout: 4000 });
    }
    await h.sleep(300);

    const overflow = await h.js(win, `(() => {
      const b = document.querySelector('.tab-bar');
      return { max: b.scrollWidth - b.clientWidth, left: b.scrollLeft };
    })()`);
    h.assert.ok(overflow.value.max > 0, `标签栏应溢出，实际 max=${overflow.value.max}`);
    h.assert.strictEqual(overflow.value.left, 0, '初始应停在最左');

    // 纵向滚轮向下 → 横向右移
    const down = await h.js(win, `(() => {
      const b = document.querySelector('.tab-bar');
      const e = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
      b.dispatchEvent(e);
      return { left: b.scrollLeft, prevented: e.defaultPrevented };
    })()`);
    h.assert.strictEqual(down.value.left, 120, '滚轮向下应右移 120px');
    h.assert.strictEqual(down.value.prevented, true, '滚轮应被消费，避免外层滚动');

    // 纵向滚轮向上 → 横向左移
    const up = await h.js(win, `(() => {
      const b = document.querySelector('.tab-bar');
      b.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, bubbles: true, cancelable: true }));
      return b.scrollLeft;
    })()`);
    h.assert.strictEqual(up.value, 60, '滚轮向上应左移 60px');

    // 触控板横向 deltaX 直接生效
    const horiz = await h.js(win, `(() => {
      const b = document.querySelector('.tab-bar');
      b.scrollLeft = 0;
      b.dispatchEvent(new WheelEvent('wheel', { deltaX: 90, deltaY: 0, bubbles: true, cancelable: true }));
      return b.scrollLeft;
    })()`);
    h.assert.strictEqual(horiz.value, 90, 'deltaX 应直接横向滚动');

    // 边界钳制：滚动量超过上限时停在 max
    const clamp = await h.js(win, `(() => {
      const b = document.querySelector('.tab-bar');
      const max = b.scrollWidth - b.clientWidth;
      b.dispatchEvent(new WheelEvent('wheel', { deltaY: max + 500, bubbles: true, cancelable: true }));
      return { left: b.scrollLeft, max };
    })()`);
    // scrollLeft 可能因缩放返回小数，容差 1px
    h.assert.ok(Math.abs(clamp.value.left - clamp.value.max) < 1, `滚动应钳制在最大位置，实际 ${clamp.value.left} / ${clamp.value.max}`);
  });

  h.finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
