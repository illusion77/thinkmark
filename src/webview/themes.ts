export type MainStyle = 'filled' | 'outline' | 'tint' | 'underline';
export type SubStyle = 'plain' | 'underline';

export interface Theme {
  id: string;
  dark: boolean;
  bg: string;
  rootBg: string;
  rootFg: string;
  rootBorder?: string;
  main: MainStyle;
  /** Text color of main topics when they are not filled with the branch color. */
  mainFg: string;
  /** Text color on topics filled with a branch color ('auto' picks by contrast). */
  fillFg: string;
  sub: SubStyle;
  subFg: string;
  /** Single line color, or null to use each branch's palette color. */
  line: string | null;
  palette: string[];
  surface: string;
}

export const THEMES: Theme[] = [
  {
    id: 'rainbow',
    dark: false,
    bg: '#ffffff',
    rootBg: '#26334d',
    rootFg: '#ffffff',
    main: 'filled',
    mainFg: '#1f2329',
    fillFg: '#ffffff',
    sub: 'plain',
    subFg: '#262a31',
    line: null,
    palette: ['#E5484D', '#EA7424', '#2FA36B', '#0E9AA7', '#3B7FE6', '#7C5CD6', '#D6409F', '#B98010'],
    surface: '#ffffff',
  },
  {
    id: 'fresh',
    dark: false,
    bg: '#f5f8fc',
    rootBg: '#3d7eff',
    rootFg: '#ffffff',
    main: 'outline',
    mainFg: '#1f2329',
    fillFg: 'auto',
    sub: 'underline',
    subFg: '#2a2f37',
    line: null,
    palette: ['#FF6B6B', '#FF922B', '#40C057', '#15AABF', '#4C6EF5', '#9775FA', '#F06595', '#FAB005'],
    surface: '#ffffff',
  },
  {
    id: 'business',
    dark: false,
    bg: '#ffffff',
    rootBg: '#163a5f',
    rootFg: '#ffffff',
    main: 'tint',
    mainFg: '#163a5f',
    fillFg: 'auto',
    sub: 'plain',
    subFg: '#2d3748',
    line: '#9aabc0',
    palette: ['#2f5d8a'],
    surface: '#ffffff',
  },
  {
    id: 'ink',
    dark: false,
    bg: '#fbfaf6',
    rootBg: 'transparent',
    rootFg: '#1d1d1f',
    rootBorder: '#1d1d1f',
    main: 'underline',
    mainFg: '#1d1d1f',
    fillFg: 'auto',
    sub: 'plain',
    subFg: '#333333',
    line: '#3a3a3a',
    palette: ['#1d1d1f'],
    surface: '#fbfaf6',
  },
  {
    id: 'midnight',
    dark: true,
    bg: '#1c1e24',
    rootBg: '#eef1f6',
    rootFg: '#1c1e24',
    main: 'filled',
    mainFg: '#e7eaf0',
    fillFg: '#1c1e24',
    sub: 'plain',
    subFg: '#d5d9e1',
    line: null,
    palette: ['#FF8A8F', '#FFB070', '#7EE2A8', '#6FD3E0', '#7FB2FF', '#B39DFF', '#F59AC8', '#F2C866'],
    surface: '#262932',
  },
];

export function resolveTheme(id: string, vsDark: boolean): Theme {
  return THEMES.find(t => t.id === id) ?? THEMES.find(t => t.id === (vsDark ? 'midnight' : 'rainbow'))!;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
}

export function luminance(hex: string): number {
  if (!/^#[0-9a-f]{3,6}$/i.test(hex)) return 1;
  const [r, g, b] = rgb(hex).map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or near-black, whichever contrasts more with the background. */
export function readableOn(hex: string): string {
  const l = luminance(hex);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.062 ? '#ffffff' : '#1c1e24';
}

export function withAlpha(hex: string, a: number): string {
  if (!/^#[0-9a-f]{3,6}$/i.test(hex)) return hex;
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
