#!/usr/bin/env node
/* Regenerate JSON outputs from a kaomojikan-compatible source.

   The source must expose `window.KAOMOJI = { categories, items }` via one or
   more `data/*.js` files (see ../README.md for the schema).

   Usage: SITE=/path/to/source-repo node scripts/sync-from-site.js */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

const SITE = process.env.SITE;
if (!SITE) {
  console.error("Error: SITE env var is required.");
  console.error("Usage: SITE=/path/to/source-repo node scripts/sync-from-site.js");
  process.exit(1);
}

const OUT = path.resolve(__dirname, "..");
const dataDir = path.join(SITE, "data");

if (!fs.existsSync(dataDir)) {
  console.error("Source data dir not found:", dataDir);
  console.error("Expected layout: $SITE/data/*.js");
  process.exit(1);
}

const sandbox = { window: {}, console };
vm.createContext(sandbox);

const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".js"));
const ordered = ["categories.js", ...files.filter((f) => f !== "categories.js")];

for (const f of ordered) {
  const code = fs.readFileSync(path.join(dataDir, f), "utf8");
  vm.runInContext(code, sandbox, { filename: f });
}

const K = sandbox.window.KAOMOJI;
if (!K || !K.items || !K.categories) {
  console.error("window.KAOMOJI not populated as expected");
  process.exit(1);
}

const items = K.items;
const categories = K.categories;

const writeJSON = (file, obj) =>
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(obj, null, 2) + "\n");

writeJSON("kaomoji.json", items);
writeJSON("categories.json", categories);

const byCategory = {};
for (const slug of Object.keys(categories)) byCategory[slug] = [];
for (const item of items) {
  for (const c of item.categories || []) {
    if (!byCategory[c]) byCategory[c] = [];
    byCategory[c].push(item);
  }
}

fs.mkdirSync(path.join(OUT, "by-category"), { recursive: true });
for (const [slug, list] of Object.entries(byCategory)) {
  writeJSON(`by-category/${slug}.json`, list);
}

const stats = {
  lastUpdated: new Date().toISOString().slice(0, 10),
  totalKaomoji: items.length,
  totalCategories: Object.keys(categories).length,
  byCategory: Object.fromEntries(
    Object.entries(byCategory).map(([k, v]) => [k, v.length])
  ),
};
writeJSON("stats.json", stats);

const readmePath = path.join(OUT, "README.md");
if (fs.existsSync(readmePath)) {
  let readme = fs.readFileSync(readmePath, "utf8");
  const rows = Object.entries(categories).map(
    ([slug, c]) => `| ${c.name} | \`${slug}\` | ${byCategory[slug]?.length || 0} |`
  );
  const table = [
    "| Category | Slug | Count |",
    "|----------|------|-------|",
    ...rows,
    `| **Total** | | **${items.length}** |`,
  ].join("\n");
  readme = readme.replace(
    /<!-- stats:start -->[\s\S]*?<!-- stats:end -->/,
    `<!-- stats:start -->\n${table}\n<!-- stats:end -->`
  );
  readme = readme.replace(
    /<!-- lastUpdated:start -->[\s\S]*?<!-- lastUpdated:end -->/,
    `<!-- lastUpdated:start -->${stats.lastUpdated}<!-- lastUpdated:end -->`
  );
  fs.writeFileSync(readmePath, readme);
}

console.log(`✓ Synced ${items.length} kaomoji across ${Object.keys(categories).length} categories`);
console.log(`  Last updated: ${stats.lastUpdated}`);
console.log(`  Output: ${path.relative(process.cwd(), OUT)}`);
