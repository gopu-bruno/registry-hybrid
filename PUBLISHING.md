# Publishing & versioning

Publishing is a **pull request to this repo** — both listing a collection the first time and adding a new version later. There is no separate "release" step and no dependency on GitHub Releases.

| Act | What it is | How often |
|---|---|---|
| **List a collection** | A PR adding `collection/<letter>/<ns>/<name>.json` with its first version | once |
| **Publish a version** | A PR appending an entry to that file's `versions` array | every version |

A *version* carries its own source — `git` (clone a repo at a ref) or `url` (download a hosted `opencollection.yml`). Different versions of the same collection may use different types.

See [ARCHITECTURE.md](ARCHITECTURE.md) for why it's modeled this way.

---

## From the Bruno app (one flow)

1. **Discover** (globe icon) → **Publish**.
2. **Select** — pick a collection open in your workspace. Bruno reads its git remote and prefills the **repo** + **subdir**, and checks the index: *Listed* or *Not listed yet*.
3. **Version** — set the **version** label and choose the source **type**:
   - **git** — confirm repo / ref / subdir.
   - **url** — paste the artifact URL (a hosted `opencollection.yml`).
   Optionally include a **hash** for integrity.
4. **Open registry PR** — the app commits the entry (new file, or an appended version) and opens the PR. If your token can write here it branches directly; otherwise it **forks** and opens the PR from the fork. A maintainer reviews and merges.
5. **Done** — PR URL. The index re-bakes on merge; install counts come from the public API.

---

## From the CLI (equivalent)

### First listing
```bash
git clone https://github.com/gopu-bruno/registry-hybrid && cd registry-hybrid
LETTER=$(printf %.1s "<ns>")
mkdir -p collection/$LETTER/<ns>
$EDITOR collection/$LETTER/<ns>/<name>.json   # see schema/ + the example in CONTRIBUTING.md
git checkout -b add-<ns>-<name>
git add collection/$LETTER/<ns>/<name>.json
git commit -m "Add <ns>/<name> collection"
git push -u origin add-<ns>-<name>
gh pr create --base main --title "Add <ns>/<name>"
```

**No write access here?** Use fork-and-PR (the normal open-source path):
```bash
gh repo fork gopu-bruno/registry-hybrid --clone
# ...edit the file, commit on a branch, push to YOUR fork...
gh pr create --repo gopu-bruno/registry-hybrid --base main --head <you>:add-<ns>-<name> --title "Add <ns>/<name>"
```

### A new version
Edit the same file and append to `versions` — git or url:
```json
{ "version": "1.1", "type": "url",
  "source": { "url": "https://cdn.example.com/<ns>/<name>/1.1/opencollection.yml" },
  "hash": "sha256-…" }
```
Commit, push, open a PR. On merge, the index re-bakes and `1.1` becomes the latest (derived by semver).

---

## "The index re-bakes" — what that means

`index.json` is built by [`scripts/build-index.mjs`](scripts/build-index.mjs), which reads every `collection/**/*.json`, validates it, derives each collection's latest version, and writes the flat catalog. It does **no network calls** and stores **no stats**. It runs on merge to `main` and on manual `workflow_dispatch`.

> Nothing runs on install. The client resolves the chosen version's `source` and fetches the `opencollection.yml` (clone for `git`, download for `url`), writing native `.bru` files into the workspace. Install counts are recorded and served by a separate public API — the registry itself measures nothing.
