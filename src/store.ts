import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Small JSON stores under data/. Enough for one server; swap for a database when there are several.
// Serverless hosts (Vercel) only allow writes under the temp dir, and wipe it between instances.
const DIR = process.env.DATA_DIR
  ? pathToFileURL(join(process.env.DATA_DIR, '/'))
  : process.env.VERCEL
    ? pathToFileURL(join(tmpdir(), 'tell-data', '/'))
    : new URL('../data/', import.meta.url);
let writable = true;
try { mkdirSync(DIR, { recursive: true }); } catch { writable = false; }

export class JsonStore<T> {
  private data: Record<string, T>;
  private timer?: NodeJS.Timeout;

  constructor(private name: string, private limit = 2000) {
    try {
      this.data = JSON.parse(readFileSync(new URL(name, DIR), 'utf8'));
    } catch {
      this.data = {};
    }
  }

  get(key: string): T | undefined { return this.data[key]; }
  values(): T[] { return Object.values(this.data); }
  entries(): [string, T][] { return Object.entries(this.data); }

  set(key: string, value: T) {
    delete this.data[key]; // re-insert so the newest key is last, oldest go first when trimming
    this.data[key] = value;
    const keys = Object.keys(this.data);
    for (const k of keys.slice(0, Math.max(0, keys.length - this.limit))) delete this.data[k];
    this.save();
  }

  /** Writes at most once a second, through a temp file so a crash never leaves half a file. */
  private save() {
    if (this.timer || !writable) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      try {
        const tmp = new URL(this.name + '.tmp', DIR);
        writeFileSync(tmp, JSON.stringify(this.data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
        renameSync(tmp, new URL(this.name, DIR));
      } catch (err) {
        // keep serving from memory; a read-only disk shouldn't take the site down
        console.error(`could not save ${this.name}:`, (err as Error).message);
        writable = false;
      }
    }, 1000);
  }
}
