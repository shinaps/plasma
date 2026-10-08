# Plasma local preview 0.5.0

This is a manually installed local-runtime preview, not an approved OpenAI directory package. It preserves local editing, Git inspection, terminals and the Plasma panel. No cloud server is included.

## Requirements

- macOS, Node.js 24.3 or newer, pnpm 11.19.0, Git and the Codex CLI/desktop app with local plugin support.
- Internet access during dependency installation. The archive includes the built UI and runtime source, but not Node.js or node_modules.
- Linux and Windows are not verified for this preview.

## Install

Keep the extracted folder in a permanent location. From inside that folder:

```sh
pnpm install --prod --frozen-lockfile
pnpm run setup:plugin
codex plugin marketplace add "$PWD/.shinaps/work/local-marketplace"
codex plugin add typescript-workbench@workbench-local
```

Restart Codex, enable Plasma if needed, and open Plasma from the plugin or sidebar entry. Pick a project folder. Node.js and the extracted folder must remain at the registered locations. If either moves, regenerate and register the marketplace again.

The plugin retains the existing `typescript-workbench@workbench-local` identity. If that identity is already installed, do not install a second copy blindly: keep the previous folder, remove the old plugin/marketplace through Codex, then register this location. Restart and verify before deleting the previous folder. This preview does not perform automatic updates.

For standalone browser access, run `pnpm start` and open the local URL printed by the server. Do not share that URL or its token.

## Access and data

The local process runs with your OS user's permissions. Opening a project enables file reads/writes, project analysis, Git inspection and local shell terminals. It is not an OS sandbox. Terminal commands and project formatter programs can access whatever your account can access, including the network. Review projects and commands accordingly.

Plasma stores recent projects/settings under `~/.config/typescript-workbench`. Shared selections are delivered to the host conversation when you use the context-sharing controls; the host's data policy applies. Plasma does not include its own hosted backend or telemetry service. This is a technical description, not a finalized privacy policy.

## Removal

Remove Plasma and its marketplace in Codex, close running Plasma panels, then delete the extracted folder. Removing the plugin does not delete project files. Settings remain under `~/.config/typescript-workbench` unless you separately remove them.

## Distribution status

Third-party license notices are included in `third-party/`. A public license and publisher/legal details for Plasma itself have not yet been selected. This artifact is prepared for owner evaluation and discussion of local MCP distribution; it does not grant an open-source license or indicate approval for public directory publication.

The current public submission route expects an HTTPS MCP endpoint. Local MCP support requires discussion with OpenAI: https://developers.openai.com/plugins/guides/submit-claude-plugin
