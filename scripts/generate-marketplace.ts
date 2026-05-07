import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, dirname } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const PLUGINS_DIR = join(ROOT, "plugins");
const TEMPLATE = join(ROOT, "marketplace-template", "template.json");
const CLAUDE_MANIFEST = join(ROOT, ".claude-plugin", "marketplace.json");
const COPILOT_MANIFEST = join(ROOT, ".github", "marketplace.json");

interface PluginMeta {
  dirName: string;
  name: string;
  description: string;
  category: string;
  authorName: string;
  authorEmail: string;
}

function toKebabCase(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^(\w[\w-]*):\s*"?([^"]*)"?\s*$/);
    if (m) result[m[1]] = m[2].trim();
  }
  return result;
}

interface PluginManifest {
  name?: string;
  description?: string;
  author?: string | { name?: string; email?: string };
  keywords?: string[];
}

async function hasNonEmptyDir(
  dir: string,
  predicate?: (entry: import("fs").Dirent) => boolean,
): Promise<boolean> {
  if (!existsSync(dir)) return false;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.some((e) => (predicate ? predicate(e) : true));
}

async function hasSkillsDir(skillsDir: string): Promise<boolean> {
  if (!existsSync(skillsDir)) return false;
  const entries = await readdir(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && existsSync(join(skillsDir, entry.name, "SKILL.md"))) {
      return true;
    }
  }
  return false;
}

async function isValidPlugin(pluginDir: string): Promise<boolean> {
  if (existsSync(join(pluginDir, ".claude-plugin", "plugin.json"))) return true;
  if (await hasSkillsDir(join(pluginDir, "skills"))) return true;
  if (await hasNonEmptyDir(join(pluginDir, "agents"), (e) => e.isFile() && e.name.endsWith(".md"))) return true;
  if (await hasNonEmptyDir(join(pluginDir, "commands"), (e) => e.isFile() && e.name.endsWith(".md"))) return true;
  if (existsSync(join(pluginDir, "hooks", "hooks.json"))) return true;
  if (existsSync(join(pluginDir, ".mcp.json"))) return true;
  if (existsSync(join(pluginDir, ".lsp.json"))) return true;
  if (existsSync(join(pluginDir, "monitors", "monitors.json"))) return true;
  if (await hasNonEmptyDir(join(pluginDir, "output-styles"), (e) => e.isFile() && e.name.endsWith(".md"))) return true;
  if (await hasNonEmptyDir(join(pluginDir, "themes"), (e) => e.isFile() && e.name.endsWith(".json"))) return true;
  return false;
}

async function loadPluginManifest(pluginDir: string): Promise<PluginManifest | null> {
  const manifestPath = join(pluginDir, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(await readFile(manifestPath, "utf-8")) as PluginManifest;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: ${pluginDir} — plugin.json parse error: ${msg}, falling back to README`);
    return null;
  }
}

async function loadReadmeFrontmatter(pluginDir: string): Promise<Record<string, string>> {
  const readmePath = join(pluginDir, "README.md");
  if (!existsSync(readmePath)) return {};
  return parseFrontmatter(await readFile(readmePath, "utf-8"));
}

async function resolvePluginMeta(
  dirName: string,
  pluginDir: string,
  template: Record<string, unknown>,
): Promise<PluginMeta> {
  const manifest = await loadPluginManifest(pluginDir);
  const readme = await loadReadmeFrontmatter(pluginDir);
  const owner = template.owner as { name?: string; email?: string } | undefined;

  let manifestAuthorName = "";
  let manifestAuthorEmail = "";
  if (typeof manifest?.author === "string") {
    manifestAuthorName = manifest.author;
  } else if (manifest?.author) {
    manifestAuthorName = manifest.author.name ?? "";
    manifestAuthorEmail = manifest.author.email ?? "";
  }

  const manifestName = (manifest?.name ?? "").trim();
  const manifestCategory = manifest?.keywords?.[0] ?? "";

  return {
    dirName,
    name: manifestName !== "" ? manifestName : toKebabCase(dirName),
    description: manifest?.description ?? readme.description ?? "",
    category: manifestCategory || readme.category || "",
    authorName: manifestAuthorName || readme.author || owner?.name || "",
    authorEmail: manifestAuthorEmail || readme.email || owner?.email || "",
  };
}

interface MarketplaceEntry {
  name: string;
  source: string;
  description?: string;
  author?: { name: string; email?: string };
  category?: string;
}

function buildEntry(meta: PluginMeta): MarketplaceEntry {
  const entry: MarketplaceEntry = {
    name: meta.name,
    source: `./plugins/${meta.dirName}`,
  };

  if (meta.description) entry.description = meta.description;
  if (meta.category) entry.category = toKebabCase(meta.category);

  if (meta.authorName) {
    const author: { name: string; email?: string } = { name: meta.authorName };
    if (meta.authorEmail) author.email = meta.authorEmail;
    entry.author = author;
  }

  return entry;
}

async function scanPlugins(template: Record<string, unknown>): Promise<PluginMeta[]> {
  if (!existsSync(PLUGINS_DIR)) {
    console.warn(`Warning: plugins/ directory not found at ${PLUGINS_DIR}`);
    return [];
  }

  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
  const plugins: PluginMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;
    const pluginDir = join(PLUGINS_DIR, dirName);

    if (!(await isValidPlugin(pluginDir))) {
      console.warn(`Warning: ${dirName} — no recognized plugin component found, skipping`);
      continue;
    }

    plugins.push(await resolvePluginMeta(dirName, pluginDir, template));
  }

  return plugins;
}

async function writeManifest(
  outPath: string,
  label: string,
  template: Record<string, unknown>,
  entries: MarketplaceEntry[],
): Promise<void> {
  const updated = {
    ...template,
    name: toKebabCase(String(template.name ?? "")),
    plugins: entries,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  console.log(`✔ ${label} manifest updated: ${outPath}`);
}

async function main() {
  const template = JSON.parse(await readFile(TEMPLATE, "utf-8"));

  console.log("Scanning plugins/...");
  const plugins = await scanPlugins(template);
  console.log(`Found ${plugins.length} plugin(s): ${plugins.map((p) => p.name).join(", ")}`);

  const entries = plugins.map(buildEntry);
  await writeManifest(CLAUDE_MANIFEST, "Claude", template, entries);
  await writeManifest(COPILOT_MANIFEST, "Copilot", template, entries);

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
