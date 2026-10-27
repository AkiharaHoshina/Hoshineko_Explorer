import dbus from 'dbus-next';
import {
  BACKEND_VERSION_PROPERTY,
  PORTAL_BUS_NAME,
  PORTAL_INTERNAL_BUS_NAME,
  PORTAL_FILE_CHOOSER_IFACE,
  PORTAL_OBJECT_PATH,
} from './portalNames';

/**
 * `hoshineko-portal-bridge` 的实现：**不启动 Chromium 的纯 Node 进程**，
 * 由 `.service` 直接以 `ELECTRON_RUN_AS_NODE=1` 运行（见
 * `packaging/dbus/org.freedesktop.impl.portal.desktop.hoshineko.service`）。
 *
 * 存在原因（详见 AGENTS.md「启动期环」）：Electron 进程启动时 Chromium 会
 * **同步**查询 `org.freedesktop.portal.Desktop` 的 Settings（明暗），而宿主
 * portal 启动时又要 `StartServiceByName` 激活 FileChooser 实现者并等它持有
 * 名字——若实现者就是 Electron 自己，三方互等 25 秒，最终 FileChooser 接口
 * 被宿主丢弃且不再重建（本次会话所有应用的文件对话框失效）。
 *
 * 解法：让**不启动 Chromium**的桥进程持有对外名字（毫秒级到手），真正的
 * 选择器后端（Electron `--portal-service`）退到内部名字
 * `PORTAL_INTERNAL_BUS_NAME` 后面；桥把 FileChooser 调用原样转发过去。
 * Electron 那边即使被 Chromium 卡 25 秒，宿主也早已拿到名字，不会超时。
 *
 * 生命周期：桥由 dbus-daemon 按需拉起，空闲 `HOSHINEKO_BRIDGE_IDLE_MS`
 * （默认 60s，且无在途请求）自行退出并释放名字；下一次调用由 `.service`
 * 重新激活（实测冷启动 ~100ms）。退出前不影响 portal 已建立的代理。
 */

/** esbuild 在构建时注入（scripts/build-portal-bridge.cjs 取 package.json.version） */
declare const __HOSHINEKO_VERSION__: string;

/** 对外总线名（测试可用环境变量换成随机名，避免与真实常驻抢名） */
const BUS_NAME = process.env.HOSHINEKO_BRIDGE_BUS_NAME?.trim() || PORTAL_BUS_NAME;
/** 转发目标：选择器后端所在总线名（同样可由测试覆盖） */
const TARGET_NAME = process.env.HOSHINEKO_BRIDGE_TARGET?.trim() || PORTAL_INTERNAL_BUS_NAME;

const idleOverride = Number(process.env.HOSHINEKO_BRIDGE_IDLE_MS);
/** 空闲退出时长（ms）：无在途请求时开始计时 */
const IDLE_MS = Number.isFinite(idleOverride) && idleOverride > 0 ? idleOverride : 60_000;

