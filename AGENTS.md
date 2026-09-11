# Design System

All UI work — layout, color, typography, spacing, component selection, UX behavior — must follow [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md). Use the tokens defined in `src/renderer/src/assets/main.css` (the canonical source) and the shadcn primitives in `src/renderer/src/components/ui/`. Don't invent new color values, font sizes, or shadow tiers when a documented one already covers the role. When STYLEGUIDE.md is silent, follow the resolution order in its final section.

## Electron UI Validation

Always run tests and agent-launched apps in the background with `ORCA_BACKGROUND_LAUNCH=1`.
Never steal monitor focus or reveal test windows: no `show()`, `showInactive()`, `bringToFront()`,
`app.focus()`, or OS activation. Use CDP screenshots of hidden renderers. Keep native-focus and
visible-window tests paused on the user's desktop; run them on an isolated display or CI.
Rebuild modified launch-policy code before running an app; stale build wrappers are not safe.

Use the `$electron` skill and Playwright CDP for rendered Orca UI checks. Do not use computer-use for Orca UI validation.

### GUI Sandbox Runtime Dependencies

The Ubuntu guest has no Node, package manager, compiler, or host Nix libraries. Before creating the sandbox, the host must build every required Electron artifact. After creation, mandatory bootstrap provisions disposable guest-local dependencies and must complete successfully before any UI scenario:

- Read the Node version from `package.json` `engines` (currently 24) and download that portable Node into a task-local guest path such as `/tmp/orca-runtime/node`; use absolute paths because `gui-sandbox exec` has only the system guest `PATH`.
- Use the bundled Electron version, and download `libnspr4` and `libnss3` package contents into a task-local guest path such as `/tmp/orca-runtime/lib`.
- Download/extract build-essential, GCC/G++, binutils, libc development headers, and runtime libraries into a task-local guest toolchain; set absolute `PATH`, `LD_LIBRARY_PATH`, compiler include paths, and `--sysroot` for bootstrap commands.
- Rebuild `node-pty` against the bundled Electron version with `node-gyp --runtime=electron --target=<version> --dist-url=https://electronjs.org/headers`.
- Verify, before the scenario: the expected Node and Electron executables run; NSS/NSPR resolve; rebuilt `node-pty` loads; temporary `HOME` and Electron user-data are writable; and Orca launches successfully. Use `--disable-crashpad --disable-breakpad` when required by the guest.

#### Proven disposable bootstrap

Use a task-local prefix (example `/tmp/orca-runtime`) and absolute paths throughout; never depend on the guest `PATH` or host Nix libraries. The working setup used for Orca validation is:

- Portable Node 24 extracted to `/tmp/orca-runtime/node` (version comes from `package.json` `engines`).
- Bundled Electron 43.1.0 plus extracted `libnss3`/`libnspr4` contents under the task-local runtime/toolchain prefix.
- Extracted GCC/G++ 13, binutils, libc development headers, and runtime libraries with a matching sysroot. Export the extracted compiler `PATH`, `CC`, `CXX`, include paths, and `--sysroot` for all guest build commands.
- Rebuild `node-pty` for Electron 43.1.0 after dependency installation:
  `node-gyp rebuild --runtime=electron --target=43.1.0 --dist-url=https://electronjs.org/headers`.
- Before launch, verify `node --version`, Electron startup, NSS/NSPR resolution, and `require('node-pty')` from the rebuilt module.

Launch with disposable writable state and carry the library path into the launch command itself:

```sh
HOME=/tmp/orca-runtime/home \
XDG_CONFIG_HOME=/tmp/orca-runtime/config \
XDG_CACHE_HOME=/tmp/orca-runtime/cache \
XDG_DATA_HOME=/tmp/orca-runtime/data \
LD_LIBRARY_PATH=/tmp/orca-runtime/toolchain/usr/lib/x86_64-linux-gnu:/tmp/orca-runtime/toolchain/usr/lib:/tmp/orca-runtime/toolchain/lib/x86_64-linux-gnu:/tmp/orca-runtime/toolchain/lib \
<electron> <orca-entry> \
  --user-data-dir=/tmp/orca-runtime/user-data \
  --crash-dumps-dir=/tmp/orca-runtime/crash \
  --force-renderer-accessibility \
  --disable-crashpad --disable-breakpad \
  --ozone-platform=x11
```

