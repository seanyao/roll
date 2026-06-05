# Roll — Test Isolation (`roll test`)

`roll test` runs your project's test suite through an **isolation adapter**
selected in `.roll/local.yaml`:

```yaml
test_isolation:
  type: none   # default
```

## `type: none` (the only built-in adapter)

Direct host execution — the same shell `npm test` would use. `roll test`
forwards to `npm test -- <args>` with `--affected` as the default argument:

```bash
roll test                  # npm test -- --affected
roll test -- tests/        # full suite, explicit
roll test -- --tier=fast   # forward anything to npm test
```

The v3 test suites are hermetic by construction — fabricated `$HOME`s,
PATH-shimmed binaries, `file://` remotes, blackholed network — so host
execution does not touch your launchd jobs, shared roll state, or the network.

## Routing: `--where`

Prints where tests would run, without running them:

| Configured type | `--where` prints |
|---|---|
| `none` (or no config) | `host` |
| anything else | `unknown:<type>` |

The `<type>:<detail>` token format is the **extension point**: a future
adapter (say, a container lane) would print `docker:running`-style tokens in
the same shape.

## Unknown types fail loud

Any `test_isolation.type` other than `none` makes `roll test` exit non-zero
with an explicit error listing the supported types. It never silently falls
back to host execution — a misconfigured isolation lane should stop you, not
quietly change where your tests run.

## `--reset`

Resets the isolation environment. For `type: none` there is nothing to reset
(host execution is stateless): it prints a note and exits 0. A reset holds a
lockfile at `.roll/.iso-reset.lock`; concurrent `roll test` invocations
fast-fail with a clear message while it is held.
