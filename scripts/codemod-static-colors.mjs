import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import parser from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default;
const root = process.cwd();
const roots = [path.join(root, "app"), path.join(root, "components")];
const outputPath = path.join(root, "lib", "design", "staticColors.js");
const colorPattern = /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i;

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    return statSync(absolute).isDirectory() ? filesUnder(absolute) : [absolute];
  });
}

function hash(value) {
  let result = 5381;
  for (const character of value) result = ((result << 5) + result) ^ character.charCodeAt(0);
  return (result >>> 0).toString(36);
}

function keyFor(value) {
  const prefix = value.startsWith("#") ? `hex_${value.slice(1).toLowerCase()}` : "rgba";
  return `${prefix}_${hash(value)}`;
}

const files = roots.flatMap(filesUnder).filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file));
const values = new Set();
const editsByFile = new Map();

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const ast = parser.parse(source, {
    sourceType: "module",
    plugins: ["jsx", ...(file.endsWith(".ts") || file.endsWith(".tsx") ? ["typescript"] : [])],
  });
  const edits = [];
  traverse(ast, {
    StringLiteral(nodePath) {
      const { node, parent } = nodePath;
      if (!colorPattern.test(node.value)) return;
      values.add(node.value);
      const expression = `staticColors.${keyFor(node.value)}`;
      edits.push({
        start: node.start,
        end: node.end,
        value: parent?.type === "JSXAttribute" && parent.value === node ? `{${expression}}` : expression,
      });
    },
  });
  if (edits.length) editsByFile.set(file, { source, ast, edits });
}

for (const [file, { source, ast, edits }] of editsByFile) {
  let next = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    next = `${next.slice(0, edit.start)}${edit.value}${next.slice(edit.end)}`;
  }
  let importPath = path.relative(path.dirname(file), outputPath.replace(/\.js$/, "")).replaceAll(path.sep, "/");
  if (!importPath.startsWith(".")) importPath = `./${importPath}`;
  const importLine = `\nimport { staticColors } from "${importPath}";`;
  const imports = ast.program.body.filter((node) => node.type === "ImportDeclaration");
  const insertAt = imports.length ? imports.at(-1).end : ast.program.directives.at(-1)?.end || 0;
  // Account for replacements that occur before the import insertion point.
  const delta = edits
    .filter((edit) => edit.start < insertAt)
    .reduce((sum, edit) => sum + edit.value.length - (edit.end - edit.start), 0);
  const adjusted = insertAt + delta;
  next = `${next.slice(0, adjusted)}${importLine}${next.slice(adjusted)}`;
  writeFileSync(file, next);
}

const entries = [...values]
  .sort()
  .map((value) => `  ${keyFor(value)}: ${JSON.stringify(value)},`)
  .join("\n");
writeFileSync(
  outputPath,
  `/**\n * Static illustration, chart, and compatibility colours centralised from legacy screens.\n * New general UI must use semantic theme colours instead.\n */\nexport const staticColors = Object.freeze({\n${entries}\n});\n`
);

console.log(`Centralised ${values.size} static colours across ${editsByFile.size} files.`);
