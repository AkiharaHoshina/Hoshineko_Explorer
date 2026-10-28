import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { MarqueeText } from "./MarqueeText";
import "./Sidebar.css";
import { t } from "../i18n";
import { showToast } from "../utils/toast";
import type { AllDevice, GvfsVolume, IFile } from "../types/files";
import { isExternalDevice, getDiskIcon } from "../utils/deviceUtils";
import { SidebarPartitionItem } from "./SidebarPartitionItem";
import { ContextMenu } from "./ContextMenu";
import type { ContextMenuItem } from "./ContextMenu";
import { useDrag } from "../contexts/DragContext";
import { shouldSuppressDrop } from "../utils/nativeDragTracker";
import { setPinReorderDragActive } from "../utils/pinReorderDrag";
import { findPrideFlag } from "../types/pride";
import { registerKeyboardZone } from "../utils/focusZones";
import { isObjectDrag, readObjectDrag, type ObjectDragPayload } from "../utils/objectDrag";
import { useLocalStorage } from "../hooks/useLocalStorage";

/** 侧边栏固定目录条目（仅目录，与仪表盘固定项相互独立） */
export interface SidebarPinnedItem {
  /** 显示名（路径最后一段） */
  name: string;
  /** 目录绝对路径；对象投影（阴影投影）= objects:// 对象页路径 */
  path: string;
  /** 是否为目录（当前固定功能仅允许目录，字段保留以便将来支持文件；
   *  对象投影恒 false） */
  isDir: boolean;
  /** 图标名（对象投影用实例图标；目录条目缺省，渲染回落 folder） */
  icon?: string;
}

/**
 * 固定区排序拖拽期间的渲染条目：真实固定项（origIndex 为在
 * pinnedDirs 中的原始索引，hidden 标记源条目已隐藏本体）或
 * 插入间隙占位（gap 为插入位置，0..n-1）。
 */
type PinRenderEntry =
  | { kind: 'item'; item: SidebarPinnedItem; origIndex: number; hidden?: boolean }
  | { kind: 'gap'; gap: number };

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string, selectFileName?: string) => void;
  onDeviceContextMenu?: (e: React.MouseEvent, device: AllDevice) => void;
  onDeviceMount?: (
    devicePath: string,
  ) => Promise<{ success: boolean; mountpoint?: string; error?: string }>;
  onDeviceUnmount?: (devicePath: string) => void;
  onDeviceEject?: (devicePath: string) => void;
  onGvfsMount?: (volume: GvfsVolume) => Promise<{ success: boolean; mountpoint?: string }>;
  onGvfsUnmount?: (volume: GvfsVolume) => void;
  onGvfsContextMenu?: (e: React.MouseEvent, volume: GvfsVolume) => void;
  marqueeEnabled: boolean;
  /**
   * 同窗口内部拖放到侧边栏条目（位置 / 设备）的请求。
   * 由 App 转发给当前活动标签页的 ExplorerTab 执行
   * （移动/复制对话框 + 冲突处理 + 批量任务）。
   */
  onDropFiles?: (
    targetPath: string,
    files: IFile[],
    operation: "move" | "copy",
    sourcePath: string,
  ) => void;
  /**
   * 固定目录列表（受控：状态由 App 持有，与文件右键菜单共享）。
   */
  pinnedDirs: SidebarPinnedItem[];
  /** 固定一个已校验的目录路径（App 侧去重 + toast） */
  onPinPath: (path: string) => void;
  /** 移除固定目录 */
  onUnpinPath: (path: string) => void;
  /**
   * 固定目录拖拽排序：把 fromIndex 的条目移动到 toIndex
   * （App 侧写入持久化存储）。picker 变体不传——选择器内
   * 固定区只导航不排序（draggable 不启用）。
   */
  onReorderPin?: (fromIndex: number, toIndex: number) => void;
  /**
   * 对象投影落点（阴影投影，仅 default 变体）：Object Panel 实例行
   * 拖到固定区 → App 写入投影条目（导航别名）。picker 变体不传——
   * 选择器无对象面板且固定区只读。
   */
  onPinObject?: (obj: ObjectDragPayload) => void;
  /**
   * 固定区互拖（仅 default 变体）：仪表盘固定项拖入侧边栏固定区 →
   * App 移动（from='dashboard' 移除 + 追加到 pinnedDirs）。picker 不传。
   */
  onMovePinAcross?: (from: 'sidebar' | 'dashboard', index: number, to: 'sidebar' | 'dashboard', insertAt?: number) => void;
  /**
   * Ctrl 按住时显示固定区序号角标（Ctrl+1..9 跳转语义；App 键盘监听驱动）
   */
  showPinBadges?: boolean;
  /**
   * 固定项右键回调（仅 default 变体）：App 打开固定项菜单
   * （第一组复用文件区文件夹右键菜单 + 第二组上移/下移/取消固定）。
   * picker 变体不传——选择器内固定区只读，无右键菜单。
   */
  onPinnedContextMenu?: (e: React.MouseEvent, item: SidebarPinnedItem) => void;
  /**
   * Places 条目（仪表盘与位置区）右键回调（仅 default 变体）：App 打开
   * 位置菜单——仪表盘 = 仅「打开」；回收站 = 「打开 + 属性」；其余位置
   * = 文件区文件夹菜单裁剪掉复制/剪切/删除/永久删除/重命名/解压/压缩。
   * picker 变体不传——选择器内位置区只读，无右键菜单。
   */
  onPlaceContextMenu?: (e: React.MouseEvent, place: { name: string; path: string; icon: string }) => void;
  /**
   * 变体：'picker' 用于文件选择器窗口——隐藏仪表盘入口、固定按钮、
   * 固定移除按钮、右键固定菜单与侧边栏拖放路由（选择器只导航不落点）。
   * 默认 'default' 行为不变。
   */
  variant?: 'default' | 'picker';
  /** 隐藏 Places 中的回收站条目（保存模式选择器用：回收站不可作保存目标） */
  hideTrash?: boolean;
  /**
   * 是否显示 Places 中的仪表盘入口（review 26：设置页「显示仪表盘」开关
   * 立即生效——关闭即从 Places 隐藏；导航栏/仪表盘固定项不受影响）。
   * 默认 true；picker 变体恒不显示（isPicker 守卫优先级更高）。
   */
  showDashboardPlace?: boolean;
  /** 是否显示 Places 中的对象面板入口（review 29 #11：设置页
   *  「显示对象面板」开关；默认 true，picker 恒不显示） */
  showObjectsPlace?: boolean;
  /** 是否显示 Places 中的内建终端入口（review 29 #15：设置页开关；
   *  默认 true，picker 恒不显示） */
  showTerminalPlace?: boolean;
  /** 内置终端是否打开（入口高亮跟随——与导航栏终端按钮同行为） */
  terminalOpen?: boolean;
  /** 切换内置终端（点击 Places 内建终端入口 = toggleTerminal） */
  onToggleTerminal?: () => void;
  /**
   * 滚轮翻页灵敏度（百分比 50–500，默认 100＝与旧版手感一致）：
   * 数值越大，翻一页所需累计滚动位移越小。
   */
  wheelSensitivity?: number;
  /** 骄傲主题（旗帜 id；null = 无）：每次激活侧边栏条目时给当前条目
   *  随机取一个旗色做弱化底色（会话内有效，切换条目后旧条目复原） */
  prideAccent?: string | null;
}

/** 侧边栏拖放目标标识前缀与常量 */
const TARGET_PREFIX_PLACE = "place:";
const TARGET_PREFIX_DEVICE = "device:";
const TARGET_PREFIX_GVFS = "gvfs:";
/** 固定按钮的拖放目标标识（拖单个文件夹到按钮上固定） */
const TARGET_PIN = "pin:";

/**
 * 拖拽边缘自动翻页：光标进入侧边栏上/下边缘区的判定距离（像素）。
 * 分页后没有滚动容器，跨页拖放靠"贴着边缘停留 → 翻页"实现。
 */
const EDGE_ZONE_PX = 96;
/** 边缘停留多久翻一页（毫秒）；持续停留会连续翻页 */
const EDGE_FLIP_INTERVAL_MS = 450;

/**
 * 分页尺寸常量（像素），必须与 Sidebar.css 保持一致：
 * `.sidebar-item` 高 56、列表 gap 4、区块标题行 32、设备组头 32。
 * 首次布局后用实测条目高度校验（见 measureRowHeight），不一致时以
 * 实测值为准并告警——CSS 改了但常量忘了改时能立刻发现。
 */
const ROW_H = 56;
/** 收起（图标轨道）态条目高度：图标化后不需要 56px 的文字胶囊高度 */
const COLLAPSED_ROW_H = 44;
const ROW_GAP = 4;
const SECTION_TITLE_H = 32;
/** 区块标题的上外边距（非页首的区块标题才有） */
const SECTION_TITLE_TOP = 16;
/** 设备组头（磁盘名行）高度 */
const DEVICE_HEADER_H = 32;
/** 分页内容区顶部内边距（.sidebar-body padding-top），需从可用高度中扣除 */
const BODY_TOP_PADDING = 8;
/** 横向（触控板/横向滚轮）翻页阈值（累计位移像素） */
const WHEEL_FLIP_THRESHOLD = 48;
/**
 * 竖向翻页的一格基准（累计位移像素，100% 灵敏度下）。
 *
 * 不再区分设备（用户定案 A：竖向滚动一律翻页）：光滑滚轮（罗技 M720 等）
 * 把一格拆成多帧 15/30，整格合计仍是 120；离散滚轮一格是 100 或 120。
 * 取 100 使两种设备都能在一格内触发，余量在翻页时清零。
 */
