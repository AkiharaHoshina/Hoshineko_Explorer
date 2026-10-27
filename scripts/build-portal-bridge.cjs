/**
 * 构建 portal 名字持有桥：`packaging/portal/portal-bridge.cjs`。
 *
 * 为什么需要构建步骤：
 * - 桥进程由 `.service` 以 `ELECTRON_RUN_AS_NODE=1` 直接运行（Electron 内嵌
 *   Node，**不依赖系统 node**），路径必须固定且是真实文件（不能在 asar 里、
 *   不能是 AppImage 挂载点）；
 * - 它依赖 `dbus-next`，用户机器上没有 node_modules——用 esbuild 把 TS 源码
 *   与依赖打成单文件，随 `packaging/**` 进 AppImage，再由 install.sh 装到
 *   /usr/share/hoshineko/。
 *
 * 版本号通过 define 注入（桥进程没有 Electron 的 app.getVersion()）。
 */
const path = require('path');
const esbuild = require('esbuild');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');
const outfile = path.join(root, 'packaging/portal/portal-bridge.cjs');

esbuild.buildSync({
  entryPoints: [path.join(root, 'electron/portalBridge.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile,
  define: { __HOSHINEKO_VERSION__: JSON.stringify(pkg.version) },
  // dbus-next 的可选依赖：只在没有 DBUS_SESSION_BUS_ADDRESS 时用于 X11
  // autolaunch 取地址（D-Bus 激活的进程一定有该变量）。标记 external 让
  // 打包不要求安装 x11——真走到那条分支会抛错，而不是打包失败。
  external: ['x11'],
  legalComments: 'none',
  logLevel: 'warning',
});

console.log(`portal bridge built: ${path.relative(root, outfile)} (version ${pkg.version})`);
