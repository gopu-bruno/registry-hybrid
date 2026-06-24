// One-off seed: writes a few starter collection/<letter>/<ns>/<name>.json entries.
// These are the registry's source of truth. After seeding, more collections —
// and more versions of existing ones — are added via pull request.
//
// Every field here is authored identity/metadata + one or more versioned
// sources. No usage stats are stored; install counts come from a public API.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Each version points at a real Bruno collection (opencollection.yml + .yml
// requests) hosted in the bruno-collections repo under its own subdir.
const HOST_REPO = 'https://github.com/gopu-bruno/bruno-collections';

const COLLECTIONS = [
  { ns: 'stripe', name: 'stripe-api', title: 'Stripe API', tagline: 'Payments, customers and webhooks for the Stripe REST API.', category: 'payments', featured: true, langs: ['REST'], color: '#635bff' },
  { ns: 'github', name: 'rest-api', title: 'GitHub REST API', tagline: 'Core endpoints of the GitHub REST API.', category: 'devops', featured: true, langs: ['REST'], color: '#24292e' },
  { ns: 'openai', name: 'openai-api', title: 'OpenAI API', tagline: 'Chat completions and models for the OpenAI API.', category: 'ai', featured: true, langs: ['REST'], color: '#10a37f' },
];

const entryFor = (c) => {
  const entry = { ns: c.ns, name: c.name, title: c.title, tagline: c.tagline, category: c.category };
  if (c.langs) entry.langs = c.langs;
  if (c.color) entry.color = c.color;
  if (c.featured) entry.featured = true;
  if (c.trending) entry.trending = true;
  entry.versions = [
    { version: '1.0.0', type: 'git', source: { repo: HOST_REPO, subdir: `${c.ns}-${c.name}`, ref: 'main' } },
  ];
  return entry;
};

const run = async () => {
  for (const c of COLLECTIONS) {
    const file = join(ROOT, 'collection', c.ns[0], c.ns, `${c.name}.json`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(entryFor(c), null, 2) + '\n');
    console.log('seeded', `${c.ns}/${c.name}`);
  }
  console.log(`\n${COLLECTIONS.length} collections seeded.`);
};

run();
