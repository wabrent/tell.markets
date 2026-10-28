import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

// Small JSON stores under data/. Enough for one server; swap for a database when there are several.
const DIR = new URL('../data/', import.meta.url);
mkdirSync(DIR, { recursive: true });

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
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const tmp = new URL(this.name + '.tmp', DIR);
      writeFileSync(tmp, JSON.stringify(this.data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
      renameSync(tmp, new URL(this.name, DIR));
    }, 1000);
  }
}
