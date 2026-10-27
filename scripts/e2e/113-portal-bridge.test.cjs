/**
 * e2e 113：portal 名字持有桥（packaging/portal/portal-bridge.cjs）。
 *
 * 桥的存在原因见 AGENTS.md「启动期环」：对外总线名必须由**不启动 Chromium**
 * 的进程持有，否则冷激活时 Chromium 启动期的门户查询会把注册卡 25s。
 *
 * 本用例验证三件事（不需要真实 portal，私有会话总线由 harness 所在会话提供，
 * 但用随机总线名隔离，绝不碰真实常驻）：
 * 1. 桥能抢到名字并导出 FileChooser；
 * 2. 调用被原样转发给「选择器后端」并把回包带回（用 gdbus 作独立客户端，
 *    避免与被测进程共用同一条 dbus-next 连接）；
 * 3. 空闲超时后自行退出（名字释放）。
 *
 * 依赖：`packaging/portal/portal-bridge.cjs`（npm run build 产出）；缺失时跳过。
 */
const h = require('./harness.cjs');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BRIDGE = path.join(ROOT, 'packaging/portal/portal-bridge.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 假「选择器后端」脚本：持有内部名字并返回固定 URI */
const FAKE_TARGET_SOURCE = `
const dbus = require(${JSON.stringify(path.join(ROOT, 'node_modules/dbus-next'))});
const { Interface } = dbus.interface;
const IFACE = 'org.freedesktop.impl.portal.FileChooser';
const PATH = '/org/freedesktop/portal/desktop';
const bus = dbus.sessionBus();
bus.on('error', (e) => { console.error('fake target bus error:', e && e.message); process.exit(1); });
class Fake extends Interface {
  constructor() { super(IFACE); }
  get Version() { return 'e2e-fake'; }
  async OpenFile() { return [0, { uris: new dbus.Variant('as', ['file:///tmp/e2e-bridge-ok.txt']) }]; }
  async SaveFile() { return [0, {}]; }
  async SaveFiles() { return [0, {}]; }
}
Fake.configureMembers({
  properties: { Version: { signature: 's', access: 'read' } },
  methods: {
    OpenFile: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' },
    SaveFile: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' },
    SaveFiles: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' },
  },
});
bus.requestName(process.env.FAKE_TARGET_NAME, dbus.NameFlag.DO_NOT_QUEUE).then((reply) => {
  if (reply !== 1) { console.error('fake target requestName failed', reply); process.exit(1); }
  bus.export(PATH, new Fake());
  console.log('fake-target-ready');
});
setInterval(() => {}, 1000);
`;

(async () => {
  await h.setupApp();

  await h.run('113 portal 名字持有桥（持名 + 转发 + 空闲退出）', async () => {
    if (!fs.existsSync(BRIDGE)) {
      console.log('    跳过：未构建 packaging/portal/portal-bridge.cjs（先 npm run build）');
      return;
    }
    const gdbus = spawnSync('which', ['gdbus'], { encoding: 'utf-8' });
    if (gdbus.status !== 0) {
      console.log('    跳过：缺少 gdbus（需要 glib2）');
      return;
    }

    // D-Bus 名各段不能以数字开头：前缀 p/r（与 harness 同款）
    const suffix = `p${process.pid}.r${Math.floor(Math.random() * 1e6)}`;
    const bridgeName = `org.hoshineko.e2e.bridge.${suffix}`;
    const targetName = `org.hoshineko.e2e.picker.${suffix}`;
    const IDLE_MS = 1200;

    const fakePath = path.join(h.tempDir('hoshineko-e2e-fake-target-'), 'fake-target.cjs');
    fs.writeFileSync(fakePath, FAKE_TARGET_SOURCE, 'utf-8');

    // 子进程一律用当前 Electron 的 Node 模式（与生产桥完全一致：不启动 Chromium）
    const childEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    const fake = spawn(process.execPath, [fakePath], {
      env: { ...childEnv, FAKE_TARGET_NAME: targetName },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let fakeOut = '';
    fake.stdout.on('data', (d) => { fakeOut += String(d); });
    fake.stderr.on('data', (d) => { fakeOut += String(d); });

    const bridge = spawn(process.execPath, [BRIDGE], {
      env: {
        ...childEnv,
        HOSHINEKO_BRIDGE_BUS_NAME: bridgeName,
        HOSHINEKO_BRIDGE_TARGET: targetName,
        HOSHINEKO_BRIDGE_IDLE_MS: String(IDLE_MS),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let bridgeOut = '';
    bridge.stdout.on('data', (d) => { bridgeOut += String(d); });
    bridge.stderr.on('data', (d) => { bridgeOut += String(d); });

    try {
      // 等两个名字就位
      const ownership = await (async () => {
        for (let i = 0; i < 100; i++) {
          const b = spawnSync('busctl', ['--user', 'status', bridgeName], { encoding: 'utf-8' });
          const t = spawnSync('busctl', ['--user', 'status', targetName], { encoding: 'utf-8' });
          if (b.status === 0 && t.status === 0) return true;
          await sleep(50);
        }
        return false;
      })();
      h.assert.ok(ownership, `桥/假后端应各自持有总线名（bridge=${bridgeName}，target=${targetName}）\n${bridgeOut}${fakeOut}`);

      // 经 gdbus（独立客户端）调用桥的 OpenFile
      const call = spawnSync('gdbus', [
        'call', '--session',
        '--dest', bridgeName,
        '--object-path', '/org/freedesktop/portal/desktop',
        '--method', 'org.freedesktop.impl.portal.FileChooser.OpenFile',
        '/handle', 'e2e-app', '', 'title', '{}',
      ], { encoding: 'utf-8' });
      h.assert.strictEqual(call.status, 0, `gdbus 调用应成功：${call.stderr}`);
      h.assert.ok(
        call.stdout.includes('file:///tmp/e2e-bridge-ok.txt'),
        `回包应原样带回假后端的 URI（实际 ${call.stdout}）`,
      );
      h.assert.ok(call.stdout.includes('uint32 0'), `响应码应为 0（实际 ${call.stdout}）`);
      h.assert.ok(bridgeOut.includes('已持有'), `桥应打印持有日志（实际 ${bridgeOut}）`);

      // 空闲退出：超时后进程结束且名字释放
      const exited = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), IDLE_MS + 5000);
        bridge.once('exit', () => { clearTimeout(timer); resolve(true); });
      });
      h.assert.ok(exited, '桥应在空闲超时后自行退出');
      let released = false;
      for (let i = 0; i < 40; i++) {
        const b = spawnSync('busctl', ['--user', 'status', bridgeName], { encoding: 'utf-8' });
        if (b.status !== 0) { released = true; break; }
        await sleep(50);
      }
      h.assert.ok(released, '桥退出后对外总线名应释放');
    } finally {
      fake.kill();
      bridge.kill();
    }
  });

  h.finish();
})();
