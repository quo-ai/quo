// Patches native sources inside node_modules. Runs on every install via the
// `postinstall` npm hook, so it covers local dev and CI/EAS builds alike.
// This is the single source of truth for node_modules patches — the Expo
// config plugin in plugins/withLlamaFix.js only touches the generated
// android project (gradle packaging excludes), never node_modules.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function patchFile({ filePath, marker, variants, label }) {
  if (!fs.existsSync(filePath)) {
    // Loud failure: a moved/renamed file means a dependency bump silently
    // dropped a crash fix. Update the patch target, don't delete the patch.
    throw new Error(`[native-patches] ${label}: patch target not found at ${path.relative(root, filePath)}`);
  }

  const current = fs.readFileSync(filePath, 'utf8');
  if (current.includes(marker)) {
    console.log(`[native-patches] ${label}: already patched`);
    return;
  }

  const variant = variants.find((v) => current.includes(v.find));
  if (!variant) {
    throw new Error(`[native-patches] ${label}: expected patch target was not found`);
  }

  fs.writeFileSync(filePath, current.replace(variant.find, variant.replace));
  console.log(`[native-patches] ${label}: patched`);
}

// Disable the Qualcomm Hexagon DSP variant in llama.rn — it crashes on
// non-Qualcomm devices. Pairs with the gradle packaging excludes applied by
// plugins/withLlamaFix.js.
patchFile({
  label: 'llama.rn Hexagon runtime disable',
  marker: 'HEXAGON_DISABLED_BY_EXPO_PLUGIN',
  filePath: path.join(
    root,
    'node_modules',
    'llama.rn',
    'android',
    'src',
    'main',
    'java',
    'com',
    'rnllama',
    'RNLlama.java',
  ),
  variants: [
    {
      find: '        if (hasDotProd && hasI8mm && hasHexagon && hasAdreno) {',
      replace:
        '        // HEXAGON_DISABLED_BY_EXPO_PLUGIN - Skip hexagon variant to prevent crash on non-Qualcomm devices\n' +
        '        if (false /* hasDotProd && hasI8mm && hasHexagon && hasAdreno */) {',
    },
  ],
});

// Guard against rare Android service-binding crashes where the returned
// IBinder is cast without checking its runtime type first. Two variants
// cover the library's logging styles across versions.
patchFile({
  label: 'background downloader safe binder cast',
  marker: 'SAFE_BINDER_CAST_BY_EXPO_PLUGIN',
  filePath: path.join(
    root,
    'node_modules',
    '@kesha-antonov',
    'react-native-background-downloader',
    'android',
    'src',
    'main',
    'java',
    'com',
    'eko',
    'Downloader.kt',
  ),
  variants: [
    {
      find:
        '    override fun onServiceConnected(name: ComponentName?, service: IBinder?) {\n' +
        '      val binder = service as ResumableDownloadService.LocalBinder\n' +
        '      downloadService = binder.getService()\n' +
        '      serviceBound = true\n' +
        '      RNBackgroundDownloaderModuleImpl.logD(TAG, "ResumableDownloadService connected")',
      replace:
        '    override fun onServiceConnected(name: ComponentName?, service: IBinder?) {\n' +
        '      val binder = service as? ResumableDownloadService.LocalBinder\n' +
        '      if (binder == null) {\n' +
        '        // SAFE_BINDER_CAST_BY_EXPO_PLUGIN\n' +
        '        RNBackgroundDownloaderModuleImpl.logE(TAG, "Unexpected binder type in onServiceConnected: ${service?.javaClass?.name}")\n' +
        '        downloadService = null\n' +
        '        serviceBound = false\n' +
        '        return\n' +
        '      }\n' +
        '      downloadService = binder.getService()\n' +
        '      serviceBound = true\n' +
        '      RNBackgroundDownloaderModuleImpl.logD(TAG, "ResumableDownloadService connected")',
    },
    {
      find:
        '    override fun onServiceConnected(name: ComponentName?, service: IBinder?) {\n' +
        '      val binder = service as ResumableDownloadService.LocalBinder\n' +
        '      downloadService = binder.getService()\n' +
        '      serviceBound = true\n' +
        '      Log.d(TAG, "ResumableDownloadService connected")',
      replace:
        '    override fun onServiceConnected(name: ComponentName?, service: IBinder?) {\n' +
        '      val binder = service as? ResumableDownloadService.LocalBinder\n' +
        '      if (binder == null) {\n' +
        '        // SAFE_BINDER_CAST_BY_EXPO_PLUGIN\n' +
        '        Log.e(TAG, "Unexpected binder type in onServiceConnected: ${service?.javaClass?.name}")\n' +
        '        downloadService = null\n' +
        '        serviceBound = false\n' +
        '        return\n' +
        '      }\n' +
        '      downloadService = binder.getService()\n' +
        '      serviceBound = true\n' +
        '      Log.d(TAG, "ResumableDownloadService connected")',
    },
  ],
});
