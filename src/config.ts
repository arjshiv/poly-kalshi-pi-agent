import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { agentConfigSchema, type AgentConfig } from "./types.js";

type UnknownRecord = Record<string, unknown>;

export async function loadConfig(path: string): Promise<AgentConfig> {
  const raw = await readFile(path, "utf8");
  const parsed = YAML.parse(raw) as unknown;
  return agentConfigSchema.parse(camelizeKeys(parsed));
}

function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelizeKeys);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as UnknownRecord).map(([key, child]) => [
        snakeToCamel(key),
        camelizeKeys(child)
      ])
    );
  }
  return value;
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}
