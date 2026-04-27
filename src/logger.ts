import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";

export class Logger {
  constructor(private readonly logPath: string) {}

  async info(message: string, meta: Record<string, unknown> = {}): Promise<void> {
    await this.write("INFO", message, meta);
  }

  async warn(message: string, meta: Record<string, unknown> = {}): Promise<void> {
    await this.write("WARN", message, meta);
  }

  async error(message: string, meta: Record<string, unknown> = {}): Promise<void> {
    await this.write("ERROR", message, meta);
  }

  private async write(
    level: "INFO" | "WARN" | "ERROR",
    message: string,
    meta: Record<string, unknown>
  ): Promise<void> {
    const event = {
      ts: new Date().toISOString(),
      level,
      message,
      ...meta
    };
    const line = JSON.stringify(event);
    console.log(line);
    await mkdir(dirname(this.logPath), { recursive: true });
    await appendFile(this.logPath, `${line}\n`, "utf8");
  }
}
