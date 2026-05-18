#!/usr/bin/env bats
# Unit tests for US-WEB-001 dual-frame Terminal hero animation

SITE="${BATS_TEST_DIRNAME}/../../site"

@test "roll-data.js exports FRAME_A constant" {
  grep -q "FRAME_A" "${SITE}/roll-data.js"
}

@test "roll-data.js has CYCLE_NDJSON embedded fixture" {
  grep -q "CYCLE_NDJSON" "${SITE}/roll-data.js"
}

@test "roll-data.js FRAME_A includes install prompt line" {
  grep -A5 "FRAME_A" "${SITE}/roll-data.js" | grep -q "roll loop on"
}

@test "roll-atoms.jsx has parseNdjson helper function" {
  grep -q "parseNdjson" "${SITE}/roll-atoms.jsx"
}

@test "roll-atoms.jsx Terminal state machine has frameA phase" {
  grep -q "frameA" "${SITE}/roll-atoms.jsx"
}

@test "roll-atoms.jsx Terminal state machine has transition phase" {
  grep -q "transition" "${SITE}/roll-atoms.jsx"
}

@test "roll-atoms.jsx Terminal state machine has frameB phase" {
  grep -q "frameB" "${SITE}/roll-atoms.jsx"
}

@test "roll-site.css has is-dim transition style for terminal body" {
  grep -q "is-dim" "${SITE}/roll-site.css"
}

@test "roll-site.css has terminal clock element style" {
  grep -q "r-terminal-clock" "${SITE}/roll-site.css"
}

@test "roll-site.css has ghost line style for idle transition" {
  grep -q "r-tl-ghost" "${SITE}/roll-site.css"
}

@test "roll-site.css has prefers-reduced-motion media query" {
  grep -q "prefers-reduced-motion" "${SITE}/roll-site.css"
}
