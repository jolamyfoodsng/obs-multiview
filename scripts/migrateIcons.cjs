/**
 * Bulk-replace material icon spans with <Icon> components — PASS 2.
 * Handles remaining patterns: dynamic icon names, multi-line, extra classes.
 * Run: node scripts/migrateIcons.cjs
 */

const fs = require("fs");
const path = require("path");

function findTSXFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findTSXFiles(fullPath));
    else if (entry.name.endsWith(".tsx")) results.push(fullPath);
  }
  return results;
}

const srcDir = path.join(__dirname, "..", "src");
const files = findTSXFiles(srcDir);
let totalReplaced = 0;

for (const file of files) {
  let content = fs.readFileSync(file, "utf8");
  const origContent = content;

  const countBefore = (content.match(/className="material-(icons|symbols-outlined)/g) || []).length;
  if (countBefore === 0) continue;

  // Pattern A: Dynamic icon names on same line
  // <span className="material-icons">{expr}</span>
  content = content.replace(
    /<span className="material-(icons|symbols-outlined)">(\{[^}]+\})<\/span>/g,
    (_match, _type, expr) => {
      // expr is like {tab.icon} or {saving ? "hourglass_empty" : "save"}
      return `<Icon name=${expr} size={20} />`;
    }
  );

  // Pattern B: Dynamic icon with style on same line
  // <span className="material-icons" style={{ fontSize: NN }}>{expr}</span>
  content = content.replace(
    /<span className="material-(icons|symbols-outlined)" style=\{\{([^}]*)\}\}>(\{[^}]+\})<\/span>/g,
    (_match, _type, styleInner, expr) => {
      const sizeM = styleInner.match(/fontSize:\s*(\d+)/);
      const size = sizeM ? sizeM[1] : "20";
      const parts = styleInner.split(",").map(p => p.trim()).filter(p => p && !p.startsWith("fontSize"));
      const otherStyles = parts.length > 0 ? ` style={{ ${parts.join(", ")} }}` : "";
      retuthrn `<Icon name=${expr} size={${size}}${otherStyles} />`;
    }
  );

  // Pattern C: Dynamic icon with extra CSS classes
  // <span className="material-icons some-class">{expr}</span>
  content = content.replace(
    /<span className="material-(icons|symbols-outlined) ([^"]+)">(\{[^}]+\})<\/span>/g,
    (_match, _type, extraClasses, expr) => {
      return `<Icon name=${expr} size={20} className="${extraClasses}" />`;
    }
  );

  // Pattern D: Multi-line with icon name on next line (no dynamic)
  // <span className="material-icons" style={{ ... }}>
  //   iconname
  // </span>
  content = content.replace(
    /<span\s+className="material-(icons|symbols-outlined)"(\s+style=\{\{([^}]*)\}\})?\s*>\s*\n\s*([\w_]+)\s*\n\s*<\/span>/g,
    (_match, _type, _styleAttr, styleInner, iconName) => {
      let size = "20";
      let otherStyles = "";
      if (styleInner) {
        const sizeM = styleInner.match(/fontSize:\s*(\d+)/);
        if (sizeM) size = sizeM[1];
        const parts = styleInner.split(",").map(p => p.trim()).filter(p => p && !p.startsWith("fontSize"));
        if (parts.length > 0) {
          otherStyles = ` style={{ ${parts.join(", ")} }}`;
        }
      }
      return `<Icon name="${iconName}" size={${size}}${otherStyles} />`;
    }
  );

  // Pattern E: Multi-line with extra class and icon name on next line
  // <span className="material-icons some-class">
  //   iconname
  // </span>
  content = content.replace(
    /<span\s+className="material-(icons|symbols-outlined) ([^"]+)"(\s+style=\{\{([^}]*)\}\})?\s*>\s*\n\s*([\w_]+)\s*\n\s*<\/span>/g,
    (_match, _type, extraClasses, _styleAttr, styleInner, iconName) => {
      let size = "20";
      let otherStyles = "";
      if (styleInner) {
        const sizeM = styleInner.match(/fontSize:\s*(\d+)/);
        if (sizeM) size = sizeM[1];
        const parts = styleInner.split(",").map(p => p.trim()).filter(p => p && !p.startsWith("fontSize"));
        if (parts.length > 0) {
          otherStyles = ` style={{ ${parts.join(", ")} }}`;
        }
      }
      return `<Icon name="${iconName}" size={${size}} className="${extraClasses}"${otherStyles} />`;
    }
  );

  // Pattern F: className on separate line (JSX multi-attribute span)
  // <span
  //   className="material-icons"
  //   style={{ ... }}
  // >
  //   iconname
  // </span>
  // or
  // <span
  //   className="material-icons some-class"
  //   style?={{ ... }}
  //   ...attributes
  // >
  //   iconname | {expr}
  // </span>
  content = content.replace(
    /<span\s*\n\s*className="material-(icons|symbols-outlined)(?:\s+([^"]*))?"(?:\s*\n\s*style=\{\{([^}]*)\}\})?(?:\s*\n[^>]*)?\s*>\s*\n?\s*([\w_]+|\{[^}]+\})\s*<\/span>/g,
    (_match, _type, extraClasses, styleInner, iconNameOrExpr) => {
      let size = "20";
      let otherStyles = "";
      let classAttr = "";
      if (extraClasses) {
        classAttr = ` className="${extraClasses}"`;
      }
      if (styleInner) {
        const sizeM = styleInner.match(/fontSize:\s*(\d+)/);
        if (sizeM) size = sizeM[1];
        const parts = styleInner.split(",").map(p => p.trim()).filter(p => p && !p.startsWith("fontSize"));
        if (parts.length > 0) {
          otherStyles = ` style={{ ${parts.join(", ")} }}`;
        }
      }
      const nameAttr = iconNameOrExpr.startsWith("{")
        ? `name=${iconNameOrExpr}`
        : `name="${iconNameOrExpr}"`;
      return `<Icon ${nameAttr} size={${size}}${classAttr}${otherStyles} />`;
    }
  );

  // Pattern G: Multi-line ternary expressions or complex JSX expressions
  // <span className="material-icons" style={{ ... }}>
  //   {expr ? "a" : "b"}
  // </span>
  // or
  // <span className="material-icons extra-class" style={{ ... }}>
  //   {complex expression}
  // </span>
  content = content.replace(
    /<span\s+className="material-(icons|symbols-outlined)(?:\s+([^"]*))?"(?:\s+style=\{\{([^}]*)\}\})?(?:\s+[a-zA-Z][\w-]*="[^"]*")*\s*>\s*\n\s*(\{[^]*?\})\s*\n\s*<\/span>/g,
    (_match, _type, extraClasses, styleInner, expr) => {
      let size = "20";
      let otherStyles = "";
      let classAttr = "";
      if (extraClasses) {
        classAttr = ` className="${extraClasses}"`;
      }
      if (styleInner) {
        const sizeM = styleInner.match(/fontSize:\s*(\d+)/);
        if (sizeM) size = sizeM[1];
        const parts = styleInner.split(",").map(p => p.trim()).filter(p => p && !p.startsWith("fontSize"));
        if (parts.length > 0) {
          otherStyles = ` style={{ ${parts.join(", ")} }}`;
        }
      }
      // Clean up the expression — remove surrounding whitespace
      const cleanExpr = expr.trim();
      return `<Icon name=${cleanExpr} size={${size}}${classAttr}${otherStyles} />`;
    }
  );

  // Pattern H: Same as G but icon name is static text on next line (not {expr})
  content = content.replace(
    /<span\s+className="material-(icons|symbols-outlined)(?:\s+([^"]*))?"(?:\s+style=\{\{([^}]*)\}\})?\s*>\s*\n\s*([\w_]+)\s*\n\s*<\/span>/g,
    (_match, _type, extraClasses, styleInner, iconName) => {
      let size = "20";
      let otherStyles = "";
      let classAttr = "";
      if (extraClasses) {
        classAttr = ` className="${extraClasses}"`;
      }
      if (styleInner) {
        const sizeM = styleInner.match(/fontSize:\s*(\d+)/);
        if (sizeM) size = sizeM[1];
        const parts = styleInner.split(",").map(p => p.trim()).filter(p => p && !p.startsWith("fontSize"));
        if (parts.length > 0) {
          otherStyles = ` style={{ ${parts.join(", ")} }}`;
        }
      }
      return `<Icon name="${iconName}" size={${size}}${classAttr}${otherStyles} />`;
    }
  );

  // Pattern I: className on a separate line
  // <span
  //   className="material-icons extra"
  //   style={{ ... }}
  // >
  //   iconname or {expr}
  // </span>
  content = content.replace(
    /<span\s*\n\s*className="material-(icons|symbols-outlined)(?:\s+([^"]*))?"(?:\s*\n\s*style=\{\{([^}]*)\}\})?(?:\s*\n\s*[a-zA-Z][\w-]*="[^"]*")*\s*>\s*\n?\s*(\{[^]*?\}|[\w_]+)\s*\n?\s*<\/span>/g,
    (_match, _type, extraClasses, styleInner, iconNameOrExpr) => {
      let size = "20";
      let otherStyles = "";
      let classAttr = "";
      if (extraClasses) {
        classAttr = ` className="${extraClasses}"`;
      }
      if (styleInner) {
        const sizeM = styleInner.match(/fontSize:\s*(\d+)/);
        if (sizeM) size = sizeM[1];
        const parts = styleInner.split(",").map(p => p.trim()).filter(p => p && !p.startsWith("fontSize"));
        if (parts.length > 0) {
          otherStyles = ` style={{ ${parts.join(", ")} }}`;
        }
      }
      const nameAttr = iconNameOrExpr.trim().startsWith("{")
        ? `name=${iconNameOrExpr.trim()}`
        : `name="${iconNameOrExpr.trim()}"`;
      return `<Icon ${nameAttr} size={${size}}${classAttr}${otherStyles} />`;
    }
  );

  const countAfter = (content.match(/className="material-(icons|symbols-outlined)/g) || []).length;
  const replaced = countBefore - countAfter;

  if (content !== origContent) {
    // Add Icon import if not already present
    if (!content.includes("import Icon from")) {
      const fileDir = path.dirname(file);
      let relPath = path.relative(fileDir, path.join(srcDir, "components", "Icon"));
      if (!relPath.startsWith(".")) relPath = "./" + relPath;
      relPath = relPath.replace(/\\/g, "/");

      const lines = content.split("\n");
      let lastImportLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trimStart().startsWith("import ")) lastImportLine = i;
      }
      if (lastImportLine >= 0) {
        lines.splice(lastImportLine + 1, 0, `import Icon from "${relPath}";`);
        content = lines.join("\n");
      }
    }

    fs.writeFileSync(file, content);
    totalReplaced += replaced;
    if (replaced > 0 || countAfter > 0) {
      console.log(`${path.relative(srcDir, file)}: ${replaced} replaced (${countAfter} remaining)`);
    }
  }
}

console.log(`\nTotal replaced: ${totalReplaced}`);
