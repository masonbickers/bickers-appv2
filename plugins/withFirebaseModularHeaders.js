const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

module.exports = function withFirebaseModularHeaders(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      let contents = fs.readFileSync(podfilePath, "utf8");

      contents = contents.replace(/^use_modular_headers!\n/m, "");

      if (!contents.includes("$RNFirebaseAsStaticFramework = true")) {
        contents = contents.replace(
          /(podfile_properties = JSON\.parse\(File\.read\(File\.join\(__dir__, 'Podfile\.properties\.json'\)\)\) rescue \{}\n)/,
          "$1$RNFirebaseAsStaticFramework = true\n"
        );
      }

      if (!contents.includes("podfile_properties['ios.useFrameworks'] ||= 'static'")) {
        contents = contents.replace(
          /(\$RNFirebaseAsStaticFramework = true\n)/,
          "$1podfile_properties['ios.useFrameworks'] ||= 'static'\n"
        );
      }

      if (!contents.includes("CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES")) {
        contents = contents.replace(
          /(react_native_post_install\(\n\s+installer,\n\s+config\[:reactNativePath\],\n\s+:mac_catalyst_enabled => false,\n\s+:ccache_enabled => ccache_enabled\?\(podfile_properties\),\n\s+\)\n)/,
          "$1\n    installer.pods_project.targets.each do |target|\n      target.build_configurations.each do |config|\n        config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'\n      end\n    end\n"
        );
      }

      fs.writeFileSync(podfilePath, contents);

      return config;
    },
  ]);
};
