# registry-hybrid

A **git-native, versioned index** of [Bruno](https://usebruno.com) / OpenCollection API collections — a hybrid registry where each version is independently sourced (`git` or `url`).

There is **no server**. The registry *is* this repository:

- Each collection is one file: [`collection/<letter>/<ns>/<name>.json`](collection/) — where `<letter>` is the first character of `<ns>`. It lists the collection's **versions**, each pointing at a `git` repo or a `url` artifact, plus display metadata.
- [`index.json`](index.json) is generated from those files by CI and is what the website and the Bruno app fetch. The build is pure — **no network calls, no stats**. It just flattens the entries and derives each collection's latest version (by semver).
- **Install counts** come from a separate **public API**, not from here — the registry stores no usage data and has no dependency on GitHub Releases.
- Adding a collection *or a new version* is a **pull request** editing a file under `collection/`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the model and [PUBLISHING.md](PUBLISHING.md) for the publish flow (app + CLI).

## Local development

```bash
npm run seed      # write the starter collections (one-off)
npm run build     # regenerate index.json from collection/
npm run validate  # validate entries without writing (what PR CI runs)
```

## Adding a collection

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: add `collection/<letter>/<ns>/<name>.json` matching [the schema](schema/collection.schema.json) and open a PR.
