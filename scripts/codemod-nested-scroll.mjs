import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default;
const root = path.join(process.cwd(), "app", "(protected)");

function filesIn(directory) {
  return fs.readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    return fs.statSync(absolute).isDirectory() ? filesIn(absolute) : [absolute];
  });
}

for (const file of filesIn(root).filter((item) => /\.(?:js|jsx|ts|tsx)$/.test(item))) {
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes("components/layout/PageShell") || !source.includes("nestedScrollEnabled")) continue;
  const ast = parse(source, { sourceType: "module", plugins: ["jsx", "typescript"] });
  const edits = [];
  traverse(ast, {
    JSXElement(nodePath) {
      const node = nodePath.node;
      if (node.openingElement.name.type !== "JSXIdentifier" || node.openingElement.name.name !== "ScrollView") return;
      const nested = node.openingElement.attributes.some(
        (attribute) => attribute.type === "JSXAttribute" && attribute.name.name === "nestedScrollEnabled"
      );
      const horizontal = node.openingElement.attributes.some(
        (attribute) => attribute.type === "JSXAttribute" && attribute.name.name === "horizontal"
      );
      if (!nested || horizontal) return;
      edits.push({ start: node.openingElement.name.start, end: node.openingElement.name.end, text: "View" });
      if (node.closingElement) {
        edits.push({ start: node.closingElement.name.start, end: node.closingElement.name.end, text: "View" });
      }
    },
  });
  if (!edits.length) continue;
  let next = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  fs.writeFileSync(file, next);
  console.log(path.relative(process.cwd(), file));
}
