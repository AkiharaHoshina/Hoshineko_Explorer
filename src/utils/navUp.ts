/**
 * 「返回上级」可用性判定（v3.0.1040）。
 *
 * 与 ExplorerTab.handleUp 的分支一一对应：返回 true 表示该路径存在上级。
 * 按钮据此在无上级时置灰（根目录、仪表盘、回收站根、设置根、对象根等）。
 */
import { isObjectSearchPath, parseObjectSearchPath } from './objectSearchPath';
import { isObjectsPath, objectsParentPath } from './objectsPath';
import { isSearchPath, parseSearchPath } from './searchPath';
import { isSettingsPath, settingsParentPath } from './settingsPath';
import { isSettingsSearchPath, parseSettingsSearchPath } from './settingsSearchPath';

/** 当前路径是否存在可返回的上级 */
export function canNavigateUp(path: string | null | undefined): boolean {
  if (!path || path === 'app://dashboard' || path === 'trash://') return false;
  // 搜索页：上级 = 发起搜索的目录（解析失败视为无上级）
  if (isSearchPath(path)) return parseSearchPath(path) !== null;
  // 对象搜索：上级 = 基准对象页
  if (isObjectSearchPath(path)) return parseObjectSearchPath(path) !== null;
  // 对象面板：根无上级，类页 → 根，实例页 → 类页
  if (isObjectsPath(path)) return objectsParentPath(path) !== null;
  // 设置页：子页 → 分类页 → 根无上级
  if (isSettingsPath(path)) return settingsParentPath(path) !== null;
  // 设置搜索：根搜索无上级，类搜索 → 基准设置页
  if (isSettingsSearchPath(path)) {
    const parsed = parseSettingsSearchPath(path);
    return parsed !== null && parsed.cat !== null;
  }
  // 真实路径：文件系统根无上级
  return path !== '/';
}
