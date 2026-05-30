"""
roll_git — shared git helpers for roll CLI scripts.

Standalone entry scripts (roll-home.py, roll-loop-status.py, ...) insert
_LIB_DIR into sys.path and import these helpers, mirroring the roll_render
import pattern. Keeps git/subprocess plumbing out of the pure-rendering
roll_render module and gives slug derivation a single source of truth.
"""

from __future__ import annotations
import subprocess
from typing import Optional


def git_remote_url(repo_path: str) -> Optional[str]:
    """Return the remote URL for a git repo — origin first, then any — or None."""
    try:
        url = subprocess.check_output(
            ["git", "-C", repo_path, "remote", "get-url", "origin"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
        if url:
            return url
    except Exception:
        pass
    # Fallback: first available remote
    try:
        remotes = subprocess.check_output(
            ["git", "-C", repo_path, "remote"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip().splitlines()
        if remotes:
            url = subprocess.check_output(
                ["git", "-C", repo_path, "remote", "get-url", remotes[0]],
                stderr=subprocess.DEVNULL, text=True,
            ).strip()
            if url:
                return url
    except Exception:
        pass
    return None
