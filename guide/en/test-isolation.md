# Roll — Test Isolation (`roll test`)

`roll test` runs your project's test suite through a pluggable isolation
adapter. The adapter is chosen by a single line in `.roll/local.yaml`, so
switching between "run on host" and "run inside an Apple-Silicon VM"
doesn't change any commands you type.

## Why this exists

Earlier versions of Roll relied on a "soft sandbox" — environment-variable
redirection to keep dev tests from touching your real `launchd` plists and
`~/.shared/roll/` state. Every code path that wrote outside the redirect
was a potential breakage, and we patched it dozens of times (FIX-065 /
087 / 097 / 101 / 124 / 125). At some point the cost of new patches
exceeded the cost of just running the tests somewhere the host can't see.

Phase 1 of this epic ships **Tart** as a real-VM isolation provider on
Apple-Silicon Macs. Tests in the VM physically cannot touch host
`launchd`. The soft sandbox stays as a defence-in-depth net for CI
(Ubuntu) and any host-only test paths.

## Quick start

```bash
# 1. Install Tart (one-time)
brew install cirruslabs/cli/tart

# 2. Tell Roll to use it
cat >> .roll/local.yaml <<'YAML'
test_isolation:
  type: tart
YAML

# 3. Run tests
roll test                      # runs npm test inside the VM
roll test --where              # tart:192.168.64.5
roll test -- --tier=fast       # forward args
roll test --reset              # nuke the VM and rebuild
```

## The three `type:` values

| `type` | When to use | What happens |
|--------|-------------|--------------|
| `none` (default) | Linux / Intel Mac dev, CI runners, anyone who hasn't installed Tart | Tests run in the same shell as `npm test`. No isolation beyond the soft sandbox. |
| `tart` | macOS on Apple Silicon, dev box, you want hard isolation | VM `roll-dev-test` is cloned from a base image, `brew install bats node bash` runs once, your worktree is virtio-mounted at `/Volumes/My Shared Files/roll`, and `npm test` runs via SSH. |
| *(future)* `docker` | Cycle-time isolation, not just test-time | Phase 2 — not implemented. |

If `.roll/local.yaml` doesn't set `test_isolation.type`, the dispatcher
falls back to `none` and prints a one-line note to stderr. An explicit
`type: none` stays quiet.

## The commands

### `roll test`

Runs `npm test` inside whatever adapter is configured. Exit code is the
test suite's exit code — when `type: tart` and the suite fails inside the
VM, your shell sees the same non-zero exit.

**Default: affected tests only.** When called with no extra args, `roll test`
automatically passes `--affected` to `npm test`, running only the tests
affected by changes since `HEAD~1` plus any uncommitted working-tree edits.
This matches the pre-commit hook's intent and keeps VM runs fast (seconds
instead of minutes for a typical feature branch).

To run the full suite explicitly:

```bash
roll test -- tests/
```

Args after `--` forward verbatim to `npm test`:

```bash
roll test -- --tier=all        # full suite, all tiers
roll test -- tests/unit/loop.bats   # specific file
```

When `type: tart` and the VM can't be reached, the command exits non-zero
rather than silently falling back to host execution. The whole point of
isolating is that you know where your tests ran.

### `roll test --where`

Prints where the next `roll test` will execute. Machine-readable, one
token (optionally with a colon-separated detail):

| Output | Meaning |
|--------|---------|
| `host` | type=none — tests will run in this shell |
| `tart:<ip>` | type=tart and VM is up; `<ip>` is the VM's IP |
| `tart:ready` | VM up and SSH-responsive (provisioned) |
| `tart:running` | VM process is up but SSH not yet usable |
| `tart:stopped` | type=tart but VM is not running |
| `tart:not-installed` | type=tart but the Tart binary or the VM is missing |

`--where` is read-only — it stays usable even while `roll test --reset`
is rebuilding the VM.

### `roll test --reset`

Destroys and rebuilds the isolation environment to a clean baseline:

- `type: tart` — `tart stop` → `tart delete` → `tart clone` → re-provision.
- `type: none` — prints "nothing to reset (host execution is stateless)"
  and exits **0** (not a failure — host has no state to wipe).

A lockfile at `.roll/.iso-reset.lock` is held during the rebuild. While
held:

- A second `roll test --reset` refuses immediately with a clear message.
- A concurrent `roll test` (test-execution path) refuses with the same
  message — racing into a half-rebuilt VM is worse than waiting.
- `roll test --where` and `--help` ignore the lock (read-only).

### `roll test --help`

