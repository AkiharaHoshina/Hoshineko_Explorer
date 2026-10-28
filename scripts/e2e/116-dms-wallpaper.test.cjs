/**
 * e2e 116：DMS2 壁纸探测（`theme:find-wallpaper`）。
 *
 * DMS2 把壁纸存到 `$XDG_STATE_HOME/dms/session.json`（不再是 settings.json），
 * 字段：wallpaperPath / perModeWallpaper+wallpaperPathLight|Dark /
 * perMonitorWallpaper+monitorWallpapers。本用例通过临时 XDG 目录伪造状态，
 * 覆盖：共享壁纸、纯色壁纸跳过、明暗分套、无扩展名图片（魔数嗅探）、
 * 每屏壁纸（失效路径跳过）。
 *
 * 注意：主题 handler 在调用时读取 XDG_STATE_HOME/XDG_CONFIG_HOME，
 * 因此可以在进程内改 process.env 后直接调用 IPC。
 */
const h = require('./harness.cjs');
const fs = require('fs');
const path = require('path');

/** 最小 PNG 头（isImageFile 的魔数嗅探只需前 16 字节） */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);

(async () => {
  await h.setupApp();

  await h.run('116 DMS2 壁纸探测（session.json）', async () => {
    const base = h.tempDir();
    const stateDms = path.join(base, 'state', 'dms');
    const configDms = path.join(base, 'config', 'dms');
    fs.mkdirSync(stateDms, { recursive: true });
    fs.mkdirSync(configDms, { recursive: true });

    // DMS 配置文件存在与否会影响「DMS 明暗来源」判定，放一份最小 settings.json
    fs.writeFileSync(path.join(configDms, 'settings.json'),
      JSON.stringify({ matugenScheme: 'scheme-tonal-spot', configVersion: 2 }));

    const imgA = path.join(base, 'a.png');
    const imgB = path.join(base, 'b.jpg');
    const imgNoExt = path.join(base, 'wallpaper-noext');
    fs.writeFileSync(imgA, 'png');
    fs.writeFileSync(imgB, 'jpg');
    fs.writeFileSync(imgNoExt, PNG_MAGIC);

    const sessionPath = path.join(stateDms, 'session.json');
    const writeSession = (obj) => fs.writeFileSync(sessionPath, JSON.stringify(obj));

    const prevState = process.env.XDG_STATE_HOME;
    const prevConfig = process.env.XDG_CONFIG_HOME;
    process.env.XDG_STATE_HOME = path.join(base, 'state');
    process.env.XDG_CONFIG_HOME = path.join(base, 'config');

    try {
      const dir = h.tempDir();
      h.makeFileTree(dir, { 'x.txt': 'x' });
      const win = await h.createTestWindow({ argv: ['electron', dir] });
      await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

      const find = async () => (await h.js(win, `window.electron.findWallpaper()`)).value;

      // ── 1) 共享壁纸 ──
      writeSession({ wallpaperPath: imgA, configVersion: 7 });
      h.assert.strictEqual(await find(), imgA, '应读取 session.json 的 wallpaperPath');

      // ── 2) 纯色壁纸不是图片：不得把 #RRGGBB 当路径返回 ──
      writeSession({ wallpaperPath: '#123456', configVersion: 7 });
      const colorResult = await find();
      h.assert.notStrictEqual(colorResult, '#123456', '纯色壁纸不应作为路径返回');

      // ── 3) 明暗分套（明暗两套指向同一图，避免依赖当前模式） ──
      writeSession({
        wallpaperPath: '',
        perModeWallpaper: true,
        wallpaperPathLight: imgA,
        wallpaperPathDark: imgA,
        configVersion: 7,
      });
      h.assert.strictEqual(await find(), imgA, 'perModeWallpaper 应走 Light/Dark 路径');

      // ── 4) 无扩展名图片：按文件头魔数接受 ──
      writeSession({ wallpaperPath: imgNoExt, configVersion: 7 });
      h.assert.strictEqual(await find(), imgNoExt, '无扩展名的图片应按魔数识别');

      // ── 5) 每屏壁纸：失效路径跳过，回退到有效的表项 ──
      writeSession({
        wallpaperPath: '',
        perMonitorWallpaper: true,
        monitorWallpapers: { 'DP-1': path.join(base, 'missing.png'), 'eDP-1': imgB },
        configVersion: 7,
      });
      const monitorResult = await find();
      h.assert.strictEqual(monitorResult, imgB, 'perMonitorWallpaper 应跳过失效路径并回退到有效表项');

      // ── 6) 文件不存在 / 值非法：不能返回不存在的路径 ──
      writeSession({ wallpaperPath: path.join(base, 'does-not-exist.jpg'), configVersion: 7 });
      const bogus = await find();
      h.assert.notStrictEqual(bogus, path.join(base, 'does-not-exist.jpg'), '不存在的路径不应被返回');

      win.destroy();
    } finally {
      if (prevState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = prevState;
      if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prevConfig;
    }
  });

  h.finish();
})();
