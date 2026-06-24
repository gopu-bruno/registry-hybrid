// Builds index.json from every collection/<letter>/<ns>/<name>.json file.
// This is what the website and the app fetch — one request, client-side search.
//
//   node scripts/build-index.mjs          # write index.json
//   node scripts/build-index.mjs --check  # validate entries only (used in PR CI)
//
// The registry is a pure pointer catalog: it stores NO usage stats and bakes in
// NO presentation. The index is just { collections, totalCollections,
// publishers }; each entry gets a derived `latestVersion`. featured / trending /
// categories are presentation, derived CLIENT-side from the flags/category on
// each entry (see deriveHome() in @usebruno/registry-ui) — so the contract isn't
// coupled to one homepage and entries aren't duplicated. No network calls.
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
// Versions are semver: major.minor.patch, optional -prerelease, optional leading v.
const SEMVER_RE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// Compare two versions by semver precedence. Core (major.minor.patch) compares
// numerically; a prerelease (e.g. 1.0.0-beta) ranks BELOW its release; prerelease
// identifiers compare dot-wise (numeric vs string). Returns >0 if a is newer.
function cmpVersion(a, b) {
  const parse = (v) => {
    const core = String(v == null ? '' : v).trim().replace(/^v/, '').split('+')[0];
    const [main, pre] = core.split('-');
    const nums = main.split('.').map((n) => (/^\d+$/.test(n) ? Number(n) : 0));
    while (nums.length < 3) nums.push(0);
    return { nums, pre: pre || null };
  };
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;   // release outranks prerelease
  if (!pb.pre) return -1;
  const ai = pa.pre.split('.'), bi = pb.pre.split('.');
  for (let i = 0; i < Math.max(ai.length, bi.length); i++) {
    const x = ai[i], y = bi[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) { if (Number(x) !== Number(y)) return Number(x) - Number(y); }
    else if (x !== y) return x > y ? 1 : -1;
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
    if (!SEMVER_RE.test(v.version)) throw new Error(`${where}: version "${v.version}" must be semver (major.minor.patch, e.g. 1.0.0)`);
    if (!SOURCE_TYPES.includes(v.type)) throw new Error(`${where}: version ${v.version} has invalid type "${v.type}" (valid: ${SOURCE_TYPES.join(', ')})`);
    if (!v.source || typeof v.source !== 'object') throw new Error(`${where}: version ${v.version} is missing "source"`);
    if (v.type === 'git' && !v.source.repo) throw new Error(`${where}: version ${v.version} (git) is missing source.repo`);
    if (v.type === 'url' && !v.source.url) throw new Error(`${where}: version ${v.version} (url) is missing source.url`);
  }
}

function buildIndex(all) {
  // Pure catalog. Stamp each entry with its derived latest version, order
  // deterministically by title, and report light totals. Presentation
  // (featured / trending / categories) is derived client-side from the entries.
  const collections = all
    .map((c) => ({ ...c, latestVersion: latestVersion(c.versions) }))
    .sort((a, b) => a.title.localeCompare(b.title));

  const publishers = new Set(all.map((c) => c.ns)).size;

  return {
    collections,
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
