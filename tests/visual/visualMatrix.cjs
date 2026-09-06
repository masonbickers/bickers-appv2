const SCENARIOS = Object.freeze([
  { name: "components", path: "/design-system", workspace: "employee" },
  { name: "employee-list", path: "/design-system", workspace: "employee" },
  { name: "employee-form", path: "/design-system", workspace: "employee" },
  { name: "service-list", path: "/service/design-system", workspace: "service" },
  { name: "service-form", path: "/service/design-system", workspace: "service" },
]);

const THEMES = Object.freeze(["light", "dark"]);
const VIEWPORTS = Object.freeze([
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
]);

module.exports = { SCENARIOS, THEMES, VIEWPORTS };
