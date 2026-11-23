# jat — Jira ATtachments

Download Jira Cloud attachments without exposing the API token. Zero runtime dependencies, Node 20+, macOS.

## Security model

- The token lives only in the macOS Keychain (service `jat-jira-token`). It is never written to a file, an env var, or argv.
- By default the Keychain item trusts no application (`-T ""`), so every read shows a macOS dialog. An AI agent or script cannot read it silently. `--allow-silent-read` removes that dialog, but then any process that runs `security` can read the token.
- The `Authorization` header is sent only to the API origin. The redirect to the signed media URL is followed by hand, restricted to HTTPS `*.atlassian.net` / `*.atlassian.com`, and goes without credentials.
- Downloads go to `0600` files (the output directory is created as `0700`; an existing `--out` directory keeps its own permissions). Names are sanitised (no traversal), existing files are never overwritten, and size is capped (`--max-size`, default 200 MB).
- Error messages never include the token or signed query strings.

## Setup

```bash
npm test
ln -s "$PWD/bin/jat.js" ~/bin/jat
ln -s "$PWD/skills/jira-attachments" ~/.claude/skills/jira-attachments
jat auth login --site your-site.atlassian.net --email you@company.com
```

Create the token at https://id.atlassian.com/manage-profile/security/api-tokens. Prefer a scoped token (`read:jira-work`, `read:jira-user`) with an expiry date. Login checks the site URL first and falls back to the `api.atlassian.com` gateway that scoped tokens require.

## Usage

```bash
jat list PROJ-5140
jat get PROJ-5140                       # into ./PROJ-5140/
jat get PROJ-5140 --filter mp4 --out ~/Downloads/PROJ-5140 --json
```
