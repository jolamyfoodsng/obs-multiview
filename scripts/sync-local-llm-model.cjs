const fs = require("node:fs");
const crypto = require("node:crypto");
const https = require("node:https");
const path = require("node:path");

const MODEL_FILE = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
const MIN_MODEL_BYTES = 1_000_000;
const DEFAULT_MODEL_URL = `https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/${MODEL_FILE}?download=true`;
const DEFAULT_MODEL_SHA256 = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e";
const MAX_REDIRECTS = 8;

const repoRoot = path.resolve(__dirname, "..");
const resourceDir = path.join(repoRoot, "src-tauri", "resources", "models", "llm");
const targetPath = path.join(resourceDir, MODEL_FILE);
const tempTargetPath = `${targetPath}.part`;

function isValidModel(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > MIN_MODEL_BYTES;
  } catch {
    return false;
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const file = fs.createReadStream(filePath);

    file.on("data", (chunk) => hash.update(chunk));
    file.on("error", reject);
    file.on("end", () => resolve(hash.digest("hex")));
  });
}

async function verifyModel(filePath) {
  if (!isValidModel(filePath)) return false;

  const expectedSha256 = process.env.LOCAL_LLM_MODEL_SHA256 || DEFAULT_MODEL_SHA256;
  if (!expectedSha256) return true;

  const actualSha256 = await sha256File(filePath);
  if (actualSha256 !== expectedSha256) {
    console.error(`[sync-local-llm-model] SHA256 mismatch for ${filePath}`);
    console.error(`[sync-local-llm-model] Expected ${expectedSha256}`);
    console.error(`[sync-local-llm-model] Actual   ${actualSha256}`);
    return false;
  }

  return true;
}

async function findSourcePath() {
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
    if (await verifyModel(resolved)) return resolved;
  }

  return (await verifyModel(targetPath)) ? targetPath : null;
}

function removeIfExists(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Best effort cleanup.
  }
}

fs.mkdirSync(resourceDir, { recursive: true });

function downloadFile(url, destinationPath, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "OBS-Church-Studio-Release-Build",
        },
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;

        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(new Error("Too many redirects while downloading the local LLM model."));
            return;
          }
          const nextUrl = new URL(location, url).toString();
          downloadFile(nextUrl, destinationPath, redirectsLeft - 1).then(resolve, reject);
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          reject(new Error(`Model download failed with HTTP ${statusCode}.`));
          return;
        }

        const totalBytes = Number(response.headers["content-length"] || 0);
        let downloadedBytes = 0;
        let lastLoggedPercent = -1;
        const file = fs.createWriteStream(destinationPath);

        response.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          if (!totalBytes) return;

          const percent = Math.floor((downloadedBytes / totalBytes) * 100);
          if (percent >= lastLoggedPercent + 10) {
            lastLoggedPercent = percent;
            console.log(`[sync-local-llm-model] Downloaded ${percent}%`);
          }
        });

        response.pipe(file);

        file.on("finish", () => {
          file.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });

        file.on("error", (error) => {
          removeIfExists(destinationPath);
          reject(error);
        });
      },
    );

    request.on("error", (error) => {
      removeIfExists(destinationPath);
      reject(error);
    });
  });
}

async function downloadModelToTarget() {
  const modelUrl = process.env.LOCAL_LLM_MODEL_URL || DEFAULT_MODEL_URL;
  removeIfExists(tempTargetPath);
  console.log(`[sync-local-llm-model] Downloading bundled local LLM model from ${modelUrl}`);
  await downloadFile(modelUrl, tempTargetPath);

  if (!(await verifyModel(tempTargetPath))) {
    removeIfExists(tempTargetPath);
    throw new Error("Downloaded local LLM model failed validation.");
  }

  removeIfExists(targetPath);
  fs.renameSync(tempTargetPath, targetPath);
  console.log(`[sync-local-llm-model] Downloaded model -> ${targetPath}`);
}

async function main() {
  const sourcePath = await findSourcePath();
  if (!sourcePath) {
    await downloadModelToTarget();
    return;
  }

  if (path.resolve(sourcePath) === targetPath) {
    console.log(`[sync-local-llm-model] Bundled model already present at ${targetPath}`);
    return;
  }

  const sourceStats = fs.statSync(sourcePath);
  if (await verifyModel(targetPath)) {
    const targetStats = fs.statSync(targetPath);
    if (targetStats.size === sourceStats.size) {
      console.log(`[sync-local-llm-model] Bundled model already up to date at ${targetPath}`);
      return;
    }
  }

  fs.copyFileSync(sourcePath, targetPath);
  if (!(await verifyModel(targetPath))) {
    removeIfExists(targetPath);
    throw new Error("Copied local LLM model failed validation.");
  }
  console.log(`[sync-local-llm-model] Copied ${sourcePath} -> ${targetPath}`);
}

main().catch((error) => {
  console.error(`[sync-local-llm-model] ${error.message}`);
  console.error("[sync-local-llm-model] Set LOCAL_LLM_MODEL_SOURCE to a valid GGUF if the download is unavailable.");
  process.exit(1);
});
