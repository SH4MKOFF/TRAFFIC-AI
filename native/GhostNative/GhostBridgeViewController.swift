import UIKit
import Capacitor

/**
 * Stage 2 registration point for the GHOST native plugin.
 *
 * Add this subclass as the bridge view controller in the generated iOS target,
 * then Capacitor will expose the GhostNative plugin to the web layer.
 */
public class GhostBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GhostNativePlugin())
    }
}
