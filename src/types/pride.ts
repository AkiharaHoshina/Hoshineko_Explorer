/**
 * 骄傲主题（v3.0.1016）：左侧栏随机强调色用的旗帜色库。
 *
 * 与「主题颜色」完全解耦——不生成 M3 主题，只给**当前激活的侧边栏条目**
 * 取一个旗色做弱化底色（配色库之外的界面仍按用户主题渲染）。
 * 条纹用于给当前激活条目画「整面旗」渐变（低比例混 surface，随主题即时
 * 跟随）；去重后的颜色用于随机强调，相邻两次不重复。
 */

/** 一面骄傲旗帜 */
export interface PrideFlag {
  /** 唯一 id（i18n 键 pride.flag.<id>） */
  id: string;
  /** 旗帜条纹（从上到下，含重复色；用于左侧旗条） */
  stripes: string[];
  /** 代表色（容器染色用；选该旗最有辨识度、且不会误读成错误/警告的一色） */
  accent: string;
}

/**
 * 支持的骄傲旗帜（按设置下拉顺序 = 数组序；`null` = 无，不在此表内）。
 * 色值取自广泛使用的旗帜公开配色，个别小众旗（多爱、半男孩/半女孩）
 * 采用其常见变体。
 */
export const PRIDE_FLAGS: PrideFlag[] = [
  { id: 'transgender', stripes: ['#5BCEFA', '#F5A9B8', '#FFFFFF', '#F5A9B8', '#5BCEFA'], accent: '#5BCEFA' },
  { id: 'pride', stripes: ['#E40303', '#FF8C00', '#FFED00', '#008026', '#004DFF', '#750787'], accent: '#750787' },
  { id: 'lesbian', stripes: ['#D52D00', '#EF7627', '#FF9A56', '#FFFFFF', '#D162A4', '#B55690', '#A30262'], accent: '#D162A4' },
  { id: 'bisexual', stripes: ['#D60270', '#D60270', '#9B4F96', '#0038A8', '#0038A8'], accent: '#9B4F96' },
  { id: 'pansexual', stripes: ['#FF1B8D', '#FFDA00', '#1BB3FF'], accent: '#FF1B8D' },
  { id: 'asexual', stripes: ['#000000', '#A3A3A3', '#FFFFFF', '#800080'], accent: '#800080' },
  { id: 'aromantic', stripes: ['#3DA542', '#A7D379', '#FFFFFF', '#A9A9A9', '#000000'], accent: '#3DA542' },
  { id: 'nonbinary', stripes: ['#FCF434', '#FFFFFF', '#9C59D1', '#2C2C2C'], accent: '#9C59D1' },
  { id: 'genderfluid', stripes: ['#FF75A2', '#FFFFFF', '#BE18D6', '#000000', '#333EBD'], accent: '#BE18D6' },
  { id: 'genderqueer', stripes: ['#B57EDC', '#FFFFFF', '#4A8123'], accent: '#B57EDC' },
  { id: 'agender', stripes: ['#000000', '#BABABA', '#FFFFFF', '#BAF484'], accent: '#BABABA' },
  { id: 'intersex', stripes: ['#FFD800', '#7902AA'], accent: '#7902AA' },
  { id: 'omnisexual', stripes: ['#FF9AC8', '#FF52A2', '#57048A', '#2B0057'], accent: '#57048A' },
  { id: 'polysexual', stripes: ['#F714BA', '#01D66A', '#1594E2'], accent: '#F714BA' },
  { id: 'demiboy', stripes: ['#7F7F7F', '#C7C7C7', '#9AD9EA', '#FFFFFF'], accent: '#9AD9EA' },
  { id: 'demigirl', stripes: ['#7F7F7F', '#C7C7C7', '#F5B6CE', '#FFFFFF'], accent: '#F5B6CE' },
  { id: 'bigender', stripes: ['#C479A2', '#EDA5CD', '#D6C7E8', '#FFFFFF', '#9AC7E8'], accent: '#C479A2' },
  { id: 'polyamory', stripes: ['#0000FF', '#FF0000', '#000000'], accent: '#0000FF' },
];

/** 按 id 查旗色库（未知 id / null 返回 null） */
export function findPrideFlag(id: string | null | undefined): PrideFlag | null {
  if (!id) return null;
  return PRIDE_FLAGS.find((f) => f.id === id) ?? null;
}
