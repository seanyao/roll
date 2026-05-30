#!/usr/bin/env bats
# Tests for roll-doc SKILL.md Phase 3b Deep Read rules (US-DOC-012)

SKILL="${BATS_TEST_DIRNAME}/../../skills/roll-doc/SKILL.md"

@test "roll-doc SKILL.md: documents Phase 3b — Deep Read section" {
  [ -f "$SKILL" ]
  grep -qF 'Phase 3b' "$SKILL"
  grep -qiE 'Deep Read|深度读取' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 specifies non-truncated full-file reading" {
  grep -qiE '(no truncat|不截断|read.*full|全量读)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 defines symbol table fields — exports" {
  grep -qiE 'exports|exported' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 defines symbol table fields — imports" {
  grep -qiE 'imports.*source.*target|import.*source.*target' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 defines symbol table fields — enums" {
  grep -qiE 'enums' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 defines symbol table fields — external_urls" {
  grep -qiE 'external.url' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 defines symbol table fields — configs" {
  grep -qiE 'configs' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 1 lists exclusion directories" {
  grep -qF 'node_modules' "$SKILL"
  grep -qF '.git' "$SKILL"
  grep -qF 'dist' "$SKILL"
  grep -qF 'build' "$SKILL"
  grep -qF '.shared' "$SKILL"
  grep -qF '.roll/dream' "$SKILL"
  grep -qF '.roll/briefs' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b documents trigger conditions" {
  grep -qiE 'Trigger conditions' "$SKILL"
  grep -qiE '(Phase 2 found.*gap|code characteristic|cannot capture)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b documents --dry-run summary behavior" {
  grep -qiE 'dry.run.*(symbol|摘要|summary|print.*count)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b documents --force unchanged behavior" {
  grep -qiE 'force.*(unchanged|不变|still|only.*draft)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists data-flow topic" {
  grep -qiE '(data.flow|数据流|调用链)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists state-machine topic" {
  grep -qiE '(state.machine|状态机)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists external-integration topic" {
  grep -qiE '(integration|外部集成)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists deployment-pipeline topic" {
  grep -qiE '(deployment|部署管线)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists AGENTS.md auto-gen topic" {
  grep -qiE 'AGENTS\.md.*(auto|自动|生成|generat)' "$SKILL"
}

@test "roll-doc SKILL.md: Phase 3b Step 2 lists high-fanin README topic" {
  grep -qiE '(high.fan.?in|高引用|high.*ref|被.*引用)' "$SKILL"
}

# ── US-DOC-013: Data Flow / Import Chain Tracing ──

@test "roll-doc SKILL.md: data-flow subsection documents entry point selection" {
  grep -qiE '(Entry point.*selection|entry.*file.*pattern|bin/|main\.\*)' "$SKILL"
}

@test "roll-doc SKILL.md: data-flow subsection documents chain construction algorithm" {
  grep -qiE '(Chain construction|recursively.*follow|call graph|directed graph)' "$SKILL"
}

@test "roll-doc SKILL.md: data-flow subsection documents cross-directory threshold (≥3)" {
  grep -qiE '(cross.directory|≥.*3.*(director|dir)|at least.*3.*(director|dir))' "$SKILL"
}

@test "roll-doc SKILL.md: data-flow subsection documents output structure with call chain and files table" {
  grep -qiE '(Complete Call Chain|完整调用链)' "$SKILL"
  grep -qiE '(Files Involved|涉及文件)' "$SKILL"
}

@test "roll-doc SKILL.md: data-flow subsection documents Draft header requirement" {
  grep -qiE '(Draft.*auto.generated|draft header)' "$SKILL"
}

@test "roll-doc SKILL.md: data-flow subsection documents idempotency (skip if already exists)" {
  grep -qiE '(skip.*already.*exist|do not overwrite.*data.flow|idempoten.*skip)' "$SKILL"
}

