/** 主题来源类别 */
export type ThemeKind = 'preset' | 'custom' | 'flag' | 'wallpaper' | 'matugen';

/**
 * 持久化的主题颜色配置（localStorage 键 settings.theme）。
 * null 表示未选择主题：应用回退到传统 matugen theme.css 加载。
 */
export interface ThemeConfig {
  /** 来源类别 */
  kind: ThemeKind;
  /** 种子色（#RRGGBB）：预设/自定义的所选颜色；壁纸取色时保存测算出的原子色 */
  seed?: string;
  /** 预设 id（THEME_PRESETS 或 THEME_FLAGS 的 id） */
  presetId?: string;
  /** 壁纸取色的图片绝对路径 */
  wallpaperPath?: string;
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

/**
 * 旗帜主题（Pride 系列）：多色方案。
 *
 * M3 只有 primary / secondary / tertiary 三个强调角色，旗帜的其余颜色
 * 由 UI 层（预设卡片的横向条纹）展示——主题本身用其中三色作强调色，
 * 中性/表面色由白色生成（彩度 0），保证对比度与可读性。
 */
export interface FlagPreset {
  /** 唯一 id（i18n 键 theme.flag.<id> 提供名称） */
  id: string;
  /** 旗帜色条（从上到下，UI 预览用） */
  stripes: string[];
  /** M3 primary 强调色 */
  primary: string;
  /** M3 secondary 强调色 */
  secondary: string;
  /** M3 tertiary 强调色；缺省时由 secondary 的色相降彩度派生 */
  tertiary?: string;
}

/** 内置旗帜主题（用户定案：跨性别骄傲、LGBT 骄傲） */
export const THEME_FLAGS: FlagPreset[] = [
  {
    id: 'transgender',
    stripes: ['#5BCEFA', '#F5A9B8', '#FFFFFF', '#F5A9B8', '#5BCEFA'],
    primary: '#5BCEFA',
    secondary: '#F5A9B8',
  },
  {
    id: 'pride',
    stripes: ['#E40303', '#FF8C00', '#FFED00', '#008026', '#004DFF', '#750787'],
    primary: '#750787',
    secondary: '#008026',
    tertiary: '#E40303',
  },
];