Create all listed directories before launch. `--ozone-platform=x11` is the fallback when Wayland AT-SPI or screenshot capture is unreliable. Write every CUA screenshot directly under a task-local `/tmp` evidence directory; never write screenshots into the repository or tracked paths. Capture screenshots, accessibility/window state, logs, and artifacts before destroying the exact sandbox. After the full validation run and artifact review, delete all task-generated screenshot `.png` files (including nested evidence files) and remove the temporary evidence directory; retain non-image logs only when needed for the report.

Missing Node, Electron, compiler, or libraries is never an acceptable infrastructure-blocker report: provision task-local dependencies or report the task incomplete. Report only genuine external provisioning failures after bootstrap attempts. The scenario must exercise an actual close and restart, and retain CUA evidence, window state, application logs, and collected artifacts before safe `gui-sandbox destroy` cleanup. Follow `$gui-sandbox` safety boundaries: no guest system package installation, tracked bootstrap payloads, software rendering, direct `pct`/`zfs`, or passwords.

# Style

## Reuse Before Reimplementing

Before writing new logic at any scale — a function, component, IPC channel, state store, or whole subsystem/flow — check whether an existing implementation already does the job (or nearly does). Extend or generalize it instead of building a parallel version; only write from scratch when nothing fits. Keep the check proportionate: a quick search for trivial code, a real one before building anything substantial.

## Concise/Brief Non-obvious Comments ONLY

- DO NOT: be verbose, explain the obvious, walk through the code ("WHY not HOW")
- BE CONCISE. 1 LINE if possible

## Lint Rules: Do Not Disable Max Lines

NEVER add a `max-lines` disable (`eslint-disable max-lines`, `oxlint-disable max-lines`, or line-specific variants), and never add a per-file `max-lines` bump in `mobile/.oxlintrc.json`.

## File and Module Naming

Never use vague names like `helpers`, `utils`, `common`, `misc`, or `shared-stuff` for files, folders, or modules. They carry zero info and tend to become dumping grounds. Name files after what they _actually_ contain — prefer the concrete domain concept (e.g. `tab-group-state.ts`, `terminal-orphan-cleanup.ts`) over the generic role (`tabs-helpers.ts`, `terminal-utils.ts`). If you find yourself reaching for `helpers`, the file probably has more than one responsibility and should be split, or there's a better name hiding in the code that describes what the functions operate on.

## Type Declarations: Prefer `.ts` Over `.d.ts`

# Verifying Changes

- **Typecheck**: `pnpm tc` (or `tc:node` / `tc:cli` / `tc:web`)
- **Test**: `pnpm test [path/to/file.test.ts]`
- **Lint**: `oxlint`, or `pnpm run check:code-quality:changed` for changed files (full `pnpm lint` is slow); format with `pnpm format`

# Considerations

## Worktree Safety

Always use the primary working directory (the worktree) for all file reads and edits. Never follow absolute paths from subagent results that point to the main repo.

## Cross-Platform Support

Orca targets macOS, Linux, and Windows. Keep all platform-dependent behavior behind runtime checks:

