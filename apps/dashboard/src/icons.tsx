import type { SVGProps } from 'react';

export type IconName = 'book' | 'home' | 'clock' | 'chart' | 'spark' | 'shield' | 'sun' | 'moon' | 'phone' | 'globe' | 'arrow' | 'lock' | 'check';
const paths: Record<IconName, string> = {
  book: 'M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1m0-15c3-2 7-2 10-1v15c-3-1-7-1-10 1V5',
  home: 'm3 10 9-7 9 7v10H3V10m6 10v-7h6v7',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  chart: 'M4 20V12m8 8V4m8 16V8',
  spark: 'm12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2',
  shield: 'm12 2 9 4v6c0 5-4 8-9 10-5-2-9-5-9-10V6l9-4m-4 10 3 3 5-6',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  moon: 'M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11',
  phone: 'M7 2h10v20H7V2m4 17h2',
  globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M2 12h20M12 2c5 5 5 15 0 20-5-5-5-15 0-20',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v12H5V10m7 5v3',
  check: 'm5 12 4 4L19 6',
};
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={paths[name]} /></svg>;
}