```
Usage: roll test [--where | --reset] [--] [<extra-args>...]

Runs the project's test suite through the isolation adapter chosen in
.roll/local.yaml:

  test_isolation:
    type: none   (default)   Direct host execution — same shell as `npm test`.
    type: tart               Inside the Apple-Silicon `roll-dev-test` Tart VM,
                             so tests can't reach the host's launchd / shared
                             roll state. Tart isn't auto-installed; run
                             `brew install cirruslabs/cli/tart` first.

Flags:
  --where        Print where tests will run, then exit (e.g. `host`,
                 `tart:192.168.64.5`, `tart:stopped`).
  --reset        Rebuild the isolation environment to a clean baseline.
                 type=tart: stop → delete → clone → provision (~90s).
                 type=none: prints a note and exits 0 (host is stateless).
                 Holds a lockfile under .roll/.iso-reset.lock; concurrent
                 `roll test` invocations fast-fail with a clear error.
  --help, -h     Show this help.

Examples:
  roll test                    Run the suite in whatever the config says.
  roll test -- --tier=fast     Forward arguments to npm test.
  roll test --where            Don't run; just report routing.
  roll test --reset            Rebuild the VM (or host no-op).

When type=tart and the VM can't be reached, the command exits non-zero
rather than silently falling back to host execution.
```

## Failure recovery

VM in a weird state? Tests hanging? Brew install half-applied? One
command:

```bash
roll test --reset
```

Target time: ~90 seconds. The next `roll test` will boot a fresh,
provisioned VM. If `--reset` itself fails, run `roll test --where` to
see what state the dispatcher thinks you're in.

## Long-term roadmap

Phase 1 (this epic) covers **test-time** isolation. Two further phases
are planned but not implemented:

### Phase 2 — Per-cycle container isolation (`type: docker`)

**Trigger conditions**:

- Your `roll loop` cycles start installing real dependencies, calling
  real external APIs, or otherwise doing work whose side effects you
  don't want on the host.
- You don't trust a cycle's working changes enough to let them touch
  host filesystem state.

**Plan**: a `docker` adapter implementing the same `IsolationAdapter`
interface. `init` becomes `docker pull <image>`, `exec` becomes
`docker exec` (long-running) or `docker run --rm` (one-shot). Everything
above this layer (`roll test`, `_isolation_dispatch`) keeps working
unchanged.

### Phase 3 — Multi-tenant sandbox orchestration

**Trigger conditions**:

- Roll grows beyond a single user / single machine.
- You need network policy, per-tenant routing, or per-user billing on
  isolated runs.

**Plan**: an OpenSandbox-style adapter (E2B, Modal, Daytona, or
equivalent) plugged into the same interface. **OpenSandbox isn't justified
by "we want stronger isolation" — it's justified by "we want multi-tenant
orchestration."** Single-user single-machine isolation is `docker run`'s
job.

### How to add an adapter

Implement these six functions in `bin/roll`:

- `_isolation_<type>_init`
- `_isolation_<type>_provision`
- `_isolation_<type>_exec`
- `_isolation_<type>_status`
- `_isolation_<type>_reset`
- `_isolation_<type>_destroy`

Add `<type>` to `_ISOLATION_SUPPORTED_TYPES` in the dispatcher. That's
it — the rest of the system already routes through `_isolation_dispatch`.

## FAQ

**Q: I had FIX-124 (macOS bash 3.2 self-check) blocking my commits. Is
it gone?**

In the VM, yes — Tart base images ship bash 5, so the bash-3.2 quirks
that triggered FIX-124 don't fire. On the host (without `type: tart`)
the issue can still surface; it stays on the backlog for the rare cases
where you run with `type: none`.

**Q: Why is FIX-125 (cycle-context tripwire) still around if the VM
solves isolation?**

FIX-125 protects the **host** `roll loop` from accidentally running
`gc` / `offboard` against its own LaunchAgents during a cycle. The VM
keeps test runs off the host, but the host loop itself still executes
on the host and still needs the tripwire. The two fixes are orthogonal.

**Q: Does the soft sandbox (`_LAUNCHD_DIR` / `_SHARED_ROOT` /
`_launchctl_safe` / FIX-065/087/097/101) go away?**

Not yet. CI runs on Ubuntu where Tart isn't available, and any
host-only test path still exists. Phase 1 leaves the soft sandbox in
place as a defence-in-depth net. A follow-up story (not in this epic)
will audit which pieces can be retired once the Tart path is bedded in.

**Q: Can I bring my own VM image?**

Not in Phase 1. The base image is hard-coded
(`ghcr.io/cirruslabs/macos-tahoe-base:latest`) but is overridable per
process via the `_TART_BASE_IMAGE` env var if you really need to. A
proper `.roll/local.yaml` field for this will land when there's a
second user who wants it.