/** 版本号：esbuild 注入；未注入（如直接跑 tsc 产物）时回落 0.0.0 */
const VERSION = (() => {
  try {
    return typeof __HOSHINEKO_VERSION__ === 'string' ? __HOSHINEKO_VERSION__ : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const { Interface } = dbus.interface;

/** 会话总线连接（main 内赋值；shutdown 时断开） */
let bus: dbus.MessageBus | null = null;
/** 在途转发数量：>0 时不得空闲退出（否则调用方拿到错误、选择器被强杀） */
let inflight = 0;
/** 空闲退出计时器 */
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** 退出幂等守卫 */
let closing = false;

/**
 * 退出并释放总线名（幂等）。
 *
 * @param code - 进程退出码（0 = 正常空闲退出 / SIGTERM；1 = 注册或总线故障）
 */
function shutdown(code: number): void {
  if (closing) return;
  closing = true;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  try {
    bus?.disconnect();
  } catch {
    /* 连接已断：忽略 */
  }
  process.exit(code);
}

/** 开始空闲计时（有在途请求时不计时） */
function scheduleIdle(): void {
  if (closing || inflight > 0) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    console.log(`[portal-bridge] 空闲 ${IDLE_MS}ms，退出并释放 ${BUS_NAME}`);
    shutdown(0);
  }, IDLE_MS);
}

/** 取消空闲计时（新请求到达） */
function cancelIdle(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/**
 * 把一个 FileChooser 方法调用原样转发给选择器后端。
 *
 * 签名固定为 `osssa{sv}`（OpenFile/SaveFile/SaveFiles 三者一致），
 * 参数与回包都不做解析——解析留在后端，桥只做搬运。
 *
 * @param member - 方法名
 * @param body - 参数数组
 * @returns 后端回包 `[响应码, 结果字典]`；失败抛 portal 错误
 */
/** 可重试的瞬时错误：目标刚被激活、名字刚出现但对象还没导出的竞态 */
const TRANSIENT_DBUS_ERRORS = new Set([
  'org.freedesktop.DBus.Error.UnknownMethod',
  'org.freedesktop.DBus.Error.UnknownObject',
  'org.freedesktop.DBus.Error.UnknownInterface',
  'org.freedesktop.DBus.Error.ServiceUnknown',
  'org.freedesktop.DBus.Error.NameHasNoOwner',
]);
/** 重试次数与间隔：后端冷启动（AppImage 挂载 + Electron 起来）通常 ~1s */
const RELAY_RETRY_TIMES = 20;
const RELAY_RETRY_MS = 50;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 把一个 FileChooser 方法调用原样转发给选择器后端。
 *
 * 签名固定为 `osssa{sv}`（OpenFile/SaveFile/SaveFiles 三者一致），
 * 参数与回包都不做解析——解析留在后端，桥只做搬运。
 *
 * 「名字已出现、对象尚未导出」是 D-Bus 激活的固有时序：dbus-daemon 在名字
 * 出现的那一刻就投递排队消息。这类瞬时错误（UnknownMethod/ServiceUnknown
 * 等）在 ~1s 内重试，避免用户第一次调用静默失败。
 *
 * @param member - 方法名
 * @param body - 参数数组
 * @returns 后端回包 `[响应码, 结果字典]`；失败抛 portal 错误
 */
async function forward(
  member: string,
  body: unknown[],
): Promise<[number, Record<string, dbus.Variant>]> {
  const b = bus;
  if (!b || closing) {
    throw new dbus.DBusError('org.freedesktop.portal.Error.Failed', 'portal bridge is shutting down');
  }
  for (let attempt = 0; ; attempt += 1) {
    let reply: dbus.Message | null;
    try {
      reply = await b.call(new dbus.Message({
        type: dbus.MessageType.METHOD_CALL,
        destination: TARGET_NAME,
        path: PORTAL_OBJECT_PATH,
        interface: PORTAL_FILE_CHOOSER_IFACE,
        member,
        signature: 'osssa{sv}',
        body,
      }));
    } catch (e) {
      const err = e as { type?: string; text?: string; message?: string };
      if (err?.type && TRANSIENT_DBUS_ERRORS.has(err.type) && attempt < RELAY_RETRY_TIMES) {
        await sleep(RELAY_RETRY_MS);
        continue;
      }
      // 目标未激活/已退出：转成 portal 错误，调用方（Firefox 等）会给出自己的
      // 失败提示——绝不能伪装成「用户取消」，否则故障会被静默吞掉
      throw new dbus.DBusError(
        'org.freedesktop.portal.Error.Failed',
        `选择器后端不可用：${err?.text ?? err?.message ?? String(e)}`,
      );
    }
    if (!reply) {
      throw new dbus.DBusError('org.freedesktop.portal.Error.Failed', '选择器后端无回包');
    }
    return reply.body as [number, Record<string, dbus.Variant>];
  }
}

/**
 * FileChooser 转发实现（导出在标准对象路径上）。
 *
 * 只暴露协议要求的三个方法 + `Version` 只读属性；不做任何选项解析。
 */
class FileChooserForwarder extends Interface {
  constructor() {
    super(PORTAL_FILE_CHOOSER_IFACE);
  }

  get [BACKEND_VERSION_PROPERTY](): string {
    return VERSION;
  }

  /**
   * 统一包装一次转发：维护在途计数与空闲计时，失败统一成 portal 错误。
   *
   * @param member - 方法名
   * @param args - 原始参数
   */
  private async relay(member: string, args: unknown[]) {
    if (process.env.HOSHINEKO_BRIDGE_DEBUG) console.log(`[portal-bridge] 收到 ${member}`);
    inflight += 1;
    cancelIdle();
    try {
      return await forward(member, args);
    } finally {
      inflight -= 1;
      scheduleIdle();
    }
  }

  async OpenFile(handle: string, appId: string, parentWindow: string, title: string, options: Record<string, unknown>) {
    return this.relay('OpenFile', [handle, appId, parentWindow, title, options ?? {}]);
  }

  async SaveFile(handle: string, appId: string, parentWindow: string, title: string, options: Record<string, unknown>) {
    return this.relay('SaveFile', [handle, appId, parentWindow, title, options ?? {}]);
  }

  async SaveFiles(handle: string, appId: string, parentWindow: string, title: string, options: Record<string, unknown>) {
    return this.relay('SaveFiles', [handle, appId, parentWindow, title, options ?? {}]);
  }
}

FileChooserForwarder.configureMembers({
  properties: {
    [BACKEND_VERSION_PROPERTY]: { signature: 's', access: 'read' },
  },
  methods: {
    OpenFile: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' },
    SaveFile: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' },
    SaveFiles: { inSignature: 'osssa{sv}', outSignature: 'ua{sv}' },
  },
});

/** 连接会话总线 → 抢占对外名字 → 导出转发接口 → 开始空闲计时 */
async function main(): Promise<void> {
  try {
    bus = dbus.sessionBus();
  } catch (e) {
    console.error(`[portal-bridge] 会话总线不可用：${(e as Error)?.message ?? e}`);
    process.exit(1);
  }
  const b = bus;
  b.on('error', (e: unknown) => {
    console.error(`[portal-bridge] 会话总线错误：${(e as Error)?.message ?? e}`);
    shutdown(1);
  });
  const reply = await b.requestName(BUS_NAME, dbus.NameFlag.DO_NOT_QUEUE);
  if (reply !== 1) {
    // 已被占用：旧桥常驻/另一实例。按 D-Bus 语义只能报告失败，
    // 由 dbus-daemon 把激活失败告知调用方（安装脚本会清理旧常驻）。
    console.error(`[portal-bridge] 总线名 ${BUS_NAME} 注册失败（reply=${reply}），可能已有实例在服务`);
    b.disconnect();
    process.exit(1);
  }
  b.export(PORTAL_OBJECT_PATH, new FileChooserForwarder());
  console.log(
    `[portal-bridge] 已持有 ${BUS_NAME}（转发目标 ${TARGET_NAME}；空闲 ${IDLE_MS}ms 退出；版本 ${VERSION}）`,
  );
  scheduleIdle();
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

void main();
