import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const serviceRoot = path.join(root, "app", "(protected)", "service");
const palettePath = path.join(root, "lib", "design", "semantics");

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    return statSync(absolute).isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

let changed = 0;
for (const file of filesUnder(serviceRoot)) {
  if (!/\.(?:js|jsx|tsx)$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  if (!/^const COLORS = \{/m.test(source)) continue;

  let importPath = path.relative(path.dirname(file), palettePath).replaceAll(path.sep, "/");
  if (!importPath.startsWith(".")) importPath = `./${importPath}`;
  const importLine = `import { servicePalette as COLORS } from "${importPath}";\n`;
  const next = `${importLine}${source.replace(/^const COLORS = \{[\s\S]*?^\};\r?\n\r?\n/m, "")}`;
  writeFileSync(file, next);
  changed += 1;
}

console.log(`Centralised ${changed} service palettes.`);
