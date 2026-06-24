// Builds index.json from every collection/<letter>/<ns>/<name>.json file.
// This is what the website and the app fetch — one request, client-side search.
//
//   node scripts/build-index.mjs          # write index.json
//   node scripts/build-index.mjs --check  # validate entries only (used in PR CI)
//
// The registry is a pure pointer catalog: it stores NO usage stats. Install
// counts come from a separate public API, not from here, so this build does no
// network calls. "featured" / "trending" / "categories" / "latestVersion" /
// totals are DERIVED here, so adding a collection via PR is all it takes.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const COLLECTIONS_DIR = join(ROOT, 'collection');
const CHECK = process.argv.includes('--check');

// Category catalog: id -> display label + icon name (icons live in the website).
const CATEGORIES = {
  payments:     { label: 'Payments',         icon: 'card' },
  ai:           { label: 'AI & ML',          icon: 'sparkle' },
  auth:         { label: 'Auth & Identity',  icon: 'key' },
  devops:       { label: 'DevOps & Infra',   icon: 'server' },
  comms:        { label: 'Communications',   icon: 'message' },
  data:         { label: 'Data & Analytics', icon: 'chart' },
  storage:      { label: 'Storage & CDN',    icon: 'box' },
  productivity: { label: 'Productivity',     icon: 'layout' },
};

const REQUIRED = ['ns', 'name', 'title', 'category', 'versions'];
const SOURCE_TYPES = ['git', 'url'];

// Compare two manual version labels as semver (coercing "1.0" -> "1.0.0").
// Returns >0 if a is newer than b. Non-numeric segments fall back to string
// compare so odd labels still order deterministically.
function cmpVersion(a, b) {
  const parts = (v) => String(v).split('.').map((n) => (/^\d+$/.test(n) ? Number(n) : n));
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) > String(y) ? 1 : -1;
  }
  return 0;
}

const latestVersion = (versions) =>
  [...versions].sort((a, b) => cmpVersion(b.version, a.version))[0].version;

// Recursively collect collection/<letter>/<ns>/<name>.json with their rel path.
async function readAll() {
  const out = [];
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        await walk(join(dir, d.name), childRel);
      } else if (d.name.endsWith('.json')) {
        const full = join(dir, d.name);
        let entry;
        try {
          entry = JSON.parse(await readFile(full, 'utf8'));
        } catch (e) {
          throw new Error(`Invalid JSON in collection/${childRel}: ${e.message}`);
        }
        validate(entry, childRel);
        out.push(entry);
      }
    }
  }
  await walk(COLLECTIONS_DIR, '');
  return out;
}

function validate(entry, relPath) {
  const where = `collection/${relPath}`;
  for (const k of REQUIRED) {
    const v = entry[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) {
      throw new Error(`${where}: missing required field "${k}"`);
    }
  }
  if (!CATEGORIES[entry.category]) {
    throw new Error(`${where}: unknown category "${entry.category}" (valid: ${Object.keys(CATEGORIES).join(', ')})`);
  }

  // Path-identity: <letter>/<ns>/<name>.json must agree with the entry fields.
  const [letter, ns, file] = relPath.split('/');
  const name = (file || '').replace(/\.json$/, '');
  if (ns !== entry.ns) throw new Error(`${where}: ns "${entry.ns}" doesn't match folder "${ns}"`);
  if (name !== entry.name) throw new Error(`${where}: name "${entry.name}" doesn't match filename "${name}"`);
  if (letter !== entry.ns[0]) throw new Error(`${where}: shard "${letter}" must be the first letter of ns ("${entry.ns[0]}")`);

  if (!Array.isArray(entry.versions) || !entry.versions.length) {
    throw new Error(`${where}: "versions" must be a non-empty array`);
  }
  for (const v of entry.versions) {
    if (!v || !v.version) throw new Error(`${where}: a version is missing "version"`);
    if (!SOURCE_TYPES.includes(v.type)) throw new Error(`${where}: version ${v.version} has invalid type "${v.type}" (valid: ${SOURCE_TYPES.join(', ')})`);
    if (!v.source || typeof v.source !== 'object') throw new Error(`${where}: version ${v.version} is missing "source"`);
    if (v.type === 'git' && !v.source.repo) throw new Error(`${where}: version ${v.version} (git) is missing source.repo`);
    if (v.type === 'url' && !v.source.url) throw new Error(`${where}: version ${v.version} (url) is missing source.url`);
  }
}

function buildIndex(all) {
  // Stamp each entry with its derived latest version (clients show it directly).
  const enriched = all.map((c) => ({ ...c, latestVersion: latestVersion(c.versions) }));

  // Order is deterministic by title.
  const sorted = [...enriched].sort((a, b) => a.title.localeCompare(b.title));
  const featured = sorted.filter((c) => c.featured).slice(0, 3);
  const trending = sorted.filter((c) => c.trending && !c.featured);

  const counts = {};
  for (const c of all) counts[c.category] = (counts[c.category] || 0) + 1;
  const categories = Object.entries(CATEGORIES)
    .map(([id, meta]) => ({ id, label: meta.label, icon: meta.icon, count: counts[id] || 0 }))
    .filter((c) => c.count > 0);

  const publishers = new Set(all.map((c) => c.ns)).size;

  return {
    featured,
    trending,
    categories,
    all: sorted,
    totalCollections: all.length,
    publishers,
  };
}

async function main() {
  const all = await readAll();
  if (!all.length) throw new Error('No collections found under collection/.');

  if (CHECK) {
    console.log(`✓ ${all.length} collection(s) valid.`);
    return;
  }

  const index = buildIndex(all);
  await writeFile(join(ROOT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`Wrote index.json — ${all.length} collections, ${index.publishers} publishers.`);
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
