import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal .env.local loader for standalone scripts. Next injects env for the app,
// but a plain `tsx script.ts` does not. Only sets keys not already in process.env.
export function loadEnvLocal(dir = process.cwd()): void {
  let text: string;
  try {
    text = readFileSync(resolve(dir, '.env.local'), 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
