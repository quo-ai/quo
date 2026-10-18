const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo config plugin to fix llama.rn Hexagon DSP crash on non-Qualcomm devices
 * by excluding the Hexagon libraries from the APK.
 *
 * Hexagon is disabled in FOUR independent places — revisit ALL of them when
 * bumping llama.rn:
 *   1. This plugin: jniLibs excludes for librnllama*hexagon* / libggml-htp*.
 *   2. app.json: llama.rn plugin option `enableOpenCLAndHexagon: false`.
 *   3. scripts/apply-native-patches.js: RNLlama.java patched to skip the
 *      hexagon variant at runtime (runs on every install via `postinstall`).
 *   4. android/app/build.gradle: `syncRNLlamaHtpAssets` task disabled so the
 *      HTP assets are never packaged.
 */
function withLlamaFix(config) {
  return withAppBuildGradle(config, (config) => {
    let buildGradle = config.modResults.contents;

    if (buildGradle.includes('librnllama*hexagon')) {
      return config;
    }

    const packagingOptionsRegex = /(packagingOptions\s*\{[\s\S]*?jniLibs\s*\{[^}]*)(})/;

    const exclusions = `
            // Exclude Qualcomm Hexagon DSP libraries that crash on non-Qualcomm devices
            excludes += ['**/librnllama*hexagon*.so']
            excludes += ['**/librnllama_jni*hexagon*.so']
            excludes += ['**/libggml-htp*.so']
        `;

    if (!packagingOptionsRegex.test(buildGradle)) {
      // Fail the prebuild loudly rather than shipping an APK that still
      // contains the crashing Hexagon libraries.
      throw new Error(
        '[withLlamaFix] Could not find a `packagingOptions { jniLibs { ... } }` block in ' +
        'android/app/build.gradle to add the Hexagon excludes. The Expo template changed — ' +
        'update the regex in plugins/withLlamaFix.js.'
      );
    }

    buildGradle = buildGradle.replace(
      packagingOptionsRegex,
      `$1${exclusions}$2`
    );

    config.modResults.contents = buildGradle;
    return config;
  });
}

module.exports = withLlamaFix;
