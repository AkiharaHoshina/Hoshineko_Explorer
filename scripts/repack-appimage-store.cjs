#!/usr/bin/env node
/**
 * 把 electron-builder 产出的 gzip AppImage 重打包为**无压缩（store）**版本，
 * 同时把原 gzip 版保留到 `release-size/`。
 *
 * 背景：electron-builder 的 `compression: "store"` 对 AppImage 目标不生效
 * （实测产物 squashfs 仍是 gzip，266 MB、冷启动 1.9–3.7 s）。无压缩
 * AppImage 约 550 MB，但启动接近解包后的 ~0.9 s——冷启动瓶颈就是 squashfs
 * 的 gzip 解压。本脚本用系统 `unsquashfs`/`mksquashfs` 完成重打包。
 *
 * 用法（`npm run electron:build` 已自动串联）：
 *   node scripts/repack-appimage-store.cjs
 *
 * 依赖：squashfs-tools（unsquashfs/mksquashfs）。未安装时给出明确提示。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pipeline } = require('stream/promises');

const ROOT = path.dirname(__dirname);
const RELEASE = path.join(ROOT, 'release');
const SIZE_DIR = path.join(ROOT, 'release-size');

/** 运行外部命令并返回 stdout；失败抛错（调用方带上下文） */
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...opts });
}

/** 找 `.AppImage` 中真正的 squashfs 起始偏移：逐个候选用 unsquashfs 验证。 */
function findSquashfsOffset(appImage) {
  const headSize = Math.min(fs.statSync(appImage).size, 4 * 1024 * 1024);
  const head = Buffer.alloc(headSize);
  const fd = fs.openSync(appImage, 'r');
  try {
    fs.readSync(fd, head, 0, headSize, 0);
  } finally {
    fs.closeSync(fd);
  }
  const magic = Buffer.from('hsqs');
  const candidates = [];
  let at = head.indexOf(magic);
  while (at !== -1) {
    candidates.push(at);
    at = head.indexOf(magic, at + 1);
  }
  for (const offset of candidates) {
    try {
      // 假 magic 的候选会让 unsquashfs 往 stderr 打 FATAL，这里静默
      const out = run('unsquashfs', ['-o', String(offset), '-s', appImage],
        { stdio: ['ignore', 'pipe', 'ignore'] });
      if (out.includes('Found a valid SQUASHFS')) return { offset, info: out };
    } catch { /* 运行时里的假 magic，继续 */ }
  }
  throw new Error('未找到 AppImage 内有效的 squashfs 超级块');
}

async function main() {
  // 工具检查：缺 squashfs-tools 时明确报错，不产出半成品
  // （注意 unsquashfs -version 以退出码 1 结束，不能用退出码判断）
  for (const tool of ['unsquashfs', 'mksquashfs']) {
    try {
      run('sh', ['-c', `command -v ${tool}`]);
    } catch {
      throw new Error(`缺少 ${tool}（请安装 squashfs-tools）`);
    }
  }

  if (!fs.existsSync(RELEASE)) throw new Error(`找不到 ${RELEASE}`);
  const built = fs.readdirSync(RELEASE)
    .filter((n) => n.endsWith('.AppImage') && !/-size\.AppImage$/.test(n))
    .map((n) => path.join(RELEASE, n))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!built) throw new Error('release/ 下没有 AppImage（先运行 electron-builder）');

  const { offset, info } = findSquashfsOffset(built);
  // store 重打包后 superblock 仍标 "Compression gzip"，但会标 "Data is uncompressed"
  if (/Data is uncompressed/.test(info)) {
    console.log(`[repack] ${path.basename(built)} 数据已无压缩，跳过`);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshineko-repack-'));
  const appDir = path.join(tmp, 'appdir');
  const newSqfs = path.join(tmp, 'app.squashfs');
  try {
    console.log(`[repack] 解包 ${path.basename(built)}（offset=${offset}）…`);
    run('unsquashfs', ['-o', String(offset), '-d', appDir, '-no-progress', built]);

    console.log('[repack] 生成无压缩 squashfs…');
    run('mksquashfs', [appDir, newSqfs,
      '-noI', '-noD', '-noF', '-noX',
      '-noappend', '-b', '131072'], { stdio: 'ignore' });

    // 先保留体积优先版（原 gzip），再用 store 版覆盖 release/ 默认产物
    fs.mkdirSync(SIZE_DIR, { recursive: true });
    const base = path.basename(built, '.AppImage');
    const sizePath = path.join(SIZE_DIR, `${base}-size.AppImage`);
    fs.copyFileSync(built, sizePath);
    console.log(`[repack] 体积优先版 → ${path.relative(ROOT, sizePath)}`);

    const outTmp = path.join(tmp, 'out.AppImage');
    await pipeline(
      fs.createReadStream(built, { start: 0, end: offset - 1 }),
      fs.createWriteStream(outTmp),
    );
    await pipeline(
      fs.createReadStream(newSqfs),
      fs.createWriteStream(outTmp, { flags: 'a' }),
    );
    fs.chmodSync(outTmp, 0o755);
    fs.copyFileSync(outTmp, built);
    fs.chmodSync(built, 0o755);

    const storeInfo = run('unsquashfs', ['-o', String(offset), '-s', built]);
    const compression = storeInfo.match(/Compression (\w+)/)?.[1] ?? 'unknown';
    const data = /Data is uncompressed/.test(storeInfo) ? 'uncompressed' : 'compressed';
    console.log(
      `[repack] 启动优先版 → ${path.relative(ROOT, built)}（${(fs.statSync(built).size / 1048576).toFixed(0)} MB，` +
      `squashfs=${compression}/${data}）`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[repack] 失败：${err.message}`);
  process.exit(1);
});