const WHEEL_MOUSE_NOTCH = 100;
/** 翻页灵敏度范围（百分比）：50%–500% */
const SENSITIVITY_MIN = 50;
const SENSITIVITY_MAX = 500;
/** 翻页冷却（毫秒）：防止惯性/高频事件连续翻过多页 */
const WHEEL_FLIP_COOLDOWN_MS = 300;
/** 滚轮累积的静默重置（毫秒）：空档超过此值后不把前后两次零散滚动凑成一格 */
const WHEEL_ACC_RESET_MS = 800;
/** 触摸横向拖动翻页阈值 */
const TOUCH_FLIP_THRESHOLD = 48;

/**
 * 一个可参与分页的渲染节点：高度用于分页计算，node 为实际内容。
 * 高度含条目自身的下间距（gap），页容量按累计高度比较。
 */
interface SidebarNode {
  key: string;
  height: number;
  node: React.ReactNode;
}

/**
 * 把节点列表按可用高度切页：累计高度超过 capacity 就换页；
 * 单个节点本身高于 capacity 时独占一页（不无限递归）。
 */
function paginateNodes(nodes: SidebarNode[], capacity: number): SidebarNode[][] {
  const pages: SidebarNode[][] = [];
  let current: SidebarNode[] = [];
  let used = 0;
  for (const node of nodes) {
    if (current.length > 0 && used + node.height > capacity) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(node);
    used += node.height;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

/** 在设备树中递归查找指定 devicePath 的设备/分区（纯函数，模块级） */
function findDeviceByPath(list: AllDevice[], devicePath: string): AllDevice | null {
  for (const d of list) {
    if (d.devicePath === devicePath) return d;
    if (d.children) {
      const child = findDeviceByPath(d.children, devicePath);
      if (child) return child;
    }
  }
  return null;
}

/** #RRGGBB / rgb(r, g, b) → [r, g, b] */
function parseColorValue(input: string): [number, number, number] | null {
  const hex = input.trim().match(/^#([0-9a-fA-F]{6})$/);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = input.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).map(Number).filter((v) => !Number.isNaN(v));
    if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
  }
  return null;
}

/** 旗色按 alpha 混入背景色（明暗主题自适应弱化） */
function mixColor(raw: string, base: string, alpha: number): string | null {
  const a = parseColorValue(raw);
  const b = parseColorValue(base);
  if (!a || !b) return null;
  const ch = (i: number): number => Math.round(a[i] * alpha + b[i] * (1 - alpha));
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

/** WCAG 相对亮度（0 = 黑，1 = 白） */
function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 按背景亮度选黑/白文字（弱化后的底色保证文字可读） */
function readableTextOn(bg: string): string {
  const rgb = parseColorValue(bg);
  if (!rgb) return "var(--md-sys-color-on-surface)";
  return relativeLuminance(rgb) > 0.5 ? "#000000" : "#FFFFFF";
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPath,
  onNavigate,
  onDeviceContextMenu,
  onDeviceMount,
  onDeviceUnmount,
  onDeviceEject,
  onGvfsMount,
  onGvfsUnmount,
  onGvfsContextMenu,
  marqueeEnabled,
  onDropFiles,
  pinnedDirs,
  onPinPath,
  onUnpinPath,
  onReorderPin,
  onPinObject,
  onMovePinAcross,
  showPinBadges = false,
  onPinnedContextMenu,
  onPlaceContextMenu,
  variant = 'default',
  hideTrash = false,
  showDashboardPlace = true,
  showObjectsPlace = true,
  showTerminalPlace = true,
  terminalOpen = false,
  onToggleTerminal,
  wheelSensitivity = 100,
  prideAccent = null,
}) => {
  const isPicker = variant === 'picker';
  const [places, setPlaces] = useState<
    Array<{ name: string; path: string; icon: string }>
  >([]);
  const [devices, setDevices] = useState<AllDevice[]>([]);
  const [gvfsVolumes, setGvfsVolumes] = useState<GvfsVolume[]>([]);

  /** 固定按钮右键菜单位置（null 表示关闭）；内含「使用文件管理器选择」 */
  const [pinMenuPos, setPinMenuPos] = useState<{ x: number; y: number } | null>(null);

  /** 拖拽悬停中的侧边栏目标标识（place:/device:/gvfs:/pin: 前缀），无悬停为 null */
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  /**
   * 骄傲主题：当前被激活条目的随机旗色（**会话内**，不持久化）。
   * 只对当前激活条目生效；切到别的条目后旧条目复原（用户定案）。
   */
  const [pridePick, setPridePick] = useState<{
    /** 掷色时使用的旗帜 id（设置变更后旧色自动失效，无需 effect 清理） */
    accent: string | null;
    key: string;
    raw: string;
    bg: string;
    fg: string;
  } | null>(null);
  /** 上一次用过的旗色：新颜色不得与它相同（用户定案） */
  const lastPrideRawRef = useRef<string | null>(null);
  /** 上一次用过的旗帜：换旗后重置去重基准 */
  const lastPrideFlagRef = useRef<string | null>(null);

  /** 激活条目时掷一次旗色（同一条目连续点击也不会连出同色） */
  const rollPride = useCallback((key: string) => {
    const flag = findPrideFlag(prideAccent);
    if (!flag || flag.colors.length === 0) {
      setPridePick(null);
      return;
    }
    // 不要真随机：新颜色必须与**上一次**用的不同（跨条目/重复点同一条目都算）；
    // 换了一面旗则不延续上一面的去重基准
    const last = lastPrideFlagRef.current === flag.id ? lastPrideRawRef.current : null;
    const pool = flag.colors.length > 1 ? flag.colors.filter((c) => c !== last) : flag.colors;
    const raw = pool[Math.floor(Math.random() * pool.length)];
    lastPrideRawRef.current = raw;
    lastPrideFlagRef.current = flag.id;
    const surface = getComputedStyle(document.documentElement)
      .getPropertyValue("--md-sys-color-surface").trim();
    const bg = mixColor(raw, surface || "#1b1b1f", 0.26) ?? raw;
    setPridePick({ accent: flag.id, key, raw, bg, fg: readableTextOn(bg) });
  }, [prideAccent]);

  /** 导航并掷色（所有"位置类"条目共用） */
  const goWithPride = useCallback((path: string, key: string) => {
    rollPride(key);
    onNavigate(path);
  }, [rollPride, onNavigate]);

  /** 当前应挂到条目上的骄傲底色（仅在激活且未被拖拽悬停覆盖时） */
  const prideAttrs = (
    key: string,
    active: boolean,
    dragOver: boolean,
  ): { style?: React.CSSProperties; "data-pride-color"?: string } => {
    if (!pridePick || pridePick.accent !== prideAccent || !active || dragOver || pridePick.key !== key) return {};
    return {
      style: { backgroundColor: pridePick.bg, color: pridePick.fg },
      "data-pride-color": pridePick.raw,
    };
  };

  const { getDragState, endDrag } = useDrag();

  /** 侧边栏容器（拖拽边缘翻页的边界参照） */
  const asideRef = useRef<HTMLElement | null>(null);

  /** 分页内容区（尺寸测量对象；不再是滚动容器） */
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /**
   * 收起态（图标轨道）：状态留在 Sidebar 内部，绝不提升到 App——
   * ExplorerTab 未 memo，App 任何 setState 都会重渲染所有标签页。
   */
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(
    'sidebar.collapsed',
    false,
  );

  /** 当前页索引（展开态有效；收起态恒为第 0 页） */
  const [pageIndex, setPageIndex] = useState(0);

  /** 分页内容区可用高度（ResizeObserver 实测，0 表示尚未测量） */
  const [bodyHeight, setBodyHeight] = useState(0);

  /** 键盘导航最近聚焦的条目（Tab 分区切换时聚焦回它） */
  const kbFocusRef = useRef<HTMLElement | null>(null);

  /** 当前页内的可交互条目（分页后其它页为 display:none，不可聚焦） */
  const activePageItems = useCallback((): HTMLElement[] => {
    const aside = asideRef.current;
    if (!aside) return [];
    const page = aside.querySelector<HTMLElement>('.sidebar-page[data-active]');
    if (!page) return [];
    return Array.from(page.querySelectorAll<HTMLElement>('.sidebar-item'));
  }, []);

  /**
   * 键盘分区（sidebar）：主窗口与选择器窗口均注册——Tab 分区循环聚焦
   * 进来时落到当前路径对应条目（或上次聚焦条目/首项）；区内 ↑/↓ 在
   * 当前页的可交互条目间移动焦点，跨页边界自动翻页，Enter/Space
   * 由条目自身处理（原生按钮/既有 onKeyDown）。
   */
  useEffect(() => {
    return registerKeyboardZone({
      id: 'sidebar',
      focus: () => {
        // 只在当前页内找焦点目标：其它页为 display:none，focus() 静默失败
        const items = activePageItems();
        const all = items.length > 0
          ? items
          : Array.from(asideRef.current?.querySelectorAll<HTMLElement>('.sidebar-item') ?? []);
        if (all.length === 0) return;
        // 用户定案：Tab 循环要经过折叠按钮与内建终端按钮——进入分区时
        // 先落在头部第一个按钮，再由区内 Tab 依次前进到条目
        const headerBtn = asideRef.current?.querySelector<HTMLElement>('.sidebar-header-btn');
        if (headerBtn) {
          headerBtn.focus();
          return;
        }
        const page = asideRef.current?.querySelector<HTMLElement>('.sidebar-page[data-active]');
        const target =
          all.find((el) => el.classList.contains('active')) ??
          (kbFocusRef.current && page?.contains(kbFocusRef.current) ? kbFocusRef.current : null) ??
          all[0];
        target.focus();
      },
    });

  }, [activePageItems]);

  /**
   * 翻页后把焦点落到新页的首/末条（rAF：等 React 提交 DOM 更新）。
   * 收起态恒为第 0 页，不需要处理。
   */
  const focusEdgeItem = useCallback((position: 'first' | 'last') => {
    requestAnimationFrame(() => {
      const items = activePageItems();
      if (items.length === 0) return;
      (position === 'first' ? items[0] : items[items.length - 1])?.focus();
    });
  }, [activePageItems]);

  // 供文档级监听器读取最新数据（监听器在 effect 中注册一次，见 TabBar 同款模式）
  const placesRef = useRef(places);
  const devicesRef = useRef(devices);
  const gvfsVolumesRef = useRef(gvfsVolumes);
  const onDropFilesRef = useRef(onDropFiles);
  const onPinObjectRef = useRef(onPinObject);
  const onMovePinAcrossRef = useRef(onMovePinAcross);
  useEffect(() => {
    placesRef.current = places;
    devicesRef.current = devices;
    gvfsVolumesRef.current = gvfsVolumes;
    onDropFilesRef.current = onDropFiles;
    onPinObjectRef.current = onPinObject;
    onMovePinAcrossRef.current = onMovePinAcross;
  });

  useEffect(() => {
    if (window.electron.getPlaces) {
      window.electron.getPlaces().then(setPlaces);
    }
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let cleanup: (() => void) | null = null;

    const init = async () => {
      if (!window.electron.getAllDevices) return;
      const d = await window.electron.getAllDevices();
      setDevices(d);

      const hasWatcher = await window.electron.hasDeviceWatcher();
      if (hasWatcher) {
        cleanup = window.electron.onDeviceChange(setDevices);
      } else {
        interval = setInterval(async () => {
          const d = await window.electron.getAllDevices();
          setDevices(d);
        }, 5000);
      }
    };
    init();

    return () => {
      if (interval) clearInterval(interval);
      if (cleanup) cleanup();
    };
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let cleanup: (() => void) | null = null;

    const refresh = async () => {
      if (!window.electron.getGvfsVolumes) return;
      const volumes = await window.electron.getGvfsVolumes();
      setGvfsVolumes(volumes);
    };

    const init = async () => {
      if (!window.electron.getGvfsVolumes) return;
      await refresh();
      if (window.electron.onGvfsChange) {
        cleanup = window.electron.onGvfsChange(setGvfsVolumes);
        // 订阅间隙可能漏掉变更：订阅后补拉一次兜底
        void refresh();
      } else {
        interval = setInterval(() => { void refresh(); }, 5000);
      }
    };
    init();

    return () => {
      if (interval) clearInterval(interval);
      if (cleanup) cleanup();
    };
  }, []);

  const externalDisks = devices.filter(isExternalDevice);

  // ── 分页状态与翻页（取代原滚动容器方案） ──


  /**
   * 翻页：delta = ±1。默认**循环**（末页继续翻回到首页，首页反向翻到
   * 末页）；拖拽边缘自动翻页传 wrap=false（避免停在边缘无限翻页）。
   * 页数以参数传入（调用方各自持有当次渲染的 pageCount），避免 ref 同步。
   */
  const flipPage = useCallback((delta: number, count: number, wrap = true) => {
    if (count <= 1) return;
    // 新页从翻页方向的对侧滑入（动画在 display:none → flex 时重新触发）
    asideRef.current?.style.setProperty(
      '--sidebar-slide-x',
      delta > 0 ? '24px' : '-24px',
    );
    setPageIndex((prev) => {
      const next = prev + delta;
      if (wrap) return ((next % count) + count) % count;
      return Math.max(0, Math.min(next, count - 1));
    });
  }, []);

  /** 分页内容区尺寸测量：可用高度决定每页容纳多少条目 */
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const update = () => setBodyHeight(el.clientHeight - BODY_TOP_PADDING);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * 行高常量校验：CSS 改了但 ROW_H 忘了改时，分页会出现半条截断或
   * 大片空白。以实测条目高度为准并告警（不自动改常量——常量在模块级）。
   */
  useEffect(() => {
    const item = bodyRef.current?.querySelector<HTMLElement>('.sidebar-item');
    if (!item) return;
    const h = Math.round(item.getBoundingClientRect().height);
    const expected = collapsed ? COLLAPSED_ROW_H : ROW_H;
    if (h > 0 && h !== expected) {
      console.warn(
        `[sidebar] 条目实测高度 ${h}px 与分页常量 ${expected}px 不一致，` +
        '分页可能出现截断/空白，请同步 ROW_H（Sidebar.tsx）与 .sidebar-item（Sidebar.css）',
      );
    }
  }, [collapsed, places.length, pinnedDirs.length, devices.length, gvfsVolumes.length]);

  // ── 拖拽边缘自动翻页（原边缘自动滚动的替代） ──

  /** 边缘翻页定时器与当前方向（0 = 不在边缘区） */
  const edgeFlipRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const edgeDirRef = useRef<0 | -1 | 1>(0);

  const stopEdgeFlip = useCallback(() => {
    if (edgeFlipRef.current !== null) {
      clearInterval(edgeFlipRef.current);
      edgeFlipRef.current = null;
    }
    edgeDirRef.current = 0;
  }, []);

  /**
   * 拖拽中把光标 Y 映射为翻页方向：进入上/下边缘区后每
   * EDGE_FLIP_INTERVAL_MS 翻一页（持续停留可连续翻页），离开即停。
   * 分页后没有滚动容器，这是跨页拖放的唯一途径。
   */
  const updateDragEdge = useCallback((clientY: number) => {
    const el = asideRef.current;
    if (!el) {
      stopEdgeFlip();
      return;
    }
    const rect = el.getBoundingClientRect();
    let dir: 0 | -1 | 1 = 0;
    if (clientY < rect.top + EDGE_ZONE_PX) dir = -1;
    else if (clientY > rect.bottom - EDGE_ZONE_PX) dir = 1;
    if (dir === 0) {
      stopEdgeFlip();
      return;
    }
    if (edgeDirRef.current === dir) return;
    stopEdgeFlip();
    edgeDirRef.current = dir;
    // 页数从 DOM 读取：回调保持稳定，不因翻页重建文档级监听
    const count = el.querySelectorAll('.sidebar-page').length;
    edgeFlipRef.current = setInterval(() => flipPage(dir, count, false), EDGE_FLIP_INTERVAL_MS);
  }, [flipPage, stopEdgeFlip]);

  useEffect(() => () => stopEdgeFlip(), [stopEdgeFlip]);

  // ── 同窗口拖放到侧边栏条目 ──

  /**
   * 把拖放目标标识解析为可落点的真实路径：
   * - place:<path> → 直接返回（含 trash://）
   * - device:<devicePath> → 已挂载返回挂载点；未挂载先挂载再取挂载点；
   *   无法挂载（无文件系统等）提示并返回 null
   * - gvfs:<key> → 已挂载返回挂载点；未挂载先经稳健挂载流程再取挂载点
   */
  const resolveDropTarget = useCallback(async (key: string): Promise<string | null> => {
    if (key.startsWith(TARGET_PREFIX_PLACE)) {
      return key.slice(TARGET_PREFIX_PLACE.length);
    }
    if (key.startsWith(TARGET_PREFIX_DEVICE)) {
      const devicePath = key.slice(TARGET_PREFIX_DEVICE.length);
      const device = findDeviceByPath(devicesRef.current, devicePath);
      if (!device) return null;
      if (device.mounted && device.mountpoint) return device.mountpoint;
      if (
        onDeviceMount &&
        (device.type === "part" || (device.type === "disk" && device.fstype))
      ) {
        const result = await onDeviceMount(device.devicePath);
        if (result.success && result.mountpoint) return result.mountpoint;
        return null;
      }
      showToast(t("device.cannot_mount"), "warning");
      return null;
    }
    if (key.startsWith(TARGET_PREFIX_GVFS)) {
      const gk = key.slice(TARGET_PREFIX_GVFS.length);
      const volume = gvfsVolumesRef.current.find(
        (v) => (v.mountpoint ?? v.deviceId ?? v.name) === gk,
      );
      if (!volume) return null;
      if (volume.mounted && volume.mountpoint) return volume.mountpoint;
      if (onGvfsMount && volume.deviceId) {
        const result = await onGvfsMount(volume);
        if (result.success && result.mountpoint) return result.mountpoint;
        return null;
      }
      return null;
    }
    return null;
  }, [onDeviceMount, onGvfsMount]);

  /**
   * 处理落在侧边栏条目上的内部拖放：
   * 读取拖拽状态 → 结束拖拽 → 分派目标类型：
   * - pin: → 校验单个文件夹后固定（armed 状态解除）
   * - place:/device:/gvfs: → 解析目标路径（可能挂载设备）→
   *   同目录拦截 → 交给 App 转发执行（对话框/冲突/任务由 ExplorerTab 复用）。
   */
  const handleSidebarDrop = useCallback(async (e: DragEvent, targetKey: string) => {
    const dragState = getDragState();
    if (!dragState || dragState.files.length === 0) return;
    const operation: "move" | "copy" = e.shiftKey ? "copy" : "move";
    const files = dragState.files;
    const sourcePath = dragState.sourcePath;
    endDrag();

    if (targetKey === TARGET_PIN) {
      // 拖到固定按钮：仅接受单个文件夹（回收站条目不可固定）
      if (
        files.length === 1 &&
        files[0].isDirectory &&
        !files[0].trashOriginalPath
      ) {
        onPinPath(files[0].path);
      } else {
        showToast(t("sidebar.pin_single_folder"), "info");
      }
      return;
    }

    const targetPath = await resolveDropTarget(targetKey);
    if (!targetPath) return;
    if (targetPath === sourcePath) {
      showToast(t("drop.same_dir"), "info");
      return;
    }
    onDropFilesRef.current?.(targetPath, files, operation, sourcePath);
  }, [getDragState, endDrag, resolveDropTarget, onPinPath]);

  /**
   * 文档级捕获监听 + elementFromPoint 定位侧边栏条目（TabBar 同款模式）：
   * 本应用发起拖拽时 dragstart 里同步调用 webContents.startDrag，HTML5
   * 会话立即终止，元素级 onDrop 不可靠，因此用坐标命中路由。
   * 只接受同窗口内部拖拽（dragState 存活），跨窗口/外部拖放不作为目标。
   */
  useEffect(() => {
    // 选择器变体不参与拖放落点：只导航、不接收文件
    if (isPicker) return;

    /** 从光标坐标解析命中的侧边栏拖放目标标识（无目标返回 null） */
    const resolveTargetAt = (x: number, y: number): string | null => {
      const el = document.elementFromPoint(x, y);
      const item = el?.closest("[data-sidebar-target]") as HTMLElement | null;
      return item?.dataset.sidebarTarget ?? null;
    };

    const onDragOver = (e: DragEvent) => {
      // 对象投影拖拽：**只有「添加固定」按钮接受**（TARGET_PIN）。
      // 已固定条目对文件夹拖放是「移动/复制进去」语义，对象无此语义
      // ——悬停已固定条目/间隙/其他区域一律不 preventDefault（浏览器
      // 不派发 drop，落上无反应）。载荷来源双通道：HTML5 会话内拖拽的
      // dragover 直接派发到光标下元素（composedPath 定位比 elementFromPoint
      // 更可靠——软件渲染下坐标命中偶发失效，TabBar 同款手法）；原生
      // 拖出（对象行与文件 DnD 同款架构）的 dragover 无 MIME，回落
      // DragContext 登记。
      const objectDragPayload = readObjectDrag(e) ?? getDragState()?.object ?? null;
      if (objectDragPayload) {
        const path = e.composedPath ? e.composedPath() : [];
        const hit = path.find((n): n is Element => n instanceof Element) ?? null;
        // 在侧边栏内即驱动边缘自动滚动（固定项多时「添加固定」按钮
        // 可能被推到折叠线下方——拖到上下边缘滚动以露出落点）
        if (hit?.closest?.('.sidebar')) {
          updateDragEdge(e.clientY);
        } else {
          stopEdgeFlip();
          setDragOverTarget(null);
          return;
        }
        const targetEl = hit?.closest?.('[data-sidebar-target]') as HTMLElement | null;
        const target = targetEl?.dataset.sidebarTarget ?? null;
        if (target !== TARGET_PIN) {
          setDragOverTarget(null);
          return;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        setDragOverTarget(target);
        return;
      }
      // 固定区互拖（仪表盘固定项拖入）：固定区内 preventDefault 使 drop
      // 派发（条目级 reorder 处理器对非本侧起拖不 preventDefault——pinDrag
      // 为 null 早退；载荷前缀自证来源，无需全局排序标志——仪表盘起拖
      // 不置该标志）
      if ((e.dataTransfer?.getData('text/plain') ?? '').startsWith('dashboard:')) {
        const path = e.composedPath ? e.composedPath() : [];
        const hit = path.find((n): n is Element => n instanceof Element) ?? null;
        if (hit?.closest?.('[data-sidebar-pin-zone]')) {
          e.preventDefault();
          e.dataTransfer!.dropEffect = 'move';
        }
        return;
      }
      const dragState = getDragState();
      if (!dragState || dragState.files.length === 0) {
        // 非内部拖拽：不接受，也不高亮
        setDragOverTarget(null);
        stopEdgeFlip();
        return;
      }
      const target = resolveTargetAt(e.clientX, e.clientY);
      if (!target) {
        setDragOverTarget(null);
        stopEdgeFlip();
        return;
      }
      // 「添加固定」只接受单个文件夹：文件/多选拖到这里不提示、不接受
      // （不 preventDefault → 浏览器不派发 drop，也没有高亮）
      if (target === TARGET_PIN) {
        const ds0 = getDragState();
        const ok = !!ds0 && ds0.files.length === 1
          && ds0.files[0].isDirectory && !ds0.files[0].trashOriginalPath;
        if (!ok) {
          setDragOverTarget(null);
          stopEdgeFlip();
          return;
        }
      }
      // 接受放置：drop 事件才会派发
      e.preventDefault();
      e.dataTransfer!.dropEffect = e.shiftKey ? "copy" : "move";
      setDragOverTarget(target);
      updateDragEdge(e.clientY);
    };

    const onDrop = (e: DragEvent) => {
      setDragOverTarget(null);
      stopEdgeFlip();
      // 对象投影松手：只有「添加固定」按钮接受（与 dragover 同源判定；
      // 载荷 MIME 优先，原生拖出回落 DragContext 登记）
      const objectDragPayload = readObjectDrag(e) ?? getDragState()?.object ?? null;
      if (objectDragPayload) {
        const path = e.composedPath ? e.composedPath() : [];
        const hit = path.find((n): n is Element => n instanceof Element) ?? null;
        const targetEl = hit?.closest?.('[data-sidebar-target]') as HTMLElement | null;
        if (targetEl?.dataset.sidebarTarget !== TARGET_PIN) return;
        e.preventDefault();
        e.stopPropagation();
        onPinObjectRef.current?.(objectDragPayload);
        return;
      }
      // 固定区互拖：仪表盘固定项松手在固定区（含列表空白/间隙）→ 移动
      // 到侧边栏（末尾追加；松手在具体条目上时不消费——条目级 drop
      // 处理器按插入位置移动，见 handlePinReorderDrop/handlePinGapDrop）
      if ((e.dataTransfer?.getData('text/plain') ?? '').startsWith('dashboard:')) {
        const path = e.composedPath ? e.composedPath() : [];
        const hit = path.find((n): n is Element => n instanceof Element) ?? null;
        if (hit?.closest?.('.sidebar-item[data-sidebar-target]')) return;
        if (hit?.closest?.('[data-sidebar-pin-zone]')) {
          const from = Number((e.dataTransfer?.getData('text/plain') ?? '').slice('dashboard:'.length));
          if (Number.isInteger(from)) {
            e.preventDefault();
            e.stopPropagation();
            onMovePinAcrossRef.current?.('dashboard', from, 'sidebar');
          }
        }
        return;
      }
      // 幻影 drop-back（本窗口刚发起过拖拽，真实 drop 落在其他窗口）：忽略
      if (shouldSuppressDrop()) return;
      const dragState = getDragState();
      if (!dragState || dragState.files.length === 0) return;
      const target = resolveTargetAt(e.clientX, e.clientY);
      if (!target) return;
      if (target === TARGET_PIN) {
        const ok = dragState.files.length === 1
          && dragState.files[0].isDirectory && !dragState.files[0].trashOriginalPath;
        // 文件拖到「添加固定」：不反应、不接受
        if (!ok) return;
      }

      e.preventDefault();
      e.stopPropagation();
      void handleSidebarDrop(e, target);
    };

    // 拖拽结束（真实或合成）时清除高亮与自动滚动，杜绝"高亮卡死"
    const onDragEnd = () => {
      setDragOverTarget(null);
      stopEdgeFlip();
    };

    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("dragend", onDragEnd, true);
    return () => {
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dragend", onDragEnd, true);
      stopEdgeFlip();
    };
  }, [getDragState, handleSidebarDrop, stopEdgeFlip, updateDragEdge, isPicker]);

  /**
   * gvfs 卷点击：已挂载 → 进入目录；未挂载 → 挂载后进入。
   *
   * 挂载前先拉最新卷列表（点击即刷新）：手机切换 USB 模式（仅充电 →
   * 传输文件）会重枚举，总线地址漂移且侧边栏快照最长滞后约 3.3s，
   * 直接用快照的 deviceId 挂载会命中旧地址。刷新后：
   * - 同名卷已挂载 → 直接进入（自动挂载竞态）
   * - 同名卷换了新 deviceId → 用新地址挂载
   * - 卷暂时不在列表（正在重枚举）→ 等 1.2s 重查一次
   * 挂载成功但没有挂载点时补查一次列表，按名找挂载点跳转。
   */
  const handleGvfsClick = async (volume: GvfsVolume) => {
    if (volume.mounted && volume.mountpoint) {
      onNavigate(volume.mountpoint);
      return;
    }
    if (!onGvfsMount || !volume.deviceId) return;

    const refresh = async (): Promise<GvfsVolume[]> => {
      const latest = await window.electron.getGvfsVolumes();
      setGvfsVolumes(latest);
      return latest;
    };

    let target = volume;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const latest = await refresh();
        const nowMounted = latest.find(v => v.mounted && v.mountpoint && v.name === volume.name);
        if (nowMounted?.mountpoint) {
          onNavigate(nowMounted.mountpoint);
          return;
        }
        const fresh = latest.find(v => !v.mounted && v.deviceId && v.name === volume.name);
        if (fresh) {
          target = fresh;
          break;
        }
        if (attempt === 0) await new Promise(r => setTimeout(r, 1200));
      } catch {
        break;
      }
    }

    const result = await onGvfsMount(target);

    // 挂载成功但暂未拿到挂载点（gvfsd 仍在收尾）：
    // 轮询列表，挂载点出现后自动跳转（每次 1.5s，最多 3 次）
    if (result.success && !result.mountpoint) {
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          const latest = await refresh();
          const nowMounted = latest.find(v => v.mounted && v.mountpoint && v.name === target.name);
          if (nowMounted?.mountpoint) {
            onNavigate(nowMounted.mountpoint);
            return;
          }
        } catch {
          break;
        }
      }
    }

    // 挂载后立即刷新列表，不等后端 3s 轮询广播
    try {
      await refresh();
    } catch { /* 刷新失败时等待轮询兜底 */ }

    if (result.success && result.mountpoint) {
      onNavigate(result.mountpoint);
    }
  };

  const handlePartitionClick = async (device: AllDevice) => {
    if (device.mounted && device.mountpoint) {
      onNavigate(device.mountpoint);
    } else if (
      onDeviceMount &&
      (device.type === "part" || (device.type === "disk" && device.fstype))
    ) {
      const result = await onDeviceMount(device.devicePath);
      if (result.success && result.mountpoint) {
        onNavigate(result.mountpoint);
      }
    } else if (!device.mounted) {
      // 无文件系统（未格式化）等无法挂载的设备：明确提示
      showToast(t("device.cannot_mount"), "warning");
    }
  };

  // ── 固定目录 ──

  /**
   * 通过系统文件管理器选择目录固定（固定按钮右键菜单入口）。
   * pickDirectory → stat 校验目录 → 交给 App 侧 onPinPath（去重 + toast）。
   */
  const handleAddPinned = async () => {
    if (!window.electron.pickDirectory) return;
    const path = await window.electron.pickDirectory();
    if (!path) return;
    const stat = await window.electron.stat(path);
    if (!stat || !stat.isDirectory) return;
    onPinPath(path);
  };

  /**
   * 左键点击固定按钮：打开内置文件选择器（文件夹模式，支持多选）批量固定目录。
   * openPicker → 逐个 stat 校验目录 → onPinPath（App 侧去重 + toast）。
   * 拖文件夹到按钮上固定不受影响（handleSidebarDrop 的 pin 分支独立）。
   */
  const handlePickPinDir = async () => {
    if (!window.electron?.openPicker) return;
    const picked = await window.electron.openPicker({ mode: 'folder' });
    if (!picked || picked.length === 0) return;
    for (const path of picked) {
      const stat = await window.electron.stat(path);
      if (!stat || !stat.isDirectory) continue;
      onPinPath(path);
    }
  };

  /** 移除固定目录（悬停时条目右侧的关闭按钮） */
  const handleRemovePinned = (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    onUnpinPath(path);
  };

  // ── 固定目录拖拽排序（仅调整顺序，其他区域不接收） ──

  /** 上半/下半区分界死区（像素）：光标在中线 ± 该值时保持当前间隙，
   *  避免鼠标在中线附近微抖导致插入位置来回翻转（闪动）。 */
  const PIN_HALF_BAND_PX = 4;

  /**
   * 固定区排序拖拽状态：from 为源条目在 pinnedDirs 中的原始索引，
   * gap 为当前插入间隙（0..n-1，n = 固定项总数——即去掉源条目后
   * 剩余列表中的插入位置：0 = 最前，n-1 = 最后）；null = 未悬停任何
   * 固定项，不显示占位。源索引同时写入 dataTransfer（text/plain）：
   * nativeDragTracker 在真实 drop 的捕获阶段会补发合成 dragend
   * （Dashboard 同款坑），state 可能被提前清空——drop 时以 dataTransfer
   * 读到的源索引为准。
   */
  const [pinDrag, setPinDrag] = useState<{ from: number; gap: number | null } | null>(null);

  /** 拖拽会话是否仍在进行（同步于 dragstart/dragend 与 drop）：
   *  起拖时经 rAF 延迟更新状态（保证浏览器先截取拖拽图像再隐藏
   *  源条目），回调执行前拖拽可能已结束——经此 ref 丢弃过期更新。 */
  const pinReorderActiveRef = useRef(false);

  /**
   * 计算排序插入间隙：悬停条目上半区 → 插到它前面，下半区 → 插到它后面。
   * 源条目位于悬停条目上方时，去掉源条目后悬停条目下标左移 1，
   * 需减去 (from < hoverIndex ? 1 : 0) 补偿，保证间隙基于
   * 「去掉源条目后的剩余列表」语义（与 App 侧 splice(from,1) 一致）。
   */
  const computePinReorderGap = (hoverIndex: number, clientY: number, rect: DOMRect, from: number): number => {
    const lowerHalf = clientY >= rect.top + rect.height / 2;
    return hoverIndex + (lowerHalf ? 1 : 0) - (from < hoverIndex ? 1 : 0);
  };

  /**
   * 拖拽期间的固定区渲染清单：源条目隐藏本体（display:none，仍保留
   * 在 DOM 末尾以接收 dragend），其余条目保持原顺序不动；插入间隙处
   * 生成一个空占位按钮（边界由 CSS 描绘）。列表本身不再随拖拽移位，
   * 反馈只有一个占位元素——消除「实时重排」的反馈回路振荡。
   */
  const pinRenderList = useMemo<PinRenderEntry[]>(() => {
    if (!pinDrag) return pinnedDirs.map((item, i) => ({ kind: 'item', item, origIndex: i }));
    const entries: PinRenderEntry[] = [];
    const { from, gap } = pinDrag;
    for (let i = 0; i < pinnedDirs.length; i++) {
      if (i === from) continue;
      if (gap !== null && i - (from < i ? 1 : 0) === gap) {
        entries.push({ kind: 'gap', gap });
      }
      entries.push({ kind: 'item', item: pinnedDirs[i], origIndex: i });
    }
    if (gap === pinnedDirs.length - 1) entries.push({ kind: 'gap', gap });
    // 源条目留在 DOM（display:none）：若移出 DOM，取消拖拽（ESC）时
    // dragend 不派发，隐藏状态无法清理
    entries.push({ kind: 'item', item: pinnedDirs[from], origIndex: from, hidden: true });
    return entries;
  }, [pinDrag, pinnedDirs]);

  /**
   * 排序拖拽发起：源索引同步写入 dataTransfer（drop 时读取）；
   * 隐藏源本体的状态更新延迟到下一帧——先让浏览器截取拖拽图像
   * （此时源条目仍可见），否则截到的拖拽图像为空白。
   * 从条目右侧移除按钮（×）按下时不起拖（那是取消固定交互）。
   */
  const handlePinReorderDragStart = (e: React.DragEvent, index: number) => {
    if (isPicker || !onReorderPin) return;
    if ((e.target as HTMLElement).closest('.sidebar-pin-remove')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `sidebar:${index}`);
    pinReorderActiveRef.current = true;
    // 全局排序拖拽标志：文件落点目标（文件区/地址栏/标签页等）据此
    // 忽略本次拖拽，不显示「可放置」的误导性高亮（dragend 时清除）
    setPinReorderDragActive(true);
    requestAnimationFrame(() => {
      if (!pinReorderActiveRef.current) return;
      setPinDrag({ from: index, gap: null });
    });
  };

  /**
   * 悬停到某固定项：按上/下半区计算插入间隙（中线 ± 死区时保持
   * 当前值），间隙变化时移动占位（仅排序拖拽自身，文件拖放由
   * 文档级路由处理）。
   */
  const handlePinReorderDragOver = (e: React.DragEvent, index: number) => {
    if (isPicker || !pinDrag) return;
    // 对象投影拖拽：不 preventDefault——让事件冒泡到固定区容器级
    // 对象落点处理器（否则投影落点被排序逻辑吞掉）
    if (isObjectDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (pinDrag.gap !== null && Math.abs(e.clientY - mid) <= PIN_HALF_BAND_PX) return;
    const gap = computePinReorderGap(index, e.clientY, rect, pinDrag.from);
    // dragover 高频事件：同值早退，仅在间隙变化时更新占位
    setPinDrag((prev) => (prev && prev.gap !== gap ? { ...prev, gap } : prev));
  };

  /** 悬停到插入间隙占位本身：占位即当前间隙，保持并接受放置 */
  const handlePinGapDragOver = (e: React.DragEvent, gap: number) => {
    if (isPicker || !pinDrag) return;
    if (isObjectDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setPinDrag((prev) => (prev && prev.gap !== gap ? { ...prev, gap } : prev));
  };

  /** 拖离固定区（进入其他区域/空白）时收起占位 */
  const handlePinReorderListLeave = (e: React.DragEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (e.relatedTarget && el.contains(e.relatedTarget as Node)) return;
    setPinDrag((prev) => (prev ? { ...prev, gap: null } : prev));
  };

  /**
   * 松手确认（落在真实固定项上）：光标仍在中线死区内时提交当前
   * 显示的占位间隙（所见即所得），否则按落下位置重新计算；
   * 把源条目移动到该间隙（App 侧持久化）；无效索引/原位置
   * （间隙 == 源位置）不做任何事。
   */
  const handlePinReorderDrop = (e: React.DragEvent, index: number) => {
    if (isPicker) return;
    // 对象投影拖拽：不 preventDefault/stopPropagation——事件冒泡到
    // 固定区容器级对象落点处理器
    if (isObjectDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const fromRaw = e.dataTransfer.getData('text/plain');
    if (fromRaw.startsWith('dashboard:')) {
      const from = Number(fromRaw.slice('dashboard:'.length));
      setPinDrag(null);
      if (Number.isInteger(from)) onMovePinAcross?.('dashboard', from, 'sidebar', index);
      return;
    }
    if (!fromRaw.startsWith('sidebar:')) {
      setPinDrag(null);
      return;
    }
    const from = Number(fromRaw.slice('sidebar:'.length));
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    let gap: number;
    if (pinDrag && pinDrag.gap !== null && Math.abs(e.clientY - mid) <= PIN_HALF_BAND_PX) {
      gap = pinDrag.gap;
    } else {
      gap = computePinReorderGap(index, e.clientY, rect, from);
    }
    setPinDrag(null);
    if (!Number.isFinite(from) || from === gap) return;
    onReorderPin?.(from, gap);
  };

  /** 松手确认（落在插入间隙占位上）：占位的间隙即目标位置 */
  const handlePinGapDrop = (e: React.DragEvent, gap: number) => {
    if (isObjectDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const fromRaw = e.dataTransfer.getData('text/plain');
    if (fromRaw.startsWith('dashboard:')) {
      const from = Number(fromRaw.slice('dashboard:'.length));
      setPinDrag(null);
      if (Number.isInteger(from)) onMovePinAcross?.('dashboard', from, 'sidebar', gap);
      return;
    }
    if (!fromRaw.startsWith('sidebar:')) {
      setPinDrag(null);
      return;
    }
    const from = Number(fromRaw.slice('sidebar:'.length));
    setPinDrag(null);
    if (!Number.isFinite(from) || from === gap) return;
    onReorderPin?.(from, gap);
  };

  /** 拖拽结束（含取消/落点未被接收）：清除状态，源条目恢复显示 */
  const handlePinReorderDragEnd = () => {
    pinReorderActiveRef.current = false;
    setPinReorderDragActive(false);
    setPinDrag(null);
  };

  // ── 分页节点 ──
  // 第一部分（固定快捷方式）与第二部分（固定目录 + 设备）各自独立分页，
  // 互不混页。节点高度含条目下间距，供 paginateNodes 切页。

  /** 第一部分：仪表盘 → 文件位置 → 设置 → 对象面板 → 回收站 */
  const fixedNodes: SidebarNode[] = (() => {
    const nodes: SidebarNode[] = [];
    const itemH = (collapsed ? COLLAPSED_ROW_H : ROW_H) + ROW_GAP;

    if (!isPicker && showDashboardPlace) {
      const active = currentPath === "app://dashboard";
      nodes.push({
        key: "fixed:dashboard",
        height: itemH,
        node: (
          <button
            key="fixed:dashboard"
            className={`sidebar-item ${active ? "active" : ""}`}
            tabIndex={-1}
            title={t("sidebar.dashboard")}
            onClick={() => goWithPride("app://dashboard", "fixed:dashboard")}
            {...prideAttrs("fixed:dashboard", active, false)}
            onContextMenu={(e) => {
              if (!onPlaceContextMenu) return;
              e.preventDefault();
              e.stopPropagation();
              onPlaceContextMenu(e, {
                name: "Dashboard",
                path: "app://dashboard",
                icon: "dashboard",
              });
            }}
          >
            <Icon name="dashboard" className="sidebar-icon" filled={active} />
            <span className="sidebar-label">
              <MarqueeText enabled={marqueeEnabled}>{t("sidebar.dashboard")}</MarqueeText>
            </span>
          </button>
        ),
      });
    }

    // 文件位置（主页/桌面/文档/…）：该位置已被固定时，高亮让位给固定条目
    for (const place of places.filter((p) => p.name !== "Trash")) {
      const pinnedSamePath = pinnedDirs.some((p) => p.path === place.path);
      const active = !pinnedSamePath && currentPath === place.path;
      const label = getPlaceLabel(place.name);
      nodes.push({
        key: `fixed:place:${place.path}`,
        height: itemH,
        node: (
          <button
            key={`fixed:place:${place.path}`}
            className={`sidebar-item ${active ? "active" : ""} ${dragOverTarget === `${TARGET_PREFIX_PLACE}${place.path}` ? "drag-over" : ""}`}
            data-sidebar-target={`${TARGET_PREFIX_PLACE}${place.path}`}
            tabIndex={-1}
            title={label}
            onClick={() => goWithPride(place.path, `fixed:place:${place.path}`)}
            {...prideAttrs(`fixed:place:${place.path}`, active, dragOverTarget === `${TARGET_PREFIX_PLACE}${place.path}`)}
            onContextMenu={(e) => {
              if (!onPlaceContextMenu) return;
              e.preventDefault();
              e.stopPropagation();
              onPlaceContextMenu(e, place);
            }}
          >
            <Icon
              name={getPlaceIcon(place.name)}
              className="sidebar-icon"
              filled={!pinnedSamePath && currentPath.startsWith(place.path)}
            />
            <span className="sidebar-label">
              <MarqueeText enabled={marqueeEnabled}>{label}</MarqueeText>
            </span>
          </button>
        ),
      });
    }

    if (!isPicker) {
      const active = currentPath.startsWith("settings://");
      nodes.push({
        key: "fixed:settings",
        height: itemH,
        node: (
          <button
            key="fixed:settings"
            className={`sidebar-item ${active ? "active" : ""}`}
            tabIndex={-1}
            title={t("settings.title")}
            onClick={() => goWithPride("settings://", "fixed:settings")}
            {...prideAttrs("fixed:settings", active, false)}
          >
            <Icon name="settings" className="sidebar-icon" filled={active} />
            <span className="sidebar-label">
              <MarqueeText enabled={marqueeEnabled}>{t("settings.title")}</MarqueeText>
            </span>
          </button>
        ),
      });
    }

    if (!isPicker && showObjectsPlace) {
      const active = currentPath.startsWith("objects://");
      nodes.push({
        key: "fixed:objects",
        height: itemH,
        node: (
          <button
            key="fixed:objects"
            className={`sidebar-item ${active ? "active" : ""}`}
            tabIndex={-1}
            title={t("objects.title")}
            onClick={() => goWithPride("objects://", "fixed:objects")}
            {...prideAttrs("fixed:objects", active, false)}
          >
            <Icon name="widgets" className="sidebar-icon" filled={active} />
            <span className="sidebar-label">
              <MarqueeText enabled={marqueeEnabled}>{t("objects.title")}</MarqueeText>
            </span>
          </button>
        ),
      });
    }

    if (!hideTrash) {
      const place = places.find((p) => p.name === "Trash");
      if (place) {
        const pinnedSamePath = pinnedDirs.some((p) => p.path === place.path);
        const active = !pinnedSamePath && currentPath === place.path;
        const label = getPlaceLabel(place.name);
        nodes.push({
          key: `fixed:place:${place.path}`,
          height: itemH,
          node: (
            <button
              key={`fixed:place:${place.path}`}
              className={`sidebar-item ${active ? "active" : ""} ${dragOverTarget === `${TARGET_PREFIX_PLACE}${place.path}` ? "drag-over" : ""}`}
              data-sidebar-target={`${TARGET_PREFIX_PLACE}${place.path}`}
              tabIndex={-1}
              title={label}
              onClick={() => goWithPride(place.path, `fixed:place:${place.path}`)}
              {...prideAttrs(`fixed:place:${place.path}`, active, dragOverTarget === `${TARGET_PREFIX_PLACE}${place.path}`)}
              onContextMenu={(e) => {
                if (!onPlaceContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                onPlaceContextMenu(e, place);
              }}
            >
              <Icon
                name={getPlaceIcon(place.name)}
                className="sidebar-icon"
                filled={!pinnedSamePath && currentPath.startsWith(place.path)}
              />
              <span className="sidebar-label">
                <MarqueeText enabled={marqueeEnabled}>{label}</MarqueeText>
              </span>
            </button>
          ),
        });
      }
    }

    return nodes;
  })();

  /** 第二部分：已固定目录（含拖拽占位）→ 添加固定按钮 → 设备 */
  const pinnedNodes: SidebarNode[] = (() => {
    const nodes: SidebarNode[] = [];
    const itemH = (collapsed ? COLLAPSED_ROW_H : ROW_H) + ROW_GAP;
    const titleH = SECTION_TITLE_H + SECTION_TITLE_TOP + ROW_GAP;

    if (pinnedDirs.length > 0) {
      nodes.push({
        key: "pinned:title",
        height: titleH,
        node: <h3 key="pinned:title" className="sidebar-title">{t("sidebar.pinned")}</h3>,
      });
      for (const entry of pinRenderList) {
        if (entry.kind === "gap") {
          nodes.push({
            key: `pinned:gap:${entry.gap}`,
            height: itemH,
            node: (
              <div
                key={`pinned:gap:${entry.gap}`}
                className="sidebar-item sidebar-pin-gap"
                onDragOver={(e) => handlePinGapDragOver(e, entry.gap)}
                onDrop={(e) => handlePinGapDrop(e, entry.gap)}
              />
            ),
          });
          continue;
        }
        const item = entry.item;
        const origIndex = entry.origIndex;
        nodes.push({
          key: `pinned:${item.path}`,
          // 拖拽中的源条目 display:none，不占高度
          height: entry.hidden ? 0 : itemH,
          node: (
            <div
              key={`pinned:${item.path}`}
              className={`sidebar-item ${entry.hidden ? "sidebar-pin-source-hidden" : ""} ${currentPath === item.path ? "active" : ""} ${dragOverTarget === `${TARGET_PREFIX_PLACE}${item.path}` ? "drag-over" : ""}`}
              data-sidebar-target={`${TARGET_PREFIX_PLACE}${item.path}`}
              role="button"
              tabIndex={-1}
              title={item.path}
              draggable={!isPicker && !!onReorderPin}
              onDragStart={(e) => handlePinReorderDragStart(e, origIndex)}
              onDragOver={(e) => handlePinReorderDragOver(e, origIndex)}
              onDrop={(e) => handlePinReorderDrop(e, origIndex)}
              onDragEnd={handlePinReorderDragEnd}
              onContextMenu={(e) => {
                if (isPicker || !onPinnedContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                onPinnedContextMenu(e, item);
              }}
              onClick={() => goWithPride(item.path, `pinned:${item.path}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  goWithPride(item.path, `pinned:${item.path}`);
                }
              }}
              {...prideAttrs(`pinned:${item.path}`, currentPath === item.path, dragOverTarget === `${TARGET_PREFIX_PLACE}${item.path}`)}
            >
              <Icon
                name={item.icon ?? "folder"}
                className="sidebar-icon"
                filled={currentPath === item.path}
              />
              <span className="sidebar-label sidebar-pin-label">
                <MarqueeText enabled={marqueeEnabled}>{item.name}</MarqueeText>
              </span>
              {showPinBadges && origIndex < 9 && (
                <span className="sidebar-pin-badge">{origIndex + 1}</span>
              )}
              {!isPicker && (
                <IconButton
                  variant="standard"
                  onClick={(e) => handleRemovePinned(e, item.path)}
                  className="sidebar-pin-remove"
                  title={t("sidebar.unpin")}
                >
                  <Icon name="close" />
                </IconButton>
              )}
            </div>
          ),
        });
      }
    }

    if (!isPicker) {
      nodes.push({
        key: "pinned:add",
        height: itemH,
        node: (
          <div key="pinned:add" className="sidebar-section sidebar-pin-section">
            <div className="sidebar-list" data-sidebar-pin-zone="">
              <button
                className={`sidebar-item sidebar-add-pin ${dragOverTarget === TARGET_PIN ? "drag-over" : ""}`}
                data-sidebar-target={TARGET_PIN}
                tabIndex={-1}
                title={t("sidebar.add_pin")}
                onClick={() => { void handlePickPinDir(); }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setPinMenuPos({ x: e.clientX, y: e.clientY });
                }}
              >
                <Icon name="add" className="sidebar-icon" />
                <span className="sidebar-label">
                  <MarqueeText enabled={marqueeEnabled}>{t("sidebar.add_pin")}</MarqueeText>
                </span>
              </button>
            </div>
          </div>
        ),
      });
    }

    if (externalDisks.length > 0 || gvfsVolumes.length > 0) {
      nodes.push({
        key: "devices:title",
        height: titleH,
        node: <h3 key="devices:title" className="sidebar-title">{t("sidebar.devices")}</h3>,
      });

      for (const disk of externalDisks) {
        const parts = disk.children && disk.children.length > 0 ? disk.children : null;
        nodes.push({
          key: `device:${disk.name}`,
          height: DEVICE_HEADER_H + (parts ? parts.length * itemH : itemH),
          node: (
            <div key={`device:${disk.name}`} className="sidebar-device-group">
              {parts ? (
                <>
                  <div
                    className="sidebar-device-header"
                    title={`${disk.model || disk.label || disk.name} · ${disk.devicePath}`}
                  >
                    <Icon name={getDiskIcon(disk)} className="sidebar-icon" />
                    <span className="sidebar-label">
                      <MarqueeText enabled={marqueeEnabled}>
                        {disk.model || disk.label || disk.name}
                      </MarqueeText>
                    </span>
                    <div style={{ flex: 1 }} />
                    {isExternalDevice(disk) &&
                      disk.children?.every((part) => !part.mounted) && (
                      <IconButton
                        variant="standard"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeviceEject?.(disk.devicePath);
                        }}
                        className="sidebar-disk-eject"
                        title={t("device.eject")}
                      >
                        <Icon name="eject" />
                      </IconButton>
                    )}
                  </div>
                  {parts.map((part) => (
                    <SidebarPartitionItem
                      key={part.name}
                      device={part}
                      isActive={!!(part.mounted && part.mountpoint && currentPath.startsWith(part.mountpoint))}
                      onPartitionClick={(dev) => {
                        rollPride(`device-part:${dev.devicePath}`);
                        void handlePartitionClick(dev);
                      }}
                      pride={prideAttrs(
                        `device-part:${part.devicePath}`,
                        !!(part.mounted && part.mountpoint && currentPath.startsWith(part.mountpoint)),
                        dragOverTarget === `${TARGET_PREFIX_DEVICE}${part.devicePath}`,
                      )}
                      onDeviceContextMenu={onDeviceContextMenu}
                      onDeviceMount={onDeviceMount}
                      onDeviceUnmount={onDeviceUnmount}
                      marqueeEnabled={marqueeEnabled}
                      dropTarget={`${TARGET_PREFIX_DEVICE}${part.devicePath}`}
                      dragOver={dragOverTarget === `${TARGET_PREFIX_DEVICE}${part.devicePath}`}
                      tabIndex={-1}
                    />
                  ))}
                </>
              ) : (
                <SidebarPartitionItem
                  device={disk}
                  isActive={!!(disk.mounted && disk.mountpoint && currentPath.startsWith(disk.mountpoint))}
                  onPartitionClick={(dev) => {
                    rollPride(`device-part:${dev.devicePath}`);
                    void handlePartitionClick(dev);
                  }}
                  pride={prideAttrs(
                    `device-part:${disk.devicePath}`,
                    !!(disk.mounted && disk.mountpoint && currentPath.startsWith(disk.mountpoint)),
                    dragOverTarget === `${TARGET_PREFIX_DEVICE}${disk.devicePath}`,
                  )}
                  onDeviceContextMenu={onDeviceContextMenu}
                  onDeviceMount={onDeviceMount}
                  onDeviceUnmount={onDeviceUnmount}
                  onDeviceEject={onDeviceEject}
                  marqueeEnabled={marqueeEnabled}
                  showEject
                  dropTarget={`${TARGET_PREFIX_DEVICE}${disk.devicePath}`}
                  dragOver={dragOverTarget === `${TARGET_PREFIX_DEVICE}${disk.devicePath}`}
                  tabIndex={-1}
                />
              )}
            </div>
          ),
        });
      }

      for (const volume of gvfsVolumes) {
        const isActive = !!volume.mountpoint && currentPath.startsWith(volume.mountpoint);
        const gvfsKey = volume.mountpoint ?? volume.deviceId ?? volume.name;
        nodes.push({
          key: `gvfs:${gvfsKey}`,
          height: itemH,
          node: (
            <div
              key={`gvfs:${gvfsKey}`}
              className={`sidebar-item sidebar-partition ${!volume.mounted ? "unmounted" : ""} ${isActive ? "active" : ""} ${dragOverTarget === `${TARGET_PREFIX_GVFS}${gvfsKey}` ? "drag-over" : ""}`}
              data-sidebar-target={`${TARGET_PREFIX_GVFS}${gvfsKey}`}
              role="button"
              tabIndex={-1}
              title={volume.mountpoint ?? volume.deviceId ?? volume.name}
              onClick={() => { rollPride(`gvfs:${gvfsKey}`); void handleGvfsClick(volume); }}
              {...prideAttrs(`gvfs:${gvfsKey}`, isActive, dragOverTarget === `${TARGET_PREFIX_GVFS}${gvfsKey}`)}
              onContextMenu={(e) => onGvfsContextMenu?.(e, volume)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  rollPride(`gvfs:${gvfsKey}`);
                  void handleGvfsClick(volume);
                }
              }}
            >
              <Icon
                name={volume.kind === "gphoto2" ? "photo_camera" : "smartphone"}
                className="sidebar-icon"
              />
              <div className="sidebar-partition-info">
                <span className="sidebar-label">
                  <MarqueeText enabled={marqueeEnabled}>{volume.name}</MarqueeText>
                </span>
                <span className="sidebar-subtitle">
                  <MarqueeText enabled={marqueeEnabled}>
                    {volume.mounted && volume.mountpoint
                      ? volume.mountpoint
                      : volume.kind === "gphoto2"
                        ? t("device.type_gphoto2")
                        : t("device.type_mtp")}
                  </MarqueeText>
                </span>
              </div>
              {!volume.mounted ? (
                volume.deviceId && (
                  <IconButton
                    variant="standard"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleGvfsClick(volume);
                    }}
                    className="sidebar-mount-btn"
                    title={t("device.mount")}
                  >
                    <Icon name="power" />
                  </IconButton>
                )
              ) : (
                <IconButton
                  variant="standard"
                  onClick={(e) => {
                    e.stopPropagation();
                    onGvfsUnmount?.(volume);
                  }}
                  className="sidebar-eject-btn"
                  title={t("device.unmount")}
                >
                  <Icon name="eject" />
                </IconButton>
              )}
            </div>
          ),
        });
      }
    }

    return nodes;
  })();

  // ── 切页：两组分别分页后拼接，收起态恒为第 0 页 ──
  const pages: SidebarNode[][] = (() => {
    // 收起态（图标轨道）：恒定第一部分、单页——窗口太矮时由 .sidebar-body
    // 滚动（滚轮/触控板上下/触摸拖动/键盘焦点跟随），不再分页
    if (collapsed) return [fixedNodes];
    const capacity = bodyHeight > 0 ? bodyHeight : 600;
    const fixedPages = paginateNodes(fixedNodes, capacity);
    const pinnedPages = paginateNodes(pinnedNodes, capacity);
    const all = [...fixedPages, ...pinnedPages];
    return all.length > 0 ? all : [[]];
  })();

  const pageCount = pages.length;
  const currentPage = collapsed ? 0 : Math.min(pageIndex, pageCount - 1);

  /** 区内键盘：↑/↓ 在当前页条目间移动焦点，越过页边界自动翻页；
   *  Enter 显式点击焦点按钮——原生按钮的 Enter→click 合成对注入型键盘
   *  事件（e2e/辅助工具）不可靠，且 div 条目（固定/分区）自带 onKeyDown
   *  处理 Enter/Space，这里只处理原生 BUTTON，避免双重激活 */
  const handleSidebarKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      // 区内 Tab 序列：折叠按钮 → 内建终端按钮 → 当前页条目…
      // 序列尽头不 preventDefault，交给全局分区循环
      const aside = asideRef.current;
      const cur = document.activeElement as HTMLElement | null;
      if (!aside || !cur) return;
      const headerBtns = Array.from(
        aside.querySelectorAll<HTMLElement>('.sidebar-header-btn'),
      );
      const items = activePageItems();
      const hi = headerBtns.indexOf(cur);
      if (!e.shiftKey) {
        if (hi >= 0 && hi < headerBtns.length - 1) {
          e.preventDefault();
          e.stopPropagation();
          headerBtns[hi + 1].focus();
          return;
        }
        if (hi >= 0) {
          e.preventDefault();
          e.stopPropagation();
          items[0]?.focus();
          return;
        }
        return;
      }
      if (hi > 0) {
        e.preventDefault();
        e.stopPropagation();
        headerBtns[hi - 1].focus();
        return;
      }
      if (hi === 0) return;
      if (items.indexOf(cur) === 0 && headerBtns.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        headerBtns[headerBtns.length - 1].focus();
      }
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const items = activePageItems();
      if (items.length === 0) return;
      const cur = document.activeElement as HTMLElement | null;
      const idx = cur ? items.indexOf(cur) : -1;
      const down = e.key === 'ArrowDown';
      if (idx === -1) {
        // 焦点在头部按钮上：↓ 进第一个条目，↑ 进最后一个条目
        (down ? items[0] : items[items.length - 1])?.focus();
        return;
      }
      const next = idx + (down ? 1 : -1);
      if (next < 0) {
        // 循环翻页：首页再 ↑ → 末页最后一条
        if (pageCount > 1) {
          flipPage(-1, pageCount);
          focusEdgeItem('last');
        }
        return;
      }
      if (next >= items.length) {
        // 循环翻页：末页再 ↓ → 首页第一条
        if (pageCount > 1) {
          flipPage(1, pageCount);
          focusEdgeItem('first');
        }
        return;
      }
      items[next]?.focus();
      return;
    }
    if (e.key === 'Enter') {
      const t = e.target as HTMLElement | null;
      if (t && t.tagName === 'BUTTON' && asideRef.current?.contains(t)) {
        e.preventDefault();
        e.stopPropagation();
        t.click();
      }
    }
  };

  const showDots = !collapsed && pageCount > 1;

  const wheelAccRef = useRef(0);
  /** 当前累积所在主轴（'y' 竖向 / 'x' 横向）：切换主轴时清零累积 */
  const wheelAxisRef = useRef<'x' | 'y' | null>(null);
  /** 最近一次滚轮事件时间：空档超过 WHEEL_ACC_RESET_MS 后重新累计 */
  const wheelLastEventRef = useRef(0);
  const wheelLastFlipRef = useRef(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  /** 触摸滑动刚翻过页：吞掉紧随其后的 click，避免顺带导航到划到的条目 */
  const swipeSuppressClickRef = useRef(false);

  const handleSidebarWheel = (e: React.WheelEvent) => {
    // 收起态恒定第一部分第 1 页：滚轮不改变当前页（用户定案）
    if (collapsed) return;
    if (pageCount <= 1) return;
    if (pinReorderActiveRef.current || getDragState()) return;
    // **不区分设备**（用户定案 A：竖向滚动一律翻页，鼠标/触控板一致）：
    // 取本次事件的**主轴**，对角手势不双计。竖向基准 100px/格（光滑滚轮
    // 把一格拆成多帧 15/30，合计仍是 120；离散滚轮一格 100/120），横向
    // 基准 48px（触控板横扫）。
    const vertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
    const axis = vertical ? 'y' : 'x';
    const delta = vertical ? e.deltaY : e.deltaX;
    if (!delta) return;
    // 主轴切换（先竖滑再横扫）：清掉上一轴残留，避免跨轴凑够阈值
    if (wheelAxisRef.current !== axis) {
      wheelAxisRef.current = axis;
      wheelAccRef.current = 0;
    }
    // 手势空档（如先轻推 40px 再等一会儿）后重新累计，防止零散小滚动
    // 累积到一格；与「格与格之间 ~300ms」区分开，取 800ms。
    const now = performance.now();
    if (now - wheelLastEventRef.current > WHEEL_ACC_RESET_MS) wheelAccRef.current = 0;
    wheelLastEventRef.current = now;
    // 灵敏度：百分比同时缩放「翻页阈值」与「翻页冷却」。
    // 50% 需要两格、100% 一格、高灵敏度主要缩短冷却（快速滚动时翻得更快）。
    const sens = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, wheelSensitivity)) / 100;
    const baseThreshold = vertical ? WHEEL_MOUSE_NOTCH : WHEEL_FLIP_THRESHOLD;
    const threshold = baseThreshold / sens;
    const cooldown = WHEEL_FLIP_COOLDOWN_MS / sens;
    // 冷却期内丢弃事件：光滑滚轮的「滑行尾」（单格起手后 40ms 内的续帧，
    // 总量可达整格）由此吸收，保证一格只翻一页。
    if (now - wheelLastFlipRef.current < cooldown) return;
    wheelAccRef.current += delta;
    if (Math.abs(wheelAccRef.current) >= threshold) {
      flipPage(wheelAccRef.current > 0 ? 1 : -1, pageCount);
      wheelAccRef.current = 0;
      wheelLastFlipRef.current = now;
    }
  };

  /** 触摸横向滑动翻页（鼠标拖动不参与） */
  const handleSidebarPointerDown = (e: React.PointerEvent) => {
    if (collapsed || e.pointerType === 'mouse') return;
    touchStartRef.current = { x: e.clientX, y: e.clientY };
    // 捕获指针：手指移出容器/元素重渲染时仍能收到 pointermove/up，
    // 否则浏览器接管手势后只发 pointercancel，翻页永远不触发
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件（e2e）没有真实指针，忽略
    }
  };

  /** 复位跟手位移（取消/结束时恢复过渡与 transform） */
  const resetSwipeOffset = () => {
    touchStartRef.current = null;
    const page = asideRef.current?.querySelector<HTMLElement>('.sidebar-page[data-active]');
    if (!page) return;
    page.style.transition = '';
    page.style.transform = '';
  };

  const handleSidebarPointerCancel = () => resetSwipeOffset();

  const handleSidebarPointerMove = (e: React.PointerEvent) => {
    const start = touchStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) <= Math.abs(dy)) return;
    const page = asideRef.current?.querySelector<HTMLElement>('.sidebar-page[data-active]');
    if (!page) return;
    // 跟手位移 + 阻尼（最多 72px）
    const resisted = Math.max(-72, Math.min(72, dx));
    page.style.transition = 'none';
    page.style.transform = `translateX(${resisted}px)`;
  };

  const handleSidebarPointerUp = (e: React.PointerEvent) => {
    const start = touchStartRef.current;
    const dx = start ? e.clientX - start.x : 0;
    const dy = start ? e.clientY - start.y : 0;
    resetSwipeOffset();
    if (!start) return;
    if (collapsed) return;
    if (Math.abs(dx) >= TOUCH_FLIP_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      swipeSuppressClickRef.current = true;
      setTimeout(() => { swipeSuppressClickRef.current = false; }, 350);
      flipPage(dx < 0 ? 1 : -1, pageCount);
    }
  };


  return (
    <aside
      className={`sidebar${collapsed ? " sidebar--collapsed" : ""}`}
      ref={asideRef}
      data-kb-zone="sidebar"
      onKeyDown={handleSidebarKeyDown}
      onFocusCapture={(e) => {
        const t = e.target as HTMLElement;
        if (t.matches?.('.sidebar-item, .sidebar-partition')) {
          kbFocusRef.current = t;
        }
      }}
    >
      <div className="sidebar-header">
        <button
          type="button"
          className="sidebar-header-btn sidebar-collapse-btn"
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          <Icon name="menu" />
        </button>
        {!isPicker && showTerminalPlace && (
          <button
            type="button"
            className={`sidebar-header-btn sidebar-terminal-btn${terminalOpen ? " sidebar-header-btn--active" : ""}`}
            title={t("settings.cat_terminal")}
            aria-label={t("settings.cat_terminal")}
            onClick={() => onToggleTerminal?.()}
          >
            <Icon name="terminal" filled={terminalOpen} />
          </button>
        )}
        {showDots && (
          <nav className="sidebar-dots" aria-label={t("sidebar.pages")}>
            {pages.map((_, i) => (
              <button
                key={`dot-${i}`}
                type="button"
                className={`sidebar-dot${i === currentPage ? " active" : ""}`}
                aria-label={`${t("sidebar.page")} ${i + 1}`}
                aria-current={i === currentPage ? "true" : undefined}
                tabIndex={-1}
                onClick={() => setPageIndex(i)}
              >
                {/* 视觉圆点：粗略区域悬停 → 放大一档；精确悬停圆点 →
                    再放大一档（用户定案的两级悬停反馈） */}
                <span className="sidebar-dot-core" aria-hidden="true" />
              </button>
            ))}
          </nav>
        )}
      </div>

      <div
        className="sidebar-body"
        ref={bodyRef}
        onWheel={handleSidebarWheel}
        onPointerDown={handleSidebarPointerDown}
        onPointerMove={handleSidebarPointerMove}
        onPointerUp={handleSidebarPointerUp}
        onPointerCancel={handleSidebarPointerCancel}
        onClickCapture={(e) => {
          if (swipeSuppressClickRef.current) {
            e.stopPropagation();
            e.preventDefault();
            swipeSuppressClickRef.current = false;
          }
        }}
      >
        {pages.map((nodes, i) => (
          <div
            key={`page-${i}`}
            className="sidebar-page"
            data-active={i === currentPage ? "" : undefined}
            data-sidebar-pin-zone=""
            onDragLeave={handlePinReorderListLeave}
          >
            {nodes.map((n) => n.node)}
          </div>
        ))}
      </div>

      {!isPicker && pinMenuPos && (
        <ContextMenu
          x={pinMenuPos.x}
          y={pinMenuPos.y}
          items={[
            {
              label: t("sidebar.pin_via_file_manager"),
              icon: "folder_open",
              action: () => { void handleAddPinned(); },
            } satisfies ContextMenuItem,
          ]}
          onClose={() => setPinMenuPos(null)}
        />
      )}
    </aside>
  );
};

function getPlaceIcon(name: string): string {
  switch (name) {
  case "Home":
    return "home";
  case "Desktop":
    return "desktop_windows";
  case "Documents":
    return "description";
  case "Downloads":
    return "download";
  case "Music":
    return "music_note";
  case "Pictures":
    return "image";
  case "Videos":
    return "movie";
  case "Trash":
    return "delete";
  default:
    return "folder";
  }
}

function getPlaceLabel(name: string): string {
  const map: Record<string, string> = {
    Home: t("sidebar.home"),
    Desktop: t("sidebar.desktop"),
    Documents: t("sidebar.documents"),
    Downloads: t("sidebar.downloads"),
    Music: t("sidebar.music"),
    Pictures: t("sidebar.pictures"),
    Videos: t("sidebar.videos"),
    Trash: t("sidebar.trash"),
  };
  return map[name] || name;
}
