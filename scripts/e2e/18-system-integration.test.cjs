/**
 * e2e 18：系统集成一键安装/卸载（用户级部分 + 状态检测 + 脚本形态校验）。
 * - 状态 IPC 返回完整字段；
 * - 脚本可执行、--user-only 幂等（沙箱 HOME + 临时 packaging 目录，
 *   不触碰真实 /usr 与用户真实 portals.conf）；
 * - 用户级输出：portals.conf preferred 项写入 / 卸载时移除；
 * - 桌面专属 `<desktop>-portals.conf` 优先于通用文件（niri 场景）。
 * root 级（pkexec）不在 e2e 内执行（需交互授权）。
 */
const h = require('./harness.cjs');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  await h.setupApp();

  await h.run('18 系统集成一键安装/卸载（用户级 + 状态）', async () => {
    // 沙箱环境禁止真实 kill：install/uninstall 会 pkill 会话中真实的
    // 常驻服务（--portal/--filemanager1），测试必须经环境变量跳过
    // （输出仍包含清理标记行，可断言该代码路径被执行）
    const prevSkipKill = process.env.HOSHINEKO_SKIP_SERVICE_KILL;
    process.env.HOSHINEKO_SKIP_SERVICE_KILL = '1';
    const dir = h.tempDir();
    h.makeFileTree(dir, { 'a.txt': 'x' });
    const win = await h.createTestWindow({ argv: ['electron', dir] });
    await h.waitFor(win, `!!document.querySelector('.file-list-item')`);

    // 状态 IPC：字段完整且为布尔
    const status = await h.js(win, `window.electron.getSystemIntegrationStatus()`);
    h.assert.ok(status.ok, '应能查询系统集成状态');
    for (const key of ['portalConfig', 'fileManager1Service', 'portalService', 'portalsConf']) {
      h.assert.strictEqual(typeof status.value[key], 'boolean', `状态字段 ${key} 应为布尔`);
    }

    // 卸载 IPC 已暴露（preload）
    const uninstallApi = await h.js(win, `typeof window.electron.uninstallSystemIntegration`);
    h.assert.strictEqual(uninstallApi.value, 'function', 'preload 应暴露 uninstallSystemIntegration');

    // 脚本存在且可执行
    const scriptPath = path.join(h.ROOT, 'scripts', 'system-integration', 'install.sh');
    const uninstallPath = path.join(h.ROOT, 'scripts', 'system-integration', 'uninstall.sh');
    h.assert.ok(fs.existsSync(scriptPath), 'install.sh 应存在');
    h.assert.ok(fs.existsSync(uninstallPath), 'uninstall.sh 应存在');
    fs.accessSync(scriptPath, fs.constants.X_OK);
    fs.accessSync(uninstallPath, fs.constants.X_OK);

    // --user-only 幂等运行：沙箱 HOME + 临时 packaging 目录
    const fakeHome = h.tempDir('hoshineko-e2e-home-');
    const fakePkg = h.tempDir('hoshineko-e2e-pkg-');
    // 沙箱化二进制来源：不依赖开发机上是否真的装过系统集成
    // （/usr/local/bin/HoshinekoFM 可能已被用户卸载）
    const sandboxAppImage = path.join(h.tempDir('hoshineko-e2e-app-'), 'HoshinekoFM');
    fs.writeFileSync(sandboxAppImage, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(sandboxAppImage, 0o755);
    const sandboxNoSystemBin = path.join(fakeHome, 'no-system-bin');
    const run = (script, extraEnv = {}) =>
      spawnSync(script, ['--user-only'], {
        env: {
          ...process.env,
          HOME: fakeHome,
          XDG_CURRENT_DESKTOP: 'niri',
          HOSHINEKO_PACKAGING_DIR: fakePkg,
          APPIMAGE: sandboxAppImage,
          HOSHINEKO_SYSTEM_BIN: sandboxNoSystemBin,
          ...extraEnv,
        },
        encoding: 'utf-8',
      });

    const r1 = run(scriptPath);
    h.assert.strictEqual(r1.status, 0, `首次运行应成功：${r1.stderr}`);
    const confPath = path.join(fakeHome, '.config', 'xdg-desktop-portal', 'portals.conf');
    h.assert.ok(fs.existsSync(confPath), 'portals.conf 应已写入');
    const conf1 = fs.readFileSync(confPath, 'utf-8');
    h.assert.ok(conf1.includes('org.freedesktop.impl.portal.FileChooser=hoshineko'), '应包含 preferred 项');
    h.assert.ok(
      r1.stdout.includes('[user] 清理旧 portal/FileManager1 常驻进程'),
      '安装应执行旧常驻进程清理路径',
    );
    h.assert.ok(
      r1.stdout.includes('HOSHINEKO_SKIP_SERVICE_KILL 已设置'),
      '沙箱环境应跳过真实 kill',
    );

    // GTK 应用走门户：安装写入 environment.d 的 GTK_USE_PORTAL=1
    const envConf = path.join(fakeHome, '.config', 'environment.d', '60-hoshineko-portal.conf');
    h.assert.ok(fs.existsSync(envConf), '应写入 environment.d/60-hoshineko-portal.conf');
    h.assert.ok(
      /^GTK_USE_PORTAL=1$/m.test(fs.readFileSync(envConf, 'utf-8')),
      'environment.d 应包含 GTK_USE_PORTAL=1',
    );

    // 用户级 FileManager1 激活文件（优先于 /usr/share 同名文件）
    const userFm1 = path.join(
      fakeHome, '.local', 'share', 'dbus-1', 'services', 'org.freedesktop.FileManager1.service',
    );
    h.assert.ok(fs.existsSync(userFm1), '应写入用户级 FileManager1 激活文件');
    const fm1Content = fs.readFileSync(userFm1, 'utf-8');
    h.assert.ok(/Name=org\.freedesktop\.FileManager1/m.test(fm1Content), 'FileManager1 名应正确');
    h.assert.ok(/--filemanager1/.test(fm1Content), 'Exec 应带 --filemanager1');

    // 原子安装：二进制相同则跳过重写（直接截断原 inode 会让运行中的
    // AppImage 进程 / portal 后端 SIGBUS —— v3.0.1009 修复）
    const atomHome = h.tempDir('hoshineko-e2e-atomic-');
    const atomApp = path.join(h.tempDir('hoshineko-e2e-atomic-app-'), 'HoshinekoFM');
    fs.writeFileSync(atomApp, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(atomApp, 0o755);
    const atomEnv = {
      HOME: atomHome,
      APPIMAGE: atomApp,
      HOSHINEKO_SYSTEM_BIN: path.join(atomHome, 'no-such-bin'),
    };
    h.assert.strictEqual(run(scriptPath, atomEnv).status, 0, '原子安装首次运行应成功');
    const atomUserBin = path.join(atomHome, '.local', 'bin', 'HoshinekoFM');
    const ino1 = fs.statSync(atomUserBin).ino;
    h.assert.strictEqual(run(scriptPath, atomEnv).status, 0, '原子安装二次运行应成功');
    h.assert.strictEqual(
      fs.statSync(atomUserBin).ino,
      ino1,
      '二进制相同应跳过重写（inode 不变，避免截断运行中进程触发 SIGBUS）',
    );

    // 幂等：二次运行不重复追加
    const r2 = run(scriptPath);
    h.assert.strictEqual(r2.status, 0);
    const conf2 = fs.readFileSync(confPath, 'utf-8');
    h.assert.strictEqual((conf2.match(/FileChooser=hoshineko/g) || []).length, 1, 'preferred 项不应重复');

    // 卸载：preferred 项移除、文件无剩余内容时删除
    const u1 = run(uninstallPath);
    h.assert.strictEqual(u1.status, 0, `卸载应成功：${u1.stderr}`);
    h.assert.strictEqual(fs.existsSync(confPath), false, 'portals.conf 无剩余内容应删除');
    h.assert.strictEqual(fs.existsSync(envConf), false, '卸载应删除安装时新建的 environment.d 配置');
    h.assert.strictEqual(fs.existsSync(userFm1), false, '卸载应删除用户级 FileManager1 激活文件');
    h.assert.ok(
      u1.stdout.includes('[user] 清理 portal/FileManager1 常驻进程'),
      '卸载应执行常驻进程清理路径',
    );

    // 卸载幂等：再次卸载仍成功
    const u2 = run(uninstallPath);
    h.assert.strictEqual(u2.status, 0, `二次卸载应幂等成功：${u2.stderr}`);

    // 卸载不误删其他 portal 配置：混入其他 preferred 项后只移除 hoshineko 行
    fs.mkdirSync(path.dirname(confPath), { recursive: true });
    fs.writeFileSync(
      confPath,
      '[preferred]\norg.freedesktop.impl.portal.FileChooser=hoshineko\norg.freedesktop.impl.portal.OpenURI=gtk\n',
    );
    const u3 = run(uninstallPath);
    h.assert.strictEqual(u3.status, 0);
    const conf3 = fs.readFileSync(confPath, 'utf-8');
    h.assert.ok(!conf3.includes('hoshineko'), 'hoshineko 项应移除');
    h.assert.ok(conf3.includes('OpenURI=gtk'), '其他 portal 项应保留');

    // 桌面专属配置优先：niri-portals.conf 存在时安装必须改它，
    // 否则只写通用 portals.conf 会被 xdg-desktop-portal 忽略。
    const desktopConf = path.join(fakeHome, '.config', 'xdg-desktop-portal', 'niri-portals.conf');
    fs.writeFileSync(desktopConf, '[preferred]\ndefault=gtk\n');
    const r4 = run(scriptPath);
    h.assert.strictEqual(r4.status, 0, `桌面配置场景安装应成功：${r4.stderr}`);
    const desktopInstalled = fs.readFileSync(desktopConf, 'utf-8');
    h.assert.ok(
      desktopInstalled.includes('org.freedesktop.impl.portal.FileChooser=hoshineko'),
      'niri-portals.conf 应写入 preferred 项',
    );
    h.assert.ok(desktopInstalled.includes('default=gtk'), '桌面配置原有键应保留');
    h.assert.strictEqual(
      (desktopInstalled.match(/FileChooser=hoshineko/g) || []).length,
      1,
      '桌面配置 preferred 项不应重复',
    );
    const u4 = run(uninstallPath);
    h.assert.strictEqual(u4.status, 0);
    const desktopUninstalled = fs.readFileSync(desktopConf, 'utf-8');
    h.assert.ok(!desktopUninstalled.includes('hoshineko'), '卸载应移除桌面配置中的 preferred 项');
    h.assert.ok(desktopUninstalled.includes('default=gtk'), '卸载应保留桌面配置其他键');
    h.assert.ok(fs.existsSync(desktopConf), '有剩余内容的桌面配置不应删除');

    // 只有系统级桌面配置（用户级不存在）：应生成用户级副本并写入，
    // 否则系统 `<desktop>-portals.conf` 会遮蔽通用 portals.conf。
    const freshHome = h.tempDir('hoshineko-e2e-fresh-home-');
    const fakeData = h.tempDir('hoshineko-e2e-data-');
    const systemDeskDir = path.join(fakeData, 'xdg-desktop-portal');
    fs.mkdirSync(systemDeskDir, { recursive: true });
    fs.writeFileSync(
      path.join(systemDeskDir, 'niri-portals.conf'),
      '[preferred]\ndefault=testdesk;gtk;\n',
    );
    const freshEnv = {
      HOME: freshHome,
      XDG_DATA_DIRS: fakeData,
      XDG_CONFIG_DIRS: path.join(fakeData, 'no-user-config'),
    };
    const r5 = run(scriptPath, freshEnv);
    h.assert.strictEqual(r5.status, 0, `系统级桌面配置场景安装应成功：${r5.stderr}`);
    const freshDesktopConf = path.join(
      freshHome, '.config', 'xdg-desktop-portal', 'niri-portals.conf',
    );
    h.assert.ok(fs.existsSync(freshDesktopConf), '应生成用户级 niri-portals.conf');
    const freshDesktopContent = fs.readFileSync(freshDesktopConf, 'utf-8');
    h.assert.ok(
      freshDesktopContent.includes('org.freedesktop.impl.portal.FileChooser=hoshineko'),
      '生成的桌面配置应写入 preferred 项',
    );
    h.assert.ok(freshDesktopContent.includes('default=testdesk'), '应保留系统桌面配置默认值');
    const createdList = path.join(
      freshHome, '.config', 'xdg-desktop-portal', '.hoshineko-portals-created',
    );
    h.assert.ok(fs.existsSync(createdList), '应记录新建配置用于卸载');

    const u5 = run(uninstallPath, freshEnv);
    h.assert.strictEqual(u5.status, 0);
    h.assert.strictEqual(
      fs.existsSync(freshDesktopConf), false,
      '卸载应删除安装时新建的桌面配置副本',
    );
    h.assert.strictEqual(fs.existsSync(createdList), false, '卸载应删除新建配置清单');

    // 重装脚本同时 source install/uninstall：两者同名函数不得互相覆盖。
    // 仅系统级桌面配置时，reinstall 的安装阶段也必须生成用户级副本。
    const reinstallPath = path.join(h.ROOT, 'scripts', 'system-integration', 'reinstall.sh');
    const reinstallHome = h.tempDir('hoshineko-e2e-reinstall-home-');
    const r6 = spawnSync(reinstallPath, ['--user-only'], {
      env: {
        ...process.env,
        HOME: reinstallHome,
        XDG_CURRENT_DESKTOP: 'niri',
        XDG_DATA_DIRS: fakeData,
        XDG_CONFIG_DIRS: path.join(fakeData, 'no-user-config'),
        HOSHINEKO_PACKAGING_DIR: fakePkg,
        HOSHINEKO_SKIP_SERVICE_KILL: '1',
      },
      encoding: 'utf-8',
    });
    h.assert.strictEqual(r6.status, 0, `重装应成功：${r6.stderr}`);
    const reinstallDesktopConf = path.join(
      reinstallHome, '.config', 'xdg-desktop-portal', 'niri-portals.conf',
    );
    h.assert.ok(
      fs.existsSync(reinstallDesktopConf),
      '重装应生成用户级 niri-portals.conf（source 函数不得被卸载版覆盖）',
    );
    h.assert.ok(
      fs.readFileSync(reinstallDesktopConf, 'utf-8').includes('FileChooser=hoshineko'),
      '重装生成的桌面配置应包含 preferred 项',
    );

    // 未触碰真实 /usr（root 级未执行）
    h.assert.strictEqual(r1.stdout.includes('[root]'), false, '--user-only 不应执行 root 级');
    h.assert.strictEqual(u1.stdout.includes('[root]'), false, '卸载 --user-only 不应执行 root 级');

    // 完整模式 + 假 pkexec、无 APPIMAGE：EXIT trap 不得把成功安装变失败
    // （回归：stage 为空时旧写法 trap 返回 1 → 安装成功却报「安装失败」）。
    // HOSHINEKO_SYSTEM_BIN 指向沙箱不存在的路径（本机 /usr/local/bin 可能
    // 已有真副本，避免无 APPIMAGE 时回退复制影响后续用例）
    const fakePkexecDir = h.tempDir('hoshineko-e2e-fakepk-');
    const fakePkexec = path.join(fakePkexecDir, 'pkexec');
    fs.writeFileSync(fakePkexec, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(fakePkexec, 0o755);
    const noSystemBin = path.join(fakePkg, 'no-such-system-bin');
    const fullModeHome = h.tempDir('hoshineko-e2e-fullmode-home-');
    const rFull = spawnSync(scriptPath, [], {
      env: {
        ...process.env,
        HOME: fullModeHome,
        HOSHINEKO_PACKAGING_DIR: fakePkg,
        HOSHINEKO_SYSTEM_BIN: noSystemBin,
        PATH: fakePkexecDir + path.delimiter + process.env.PATH,
      },
      encoding: 'utf-8',
    });
    h.assert.strictEqual(
      rFull.status,
      0,
      `完整模式（假 pkexec、无 APPIMAGE）应成功退出：${rFull.stdout}${rFull.stderr}`,
    );

    // APPIMAGE 指向不存在的文件且无任何可用副本（应用从已删除副本运行的
    // 降级态）：应在弹提权之前明确报错（避免输完密码才发现装不了二进制）
    const noSrcHome = h.tempDir('hoshineko-e2e-nosrc-home-');
    const rNoSrc = spawnSync(scriptPath, [], {
      env: {
        ...process.env,
        HOME: noSrcHome,
        HOSHINEKO_PACKAGING_DIR: fakePkg,
        HOSHINEKO_SYSTEM_BIN: noSystemBin,
        PATH: fakePkexecDir + path.delimiter + process.env.PATH,
        APPIMAGE: '/nonexistent/Deleted.AppImage',
      },
      encoding: 'utf-8',
    });
    h.assert.notStrictEqual(rNoSrc.status, 0, 'APPIMAGE 失效且无副本时应失败');
    h.assert.ok(
      (rNoSrc.stdout + rNoSrc.stderr).includes('[error] APPIMAGE 指向的文件不存在'),
      '失败应给出明确原因（从原始 AppImage 重启后重试）',
    );

    // APPIMAGE 失效但用户级副本存在：回退到该副本暂存，安装应成功
    const degradedHome = h.tempDir('hoshineko-e2e-degraded-home-');
    const degradedBin = path.join(degradedHome, '.local', 'bin', 'HoshinekoFM');
    fs.mkdirSync(path.dirname(degradedBin), { recursive: true });
    fs.writeFileSync(degradedBin, 'degraded copy');
    const rFallback = spawnSync(scriptPath, [], {
      env: {
        ...process.env,
        HOME: degradedHome,
        HOSHINEKO_PACKAGING_DIR: fakePkg,
        HOSHINEKO_SYSTEM_BIN: noSystemBin,
        PATH: fakePkexecDir + path.delimiter + process.env.PATH,
        APPIMAGE: '/nonexistent/Deleted.AppImage',
      },
      encoding: 'utf-8',
    });
    h.assert.strictEqual(rFallback.status, 0, `回退到用户级副本应成功：${rFallback.stdout}${rFallback.stderr}`);

    // 用户级固定副本 + 桌面入口 Exec 统一（AppImage 场景，用伪 APPIMAGE 文件模拟）
    const fakeApp = path.join(fakePkg, 'fake.AppImage');
    fs.writeFileSync(fakeApp, 'fake appimage content');
    const fakeDesktop = path.join(fakeHome, '.local', 'share', 'applications', 'HoshinekoFM.desktop');
    fs.mkdirSync(path.dirname(fakeDesktop), { recursive: true });
    fs.writeFileSync(fakeDesktop, '[Desktop Entry]\nExec="/old/path.AppImage" %U\n');
    const runAsApp = (script) =>
      spawnSync(script, ['--user-only'], {
        env: { ...process.env, HOME: fakeHome, HOSHINEKO_PACKAGING_DIR: fakePkg, APPIMAGE: fakeApp },
        encoding: 'utf-8',
      });

    const a1 = runAsApp(scriptPath);
    h.assert.strictEqual(a1.status, 0, `带 APPIMAGE 的安装应成功：${a1.stderr}`);
    const userBin = path.join(fakeHome, '.local', 'bin', 'HoshinekoFM');
    h.assert.ok(fs.existsSync(userBin), '应创建用户级固定副本 ~/.local/bin/HoshinekoFM');
    h.assert.strictEqual(
      fs.readFileSync(userBin, 'utf-8'),
      'fake appimage content',
      '固定副本内容应与 APPIMAGE 一致',
    );
    const desktopAfterInstall = fs.readFileSync(fakeDesktop, 'utf-8');
    h.assert.ok(
      /^Exec=.*\/bin\/HoshinekoFM %U$/m.test(desktopAfterInstall),
      `桌面入口 Exec 应统一到固定路径（简单路径裸写不带引号——引号会破坏 xdg-utils 解析）：${desktopAfterInstall}`,
    );

    // 幂等：再次安装不重复复制（内容一致跳过）
    const a2 = runAsApp(scriptPath);
    h.assert.strictEqual(a2.status, 0);

    // 卸载：桌面入口 Exec 恢复为 APPIMAGE 路径；非 AppImage 形态的伪文件不删除（魔数保护）
    const b1 = runAsApp(uninstallPath);
    h.assert.strictEqual(b1.status, 0, `带 APPIMAGE 的卸载应成功：${b1.stderr}`);
    const desktopAfterUninstall = fs.readFileSync(fakeDesktop, 'utf-8');
    h.assert.ok(
      desktopAfterUninstall.includes(`Exec=${fakeApp} %U`),
      `桌面入口 Exec 应恢复为 APPIMAGE 路径（简单路径裸写不带引号）：${desktopAfterUninstall}`,
    );
    h.assert.ok(fs.existsSync(userBin), '非 AppImage 形态（无魔数）的固定副本不应被误删');

    // AppImage 魔数识别：带 "AI" 魔数的副本应被卸载移除
    fs.writeFileSync(userBin, Buffer.concat([Buffer.alloc(8), Buffer.from('AI'), Buffer.from('rest')]));
    const b2 = runAsApp(uninstallPath);
    h.assert.strictEqual(b2.status, 0);
    h.assert.strictEqual(fs.existsSync(userBin), false, 'AppImage 形态的固定副本应被卸载移除');

    // IPC 用户级安装/卸载（不弹 pkexec）：沙箱 HOME，验证
    // IPC → 临时目录复制 → 脚本执行 → 临时目录清理 完整链路
    const fakeHome2 = h.tempDir('hoshineko-e2e-ipc-home-');
    const prevHome = process.env.HOME;
    const countLeaked = () =>
      fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('hoshineko-integration-')).length;
    const leakedBefore = countLeaked();
    process.env.HOME = fakeHome2;
    try {
      const inst = await h.js(win, `window.electron.installSystemIntegration(true)`);
      h.assert.ok(inst.ok, '安装 IPC 应可调用');
      h.assert.strictEqual(inst.value.success, true, `IPC 用户级安装应成功：${JSON.stringify(inst.value)}`);
      const ipcConf = path.join(fakeHome2, '.config', 'xdg-desktop-portal', 'portals.conf');
      h.assert.ok(fs.existsSync(ipcConf), 'IPC 安装应写入沙箱 portals.conf');
      const un = await h.js(win, `window.electron.uninstallSystemIntegration(true)`);
      h.assert.strictEqual(un.value.success, true, `IPC 用户级卸载应成功：${JSON.stringify(un.value)}`);
      h.assert.strictEqual(fs.existsSync(ipcConf), false, 'IPC 卸载应移除沙箱 portals.conf');
    } finally {
      process.env.HOME = prevHome;
    }
    h.assert.strictEqual(countLeaked(), leakedBefore, '执行后不应残留 hoshineko-integration-* 临时目录');
    if (prevSkipKill === undefined) delete process.env.HOSHINEKO_SKIP_SERVICE_KILL;
    else process.env.HOSHINEKO_SKIP_SERVICE_KILL = prevSkipKill;
  });

  h.finish();
})();