@test "roll-doc dataflow fixture: directory has ≥3 distinct source dirs with imports" {
  FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/roll_doc_dataflow"
  [ -d "$FIXTURE" ]
  # Count distinct parent directories of .ts files (excluding node_modules)
  dirs=$(find "$FIXTURE" -name '*.ts' -not -path '*/node_modules/*' \
    -exec dirname {} \; | sort -u | wc -l | tr -d ' ')
  [ "$dirs" -ge 3 ]
}

@test "roll-doc dataflow fixture: entry file imports from another directory" {
  FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/roll_doc_dataflow"
  # main.ts should import from outside its own directory
  grep -qE 'from "\.\./' "$FIXTURE/src/cli/main.ts"
}

# ── US-DOC-014: State Machine ──

@test "roll-doc SKILL.md: state-machine subsection documents detection rule — enum name pattern" {
  grep -qiE '(\*State.*\*Status|\*Status.*\*State)' "$SKILL"
  grep -qiE '(referenced by.*≥.*2|≥.*2.*source.*file|imported.*by.*2)' "$SKILL"
}

@test "roll-doc SKILL.md: state-machine subsection documents output structure with states and references" {
  grep -qiE '(### States|状态列表)' "$SKILL"
  grep -qiE '(### Referenced By|引用文件|### Inferred Transitions)' "$SKILL"
  grep -qiE '(Inferred Transitions|切换条件|推断.*转换)' "$SKILL"
}

@test "roll-doc SKILL.md: state-machine subsection documents idempotency (skip if already exists)" {
  grep -qiE '(state.machines.*already.*exist|skip unless.*--force|Existing.*state)' "$SKILL"
}

@test "roll-doc SKILL.md: state-machine subsection documents threshold (skip when no qualifying enum)" {
  grep -qiE '(no.*qualifying.*enum|no enum.*meet|skip generation.*state)' "$SKILL"
}

@test "roll-doc statemachine fixture: directory exists with source files" {
  FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/roll_doc_statemachine"
  [ -d "$FIXTURE" ]
  [ -d "$FIXTURE/src" ]
}

@test "roll-doc statemachine fixture: OrderState enum defined and named *State" {
  FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/roll_doc_statemachine"
  grep -qE 'enum OrderState' "$FIXTURE/src/state/types.ts"
  # enum values
  grep -qE 'Pending|Processing|Shipped|Delivered|Cancelled' "$FIXTURE/src/state/types.ts"
}

@test "roll-doc statemachine fixture: OrderState imported by ≥3 source files" {
  FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/roll_doc_statemachine"
  # Count files that import OrderState (exclude types.ts itself and test files)
  import_count=$(grep -rl 'OrderState' "$FIXTURE/src" \
    | grep -v 'types.ts' | wc -l | tr -d ' ')
  [ "$import_count" -ge 3 ]
}

# ── US-DOC-015: External Integrations ──

@test "roll-doc SKILL.md: external-integration subsection documents detection rule" {
  grep -qiE '(External Integration|外部集成)' "$SKILL"
  grep -qiE 'fetch' "$SKILL"
  grep -qiE '(axios|http\.get|http\.\*)' "$SKILL"
  grep -qiE '(API_ENDPOINT|\*_URL|\*_HOST)' "$SKILL"
  grep -qiE '(https\?://|hardcoded.*http)' "$SKILL"
}

@test "roll-doc SKILL.md: external-integration subsection documents per-entry fields (timeout, error handling)" {
  grep -qiE '(endpoint URL)' "$SKILL"
  grep -qiE 'timeout' "$SKILL"
  grep -qiE '(error handling|fallback|\.catch|try.*catch)' "$SKILL"
}

@test "roll-doc SKILL.md: external-integration subsection merges multi-site endpoint into one record" {
  grep -qiE '(merged into.*one|merge.*one integration|same endpoint.*one|all.*call sites)' "$SKILL"
}

@test "roll-doc SKILL.md: external-integration subsection documents empty-skip and idempotency" {
  grep -qiE '(no external integration.*skip|skip generation.*no empty.*integration|integrations.md.*skip)' "$SKILL"
  grep -qiE '(Existing.*integrations.md|integrations.md.*skip unless.*--force)' "$SKILL"
}

