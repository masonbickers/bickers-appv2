import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default;
const root = process.cwd();
const appRoot = path.join(root, "app", "(protected)");
const write = process.argv.includes("--write");
const exceptions = new Set([
  path.join(appRoot, "service", "vehicles", "file-viewer.jsx"),
  path.join(appRoot, "notifications.js"),
]);

function filesIn(directory) {
  return fs.readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    return fs.statSync(absolute).isDirectory() ? filesIn(absolute) : [absolute];
  });
}

function elementName(node) {
  return node?.openingElement?.name?.type === "JSXIdentifier"
    ? node.openingElement.name.name
    : null;
}

function hasAttribute(node, name) {
  return node.openingElement.attributes.some(
    (attribute) => attribute.type === "JSXAttribute" && attribute.name.name === name
  );
}

function getAttribute(node, name) {
  return node.openingElement.attributes.find(
    (attribute) => attribute.type === "JSXAttribute" && attribute.name.name === name
  );
}

function removeImportSpecifier(edits, declaration, specifier, specifiers) {
  if (specifiers.length === 1) {
    edits.push({ start: declaration.start, end: declaration.end, text: "" });
    return;
  }
  const index = specifiers.indexOf(specifier);
  if (index < specifiers.length - 1) {
    edits.push({ start: specifier.start, end: specifiers[index + 1].start, text: "" });
  } else {
    edits.push({ start: specifiers[index - 1].end, end: specifier.end, text: "" });
  }
}

function collectTopLevelVerticalScrolls(node, matches = []) {
  if (!node || typeof node !== "object") return matches;
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  ) return matches;
  if (node.type === "JSXElement") {
    const name = elementName(node);
    if (["Modal", "AppModal"].includes(name)) return matches;
    if (name === "ScrollView" && !hasAttribute(node, "horizontal")) {
      matches.push(node);
      return matches;
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => collectTopLevelVerticalScrolls(item, matches));
    else if (value && typeof value === "object" && value.type) collectTopLevelVerticalScrolls(value, matches);
  }
  return matches;
}

function collectHeaderCandidates(node, source, matches = []) {
  if (!node || typeof node !== "object") return matches;
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  ) return matches;
  if (node.type === "JSXElement") {
    const name = elementName(node);
    if (["Modal", "AppModal"].includes(name)) return matches;
    if (["PageHeaderCard", "OperationalPageHeader"].includes(name)) {
      matches.push(node);
      return matches;
    }
    if (name === "View") {
      const opening = source.slice(node.openingElement.start, node.openingElement.end);
      if (/styles\.(?:header|pageHeader|heroCard)\b/.test(opening)) {
        matches.push(node);
        return matches;
      }
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => collectHeaderCandidates(item, source, matches));
    else if (value && typeof value === "object" && value.type) collectHeaderCandidates(value, source, matches);
  }
  return matches;
}

