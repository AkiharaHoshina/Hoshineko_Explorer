#!/usr/bin/env node
/**
 * 安装后清理 `usocket`（dbus-next 的 optional dependency）。
 *
 * 为什么必须清理：
 * - `usocket` 是 2016 年的包，内部调用 Node 24 已移除的 `util.isError`；
 *   Electron 43（Node 24）下只要 dbus-next 连 D-Bus 就会抛
 *   `TypeError: util.isError is not a function`（主进程未捕获异常）。
 * - 它还有 libuv use-after-free / 退出挂起 / 泄漏总线 FD 的问题。
 * - dbus-next 在 `usocket` 缺失时会自动回退到 `net.Socket`（unix:path
 *   总线地址不受影响），这是 AGENTS.md 规定的状态。
 *
 * 由 package.json 的 `postinstall` 自动执行；npm/pnpm install 后都会跑。
 * 幂等；即使清理失败也不阻断安装（只打印警告）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE_MODULES = path.join(ROOT, 'node_modules');

/** 已知路径 + 递归扫描（限制深度，避免全量遍历 node_modules）。 */
const targets = new Set();
const known = [
  path.join(NODE_MODULES, 'usocket'),
  path.join(NODE_MODULES, 'dbus-next', 'node_modules', 'usocket'),
];
for (const p of known) {
  if (fs.existsSync(p)) targets.add(p);
}

/**
 * 递归查找嵌套的 usocket（如 dbus-next/node_modules/usocket）。
 * @param {string} dir 当前目录
 * @param {number} depth 剩余深度
 */
function scan(dir, depth) {
  if (depth < 0) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // 不跟随 symlink（pnpm store 由 pnpm 管理）
    if (entry.name === '.bin' || entry.name === '.cache') continue;
    const full = path.join(dir, entry.name);
    if (entry.name === 'usocket') {
      targets.add(full);
      continue;
    }
    scan(full, depth - 1);
  }
}
scan(NODE_MODULES, 4);

let removed = 0;
for (const target of targets) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    removed += 1;
    console.log(`[postinstall] removed ${path.relative(ROOT, target)}`);
  } catch (err) {
    console.warn(`[postinstall] 无法删除 ${target}: ${err.message}`);
  }
}

if (removed === 0) {
  console.log('[postinstall] usocket not present');
}
