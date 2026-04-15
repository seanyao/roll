# CNX-OC (Cybernetix for OpenClaw)

OpenClaw adaptation layer for Cybernetix - Integrates the CNX workflow into the OpenClaw ecosystem.

## What Is This?

`wk-oc` is the **OpenClaw-specific variant** of Cybernetix, providing:
- A unified `$cnx` command entry point
- Seamless integration with the OpenClaw agent
- Simplified skill invocation

## Directory Structure

```
variants/wk-oc/
├── README.md              # This file
├── skills/
│   └── cnx/               # OpenClaw skill
│       ├── SKILL.md       # Skill documentation
│       └── cnx.sh         # Command routing script
└── install.sh             # Installation script (optional)
```

## Installing into OpenClaw

```bash
# Create symlinks (recommended)
ln -s ~/workspace/cybernetix/variants/wk-oc/skills/cnx \
  ~/.openclaw/workspace/skills/cnx

# Also link tools
ln -s ~/workspace/cybernetix/tools/cnx-fetch \
  ~/.openclaw/workspace/skills/cnx-fetch

ln -s ~/workspace/cybernetix/tools/cnx-probe \
  ~/.openclaw/workspace/skills/cnx-probe
```

## Usage

After installation, use in any OpenClaw agent:

```bash
$cnx backlog "user login feature"     # Requirement planning
$cnx build US-001                     # Execute Story
$cnx fetch https://example.com        # Web scraping
$cnx probe find orin                  # Node discovery
```

## Syncing with Upstream

When cybernetix is updated, `wk-oc` automatically gets the updates:

```bash
cd ~/workspace/cybernetix
git pull origin main
# Done! OpenClaw automatically uses the new version
```

## Version Pinning

To pin to a specific version:

```bash
cd ~/workspace/cybernetix
git checkout v1.2.3
```

## Differences

| Feature | Cybernetix (Original) | CNX-OC (OpenClaw) |
|------|-------------------|-------------------|
| Invocation | Call individual skills directly | Unified `$cnx` entry point |
| Tool name | `cnx-fetch` | `cnx-fetch` |
| Tool name | `cnx-probe` | `cnx-probe` |
| Integration | Standalone CLI | OpenClaw ecosystem |

## Maintenance

- **Upstream**: github.com/seanyao/cybernetix
- **Issue reporting**: Submit issues in the cybernetix repository
- **Version**: Follows cybernetix main version