- **Keyboard shortcuts**: Never hardcode `e.metaKey`. Use a platform check (`navigator.userAgent.includes('Mac')`) to pick `metaKey` on Mac and `ctrlKey` on Linux/Windows. Electron menu accelerators should use `CmdOrCtrl`.
- **Shortcut labels in UI**: Display `⌘` / `⇧` on Mac and `Ctrl+` / `Shift+` on other platforms.
- **File paths**: Use `path.join` or Electron/Node path utilities — never assume `/` or `\`.
- **Windows setup scripts**: the setup/issue-command runner is a `.cmd` batch file unless the script starts with a `#!` line — never derive that from the user's terminal-shell preference, and never launch a `.cmd` runner with a bare `cmd.exe /c` from a Git Bash pane (MSYS rewrites the `/c`). See [`docs/reference/windows-setup-shell.md`](./docs/reference/windows-setup-shell.md).
- **Windows child processes**: start them through `runProcess`/`spawnProcess` in `src/shared/child-process/` — never `child_process` directly. It pins `windowsHide`, refuses `shell: true`, and encodes `.cmd`/`.bat` arguments so neither `CommandLineToArgvW` nor `cmd.exe` mangles them. A ratchet test fails on any new direct import. Recognised npm/pnpm `.cmd` shims are resolved to their real target so the spawn skips `cmd.exe` entirely; see [`docs/reference/windows-cmd-shim-resolution.md`](./docs/reference/windows-cmd-shim-resolution.md) before adding a shim shape or debugging one.
- **Windows process enumeration**: read the table through `src/main/windows/windows-process-table.ts`, never by forking `powershell.exe`. See [`docs/reference/windows-process-enumeration.md`](./docs/reference/windows-process-enumeration.md).
- **Windows daemon-host relocation**: the terminal daemon runs from a copy of the app runtime under `%LOCALAPPDATA%`, which is what survives an auto-update. Before touching that copy, its exe name, or the NSIS uninstall macro, read [`docs/reference/windows-daemon-host-relocation.md`](./docs/reference/windows-daemon-host-relocation.md).
- **Windows EDR signal**: don't add `-ExecutionPolicy Bypass`, `-EncodedCommand`, `cmd.exe /c` with escaped free text, per-operation interpreter spawning, or runtime `Add-Type` compilation without reading [`docs/reference/windows-edr-posture.md`](./docs/reference/windows-edr-posture.md) first — behavioural EDR scores each of those, and being signed does not clear them.
- **WSL commands**: build argv with `buildWslExecArgs` (always `--exec` — under `--`, `wsl.exe` expands `$name` in every argument and silently rewrites the script), and fence anything whose stdout you parse with `buildWslCapturedLoginShellCommand`, because the interactive login shell prints the distro banner to stdout. See [`docs/reference/wsl-command-execution.md`](./docs/reference/wsl-command-execution.md).
- **Linux native modules**: keep the glibc floor at Ubuntu 20.04 / glibc 2.31. A module compiled from source on a newer runner can reference symbol versions absent on the floor and crash the app on startup. See [`docs/reference/linux-glibc-compatibility.md`](./docs/reference/linux-glibc-compatibility.md); packaging fails if a bundled native binary needs newer glibc.

## SSH Use Case

All changes must consider the SSH use case. Don't assume local-only execution. Before changing anything that reports on, stops, or lists remote work, follow [`docs/reference/ssh-execution-boundary.md`](./docs/reference/ssh-execution-boundary.md): the execution host owns everything that touches execution, and loss of contact is never evidence of process death — the verdict vocabulary is `live` / `unverifiable` / `exited`, with no synonyms.

## Folder Workspace Use Case

All changes must consider folder workspaces as well as git worktrees. Don't assume every workspace is a git worktree.

## Agent Status

The execution host owns agent status in one store, the hook server's, and every reader (sidebar, `worktree ps`, mobile, dashboard) subscribes to it. Before adding a producer, a cache, or a reader-side precedence rule, read [`docs/reference/agent-status-store.md`](./docs/reference/agent-status-store.md): new producers write into that store, and readers keep only presentation policy.

## Moving a Tab Between Workspaces

Before changing tab↔workspace ownership, follow [`docs/reference/tab-workspace-move.md`](./docs/reference/tab-workspace-move.md): state keyed by tab id must stay untouched, a running process keeps its working directory, and main's PTY worktree binding must be re-keyed explicitly.

## Per-Window View State

