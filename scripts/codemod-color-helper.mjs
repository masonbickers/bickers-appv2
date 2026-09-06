import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import parser from "@babel/parser";

const root = process.cwd();
const appRoot = path.join(root, "app");
const helperPath = path.join(root, "lib", "design", "color");

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    return statSync(absolute).isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

let changed = 0;
for (const file of filesUnder(appRoot)) {
  if (!/\.(?:js|jsx|ts|tsx)$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  if (!/function withAlpha\s*\(/.test(source)) continue;
  const ast = parser.parse(source, {
    sourceType: "module",
    plugins: ["jsx", ...(file.endsWith(".ts") || file.endsWith(".tsx") ? ["typescript"] : [])],
  });
  const declaration = ast.program.body.find(
    (node) => node.type === "FunctionDeclaration" && node.id?.name === "withAlpha"
  );
  if (!declaration) continue;
  let importPath = path.relative(path.dirname(file), helperPath).replaceAll(path.sep, "/");
  if (!importPath.startsWith(".")) importPath = `./${importPath}`;
  const imports = ast.program.body.filter((node) => node.type === "ImportDeclaration");
  const insertAt = imports.at(-1)?.end || ast.program.directives.at(-1)?.end || 0;
  const importLine = `\nimport { withAlpha } from "${importPath}";`;
  let next = `${source.slice(0, declaration.start)}${source.slice(declaration.end)}`;
  const adjusted = insertAt > declaration.end
    ? insertAt - (declaration.end - declaration.start)
    : insertAt;
  next = `${next.slice(0, adjusted)}${importLine}${next.slice(adjusted)}`;
  writeFileSync(file, next.replace(/\n{3,}/g, "\n\n"));
  changed += 1;
}

console.log(`Centralised withAlpha in ${changed} files.`);
