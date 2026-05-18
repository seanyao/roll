#!/usr/bin/env bats
# Tests for US-DOC-003: .roll/domain/ DDD context map + autonomous-operation model

DOMAIN_DIR="${BATS_TEST_DIRNAME}/../../.roll/domain"
CTX_MAP="${DOMAIN_DIR}/context-map.md"
AUTO_OP="${DOMAIN_DIR}/autonomous-operation.md"

# ─── Directory and file existence ─────────────────────────────────────────────

@test ".roll/domain/ directory exists" {
  [ -d "$DOMAIN_DIR" ]
}

@test ".roll/domain/context-map.md exists" {
  [ -f "$CTX_MAP" ]
}

@test ".roll/domain/autonomous-operation.md exists" {
  [ -f "$AUTO_OP" ]
}

# ─── context-map.md content ───────────────────────────────────────────────────

@test "context-map: defines Convention Management bounded context" {
  grep -qiE 'Convention Management' "$CTX_MAP"
}

@test "context-map: defines Skill Delivery bounded context" {
  grep -qiE 'Skill Delivery' "$CTX_MAP"
}

@test "context-map: defines Autonomous Operation bounded context" {
  grep -qiE 'Autonomous Operation' "$CTX_MAP"
}

@test "context-map: defines Observability bounded context" {
  grep -qiE 'Observability' "$CTX_MAP"
}

@test "context-map: defines Distribution bounded context" {
  grep -qiE 'Distribution' "$CTX_MAP"
}

@test "context-map: uses U/D or upstream/downstream notation" {
  grep -qE 'U/D|upstream|downstream|U →|→ D' "$CTX_MAP"
}

@test "context-map: mentions ACL (Anti-Corruption Layer)" {
  grep -qiE 'ACL|Anti.Corruption' "$CTX_MAP"
}

# ─── autonomous-operation.md content ─────────────────────────────────────────

@test "autonomous-operation: defines Loop Aggregate" {
  grep -qiE 'Loop.*Aggregate|Aggregate.*Loop' "$AUTO_OP"
}

@test "autonomous-operation: defines Dream Aggregate" {
  grep -qiE 'Dream.*Aggregate|Aggregate.*Dream' "$AUTO_OP"
}

@test "autonomous-operation: defines Peer Aggregate" {
  grep -qiE 'Peer.*Aggregate|Aggregate.*Peer' "$AUTO_OP"
}

@test "autonomous-operation: contains ubiquitous language section" {
  grep -qiE 'Ubiquitous Language|Ubiquitous.Language|glossary|vocabulary' "$AUTO_OP"
}

@test "autonomous-operation: lists Domain Events" {
  grep -qiE 'Domain Event|StoryCompleted|LoopStarted|DreamReport|StoryFailed' "$AUTO_OP"
}

@test "autonomous-operation: mentions cross-context impact" {
  grep -qiE 'cross.context|context.*impact|integration|publish|subscribe' "$AUTO_OP"
}
