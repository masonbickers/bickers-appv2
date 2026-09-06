// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const bickersDesign = require('./scripts/eslint/design-system-rules.cjs');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['app/**/*.{js,jsx,ts,tsx}', 'components/**/*.{js,jsx,ts,tsx}'],
    plugins: { 'bickers-design': bickersDesign },
    rules: {
      'bickers-design/layout-style-only': 'error',
      'bickers-design/no-local-generic-component': 'error',
      'bickers-design/no-raw-text-input': 'error',
      'bickers-design/no-screen-palette': 'error',
      'bickers-design/no-screen-presentation': 'error',
      'bickers-design/require-page-shell': 'error',
      'bickers-design/semantic-colors-and-typography': 'error',
    },
  },
]);
