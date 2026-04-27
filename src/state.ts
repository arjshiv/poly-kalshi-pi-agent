import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class SeenTradeStore {
  private seen = new Set<string>();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as { seen?: string[] };
      this.seen = new Set(parsed.seen ?? []);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.seen = new Set();
    }
  }

  contains(key: string): boolean {
    return this.seen.has(key);
  }

  add(key: string): void {
    this.seen.add(key);
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      `${JSON.stringify({ seen: [...this.seen].sort() }, null, 2)}\n`,
      "utf8"
    );
  }
}
