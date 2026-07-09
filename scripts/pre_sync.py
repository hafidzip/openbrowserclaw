#!/usr/bin/env python3
"""
pre_sync.py — run this BEFORE `uv sync` in the dev npm script.

Removes optional package entries from python/pyproject.toml when they are
listed there but not actually installed in the venv.  This prevents uv from
installing heavy packages (e.g. llama-cpp-python) that the user never asked
for, allowing the app to launch immediately.

Usage (package.json):
    "dev": "python scripts/pre_sync.py && uv sync --directory ./python && node scripts/dev.mjs"
"""
import sys
import os
import re
import subprocess

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(_SCRIPT_DIR)
_PYTHON_DIR  = os.path.join(_PROJECT_ROOT, "python")

_is_windows = os.name == "nt"
_VENV_PYTHON = (
    os.path.join(_PYTHON_DIR, ".venv", "Scripts", "python.exe")
    if _is_windows
    else os.path.join(_PYTHON_DIR, ".venv", "bin", "python3")
)

# ---------------------------------------------------------------------------
# Optional packages: (venv_import_name, pyproject_dep_prefix, platform_check)
# ---------------------------------------------------------------------------
_OPTIONAL_PACKAGES = [
    ("llama_cpp", "llama-cpp-python", lambda: True),
    ("mlx_lm",   "mlx-lm",           lambda: sys.platform == "darwin"),
    ("mlx_vlm",  "mlx-vlm",          lambda: sys.platform == "darwin"),
]


def _is_installed_in_venv(import_name: str) -> bool:
    """Return True if the package is importable in the project venv."""
    if not os.path.exists(_VENV_PYTHON):
        # No venv yet → nothing is installed.
        return False
    try:
        result = subprocess.run(
            [_VENV_PYTHON, "-c", f"import {import_name}"],
            capture_output=True,
            timeout=10,
        )
        return result.returncode == 0
    except Exception:
        return False


def cleanup() -> None:
    pyproject_path = os.path.join(_PYTHON_DIR, "pyproject.toml")
    if not os.path.isfile(pyproject_path):
        return

    with open(pyproject_path, "r", encoding="utf-8") as f:
        content = f.read()

    changed = False
    for import_name, dep_prefix, platform_check in _OPTIONAL_PACKAGES:
        if not platform_check():
            continue
        if _is_installed_in_venv(import_name):
            continue
        # Match lines like:  "llama-cpp-python>=0.3.33",
        pattern = r'[ \t]*"' + re.escape(dep_prefix) + r'[^"]*"[,]?\r?\n'
        new_content, n = re.subn(pattern, "", content)
        if n:
            print(
                f"[pre_sync] '{dep_prefix}' is in pyproject.toml but not installed "
                "→ removing so uv sync skips it."
            )
            content = new_content
            changed = True

    if changed:
        with open(pyproject_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("[pre_sync] pyproject.toml updated.")
    else:
        print("[pre_sync] No changes needed.")


if __name__ == "__main__":
    cleanup()
