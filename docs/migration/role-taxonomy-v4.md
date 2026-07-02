# Role Taxonomy v4 Migration

This is a breaking cleanup. Roll no longer accepts or aliases the retired role/profile names in active runtime config.

## Manual Config Update

Old config patterns to remove:

```yaml
execution_profiles:
  planned:
    roles:
      planner: { rig: kimi-strong }
      builder: { routing: default }
execution_policy:
  mode: planned
  default_profile: planned
defaults:
  story:
    roles:
      execute:
        avoid: [supervise]
      evaluate:
        avoid: [execute]
```

Use the canonical taxonomy and open pools instead:

```yaml
execution_profiles:
  designed:
    roles:
      designer: { rig: kimi-strong }
      builder: { routing: default }
      evaluator: { rig: reasonix-eval }
execution_policy:
  mode: designed
  default_profile: standard
defaults:
  story:
    roles:
      execute:
        kind: select
        require: [execute]
        strategy: health-aware
      evaluate:
        kind: select
        require: [evaluate]
        strategy: health-aware
```

## No Compatibility Fallback

There is no runtime alias, fallback, or dual-write path for the retired names. Invalid legacy keys fail loudly so stale configs are visible during setup, test, or loop routing.

## Review Isolation

Fresh-session independence is the required isolation boundary. The same agent brand may serve different roles when each role runs in a separate fresh session and the selector ranks candidates by capability, health, risk, cost, and recent outcomes.

Agent/model diversity remains useful as a ranking preference or an explicit owner-requested strict mode. It is not a default reason to remove a capable agent from the pool.
