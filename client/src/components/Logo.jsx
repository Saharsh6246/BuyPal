import { useId } from 'react';

/** The Buypal mark: a shopping bag with a navy handle and a check (see design/logo). */
export function LogoMark({ size = 32 }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Buypal" className="flex-none">
      <defs>
        <linearGradient id={`bag-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f7bff" />
          <stop offset="1" stopColor="#0f4fd1" />
        </linearGradient>
      </defs>
      <path d="M34 36V29a16 16 0 0 1 32 0v7" fill="none" stroke="#0a1f4d" strokeWidth="7" strokeLinecap="round" />
      <path d="M20 38h60a4 4 0 0 1 4 4.4l-4.2 40a8 8 0 0 1-8 7.1H28.2a8 8 0 0 1-8-7.100L16 42.400A4 4 0 0 1 20 38z" fill={`url(#bag-${id})`} />
      <path d="M36 62l9 9 19-20" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Logo({ size = 34 }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="display text-[27px] font-medium leading-none text-navy">buy<span className="font-semibold text-azure">pal</span></span>
    </span>
  );
}
