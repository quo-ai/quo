// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // SDK 57 / react-hooks v6 introduced these rules; they flag long-standing
    // working patterns (ref reads during render, Animated mutations). Kept as
    // warnings for a gradual burn-down instead of a 90-site migration churn.
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
]);
