# Security boundary

The public repository must never contain:

- API keys, access tokens, cookies or passwords;
- provider base URLs or private/local node addresses;
- machine-specific executable, model or workspace paths;
- personal avatar photos, voice samples or voice IDs;
- generated media, provider task IDs, balances or task history.

Private runtime values are loaded from environment variables. Local development may use a git-ignored `.env`; the packaged desktop app uses a `.env` inside its OS-managed user-data directory. The renderer runs with `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`.

Before each release, run `npm test` and the repository secret scan in CI. If a secret is ever committed, revoke it first, then remove it from Git history.
