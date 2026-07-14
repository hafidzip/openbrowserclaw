import subprocess
import sys
import os
import re
import threading
from pathlib import Path

is_windows = os.name == "nt"

class NullWriter:
    def write(self, text_or_bytes):
        pass
    def flush(self):
        pass
    @property
    def buffer(self):
        return self

if sys.stdout is None:
    sys.stdout = NullWriter()
if sys.stderr is None:
    sys.stderr = NullWriter()

# Optional packages that should only be present if explicitly installed by the user.
# Tuple: (venv_import_name, pyproject_dep_prefix, platform_check)
_OPTIONAL_PACKAGES = [
    ("llama_cpp", "llama-cpp-python", lambda: True),
    ("mlx_lm",   "mlx-lm",           lambda: sys.platform == "darwin"),
    ("mlx_vlm",  "mlx-vlm",          lambda: sys.platform == "darwin"),
]


def _is_installed_in_venv(python_runtime: str, import_name: str) -> bool:
    """Return True if `import_name` is importable inside the bundled venv."""
    if not os.path.exists(python_runtime):
        # Venv doesn't exist yet → package is definitely not installed.
        return False
    try:
        result = subprocess.run(
            [python_runtime, "-c", f"import {import_name}"],
            capture_output=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if is_windows else 0,
        )
        return result.returncode == 0
    except Exception:
        return False


def remove_uninstalled_from_pyproject(python_runtime: str, python_dir: str) -> None:
    """Strip optional package entries from pyproject.toml when they are listed
    there but not actually installed in the venv.  This prevents uv sync from
    pulling them in on the next run."""
    pyproject_path = os.path.join(python_dir, "pyproject.toml")
    if not os.path.isfile(pyproject_path):
        return

    with open(pyproject_path, "r", encoding="utf-8") as f:
        content = f.read()

    changed = False
    for import_name, dep_prefix, platform_check in _OPTIONAL_PACKAGES:
        if not platform_check():
            continue
        if _is_installed_in_venv(python_runtime, import_name):
            continue
        # Match lines like:  "llama-cpp-python>=0.3.33",
        pattern = r'[ \t]*"' + re.escape(dep_prefix) + r'[^"]*"[,]?\r?\n'
        new_content, n = re.subn(pattern, "", content)
        if n:
            print(
                f"[launcher] '{dep_prefix}' is in pyproject.toml but not installed "
                "→ removing so uv sync skips it."
            )
            content = new_content
            changed = True

    if changed:
        with open(pyproject_path, "w", encoding="utf-8") as f:
            f.write(content)


def _tee(src, *dests):
    for line in src:
        for d in dests:
            d.write(line)
            d.flush()



def main():
    # Get the directory of the current executable
    if getattr(sys, 'frozen', False):
        base_path = os.path.dirname(sys.executable)
    else:
        base_path = os.path.dirname(os.path.abspath(__file__))

    log_path = Path(base_path) / "openchad.log"

    # Determine uv binary based on OS

    uv_binary = "uv.exe" if is_windows else "uv"
    uv_path = os.path.join(base_path, "python", uv_binary)
    python_dir = os.path.join(base_path, "python")
    # Determine bundled python path
    if is_windows:
        python_runtime = os.path.join(base_path, "python", ".venv", "Scripts", "python.exe")
        pythonw_runtime = os.path.join(base_path, "python", ".venv", "Scripts", "pythonw.exe")
    else:
        python_runtime = os.path.join(base_path, "python", ".venv", "bin", "python3")
        pythonw_runtime = python_runtime
    # Verify python runtime exists
    if not os.path.exists(python_runtime):
        print(f"Error: Python runtime not found at {python_runtime}")
        sys.exit(1)
    # Set environment variables for uv to use bundled python
    env = os.environ.copy()
    env["UV_PYTHON"] = python_runtime
    env["UV_PYTHON_AUTO_INSTALL"] = "0"
    # Remove optional packages from pyproject.toml if not installed, BEFORE uv sync.
    remove_uninstalled_from_pyproject(python_runtime, python_dir)

    # Run uv sync first to ensure dependencies are fully synchronized windowlessly
    sync_cmd = [uv_path, "sync", "--directory", "python"]
    try:
        subprocess.run(
            sync_cmd,
            cwd=base_path,
            env=env,
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW if is_windows else 0,
        )
    except Exception as e:
        print(f"Warning: uv sync failed: {e}", file=sys.stderr)

    # Command to run: pythonw python/main.py (fully windowless on Windows)
    cmd = [pythonw_runtime, "python/main.py"]
    try:
        with open(log_path, "wb") as log_file:
            process = subprocess.Popen(
                cmd,
                cwd=base_path,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if is_windows else 0,
            )

            t_out = threading.Thread(target=_tee, args=(process.stdout, sys.stdout.buffer, log_file))
            t_err = threading.Thread(target=_tee, args=(process.stderr, sys.stderr.buffer, log_file))
            t_out.start()
            t_err.start()

            process.wait()
            t_out.join()
            t_err.join()

        sys.exit(process.returncode)
    except Exception as e:
        print(f"Failed to start openchad: {e}")
        sys.exit(1)
if __name__ == "__main__":
    main()