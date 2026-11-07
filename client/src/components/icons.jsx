// Small stroke icon set (24px grid, 1.75 stroke) so the interface does not depend on emoji or text glyphs.
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
const make = (path) => function Icon({ size = 20, ...props }) {
  return <svg {...base} width={size} height={size} {...props}>{path}</svg>;
};

export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IconBag = make(<><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V7a3 3 0 0 1 6 0v1" /></>);
export const IconUser = make(<><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.4 3.6-5 7-5s6.200 1.600 7 5" /></>);
export const IconArrowRight = make(<path d="M5 12h14m-6-6 6 6-6 6" />);
export const IconExternal = make(<><path d="M14 5h5v5" /><path d="m19 5-8 8" /><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" /></>);
export const IconCheck = make(<path d="m5 12.500 4.500 4.500L19 7.500" />);
export const IconStar = function IconStar({ size = 14, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}><path d="m12 2.800 2.800 5.900 6.400.9-4.600 4.500 1.100 6.400L12 17.400l-5.700 3.100 1.100-6.400L2.800 9.600l6.400-.9L12 2.800Z" /></svg>;
};
export const IconClose = make(<path d="m6 6 12 12M18 6 6 18" />);
export const IconShield = make(<><path d="M12 3 5 6v5c0 4.400 2.900 8.300 7 10 4.100-1.700 7-5.600 7-10V6l-7-3Z" /><path d="m9 12 2.200 2.200L15 10.500" /></>);
export const IconTag = make(<><path d="M3 12V4h8l10 10-8 8L3 12Z" /><circle cx="7.500" cy="8.500" r="1.200" /></>);
export const IconSparkle = make(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m6.500 6.500 2 2m7 7 2 2m0-11-2 2m-7 7-2 2" /></>);
export const IconCoin = make(<><circle cx="12" cy="12" r="8.500" /><path d="M9.500 12.200 11.200 14l3.300-3.800" /></>);