const candidates = [];
for (const file of filesIn(appRoot).filter((item) => /\.(?:js|jsx|ts|tsx)$/.test(item))) {
  if (exceptions.has(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  if (source.includes("components/layout/PageShell")) continue;

  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch {
    continue;
  }

  let rootElement = null;
  traverse(ast, {
    ReturnStatement(nodePath) {
      if (rootElement || elementName(nodePath.node.argument) !== "SafeAreaView") return;
      const owner = nodePath.getFunctionParent();
      if (!owner) return;
      const parent = owner.parentPath;
      const isDefaultFunction =
        parent?.isExportDefaultDeclaration() ||
        (owner.node.id?.name && ast.program.body.some(
          (item) => item.type === "ExportDefaultDeclaration" && item.declaration?.name === owner.node.id.name
        ));
      if (isDefaultFunction) rootElement = nodePath.node.argument;
    },
  });
  if (!rootElement) continue;

  let scrollParent = rootElement;
  let directVerticalScrolls = rootElement.children.filter(
    (child) =>
      child.type === "JSXElement" &&
      elementName(child) === "ScrollView" &&
      !hasAttribute(child, "horizontal")
  );
  if (directVerticalScrolls.length === 0) {
    const wrapperMatches = rootElement.children
      .filter((child) => child.type === "JSXElement" && elementName(child) === "View")
      .map((wrapper) => ({
        wrapper,
        scrolls: wrapper.children.filter(
          (child) =>
            child.type === "JSXElement" &&
            elementName(child) === "ScrollView" &&
            !hasAttribute(child, "horizontal")
        ),
      }))
      .filter((match) => match.scrolls.length === 1);
    if (wrapperMatches.length === 1) {
      scrollParent = wrapperMatches[0].wrapper;
      directVerticalScrolls = wrapperMatches[0].scrolls;
    }
  }
  if (directVerticalScrolls.length === 0) {
    scrollParent = rootElement;
    directVerticalScrolls = collectTopLevelVerticalScrolls(rootElement);
  }
  if (directVerticalScrolls.length === 0) continue;
  const scroll = directVerticalScrolls[0];
  const headerChildren = scrollParent === rootElement
    ? rootElement.children
    : [...rootElement.children, ...scrollParent.children];
  const directHeaders = headerChildren.filter((child) => {
    if (child.type !== "JSXElement") return false;
    if (["PageHeaderCard", "OperationalPageHeader"].includes(elementName(child))) return true;
    if (elementName(child) !== "View") return false;
    const opening = source.slice(child.openingElement.start, child.openingElement.end);
    return /styles\.(?:header|pageHeader)\b/.test(opening);
  });
  const nestedHeaders = directHeaders.length ? directHeaders : collectHeaderCandidates(rootElement, source);
  const directHeader = nestedHeaders.length === 1 ? nestedHeaders[0] : null;
  const formMode = /(?:form|settings|vehicle-prep|add-timesheet|minor-service|mot-precheck|vehicle-check|recce)/i.test(file);
  if (formMode && !directHeader) continue;
  const refreshAttributes = directVerticalScrolls
    .map((item) => getAttribute(item, "refreshControl"))
    .filter(Boolean);
  const refreshAttribute = refreshAttributes[0];
  const modeAttribute = formMode ? ' mode="form" width="form"' : "";
  const headerAttribute = directHeader
    ? ` customHeader={${source.slice(directHeader.start, directHeader.end)}} customHeaderPlacement="${elementName(directHeader) === "OperationalPageHeader" || elementName(directHeader) === "View" || source.slice(directHeader.start, directHeader.end).includes("onBack=") || hasAttribute(directHeader, "compact") ? "fixed" : "scroll"}"`
    : "";
  let refreshAttributeText = "";
  let refreshControlElement = null;
  if (refreshAttribute) {
    refreshControlElement = refreshAttribute.value?.expression;
    if (elementName(refreshControlElement) !== "RefreshControl") continue;
    const refreshing = getAttribute(refreshControlElement, "refreshing")?.value?.expression;
    const onRefresh = getAttribute(refreshControlElement, "onRefresh")?.value?.expression;
    if (!refreshing || !onRefresh) continue;
    refreshAttributeText = ` refresh={{ refreshing: ${source.slice(refreshing.start, refreshing.end)}, onRefresh: ${source.slice(onRefresh.start, onRefresh.end)} }}`;
  }
  const pageShellOpening = `<PageShell${modeAttribute}${headerAttribute}${refreshAttributeText}>`;

  const edits = [
    { start: rootElement.openingElement.start, end: rootElement.openingElement.end, text: pageShellOpening },
    { start: rootElement.closingElement.start, end: rootElement.closingElement.end, text: "</PageShell>" },
  ];
  for (const verticalScroll of directVerticalScrolls) {
    edits.push(
      { start: verticalScroll.openingElement.start, end: verticalScroll.openingElement.end, text: "<>" },
      { start: verticalScroll.closingElement.start, end: verticalScroll.closingElement.end, text: "</>" }
    );
  }
  if (directHeader) edits.push({ start: directHeader.start, end: directHeader.end, text: "" });

  for (const declaration of ast.program.body.filter((item) => item.type === "ImportDeclaration")) {
    const specifiers = declaration.specifiers;
    for (const specifier of specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      const imported = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
      if (
        declaration.source.value === "react-native-safe-area-context" &&
        imported === "SafeAreaView" &&
        !source.slice(rootElement.end).includes("<SafeAreaView") &&
        !source.slice(0, rootElement.start).includes("<SafeAreaView")
      ) {
        removeImportSpecifier(edits, declaration, specifier, specifiers);
      }
      if (
        declaration.source.value === "react-native" &&
        imported === "ScrollView" &&
        (source.match(/<ScrollView\b/g) || []).length === directVerticalScrolls.length
      ) {
        removeImportSpecifier(edits, declaration, specifier, specifiers);
      }
      if (
        declaration.source.value === "react-native" &&
        imported === "RefreshControl" &&
        refreshControlElement &&
        (source.match(/<RefreshControl\b/g) || []).length === 1
      ) {
        removeImportSpecifier(edits, declaration, specifier, specifiers);
      }
    }
  }

  const lastImport = ast.program.body.filter((item) => item.type === "ImportDeclaration").at(-1);
  const relative = path.relative(path.dirname(file), path.join(root, "components", "layout", "PageShell"));
  edits.push({
    start: lastImport.end,
    end: lastImport.end,
    text: `\nimport PageShell from "${relative.startsWith(".") ? relative : `./${relative}`}";`,
  });

  let next = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  candidates.push(path.relative(root, file));
  if (write) fs.writeFileSync(file, next);
}

for (const candidate of candidates) console.log(candidate);
console.log(`${write ? "Migrated" : "Would migrate"} ${candidates.length} screen(s).`);
