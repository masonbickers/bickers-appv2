import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import parser from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default;
const root = process.cwd();
const roots = [path.join(root, "app"), path.join(root, "components")];
const tokenPath = path.join(root, "lib", "design", "tokens");
const walk = (directory) => readdirSync(directory).flatMap((name) => {
  const absolute = path.join(directory, name);
  return statSync(absolute).isDirectory() ? walk(absolute) : [absolute];
});
const nameOf = (property) => property.key?.type === "Identifier" ? property.key.name : property.key?.value;
const typeVariant = (size) => {
  if (size <= 10) return "micro";
  if (size === 11) return "caption";
  if (size === 12) return "metadata";
  if (size === 13) return "bodySmall";
  if (size === 14) return "body";
  if (size <= 16) return "bodyLarge";
  if (size <= 18) return "sectionTitle";
  if (size <= 23) return "titleSmall";
  if (size <= 27) return "pageTitle";
  return "display";
};
const radiusVariant = (propertyPath, value) => {
  const properties = propertyPath.parentPath.node.properties || [];
  const width = properties.find((item) => nameOf(item) === "width")?.value?.value;
  const height = properties.find((item) => nameOf(item) === "height")?.value?.value;
  if ((width === value * 2 && height === value * 2) || value > 24) return "pill";
  if (value <= 8) return "sm";
  if (value <= 12) return "md";
  if (value <= 15) return "lg";
  return "xl";
};
const spacingValues = [[0, "none"], [4, "xxs"], [8, "xs"], [12, "sm"], [16, "md"], [20, "lg"], [24, "xl"], [32, "2xl"], [40, "3xl"]];
const spacingVariant = (value) => spacingValues.reduce((best, item) =>
  Math.abs(item[0] - value) < Math.abs(best[0] - value) ? item : best
)[1];

let changed = 0;
for (const file of roots.flatMap(walk)) {
  if (!/\.(?:js|jsx|ts|tsx)$/.test(file) || file.endsWith("AppPrimitives.js")) continue;
  const source = readFileSync(file, "utf8");
  const ast = parser.parse(source, { sourceType: "module", plugins: ["jsx", ...(file.endsWith(".ts") || file.endsWith(".tsx") ? ["typescript"] : [])] });
  const edits = [];
  traverse(ast, {
    ObjectExpression(objectPath) {
      const properties = objectPath.get("properties");
      const fontSize = properties.find((item) => nameOf(item.node) === "fontSize");
      if (fontSize?.node.value?.type !== "NumericLiteral") return;
      const variant = typeVariant(fontSize.node.value.value);
      edits.push({ start: fontSize.node.value.start, end: fontSize.node.value.end, value: `t.typography.${variant}.fontSize` });
      const lineHeight = properties.find((item) => nameOf(item.node) === "lineHeight");
      if (lineHeight?.node.value?.type === "NumericLiteral") {
        edits.push({ start: lineHeight.node.value.start, end: lineHeight.node.value.end, value: `t.typography.${variant}.lineHeight` });
      }
    },
    ObjectProperty(propertyPath) {
      const name = nameOf(propertyPath.node);
      const value = propertyPath.node.value;
      if (value?.type !== "NumericLiteral") return;
      if (name === "borderRadius") {
        edits.push({ start: value.start, end: value.end, value: `t.radius.${radiusVariant(propertyPath, value.value)}` });
      } else if (/^(?:padding|margin|gap)(?:Top|Right|Bottom|Left|Horizontal|Vertical)?$/.test(name) && value.value >= 0 && value.value <= 40) {
        const token = spacingVariant(value.value);
        const reference = /^\d/.test(token) ? `t.spacing["${token}"]` : `t.spacing.${token}`;
        edits.push({ start: value.start, end: value.end, value: reference });
      }
    },
  });
  if (!edits.length) continue;
  let next = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) next = `${next.slice(0, edit.start)}${edit.value}${next.slice(edit.end)}`;
  if (!/designTokens\s+as\s+t/.test(source)) {
    let importPath = path.relative(path.dirname(file), tokenPath).replaceAll(path.sep, "/");
    if (!importPath.startsWith(".")) importPath = `./${importPath}`;
    const imports = ast.program.body.filter((node) => node.type === "ImportDeclaration");
    const insertAt = imports.at(-1)?.end || ast.program.directives.at(-1)?.end || 0;
    const delta = edits.filter((edit) => edit.start < insertAt).reduce((sum, edit) => sum + edit.value.length - (edit.end - edit.start), 0);
    const adjusted = insertAt + delta;
    next = `${next.slice(0, adjusted)}\nimport { designTokens as t } from "${importPath}";${next.slice(adjusted)}`;
  }
  writeFileSync(file, next);
  changed += 1;
}
console.log(`Applied shared style tokens in ${changed} files.`);
