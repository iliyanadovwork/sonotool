// Minimal ambient types for the untyped `ruhend-scraper` package.
// We only use igdl (Instagram), which returns an array of direct media URLs.
declare module 'ruhend-scraper' {
  export function igdl(url: string): Promise<unknown>;
  export function ttdl(url: string): Promise<unknown>;
  export function fbdl(url: string): Promise<unknown>;
}
