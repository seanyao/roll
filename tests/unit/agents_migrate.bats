#!/usr/bin/env bats
# US-AGENT-028: one-shot v1 → v3 migration (_agents_migrate_v1_to_v3).
#
# Maps a legacy agent-routes.yaml (schema v1: agents.* capability ranges +
# history.cold_start_default) into a four-slot agents.yaml (schema v3). Covers:
# cold_start_default → default/fallback, est_min.max ranking → easy/hard, ghost
# agent (deepseek) removal, local.yaml fallback, idempotence, atomic write.

load helpers
setup() { unit_setup_cd; mkdir -p .roll; }
teardown() { unit_teardown; }

write_v1() { cat > .roll/agent-routes.yaml; }

# ── core mapping ─────────────────────────────────────────────────────────────

@test "US-AGENT-028 migrate: cold_start_default → default slot; ranges → easy/hard" {
  write_v1 <<'YAML'
schema: v1
agents:
  pi:
    est_min: { min: 0, max: 8 }
  claude:
    est_min: { min: 5, max: 30 }
history:
  cold_start_default: pi
YAML

  run _agents_migrate_v1_to_v3
  [ "$status" -eq 0 ]
  [ -f .roll/agents.yaml ]

  # default + fallback come from cold_start_default.
  run _agents_config_slot default
  [ "$status" -eq 0 ]; [ "$output" = "pi" ]
  run _agents_config_slot fallback
  [ "$status" -eq 0 ]; [ "$output" = "pi" ]

  # Smallest est_min.max → easy; largest → hard.
  run _agents_config_slot easy
  [ "$status" -eq 0 ]; [ "$output" = "pi" ]
  run _agents_config_slot hard
  [ "$status" -eq 0 ]; [ "$output" = "claude" ]
}

@test "US-AGENT-028 migrate: ghost agent deepseek is dropped" {
  write_v1 <<'YAML'
schema: v1
agents:
  pi:
    est_min: { min: 0, max: 8 }
  deepseek:
    est_min: { min: 0, max: 15 }
  claude:
    est_min: { min: 5, max: 30 }
history:
  cold_start_default: deepseek
YAML

  run _agents_migrate_v1_to_v3
  [ "$status" -eq 0 ]

  # No slot may reference the ghost agent — not even default (cold_start_default
  # was deepseek, so it must have fallen through to a real routable agent).
  run grep -c deepseek .roll/agents.yaml
  [ "$output" = "0" ]

  run _agents_config_slot easy
  [ "$status" -eq 0 ]; [ "$output" = "pi" ]
  run _agents_config_slot hard
  [ "$status" -eq 0 ]; [ "$output" = "claude" ]
}

@test "US-AGENT-028 migrate: local.yaml agent: seeds default when no cold_start_default" {
  write_v1 <<'YAML'
schema: v1
agents:
  pi:
    est_min: { min: 0, max: 8 }
  claude:
    est_min: { min: 5, max: 30 }
YAML
  printf 'agent: claude\n' > .roll/local.yaml

  run _agents_migrate_v1_to_v3
  [ "$status" -eq 0 ]
  run _agents_config_slot default
  [ "$status" -eq 0 ]; [ "$output" = "claude" ]
}

# ── idempotence / atomicity ──────────────────────────────────────────────────

@test "US-AGENT-028 migrate: idempotent — never clobbers an existing v3 file" {
  write_v1 <<'YAML'
schema: v1
agents:
  pi:
    est_min: { min: 0, max: 8 }
history:
  cold_start_default: pi
YAML
  # A pre-existing hand-edited v3 config must survive untouched.
  printf 'schema: v3\ndefault: { agent: kimi }\n' > .roll/agents.yaml

  run _agents_migrate_v1_to_v3
  [ "$status" -eq 0 ]
  run _agents_config_slot default
  [ "$status" -eq 0 ]; [ "$output" = "kimi" ]
}

@test "US-AGENT-028 migrate: no v1 source → no-op (no v3 file created)" {
  run _agents_migrate_v1_to_v3
  [ "$status" -eq 0 ]
  [ ! -f .roll/agents.yaml ]
}

@test "US-AGENT-028 migrate: leaves no temp debris behind" {
  write_v1 <<'YAML'
schema: v1
agents:
  pi:
    est_min: { min: 0, max: 8 }
history:
  cold_start_default: pi
YAML
  run _agents_migrate_v1_to_v3
  [ "$status" -eq 0 ]
  # The atomic mv must consume the temp render — no agents.yaml.* leftovers.
  run bash -c 'ls .roll/agents.yaml.* 2>/dev/null | wc -l | tr -d " "'
  [ "$output" = "0" ]
}
