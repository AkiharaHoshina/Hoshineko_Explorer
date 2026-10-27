/**
 * portal FileChooser 的总线名 / 对象路径 / 版本属性常量。
 *
 * **纯常量模块：禁止 import electron。** 持有 D-Bus 名字的进程是
 * `hoshineko-portal-bridge`（`ELECTRON_RUN_AS_NODE=1` 下运行的纯 Node 脚本，
 * 见 `electron/portalBridge.ts`）——它不能启动 Chromium，否则 Chromium 启动期
 * 对 xdg-desktop-portal 的同步 Settings 查询又会与「门户正在激活我们」形成
 * 环形等待（详见 AGENTS.md「启动期环」）。桥进程与主进程必须共用同一组名字，
 * 因此单列此文件。
 */

/** 对外名字（与 packaging/portals/hoshineko.portal 的 DBusName 一致）：
 *  由桥进程持有，portal 按它找到实现者 */
export const PORTAL_BUS_NAME = 'org.freedesktop.impl.portal.desktop.hoshineko';

/** 内部名字：真正的选择器后端（Electron `--portal-service`）持有。
 *  桥进程收到调用后转发到这里，由 dbus-daemon 按 .service 激活 Electron。 */
export const PORTAL_INTERNAL_BUS_NAME = 'org.hoshineko.portal.picker';

/** 后端对象路径（impl FileChooser 协议约定） */
export const PORTAL_OBJECT_PATH = '/org/freedesktop/portal/desktop';

/** 后端接口名（impl FileChooser 协议约定） */
export const PORTAL_FILE_CHOOSER_IFACE = 'org.freedesktop.impl.portal.FileChooser';

/**
 * 后端构建版本属性名（只读 `Version`，portal 协议本身无此字段）：
 * 冲突探测经 Properties.Get 读取占名者版本，用于识别「旧版常驻仍在应答」。
 */
export const BACKEND_VERSION_PROPERTY = 'Version';
