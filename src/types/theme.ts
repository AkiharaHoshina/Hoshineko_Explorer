/** 主题来源类别 */
export type ThemeKind = 'preset' | 'custom' | 'wallpaper' | 'matugen';

/**
 * 持久化的主题颜色配置（localStorage 键 settings.theme）。
 * null 表示未选择主题：应用回退到传统 matugen theme.css 加载。
 */
export interface ThemeConfig {
  /** 来源类别 */
  kind: ThemeKind;
  /** 种子色（#RRGGBB）：预设/自定义的所选颜色；壁纸取色时保存测算出的原子色 */
  seed?: string;
  /** 预设 id（对应 THEME_PRESETS 的 id 项） */
  presetId?: string;
  /** 壁纸取色的图片绝对路径 */
  wallpaperPath?: string;
  /**
   * 壁纸图片的来源动作（决定设置页哪张大卡片高亮）：
   * - `'auto'`：自动探测当前桌面壁纸（findWallpaper）；
   * - `'pick'`：用户手动选择图片（内置文件选择器）。
   * 旧配置没有该字段 → 视为 `'auto'`。
   */
  wallpaperSource?: 'auto' | 'pick';
  /** Matugen 主题：用户所选配置文件/目录内解析到的实际文件（v3.0.1035） */
  matugenPath?: string;
  /** matugen scheme 类型（scheme-rainbow / scheme-tonal-spot 等） */
  scheme?: string;
  /** matugen contrast（-1..1，默认 0） */
  contrast?: number;
}

/** 预设色盘条目 */
export interface ThemePreset {
  /** 唯一 id（i18n 键 theme.preset.<id> 提供名称） */
  id: string;
  /** 种子色（#RRGGBB） */
  seed: string;
}

/** 内置 M3 预设种子色（与 Material Theme Builder 基线色板一致） */
export const THEME_PRESETS: ThemePreset[] = [
  { id: 'purple', seed: '#6750A4' },
  { id: 'blue', seed: '#0061A4' },
  { id: 'light_blue', seed: '#00639B' },
  { id: 'cyan', seed: '#006A6B' },
  { id: 'teal', seed: '#006A6A' },
  { id: 'green', seed: '#2E7D32' },
  { id: 'olive', seed: '#546D00' },
  { id: 'yellow', seed: '#7A5900' },
  { id: 'orange', seed: '#8B5000' },
  { id: 'red', seed: '#B3261E' },
  { id: 'pink', seed: '#B3266E' },
  { id: 'magenta', seed: '#9334A5' },
];