With multi-window, the project filter (`filterRepoIds` + `filterGroupIds`) belongs to a window, not the profile. Before adding UI state that must differ between windows, or touching `ui:get` / `ui:set` / `ui:stateChanged`, follow [`docs/reference/per-window-view-state.md`](./docs/reference/per-window-view-state.md): add the key to `WindowViewState` rather than special-casing a channel, keep the persisted value as the seed only the focused window rewrites, and let windowless renderers (paired web, pop-out) degrade to the implicit window. A window bound to a project group (`WindowScope`, `src/shared/window-scope.ts`) derives its view state from the group and never writes the seed; main is the authority on the scope, never the renderer's argv.

## Per-Window Session Ownership

There is one stored workspace session, and main partitions it along the window axis: a project window reads and writes the keys of its project group, the free window everything no project window is serving. Before touching `session:get` / `session:set` / `session:patch`, the startup hydration chain, or any code that writes the whole session rather than a patch, follow [`docs/reference/window-session-adoption.md`](./docs/reference/window-session-adoption.md): main resolves ownership from the window's scope and never trusts a renderer-declared list, every write is rebased onto the keys the window does not own, global fields stay with the free window, and every new field of `WorkspaceSessionState` has to be classified carry/drop.

## Agent Terminal Screens

A rule that reads what an agent CLI paints on a terminal — readiness, blocked prompts, idle — must be written against a captured transcript, not a remembered screen. Record one with [`docs/reference/agent-pty-transcript-capture.md`](./docs/reference/agent-pty-transcript-capture.md), which keeps escapes and wrapping intact and scrubs account identifiers before they reach git. Antigravity readiness has no transcript yet and five failed attempts without one; before touching it, read [`docs/reference/antigravity-readiness-evidence.md`](./docs/reference/antigravity-readiness-evidence.md).

## Remote Wire Compatibility

Clients and remote Orca servers update independently, so mixed versions are the normal state. Before changing anything a paired client and host exchange — RPC params, stream frames, or the content either side publishes over them — follow [`docs/reference/remote-wire-compatibility.md`](./docs/reference/remote-wire-compatibility.md). A new optional field is safe; a new stream opcode must be capability-negotiated because decoders drop unknown opcodes silently; and changing what the host publishes reaches old clients even with no wire change.

## Git Binary Compatibility

Orca runs the user's Git binary on native, WSL, and SSH hosts, which may all have different versions. Treat Git 2.25 as the core-workflow baseline and follow [`docs/reference/git-compatibility.md`](./docs/reference/git-compatibility.md).

When adding or changing a Git command:

- Check when every subcommand and option was introduced. For newer behavior, keep a baseline-compatible fallback or degrade safely.
- Use `GitCapabilityCache` with a narrow unsupported-error predicate so recurring operations do not retry a known-invalid command. Do not rely only on `git --version`; wrappers such as `simple-git` do not remove host-version differences.
- Scope capability state to the host that executes Git: native, WSL distro, SSH provider, or relay connection. Cover the first fallback, later cached calls, concurrent probes, and relevant host isolation in tests.
- Keep the real-binary compatibility contract in PR CI current. When adopting a newer Git feature, add its version boundary so the preferred command and fallback both run against representative Git releases.
- Preserve commands that begin with global Git options such as `-c` before the subcommand, including auto-maintenance suppression used by worktree-create fetches.

## Git Scan Safety

- Never enumerate every ref and then run `git ls-tree -r` or `git show` once per ref. That ref × tree fan-out can retain gigabytes of output before a downstream `sort -u` or search can make progress.
- Prefer `rg` over the checked-out files for source searches. For history or refs, use a named ref, an explicit namespace/path, `--max-count`, and a bounded output; do not use an unqualified `--all` scan as a first diagnostic.
- Keep repository-wide commands targeted to the current repository and worktree. If an unbounded scan is genuinely required, measure the ref count first, explain the cost, and get confirmation before running it.

## Git Provider Compatibility

Source-control and review changes must consider GitLab and other supported git providers, not only GitHub. Keep provider-specific behavior behind explicit checks, and avoid GitHub-only naming for generic review concepts.

## GitHub CLI Usage

Be mindful of the user's `gh` CLI API rate limit — batch requests where possible and avoid unnecessary calls. All code, commands, and scripts must be compatible with macOS, Linux, and Windows.
