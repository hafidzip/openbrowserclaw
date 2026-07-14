import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Paths
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// scripts/build.mjs lives one level below the project root
const PROJECT_ROOT = path.resolve(__dirname, "..");
const RELEASE_DIR  = path.join(PROJECT_ROOT, "Release");

// Helpers
function log(msg)  { console.log(`\x1b[36m[build]\x1b[0m ${msg}`); }
function ok(msg)   { console.log(`\x1b[32m[build]\x1b[0m ${msg}`); }
function warn(msg) { console.warn(`\x1b[33m[build]\x1b[0m ${msg}`); }
function die(msg)  { console.error(`\x1b[31m[build]\x1b[0m ${msg}`); process.exit(1); }

/** Recursively copy src → dest, mirroring the directory tree.
 *  `skipNames` is an optional set of entry names to skip at any level.
 */
function copyDirSync(src, dest, skipNames = new Set()) {
  if (!fs.existsSync(src)) {
    warn(`Source not found, creating empty directory: ${dest}`);
    fs.mkdirSync(dest, { recursive: true });
    return;
  }

  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) {
      log(`  skipping ${entry.name} (excluded)`);
      continue;
    }
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isSymbolicLink()) {
      try {
        const target = fs.readlinkSync(srcPath);
        try {
          fs.unlinkSync(destPath);
        } catch (_) {}
        const resolvedTarget = path.resolve(src, target);
        let type = "file";
        try {
          if (fs.statSync(resolvedTarget).isDirectory()) {
            type = "dir";
          }
        } catch (_) {}
        fs.symlinkSync(target, destPath, type);
      } catch (err) {
        warn(`Failed to copy symbolic link: ${srcPath} -> ${destPath} (${err.message})`);
      }
    } else if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, skipNames);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err) {
        if (err.code === 'EBUSY' || err.code === 'EACCES' || err.code === 'EPERM') {
          warn(`Skipped copying busy/locked file: ${srcPath} -> ${destPath} (${err.code})`);
        } else {
          throw err;
        }
      }
    }
  }
}

// 1. Read package.json
const pkgPath = path.join(PROJECT_ROOT, "package.json");
if (!fs.existsSync(pkgPath)) die(`package.json not found at: ${pkgPath}`);

const pkg  = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const name = pkg.name?.trim();
if (!name) die("package.json is missing a 'name' field.");

log(`Project name: ${name}`);

// 2. Ensure Release/ exists
log(`Creating Release directory: ${RELEASE_DIR}`);
fs.mkdirSync(RELEASE_DIR, { recursive: true });

// 3. Resolve uv / uvx executable
/**
 * Resolution order:
 *   1. `uvx` on PATH  (standard install)
 *   2. `uv`  on PATH  (run as: uv tool run pyinstaller …)
 *   3. Standalone `uv` / `uvx` inside project/python/
 *      Tries: uv.exe, uv, uvx.exe, uvx  (Windows-first, then POSIX)
 */
