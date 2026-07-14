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

/** Recursively copy src → dest, mirroring the directory tree. */
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) {
    warn(`Source not found, skipping: ${src}`);
    return;
  }

  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
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
      copyDirSync(srcPath, destPath);
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
 * Resolution:
 *   Uses ONLY the standalone `uv` / `uvx` executable located inside the project/python/ directory.
 *   Tries: uv.exe, uv, uvx.exe, uvx  (Windows-first, then POSIX)
 */
function resolveUvx() {
  const pythonDir = path.join(PROJECT_ROOT, "python");
  const candidates = process.platform === "win32"
    ? ["uv.exe", "uv", "uvx.exe", "uvx"]
    : ["uv", "uvx"];

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
    `Could not find uv or uvx inside project/python/.\n` +
    `  • Please place a standalone uv/uvx binary in: ${pythonDir}`
  );
}

const { bin: uvBin, args: uvArgs } = resolveUvx();

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

for (const dir of DIRS_TO_COPY) {
  const src  = path.join(PROJECT_ROOT, dir);
  const dest = path.join(RELEASE_DIR,  dir);
  log(`  ${dir}  →  Release/${dir}`);
  copyDirSync(src, dest);
}

const tauriToml = path.join(PROJECT_ROOT, "Tauri.toml");
if (fs.existsSync(tauriToml)) {
  fs.copyFileSync(tauriToml, path.join(RELEASE_DIR, "Tauri.toml"));
  log("  Tauri.toml  →  Release/Tauri.toml");
}

ok("All directories copied.");
ok(`Build complete! Output: ${RELEASE_DIR}`);
