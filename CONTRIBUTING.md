# Adding a collection

Publishing to the registry is a pull request. No account, no server — GitHub is the auth and review layer.

1. Add a file at `collection/<letter>/<ns>/<name>.json`, where `<ns>` is your publisher/owner name, `<name>` is the collection, and `<letter>` is the **first character of `<ns>`** (the shard). Example — `collection/a/anthropic/claude-api.json`:

```json
{
  "ns": "anthropic",
  "name": "claude-api",
  "title": "Claude Messages API",
  "tagline": "Anthropic Messages API with tool use and prompt caching.",
  "category": "ai",
  "versions": [
    {
      "version": "1.0.0",
      "type": "git",
      "source": {
        "repo": "https://github.com/anthropics/bruno-collections",
        "subdir": "claude-api",
        "ref": "claude-api@1.0.0"
      }
    }
  ]
}
```

2. **Required fields:** `ns`, `name`, `title`, `category`, `versions` (at least one). `tagline` is an optional one-line description. Valid categories: `payments`, `ai`, `auth`, `devops`, `comms`, `data`, `storage`, `productivity`. See [the schema](schema/collection.schema.json).

3. Open a PR. CI validates your entry (it must parse, match its path, and have valid versions). On merge, `index.json` is rebuilt automatically and your collection appears on the find page.

> **Don't set `verified` / `official` / `featured` / `trending`.** These are editorial flags maintainers add during review — leave them out of your entry.

# Versions

A collection's `versions` array is the source of truth — there is no GitHub Releases dependency. Each version is **independently sourced**, so different versions can come from different places:

```json
"versions": [
  { "version": "1.0.0", "type": "git",
    "source": { "repo": "https://github.com/you/collections", "subdir": "my-api", "ref": "my-api@1.0.0" } },
  { "version": "1.1.0", "type": "url",
    "source": { "url": "https://cdn.example.com/my-api/1.1.0/opencollection.yml" },
    "hash": "sha256-q1Mng3dGfP6mWj5kc3PqV0i8x0Qk2bq1bH8rXjYwZ0E=" }
]
```

| Field | Required | Notes |
|---|---|---|
| `version` | yes | Semver `major.minor.patch` (optional `-prerelease`), e.g. `"1.0.0"` or `"2.1.3-beta.1"`. The **latest** shown is derived by semver precedence — order in the array doesn't matter. |
| `type` | yes | `git` or `url`. |
| `source` | yes | For `git`: `{ repo, ref?, subdir? }`. For `url`: `{ url }` (a direct download of the `opencollection.yml` artifact, hosted anywhere). |
| `hash` | no | SHA-256 of the resolved artifact, SRI-style `sha256-<base64>`. The client verifies it after download — recommended especially for `url` sources, whose contents can change. |

**Publishing a new version = a PR that appends an object to `versions`.** That's the only step; there's nothing to "release" here.

> Install counts are served by a separate public API keyed by `ns/name` — they are never authored in these files and never baked into `index.json`.
