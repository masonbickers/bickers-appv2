const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Watchman can deadlock while scanning this project on macOS/iCloud-backed
// storage. Metro's Node crawler is slower initially but starts reliably.
config.resolver.useWatchman = false;

// Finder/iCloud created a duplicate dependency tree named `node_modules 2`.
// Metro only ignores directories named exactly `node_modules`, so without this
// rule it crawls both dependency trees and can appear to hang during startup.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  /[/\\]node_modules 2(?:[/\\].*)?$/,
];

module.exports = config;
