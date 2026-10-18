const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Performance optimizations for Metro bundler
config.transformer = {
  ...config.transformer,
  // Enable Hermes bytecode compilation in dev for faster loads
  minifierConfig: {
    keep_classnames: true,
    keep_fnames: true,
    mangle: {
      keep_classnames: true,
      keep_fnames: true,
    },
  },
};

// Reduce resolver overhead by excluding unnecessary extensions
config.resolver = {
  ...config.resolver,
  // Add .bin extension for whisper.rn model files
  assetExts: [...(config.resolver.assetExts || []), 'bin'],
};

// Keep Metro's crawler/watcher out of transient native build output.
// Gradle creates and deletes these dirs mid-run; on Windows (no Watchman)
// Metro's fallback watcher crashes with ENOENT when a dir it is about to
// watch disappears (seen with the RN gradle-plugin Kotlin
// classpath-snapshot right after expo run:android). Scoped to native
// output only — many packages ship their JS in a build/ dir.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList].filter(Boolean)),
  /[/\\]\.cxx([/\\]|$)/,
  /[/\\]\.gradle([/\\]|$)/,
  /[/\\]android[/\\](?:.*[/\\])?build([/\\]|$)/,
  /[/\\]@react-native[/\\]gradle-plugin[/\\].*[/\\]build([/\\]|$)/,
  // Bundled starter model staged for local debug builds (532 MB .gguf)
  /[/\\]android[/\\]app[/\\]src[/\\]debug[/\\]assets([/\\]|$)/,
  // Canonical starter-model location referenced by the iOS bundle
  /[/\\]assets-native[/\\]bundled-models([/\\]|$)/,
];

// Increase max workers for faster bundling on multi-core machines
config.maxWorkers = 4;

module.exports = config;
