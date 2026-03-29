/**
 * sync-version.cjs — Keep package.json and tauri.conf.json versions in sync.
 *
 * Usage (called automatically by npm version hooks):
 *   node scripts/sync-version.cjs
 *
 * Reads the version from package.json and writes it to tauri.conf.json.
 */

const fs = require("fs");
const path = require("path");

const pkgPath = path.resolve(__dirname, "..", "package.json");
const tauriPath = path.resolve(__dirname, "..", "src-tauri", "tauri.conf.json");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const tauri = JSON.parse(fs.readFileSync(tauriPath, "utf8"));

if (tauri.version !== pkg.version) {
  tauri.version = pkg.version;
  fs.writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");
  console.log(`✅ Synced tauri.conf.json version → ${pkg.version}`);
} else {
  console.log(`✅ Versions already in sync: ${pkg.version}`);
}
