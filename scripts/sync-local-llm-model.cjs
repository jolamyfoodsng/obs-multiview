const fs = require("node:fs");
const path = require("node:path");

const MODEL_FILE = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
const MIN_MODEL_BYTES = 1_000_000;

const repoRoot = path.resolve(__dirname, "..");
const resourceDir = path.join(repoRoot, "src-tauri", "resources", "models", "llm");
const targetPath = path.join(resourceDir, MODEL_FILE);

function isValidModel(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > MIN_MODEL_BYTES;
  } catch {
    return false;
  }
}

function findSourcePath() {
  const candidates = [];
  if (process.env.LOCAL_LLM_MODEL_SOURCE) {
    candidates.push(process.env.LOCAL_LLM_MODEL_SOURCE);
  }

  const userProfile = process.env.USERPROFILE || process.env.HOME || "";
  if (userProfile) {
    candidates.push(path.join(userProfile, "Downloads", MODEL_FILE));
    candidates.push(path.join(userProfile, "Documents", "OBSChurchStudio", "models", "llm", MODEL_FILE));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (resolved === targetPath) continue;
    if (isValidModel(resolved)) return resolved;
  }

  return isValidModel(targetPath) ? targetPath : null;
}

const sourcePath = findSourcePath();
if (!sourcePath) {
  console.error("[sync-local-llm-model] Missing local GGUF source.");
  console.error("[sync-local-llm-model] Set LOCAL_LLM_MODEL_SOURCE or place the model at:");
  console.error(`  ${path.join(process.env.USERPROFILE || "~", "Downloads", MODEL_FILE)}`);
  process.exit(1);
}

fs.mkdirSync(resourceDir, { recursive: true });

if (path.resolve(sourcePath) === targetPath) {
  console.log(`[sync-local-llm-model] Bundled model already present at ${targetPath}`);
  process.exit(0);
}

const sourceStats = fs.statSync(sourcePath);
if (isValidModel(targetPath)) {
  const targetStats = fs.statSync(targetPath);
  if (targetStats.size === sourceStats.size) {
    console.log(`[sync-local-llm-model] Bundled model already up to date at ${targetPath}`);
    process.exit(0);
  }
}

fs.copyFileSync(sourcePath, targetPath);
console.log(`[sync-local-llm-model] Copied ${sourcePath} -> ${targetPath}`);
