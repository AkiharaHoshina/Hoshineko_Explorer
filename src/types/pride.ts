/**
 * 骄傲主题（v3.0.1016）：左侧栏随机强调色用的旗帜色库。
 *
 * 与「主题颜色」完全解耦——不生成 M3 主题，只给**当前激活的侧边栏条目**
 * 取一个旗色做弱化底色（配色库之外的界面仍按用户主题渲染）。
 * 颜色去重后用于随机抽取（同一面旗里重复的白色只出现一次）。
 */

/** 一面骄傲旗帜 */
export interface PrideFlag {
  /** 唯一 id（i18n 键 pride.flag.<id>） */
  id: string;
  /** 旗色（去重后的抽取池，按旗帜顺序） */
  colors: string[];
}

/**
 * 支持的骄傲旗帜（按设置下拉顺序 = 数组序；`null` = 无，不在此表内）。
 * 色值取自广泛使用的旗帜公开配色，个别小众旗（多爱、半男孩/半女孩）
 * 采用其常见变体。
 */
export const PRIDE_FLAGS: PrideFlag[] = [
  { id: 'transgender', colors: ['#5BCEFA', '#F5A9B8', '#FFFFFF'] },
  { id: 'pride', colors: ['#E40303', '#FF8C00', '#FFED00', '#008026', '#004DFF', '#750787'] },
  { id: 'lesbian', colors: ['#D52D00', '#EF7627', '#FF9A56', '#FFFFFF', '#D162A4', '#B55690', '#A30262'] },
  { id: 'bisexual', colors: ['#D60270', '#9B4F96', '#0038A8'] },
  { id: 'pansexual', colors: ['#FF1B8D', '#FFDA00', '#1BB3FF'] },
  { id: 'asexual', colors: ['#000000', '#A3A3A3', '#FFFFFF', '#800080'] },
  { id: 'aromantic', colors: ['#3DA542', '#A7D379', '#FFFFFF', '#A9A9A9', '#000000'] },
  { id: 'nonbinary', colors: ['#FCF434', '#FFFFFF', '#9C59D1', '#2C2C2C'] },
  { id: 'genderfluid', colors: ['#FF75A2', '#FFFFFF', '#BE18D6', '#000000', '#333EBD'] },
  { id: 'genderqueer', colors: ['#B57EDC', '#FFFFFF', '#4A8123'] },
  { id: 'agender', colors: ['#000000', '#BABABA', '#FFFFFF', '#BAF484'] },
  { id: 'intersex', colors: ['#FFD800', '#7902AA'] },
  { id: 'omnisexual', colors: ['#FF9AC8', '#FF52A2', '#57048A', '#2B0057'] },
  { id: 'polysexual', colors: ['#F714BA', '#01D66A', '#1594E2'] },
  { id: 'demiboy', colors: ['#7F7F7F', '#C7C7C7', '#9AD9EA', '#FFFFFF'] },
  { id: 'demigirl', colors: ['#7F7F7F', '#C7C7C7', '#F5B6CE', '#FFFFFF'] },
  { id: 'bigender', colors: ['#C479A2', '#EDA5CD', '#D6C7E8', '#FFFFFF', '#9AC7E8'] },
  { id: 'polyamory', colors: ['#0000FF', '#FF0000', '#000000'] },
];

/** 按 id 查旗色库（未知 id / null 返回 null） */
export function findPrideFlag(id: string | null | undefined): PrideFlag | null {
  if (!id) return null;
  return PRIDE_FLAGS.find((f) => f.id === id) ?? null;
}
