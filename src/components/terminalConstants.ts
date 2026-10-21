/**
 * 内建终端面板常量。
 *
 * 单独成模块：`TerminalPanel` 是懒加载组件（xterm 体积大），App 仍需要
 * 默认高度做初始 state/重置——若从 TerminalPanel 导入常量，会把整个
 * 终端模块（含 xterm）重新拉回首屏 chunk，懒加载失效。
 */

/** 终端面板默认高度（px），每次呼出时恢复为该值 */
export const DEFAULT_TERMINAL_HEIGHT = 420;
