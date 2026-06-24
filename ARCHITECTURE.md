# Architecture

This document is the mental model behind the registry: what problem each part
solves, why the design looks the way it does, and which decisions are still open.
For *how to publish*, see [CONTRIBUTING.md](CONTRIBUTING.md).

## TL;DR

This is a **pointer registry, not a host**. The registry is a git repo of small
metadata files; each file lists a collection's **versions**, and each version
points at content that lives elsewhere — a git repo or a hosted `url`. We never
store collection content. That single choice is why there is **no server**: GitHub
is the storage, the auth, and the review layer. The one thing we *don't* derive
from GitHub is install counts — those come from a **separate public API**, so the
catalog has no runtime dependency on GitHub Releases at all.

The closest well-known models are **Cargo's index** (versions recorded in the
index) and **Homebrew taps** (a git repo of per-package files), *not* Flathub.

## The 10 layers every registry has

A "registry" feels like one thing but is really a stack of independent
decisions. The design space is *which layer is git-backed* and *which is derived*.

| # | Layer | The question it answers | How we answer it |
|---|---|---|---|
| 1 | **Identity & namespace** | What is a collection called, who arbitrates the name? | `ns/name`, arbitrated by the file path `collection/<letter>/<ns>/<name>.json`. |
| 2 | **Source manifest** | Where is metadata authored, in what format? | That JSON file ([schema](schema/collection.schema.json)). `<letter>` (first char of `<ns>`) shards the tree so directories stay small. |
| 3 | **Publish gate** | How does something get in? | Pull request + CI validation. GitHub review is the gate. |
| 4 | **Transform/build** | Is there a CI step that produces artifacts? | `build-index.mjs` flattens entries into `index.json` and derives each collection's **latest version** (by semver). **No network, no stats.** |
| 5 | **Catalog/index** | What surface do clients discover through? | `index.json`, a single static file served from the repo. |
| 6 | **Resolution** | How does name → location happen? | Read `index.json` → pick a version → resolve its `source`: `git` (clone repo at `ref`, optional `subdir`) or `url` (download the artifact). |
| 7 | **Content store** | Where do the actual bits live? | **Nowhere here.** In the version's git repo, or behind its `url`. We only point. |
| 8 | **Versioning** | How are versions tracked and selected? | **Index-carries-versions (Cargo style):** every version is an entry in the file's `versions` array, each with its own `source`. A new version is a PR. Latest is derived by semver. |
| 9 | **Trust/verification** | Checksums, signing, review? | PR review + editorial flags + an **optional per-version `hash`** (SHA-256, SRI-style) the client verifies after download. |
| 10 | **Update mechanism** | How does a published thing change? | Append a version to the file via PR; the index re-bakes. |

## How Homebrew and Flathub answer the same layers

Two mature git-backed registries sit at opposite ends of the "host vs point"
spectrum. Understanding both is what justifies our design.

| Layer | **Homebrew** | **Flathub** |
|---|---|---|
| Identity | Formula name = filename in a *tap* (git repo) | Reverse-DNS app id, one git repo per app |
| Manifest | One Ruby file per formula | Build manifest + AppStream XML |
| Publish gate | PR to `homebrew-core`, CI audits, bot merges | PR to `flathub/flathub`, **human review** |
| Build | CI compiles **bottles** (prebuilt binaries) | **Buildbot** builds the flatpak per arch |
| Catalog | Derived `formula.json` | OSTree `summary` + AppStream |
| Resolution | name → local JSON → source url + bottle url | `flathub` remote → summary → OSTree ref |
| **Content store** | **Points** at upstream source, **hosts** bottles on `ghcr.io` | **Hosts everything** in a central OSTree repo |
| Versioning | Rolling — one current version; history = git log | OSTree commits per branch |
| Trust | sha256 checksums + human review | GPG-signed commits + sandbox + review |
| Infra reality | GitHub + Actions + static JSON. **Near-serverless.** | GitHub + Buildbot + OSTree + CDN. **Real servers.** |

### The one decision that cascades: host vs point

Read down the **Content store** row. That single choice drives half the other
layers. **Flathub hosts** the content, so it needs a build pipeline, a content
store, a CDN, and signing. **Homebrew points** at upstream source and hosts only
convenience binaries, so GitHub does almost all the work.

