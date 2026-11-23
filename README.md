# jat — Jira ATtachments

Download Jira Cloud attachments without exposing the API token. Zero runtime dependencies, Node 20+, macOS, Windows and Linux.

## Security model

- The token is never written to an env var or argv, and never into a file in the project. Where it lives depends on the OS:

  | OS | Store | Silent read? |
  |---|---|---|
  | macOS | Keychain item `jat-jira-token` | No by default: the item trusts no application (`-T ""`), so every read shows a macOS dialog. `--allow-silent-read` removes the dialog, but then any process that runs `security` can read the token. |
  | Windows | `token.dpapi.json` in the jat config directory, encrypted with DPAPI for the current Windows user | Yes: any program running as your user can decrypt it. |
  | Linux | Secret Service keyring (GNOME Keyring, KWallet …) through `secret-tool` | Yes, once the keyring is unlocked. |
  | Linux without a keyring (servers, WSL, no `libsecret-tools`) | `token.json` in the jat config directory, plaintext, mode `0600` in a `0700` directory | Yes. Login warns when it falls back to this file. |

  Only macOS can stop an AI agent or script from reading the token without you. On Windows and Linux, `--allow-silent-read` is accepted but changes nothing, and login always prints a warning.
- Login records the store it used in the config, and every later command reads only from that store. `jat auth status` shows the store and whether reads are silent.
- The `Authorization` header is sent only to the API origin. The redirect to the signed media URL is followed by hand, restricted to HTTPS `*.atlassian.net` / `*.atlassian.com`, and goes without credentials.
- Downloads go to `0600` files (the output directory is created as `0700`; an existing `--out` directory keeps its own permissions). Names are sanitised (no traversal), existing files are never overwritten, and size is capped (`--max-size`, default 200 MB).
- Error messages never include the token or signed query strings.

## Setup

```bash
npm install -g @hungnb94/jat
jat auth login --site your-site.atlassian.net --email you@company.com
```

The jat config directory is `$XDG_CONFIG_HOME/jat/` or `~/.config/jat/`. `JAT_CONFIG` moves only `config.json`; token files always stay in the jat config directory, so they never end up in a project folder. On Linux, install `secret-tool` first (`libsecret-tools` on Debian/Ubuntu) to keep the token in the keyring instead of a file.

Create the token at https://id.atlassian.com/manage-profile/security/api-tokens. Prefer a scoped token (`read:jira-work`, `read:jira-user`) with an expiry date. Login checks the site URL first and falls back to the `api.atlassian.com` gateway that scoped tokens require.

### Agent skill

The `jira-attachments` skill teaches Claude Code, Cursor, Codex and other agents to use `jat` without touching the token. Install or remove it with [skills.sh](https://skills.sh) (needs Node 22.20+):

```bash
npx skills add hungnb94/jira-cli --skill jira-attachments      # asks which agents; add -g -a claude-code -y to skip the questions
npx skills remove jira-attachments
```

From a clone instead: `npm test`, then `npm link` (or `ln -s "$PWD/bin/jat.js" ~/bin/jat`) and `npx skills add ./ --skill jira-attachments`.

## Usage

```bash
jat list PROJ-5140
jat get PROJ-5140                       # into ./PROJ-5140/
jat get PROJ-5140 --filter mp4 --out ~/Downloads/PROJ-5140 --json
```

## Contributing

- PR titles follow Conventional Commits (`feat:`, `fix:`, `docs:` …); CI checks this.
- A PR that changes behaviour bumps `version` itself: `npm version <patch|minor|major> --no-git-tag-version` (`feat` → minor, `fix`/`perf`/`refactor`/`revert` → patch, `!` or `BREAKING CHANGE` → major). `docs`/`chore`/`ci`/`test`/`style`/`build` PRs, or PRs labelled `skip-release`, keep it. The Version Check workflow posts the suggested bump on the PR.
- CI runs `npm test` on Ubuntu with Node 20, 22 and 24, and scans for secrets with Gitleaks. Every credential store is tested through a fake command runner, so no runner needs a real Keychain, keyring or Windows.
- Merging to `main` publishes the new version to npm (trusted publishing, no token), then tags it and creates a GitHub Release. Re-run the Release workflow by hand to retry a failed release.