function resolveUvx() {
  // Helper: return true if the command is found on PATH
  function onPath(bin) {
    try {
      const flag = process.platform === "win32" ? `where ${bin}` : `which ${bin}`;
      execSync(flag, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  // 1. prefer `uvx` directly on PATH
  if (onPath("uvx")) {
    log("uv: using system uvx from PATH.");
    return { bin: "uvx", args: ["pyinstaller"] };
  }

  // 2. fall back to `uv tool run` on PATH
  if (onPath("uv")) {
    log("uv: using system uv (tool run) from PATH.");
    return { bin: "uv", args: ["tool", "run", "pyinstaller"] };
  }

  // 3. look for a standalone uv / uvx inside project/python/
  const pythonDir = path.join(PROJECT_ROOT, "python");
  const candidates = process.platform === "win32"
    ? ["uvx.exe", "uvx", "uv.exe", "uv"]
    : ["uvx", "uv"];

  for (const candidate of candidates) {
    const full = path.join(pythonDir, candidate);
    if (fs.existsSync(full)) {
      const isUvx = candidate.startsWith("uvx");
      log(`uv: using standalone ${candidate} from project/python/`);
      return isUvx
        ? { bin: `"${full}"`, args: ["pyinstaller"] }
        : { bin: `"${full}"`, args: ["tool", "run", "pyinstaller"] };
    }
  }

  die(
    "Could not find uv or uvx.\n" +
    "  • Install uv globally: https://docs.astral.sh/uv/getting-started/installation/\n" +
    `  • Or place a standalone uv/uvx binary in: ${pythonDir}`
  );
}

const { bin: uvBin, args: uvArgs } = resolveUvx();

// ── Resolve the plain `uv` binary (for sync / build tasks) ───────────────────
function resolveUv() {
  function onPath(bin) {
    try {
      execSync(process.platform === "win32" ? `where ${bin}` : `which ${bin}`, { stdio: "pipe" });
      return true;
    } catch { return false; }
  }
  if (onPath("uv")) return "uv";
  const pythonDir = path.join(PROJECT_ROOT, "python");
  for (const c of process.platform === "win32" ? ["uv.exe", "uv"] : ["uv"]) {
    const full = path.join(pythonDir, c);
    if (fs.existsSync(full)) return `"${full}"`;
  }
  die("Could not find uv binary.");
}

const uvCmd = resolveUv();

// 3b. Build openchadpy wheel and place it inside python/wheels/ so it ships with the release
log("Building openchadpy wheel …");
const openchadpyDir = path.join(PROJECT_ROOT, "openchadpy");
const wheelsOutDir  = path.join(PROJECT_ROOT, "python", "wheels");
if (!fs.existsSync(openchadpyDir)) die(`openchadpy directory not found: ${openchadpyDir}`);
fs.mkdirSync(wheelsOutDir, { recursive: true });
try {
  execSync(`${uvCmd} build --wheel --python 3.13 "${openchadpyDir}" --out-dir "${wheelsOutDir}"`, { stdio: "inherit", cwd: PROJECT_ROOT });
  ok("openchadpy wheel built → python/wheels/");
} catch (err) {
  die(`Failed to build openchadpy wheel: ${err.message}`);
}

// 3c. Copy openchad-webview wheels from openchad-webview/dist so they ship with the release
log("Copying openchad-webview wheels …");
const webviewDistDir = path.join(PROJECT_ROOT, "openchad-webview", "dist");
if (fs.existsSync(webviewDistDir)) {
  const files = fs.readdirSync(webviewDistDir);
  let copied = 0;
  for (const file of files) {
    if (file.endsWith(".whl")) {
      const srcWhl = path.join(webviewDistDir, file);
      const destWhl = path.join(wheelsOutDir, file);
      fs.copyFileSync(srcWhl, destWhl);
      log(`  ${file} → python/wheels/`);
      copied++;
    }
  }
  if (copied > 0) {
    ok(`Copied ${copied} openchad-webview wheel(s) to python/wheels/`);
  } else {
    warn("No .whl files found in openchad-webview/dist/");
  }
} else {
  warn("openchad-webview/dist directory not found.");
}


// 4. Run PyInstaller via uvx
const launcherPath = path.join(PROJECT_ROOT, "launcher.py");
if (!fs.existsSync(launcherPath)) die(`launcher.py not found at: ${launcherPath}`);

// macOS requires .icns; Windows/Linux use .ico
const isMac = process.platform === "darwin";
const iconFilename = isMac ? "icon.icns" : "icon.ico";
const iconPath = path.join(PROJECT_ROOT, iconFilename);
if (!fs.existsSync(iconPath)) warn(`${iconFilename} not found — building without icon.`);

const iconFlag = fs.existsSync(iconPath) ? `--icon "${iconPath}"` : "";

const pyinstallerCmd = [
  uvBin,
  ...uvArgs,
  "--onefile",
  "--noconsole",
  `--name "${name}"`,
  iconFlag,
  `--distpath "${RELEASE_DIR}"`,
  `"${launcherPath}"`,
].filter(Boolean).join(" ");

log(`Running: ${pyinstallerCmd}`);
try {
  execSync(pyinstallerCmd, { stdio: "inherit", cwd: PROJECT_ROOT });
  ok("PyInstaller finished.");
} catch (err) {
  die(`PyInstaller failed: ${err.message}`);
}

const DIRS_TO_COPY = [
  "Backend",
  "ModelProvider",
  "Pipeline",
  "Tools",
  "python",
  "Settings",
  "frontend",
  "icons",
  "capabilities",
  "Extensions", 
  "SKILLS"
];

log("Copying project directories into Release/ …");

// Directories that are copied verbatim — .venv is always excluded from python/
const SKIP_FOR_PYTHON = new Set([".venv"]);

for (const dir of DIRS_TO_COPY) {
  const src  = path.join(PROJECT_ROOT, dir);
  const dest = path.join(RELEASE_DIR,  dir);
  log(`  ${dir}  →  Release/${dir}`);
  const skip = dir === "python" ? SKIP_FOR_PYTHON : new Set();
  copyDirSync(src, dest, skip);
}

const tauriToml = path.join(PROJECT_ROOT, "Tauri.toml");
if (fs.existsSync(tauriToml)) {
  fs.copyFileSync(tauriToml, path.join(RELEASE_DIR, "Tauri.toml"));
  log("  Tauri.toml  →  Release/Tauri.toml");
}

ok("All directories copied.");

// ── Patch Release/python/pyproject.toml: use find-links for the wheel ─────────
// In dev, pyproject.toml uses [tool.uv.sources] with an editable local path.
// In Release, we remove that sources block and instead add [tool.uv] find-links
// so that `uv sync` resolves `openchadpy` from the bundled .whl in wheels/.
const releasePyproject = path.join(RELEASE_DIR, "python", "pyproject.toml");
if (fs.existsSync(releasePyproject)) {
  let toml = fs.readFileSync(releasePyproject, "utf-8");

  // 1. Remove the entire [tool.uv.sources] section (all lines until the next section or EOF)
  toml = toml.replace(/\[tool\.uv\.sources\][^\[]*/s, "");

  // 2. Remove any leftover [tool.uv] section so we can re-add it cleanly
  toml = toml.replace(/\[tool\.uv\][^\[]*/s, "");

  // 3. Trim trailing whitespace/newlines then append the find-links config
  toml = toml.trimEnd() + "\n\n[tool.uv]\nfind-links = [\"wheels\"]\n";

  fs.writeFileSync(releasePyproject, toml, "utf-8");
  ok("Patched Release/python/pyproject.toml → [tool.uv] find-links = [\"wheels\"]");
} else {
  warn("Release/python/pyproject.toml not found — skipping patch.");
}

ok(`Build complete! Output: ${RELEASE_DIR}`);