Bruno collections are small text artifacts (`opencollection.yml` / `.bru`
files). We have no reason to host them — the collection already lives in the
author's repo or behind their URL. The moment we decide **"point, never host,"**
layers 4 (build), 7 (content store), and most of 9 (signing) collapse to nearly
nothing. **We are not Flathub. We are Homebrew-without-bottles, with a
Cargo-style versioned index.**

## Why versions live in the file (not as git tags)

An earlier design made a version *be* a git tag with a GitHub Release, and read
release stats at build time. We moved off that for two reasons:

1. **Sources beyond git.** A version can now be a plain `url` to a hosted
   artifact — a CDN, object storage, a gist, anything. Tag-as-version only works
   when the content is in a taggable git repo. Recording the source *in the
   index* (Cargo style) lets each version choose `git` **or** `url`, and even mix
   them across versions of the same collection.
2. **No GitHub Releases dependency.** Reading versions and download counts from
   the Releases API tied the catalog to GitHub and to a rate-limited network call
   at build time. Versions are now authored data; **install counts come from a
   separate public API** keyed by `ns/name`. The build does no network calls and
   the catalog works for non-GitHub sources.

So `build-index.mjs` is the *entire* pipeline, and it's pure: read files →
validate → derive latest version → write `index.json`.

## How resolution works here (offline-capable, serverless)

```
publish (each   PR edits collection/<letter>/<ns>/<name>.json
  version):      (adds/append a {version, type, source, hash?})
                              │  merge → CI
                              ▼
                     build-index.mjs  (flatten + derive latest,
                              │         no network, no stats)
                              ▼
                         index.json  ◄── one static file
                              │ fetch (raw / CDN / Pages)
                              ▼
client ──► read entry ──► pick version ──► resolve source:
              git → clone repo @ ref (+ subdir)
              url → download opencollection.yml
                              │
                              ▼  (optional) verify against `hash`
                       write .bru files into the workspace

install counts ──► separate public API (keyed by ns/name), read by the
                    detail page; never stored in this repo.
```

A client fetches `index.json` once and can resolve and search entirely locally.
Fetching/cloning hits the **version's** host (git or url), not us.

## Public vs private registries

Same schema, different repo:

- **Public** — this repo; `index.json` served publicly.
- **Private** — a private git repo with the identical layout; resolution uses
  authenticated git / download. The **Homebrew private tap** model — no new
  machinery.

## Open decisions

These are deliberately unresolved; the design above does not depend on them.

### 1. Integrity — partly addressed (optional `hash`)

Each version may carry a SHA-256 `hash` of its artifact, which the client
verifies after download — tamper-evidence that matters most for mutable `url`
sources and for `git` refs that can move. It is **optional** today; making it
**required** (and/or pinning a git commit SHA in `source.ref`) is the next step
toward fully tamper-evident resolution.

### 2. Namespace ownership

Nothing currently enforces *who* may publish under an `ns`. The cheapest fix is
**CODEOWNERS on `collection/<letter>/<ns>/`** so only the namespace owner's PRs to
their own directory auto-merge.

### 3. The counts API contract

Install counts are promised to a separate public API but the contract (endpoint,
per-version vs aggregate, caching) isn't pinned here. The client treats counts as
optional: it shows them when the API answers and hides the stat otherwise, so the
catalog is fully functional before the API exists.

### 4. `latestVersion` semantics

Latest is derived by comparing `version` labels as semver. Pre-release labels and
non-semver strings fall back to deterministic string compare; a stricter policy
(reject non-semver, support pre-release precedence) can be added in `build-index`.

## Why `index.json` is committed, not just built on demand

CI rebuilds `index.json` and commits it back (see
[`.github/workflows/build-index.yml`](.github/workflows/build-index.yml)). This
keeps the served catalog a plain static file — no build step on the read path,
trivially CDN-cacheable, and resolvable offline — while the source of truth stays
the per-collection files. Drift self-heals on every rebuild because the bot
regenerates from `collection/`.

> No telemetry of our own. Install counts live in a separate public API
> (aggregate, not per-user); this repo records nothing.
