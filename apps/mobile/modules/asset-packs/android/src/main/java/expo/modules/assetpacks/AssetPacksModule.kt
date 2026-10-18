package expo.modules.assetpacks

import com.google.android.gms.tasks.Task
import com.google.android.play.core.assetpacks.AssetPackException
import com.google.android.play.core.assetpacks.AssetPackManager
import com.google.android.play.core.assetpacks.AssetPackManagerFactory
import com.google.android.play.core.assetpacks.AssetPackState
import com.google.android.play.core.assetpacks.AssetPackStateUpdateListener
import com.google.android.play.core.assetpacks.model.AssetPackErrorCode
import com.google.android.play.core.assetpacks.model.AssetPackStorageMethod
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val STATE_CHANGE_EVENT = "onStateChange"

// Thin binding over Play Asset Delivery's AssetPackManager. Failures resolve
// to a state with an errorCode instead of rejecting: "this install has no
// such pack" (sideloaded/dev builds) is an expected outcome, not an error.
class AssetPacksModule : Module() {
  private val manager: AssetPackManager by lazy {
    AssetPackManagerFactory.getInstance(requireNotNull(appContext.reactContext).applicationContext)
  }

  private val listener = AssetPackStateUpdateListener { state ->
    sendEvent(STATE_CHANGE_EVENT, stateToMap(state))
  }

  override fun definition() = ModuleDefinition {
    Name("AssetPacks")

    Events(STATE_CHANGE_EVENT)

    OnStartObserving {
      manager.registerListener(listener)
    }

    OnStopObserving {
      manager.unregisterListener(listener)
    }

    // Absolute directory of the pack's assets, or null when the pack isn't
    // available as plain files (not downloaded yet, or an install-time pack
    // served from the APK).
    Function("getPackAssetsPath") { packName: String ->
      val location = manager.getPackLocation(packName) ?: return@Function null
      if (location.packStorageMethod() != AssetPackStorageMethod.STORAGE_FILES) {
        return@Function null
      }
      location.assetsPath()
    }

    AsyncFunction("getPackState") { packName: String, promise: Promise ->
      resolveStates(manager.getPackStates(listOf(packName)), packName, promise)
    }

    AsyncFunction("fetch") { packName: String, promise: Promise ->
      resolveStates(manager.fetch(listOf(packName)), packName, promise)
    }

    // Shows Play's confirmation for large downloads over mobile data (status
    // REQUIRES_USER_CONFIRMATION / WAITING_FOR_WIFI). Resolves true when the
    // user accepted.
    AsyncFunction("showConfirmationDialog") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      manager.showConfirmationDialog(activity)
        .addOnSuccessListener { resultCode -> promise.resolve(resultCode == android.app.Activity.RESULT_OK) }
        .addOnFailureListener { promise.resolve(false) }
    }

    AsyncFunction("removePack") { packName: String, promise: Promise ->
      manager.removePack(packName)
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { promise.resolve(false) }
    }
  }

  private fun resolveStates(
    task: Task<com.google.android.play.core.assetpacks.AssetPackStates>,
    packName: String,
    promise: Promise,
  ) {
    task
      .addOnSuccessListener { states ->
        val state = states.packStates()[packName]
        promise.resolve(if (state != null) stateToMap(state) else errorState(packName, AssetPackErrorCode.PACK_UNAVAILABLE))
      }
      .addOnFailureListener { error ->
        val code = (error as? AssetPackException)?.errorCode ?: AssetPackErrorCode.INTERNAL_ERROR
        promise.resolve(errorState(packName, code))
      }
  }

  private fun stateToMap(state: AssetPackState): Map<String, Any> = mapOf(
    "name" to state.name(),
    "status" to state.status(),
    "errorCode" to state.errorCode(),
    "bytesDownloaded" to state.bytesDownloaded().toDouble(),
    "totalBytes" to state.totalBytesToDownload().toDouble(),
    "transferProgress" to state.transferProgressPercentage(),
  )

  private fun errorState(packName: String, errorCode: Int): Map<String, Any> = mapOf(
    "name" to packName,
    "status" to 0, // AssetPackStatus.UNKNOWN
    "errorCode" to errorCode,
    "bytesDownloaded" to 0.0,
    "totalBytes" to 0.0,
    "transferProgress" to 0,
  )
}
