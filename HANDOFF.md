# Registry — Handoff & Roadmap

Status: working POC (hybrid schema, in-app install + publish) + a planned server.
This doc is the single source of truth for the next chat. It reconciles what's
built with the **Public Registry PRD (draft)** — adopting what fits, flagging
where we deliberately diverge.

## Governing rule (the survival test)
**Canonical data lives in git. The cloud holds only rebuildable projections.**
Test every component: *does it survive if Bruno/the server vanishes?*
- Content (the collection) → git, always.
- Index (the registration pointer) → git, PR-gated, canonical.
- Discovery (search/rank/trending), trust, counts → cloud **projection**, rebuildable from git → so a server is fine.

If it can't be rebuilt from git, it doesn't belong in the cloud layer.

---

## Repos, branches, what's live
- **`registry-hybrid`** (github.com/gopu-bruno/registry-hybrid, `main`) — the catalog. Local: `/Users/gopu_bruno/Documents/Projects/registry-hybrid`.
- **`bruno`** (`poc/registry-hybrid`) — the app surface. Commits: `20aa14580` (hybrid schema), `3bd5afd0a` (url install), `cde73d213` (host-agnostic git). Local: `/Users/gopu_bruno/Documents/Projects/bruno`.
- **`collection-registry`** — the *original* git-native demo, intentionally untouched.
- **The server** (next feature) — **new repo** (e.g. `registry-server`); do NOT add it to the catalog repo.

## What's built today
- **Catalog**: `collection/<letter>/<ns>/<name>.json`, sharded by first letter of `ns`. Entry = `{ ns, name, title, category, versions[], tagline?, langs?, color?, editorial flags }`.
- **Versions**: `versions[] = { version (semver), type: git|url, source, hash? }`. git → `{repo, ref?, subdir?}`; url → `{url}`. Latest derived by semver.
- **index.json**: pure catalog `{ collections, totalCollections, publishers }`, `latestVersion` stamped per entry. Built by `scripts/build-index.mjs` (pure, no network). Served from `raw.githubusercontent.com/gopu-bruno/registry-hybrid/main/index.json`.
- **App** (`@usebruno/registry-ui` + `bruno-app` Registry host + `bruno-electron` IPC):
  - Install: **git** = clone any host at the version's ref (system git → GitLab/Bitbucket/self-hosted/private all work). **url** = download artifact in main, **verify sha256 hash**, import via the existing flow.
  - Publish: open a PR to the registry (list a collection / append a version), GitHub API. Generic git-URL validation (`isGitRepoUrl`), host-aware "View source".
  - `fetchInstallCount(ns,name)` client wired (reads `VITE_REGISTRY_STATS_URL`; hidden until the server exists).
  - `deriveHome(index)` derives featured/trending/categories client-side.

---

## Decisions adopted from the PRD (target state)

These change the current code; they are the **first tasks** of the next iteration, not yet implemented.

### 1. Provider-qualified namespaces  *(DECIDED — replaces bare `ns`)*
- Path: **`collection/<provider>/<owner>/<name>.json`** (provider replaces the letter-shard as the top grouping).
- Entry carries `provider` + `owner` instead of `ns`. Coordinate = `provider:owner/name` (e.g. `github:acme/billing`); URL `/github/acme/billing`.
- Rationale: `github:acme ≠ gitlab:acme` — collision-proof across hosts; the foundation for multi-provider + private.
- Verify = provider OAuth + org/group membership (no DNS, no Bruno accounts).
- **Migration:** rename path scheme, split `ns`→`{provider,owner}`, update `registryEntryPath`/`buildRegistryEntry`/`build-index` path-identity check, the electron PR path, and the app's coordinate parsing. Existing 8 entries migrate to `github`/`gopu-bruno`.

### 2. Source contract  *(DECIDED — `url` kept, hash optional for now)*
- A valid source should be pinnable to immutable content + carry a digest.
- **git** satisfies it free (tag→SHA→content-address).
- **url**: keep it (already built/demoed). **`hash` stays optional for now** (as shipped — verified client-side when present). It's the digest-pin for mutable URLs, so it's *recommended*; tightening it to **required for `type: url`** is a deferred option once we've seen real usage, not a P0 change.
- `source.type` stays a discriminated enum (`git|url`), extensible to `oci` later with no migration.

### 3. Versions — hybrid  *(DECIDED)*
- **Now:** keep explicit `versions[]` in git (manual, reviewable, works with no server, supports git+url mix).
- **Later (server):** add **tag-discovery** — poll git tags via `git ls-remote` (isomorphic-git, shared backend/Electron path), union with explicit versions into the cache. Add `source.tagPrefix` for monorepo tag attribution.
- Poll, don't webhook (uniform, zero-config; minutes of latency is fine).