@test "roll-doc SKILL.md: Step 2 table maps 外部集成 to docs/integrations.md" {
  grep -qE '外部集成.*docs/integrations.md' "$SKILL"
}

@test "roll-doc integrations fixture: directory exists with source files" {
  FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/roll_doc_integrations"
  [ -d "$FIXTURE" ]
  [ -d "$FIXTURE/src" ]
}

@test "roll-doc integrations fixture: contains a URL with timeout config" {
  FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/roll_doc_integrations"
  # payment endpoint: hardcoded https URL, fetch call, and timeout field
  grep -qE 'https://api\.payments\.example\.com' "$FIXTURE/src/clients/payment.ts"
  grep -qE 'fetch\(' "$FIXTURE/src/clients/payment.ts"
  grep -qE 'timeout: *5000' "$FIXTURE/src/clients/payment.ts"
}

@test "roll-doc integrations fixture: contains a URL without timeout config" {
  FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/roll_doc_integrations"
  # profile endpoint: hardcoded https URL, fetch call, no timeout field
  grep -qE 'https://profile\.example\.com' "$FIXTURE/src/clients/profile.ts"
  grep -qE 'fetch\(' "$FIXTURE/src/clients/profile.ts"
  ! grep -qE 'timeout' "$FIXTURE/src/clients/profile.ts"
}

# ── US-DOC-016: Deployment Pipeline ──

@test "roll-doc SKILL.md: deployment subsection documents detection rule — CI config files + deploy URL" {
  grep -qiE '(Deployment Pipeline|部署管线)' "$SKILL"
  grep -qF '.github/workflows' "$SKILL"
  grep -qF '.gitlab-ci.yml' "$SKILL"
  grep -qiE '(circle\.yml|circleci)' "$SKILL"
  grep -qF 'Jenkinsfile' "$SKILL"
  grep -qiE '(vercel|netlify|cloudflare|firebase|\*\.app|\*\.dev)' "$SKILL"
}

@test "roll-doc SKILL.md: deployment subsection documents output fields — platform, triggers, jobs, deploy URL, env names" {
  grep -qiE '(CI [Pp]latform)' "$SKILL"
  grep -qiE '(trigger event|push.*PR.*tag|push.*pull_request)' "$SKILL"
  grep -qiE '(Key Jobs|key job)' "$SKILL"
  grep -qiE '(Deploy Target|deploy.*URL|部署目标)' "$SKILL"
  grep -qiE '(Environment Variable|环境变量|env var.*name)' "$SKILL"
}

@test "roll-doc SKILL.md: deployment subsection lists env var names without values" {
  grep -qiE '(without value|不含值|only names|never emit secret)' "$SKILL"
}

@test "roll-doc SKILL.md: deployment subsection documents empty-skip and idempotency" {
  grep -qiE '(no CI config.*skip|skip generation.*no empty.*deployment|deployment.md.*skip)' "$SKILL"
  grep -qiE '(Existing.*deployment.md|deployment.md.*skip unless.*--force)' "$SKILL"
}

@test "roll-doc SKILL.md: Step 2 table maps 部署管线 to docs/deployment.md" {
  grep -qE '部署管线.*docs/deployment.md' "$SKILL"
}

@test "roll-doc deployment fixture: contains a GitHub Actions workflow file" {
  FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/roll_doc_deployment"
  [ -d "$FIXTURE" ]
  [ -f "$FIXTURE/.github/workflows/deploy.yml" ]
}

@test "roll-doc deployment fixture: workflow declares jobs and a deploy URL" {
  FIXTURE="${BATS_TEST_DIRNAME}/../fixtures/roll_doc_deployment"
  WF="$FIXTURE/.github/workflows/deploy.yml"
  # jobs present
  grep -qE '^  test:' "$WF"
  grep -qE '^  build:' "$WF"
  grep -qE '^  deploy:' "$WF"
  # deploy URL (vercel) present
  grep -qE 'https://my-app\.vercel\.app' "$WF"
  # env var name present
  grep -qE 'VERCEL_TOKEN' "$WF"
}
