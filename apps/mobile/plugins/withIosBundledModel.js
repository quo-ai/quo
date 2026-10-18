const { withXcodeProject, IOSConfig } = require('expo/config-plugins');

/**
 * Bundles the starter GGUF into the iOS app so first run needs no ~530MB
 * download (Android ships it via a Play Asset Delivery pack instead). The
 * file is fetched by scripts/fetch-starter-model.js into
 * assets-native/bundled-models/ (gitignored) and must exist before
 * xcodebuild runs — the Xcode resource reference added here points at it
 * either way. The resource lands at the app-bundle root, where llama.rn's
 * `is_model_asset` loading and services/bundledModel.ts expect it.
 *
 * Keep MODEL_FILE in sync with DEFAULT_MODEL_ID's modelFilename in
 * constants/models.ts and scripts/fetch-starter-model.js.
 */
const MODEL_FILE = 'Qwen3.5-0.8B-Q4_K_M.gguf';

module.exports = function withIosBundledModel(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const relPath = `../assets-native/bundled-models/${MODEL_FILE}`;

    if (!project.hasFile(relPath)) {
      config.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: relPath,
        groupName: config.modRequest.projectName,
        project,
        isBuildFile: true,
      });
    }

    return config;
  });
};