### 4. Trust/editorial out of the git entry  *(DECIDED — clean adoption)*
- Remove `verified` / `official` / `featured` / `trending` from the **entry schema** entirely → **cloud-computed**. With `additionalProperties:false`, a submitted trust field becomes a **validation error**. `verified` = ownership proven; `official` = org matches brand (+allowlist); `trending` = from counts; `featured` = editorial.
- **Migration note:** our seed/demo data currently sets `featured:true` in-file — that moves to cloud editorial config.
- UI must **always show the owner** (`github:janedev/stripe-api`) so impersonation never reads as the brand.

### Also adopted (no conflict)
- **Multi-registry routing in the app from P0** (npm model): `@acme/* → private endpoint`, else public. Pluggable **index location** and **identity verifier** (don't hardcode github.com). Absolute `source.repo` URLs (content host swappable).
- **Counts** = append-only events + rollup in a datastore; **advisory** (lower bound — `git clone` bypasses it); never git; phone-home opt-out, coordinate-only, never blocks install.
- **Resolution model** (one for every host/source): coordinate → tag → SHA → fetch content **direct from the provider (never proxied)** → count. Advisory: app can resolve via `ls-remote` if the server is down (installs survive outages). Resolve SHA at **observe-time** (pinned installs survive tag force-moves); disappeared version → **tombstone**, don't silently remove.
- **SSRF guards** on the poller/artifact fetch: https-only, block internal IPs, validate public host.
- **Device-flow provider OAuth** for publish (replaces the pasted PAT), token in OS keychain. Install/search stay anonymous.

### Deliberately deferred (PRD agrees these are last/optional)
- **Hosted/gitless mode** (snapshot uploaded YAML into a tagged commit) — moderation/DMCA/storage liability; lowest value.
- **Non-GitHub publish adapters** (GitLab MRs, Bitbucket PRs) — the read path decouples first; the write path stays GitHub-API for now.
- **SEO pages + OpenAPI seeding**, **domain-challenge** for unprefixed names.

---

## The next feature: the server

A **read-optimized projection** of the git catalog + the derived data git can't hold. Rebuildable; if it burns down, re-clone and rebuild. Phased:

### Phase A — Install counts (start here)
- Client contract already wired: **`GET <base>/installs/:provider/:owner/:name → { installs }`** (today's code uses `:ns/:name`; update with the namespace change). `fetchInstallCount` returns null on any failure → UI hides the stat.
- **Write path is missing** — add it: after a *successful* install in `bruno-app/src/components/Registry/index.js` (git → `CloneGitRepository.onFinish`; url → `handleUrlImportSubmit.then`), call a new `renderer:report-install` IPC (main, no CORS).
- Storage: **append-only install events keyed by coordinate**, derive the total. Don't store a bare int — weekly/monthly rollups (the design's sparkline + "installs this month") then come free.

### Phase B — Index/search projection
Driven by the design screens (`screen_discover.jsx`, `screen_search.jsx`) — build only what they render:
- **Discover** (per registry scope): `featured[]`, `trending[]` (ranked), `categories[]{id,label,count,icon}`, header `{ totalCollections, publishers, monthlyInstalls }`.
- **Search**: `GET /search?q&sort&page&<filters>` → `{ results[], total, facets }`. Sorts: relevance, downloads, stars, updated. **Facets with counts** (the part clients can't do at scale): trust (verified/official/signed), language/protocol, updated buckets, license, category.
- Server **index record** = git entry (`provider/owner/name/title/tagline/category/langs/versions/latestVersion/color/repo`) **+ measured** (`downloads`, **`stars`**) **+ derived** (`requests` count, artifact size, `updated`). Rebuildable: **git + stats → index**.
- ⚠️ **`stars` enters scope with search** (the design sorts by it + shows it). Source it (git host stars API) or drop the stars sort/column — UI-scoped discipline.

### Phase C — Frontend `RegistrySource` abstraction
- Replace the hardcoded `REGISTRY_INDEX_RAW_URL` with a per-registry **source descriptor** + a `RegistrySource` interface: `getDiscover()`, `search()`, `getCollection()`, `getInstallCount()`.
- Two impls: **StaticIndexSource(indexUrl, headers?)** — one `index.json` on any host (GitHub/GitLab/self-hosted/CDN), `deriveHome` + client search; works offline/serverless. **ApiSource(baseUrl, auth?)** — the server's search/discover/detail endpoints (scale, real facets, private + auth).
- `deriveHome` is the StaticIndexSource implementation — not thrown away.

**UI-scoped discipline (carry forward):** the server stores only what a rendered screen consumes. Today that's **install count**. `stars` + the weekly sparkline arrive *with* the search/discover build, not before. Everything else the design shows is authored (version/license/tags), derived from the artifact (requests/tree/size), or derived from the index (totals) — never server-stored.

---

## Server stack (recommended)

The rebuildable-projection rule decides most of this: the DB is a **cache, not the system of record**, the data is **small** (tens of thousands of entries) and **read-dominant**, so keep it boring and regenerable. Don't over-build.

**Backend — Node.js + TypeScript.** Not a free choice: the resolver (tag→SHA via `ls-remote`) must be **one `isomorphic-git` implementation shared by the server and the Electron app**, and the toolchain (`build-index.mjs`, schema, semver) is already Node ESM.
- Monorepo with a shared **`@usebruno/registry-core`** package (schema, semver compare, resolver, SSRF guards) consumed by **build + server + app** — so validation/resolution can't drift.
- Framework: **Fastify** (lean JSON API) — or **Hono** for edge/portable deploys.
- One service: HTTP API + background workers (tag-discovery poller, trust recompute, reindex). Don't split into microservices.

**Database — default to Postgres (single store for everything):**
- Catalog/index: relational facet columns + JSONB entry blob.
- Search: built-in FTS (`tsvector` + GIN) + ranking; `pg_trgm` for fuzzy.
- Facet counts (the design's filter numbers): plain `GROUP BY`.
- Install counts: append-only `events` table + atomic rollup (`INSERT … ON CONFLICT DO UPDATE SET count = count + 1`). Advisory ⇒ eventual consistency is fine.

**Ethos-aligned alternative — SQLite (FTS5):** because the projection is rebuildable, the DB can *be a build artifact* — regenerate from git on each index change, deploy the file, serve read-only at the edge (LiteFS / Turso / libSQL). Pick this if you want the server near-stateless/cheap/edge-served; its one wrinkle is single-writer concurrency for counts (fine here — advisory, low-volume, WAL/batched — or route counts to Turso/a small separate store).
> **Call:** start with **Postgres** (least friction, one system); reach for **SQLite** if leaning into rebuildable-artifact / serverless-edge.

**Deferred until a real need shows up:**
- **Dedicated search engine** (Meilisearch / Typesense) — faceted + typo-tolerant out of the box, but a second system and *also* just a reindex-from-git projection. Add only if PG/SQLite FTS proves too weak (Phase B).
- **Redis** for hot atomic counters (`INCR`) flushed to the event log — an optimization if install writes spike, not required.

**Avoid (over-engineering at this scale):** Elasticsearch/OpenSearch (operationally heavy), Kafka/streaming (an append-only table covers advisory events), microservices.

**Deploy / rebuild:** stateless app server(s) + managed DB; the projection rebuilds from git, triggered by an index-repo **merge webhook** (or poll). Honor the advisory contract — if the server is down, the app resolves directly via `ls-remote`, so installs never block on it.

---

## PRD phase map (adapted)
- **P0 core**: provider-qualified namespaces · git-linked + url (hash optional) · explicit versions[] (tag-discovery deferred to server) · PR + publish-API (GitHub/GitLab OAuth) · browse/install (web/CLI/app) · advisory counts · multi-registry routing · SSRF guards · drop trust booleans from entries. *(Releases-API stats already dropped.)*
- **P1 experience**: in-app install (git+url **done**) · YAML preview + SEO pages · computed trust · OpenAPI seeding · counts datastore + search projection.
- **P2 private**: same binary, three inputs swapped (index location, identity source, content hosts) + governance plane. See PRD 2 (not yet provided).
- **P3 hosted**: gitless/non-git publishing behind moderation. Last.

## Risks
- **SSRF** (poller hits arbitrary PR-supplied URLs) — https-only, block internal IPs, validate public host. P0.
- **Phone-home backlash** — advisory, opt-out, coordinate-only; disclose as a feature.
- **Provider prefix is permanent** once URLs are indexed — accepted tradeoff for collision-free names.

## Divergences from the PRD (intentional)
- **`url` source kept** (PRD would defer all non-git to hosted-mode P3). We keep it as a first-class P0 source with an **optional (recommended) hash** — it's built and demoed, and the digest pin satisfies the immutability half of the source contract when present. Making the hash mandatory for `url` is a later option, not now.
- **Explicit `versions[]` in git stays** (PRD puts versions only in the cache via tag-discovery). We keep manual versions now and *add* tag-discovery in the server later — the two union.
