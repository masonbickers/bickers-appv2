import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const primitivePath = path.join(root, "components", "ui", "AppPrimitives");
const roots = [path.join(root, "app"), path.join(root, "components")];
const excluded = new Set([
  path.join(root, "components", "ui", "AppPrimitives.js"),
  path.join(root, "components", "ThemedText.tsx"),
]);

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    return statSync(absolute).isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

function addPrimitiveImport(source, file, specifiers) {
  if (!specifiers.length) return source;
  const existing = /import\s*\{([^}]*)\}\s*from\s*["']([^"']*components\/ui\/AppPrimitives)["'];/m;
  if (existing.test(source)) {
    return source.replace(existing, (whole, body, modulePath) => {
      const additions = specifiers.filter((specifier) => !body.includes(specifier));
      const current = body.trimEnd();
      const separator = current.trim().endsWith(",") ? "" : ",";
      return additions.length
        ? `import {${current}${separator}\n  ${additions.join(",\n  ")},\n} from "${modulePath}";`
        : whole;
    });
  }

  let modulePath = path.relative(path.dirname(file), primitivePath).replaceAll(path.sep, "/");
  if (!modulePath.startsWith(".")) modulePath = `./${modulePath}`;
  const line = `import { ${specifiers.join(", ")} } from "${modulePath}";\n`;
  const directive = source.match(/^([\s\S]*?["']use client["'];?\r?\n)/);
  return directive
    ? `${directive[1]}${line}${source.slice(directive[1].length)}`
    : `${line}${source}`;
}

let changed = 0;
for (const file of roots.flatMap(filesUnder)) {
  if (excluded.has(file) || !/\.(?:js|jsx|tsx)$/.test(file)) continue;
  let source = readFileSync(file, "utf8");
  const nativeImport = /import\s*\{([^}]*)\}\s*from\s*["']react-native["'];/m;
  const match = source.match(nativeImport);
  if (!match) continue;

  const specifiers = match[1].split(",").map((value) => value.trim()).filter(Boolean);
  const hasText = specifiers.includes("Text");
  const hasTouchable = specifiers.includes("TouchableOpacity");
  if (!hasText && !hasTouchable) continue;

  const remaining = specifiers.filter((value) => value !== "Text" && value !== "TouchableOpacity");
  source = source.replace(nativeImport, remaining.length
    ? `import {\n  ${remaining.join(",\n  ")},\n} from "react-native";`
    : "");
  source = addPrimitiveImport(source, file, [
    ...(hasText ? ["AppText as Text"] : []),
    ...(hasTouchable ? ["AppPressable as TouchableOpacity"] : []),
  ]);
  writeFileSync(file, source);
  changed += 1;
}

console.log(`Migrated shared text/actions in ${changed} files.`);
