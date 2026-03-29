/**
 * migrateCssIcons.cjs — Replaces `.material-icons` and `.material-symbols-outlined`
 * selectors in CSS files with `svg` to match the new Icon component output.
 *
 * The Icon component renders <svg> directly (via lucide-react), so CSS rules
 * like `.parent .material-icons { font-size: 18px }` should become
 * `.parent svg { width: 18px; height: 18px }`.
 *
 * Additionally converts `font-size: Xpx` to `width: Xpx; height: Xpx` for SVGs.
 */

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");

function findCssFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findCssFiles(full));
    else if (entry.name.endsWith(".css")) results.push(full);
  }
  return results;
}

const cssFiles = findCssFiles(SRC);

let totalFiles = 0;
let totalReplacements = 0;

for (const abs of cssFiles) {
  const rel = path.relative(SRC, abs);
  let content = fs.readFileSync(abs, "utf8");
  const original = content;

  // 1. Replace `.material-icons` and `.material-symbols-outlined` with `svg`
  //    in selectors like `.parent .material-icons {` or `.parent .material-icons,`
  //    Also handle standalone `.material-icons {`
  const selectorPattern = /\.material-(icons|symbols-outlined)\b/g;
  const matches = content.match(selectorPattern);
  if (!matches) continue;

  content = content.replace(selectorPattern, "svg");

  // 2. Inside rules that previously targeted .material-icons,
  //    convert `font-size: Xpx` to `width: Xpx; height: Xpx`
  //    (SVGs use width/height, not font-size)
  // This is a rough heuristic — we look for `svg {` blocks and fix font-size inside
  // We'll do this line by line in blocks that follow `svg {`
  const lines = content.split("\n");
  const result = [];
  let inSvgBlock = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Detect if we're entering an svg rule block
    if (/\bsvg\s*\{/.test(line) || /\bsvg\s*,/.test(line)) {
      inSvgBlock = true;
      braceDepth = 0;
    }

    if (inSvgBlock) {
      // Track braces
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }

      // Convert font-size to width+height for SVG icons
      const fontSizeMatch = line.match(/font-size:\s*(\d+)px/);
      if (fontSizeMatch) {
        const size = fontSizeMatch[1];
        line = line.replace(/font-size:\s*\d+px\s*;?/, `width: ${size}px; height: ${size}px;`);
      }

      if (braceDepth <= 0) {
        inSvgBlock = false;
      }
    }

    result.push(line);
  }

  content = result.join("\n");

  if (content !== original) {
    fs.writeFileSync(abs, content, "utf8");
    totalFiles++;
    totalReplacements += matches.length;
    console.log(`  ✓ ${rel}: ${matches.length} selectors updated`);
  }
}

console.log(`\nDone — ${totalReplacements} selectors in ${totalFiles} files.`);
