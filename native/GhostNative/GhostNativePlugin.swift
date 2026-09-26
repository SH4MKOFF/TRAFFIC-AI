import UIKit
import Capacitor

@objc(GhostNativePlugin)
public class GhostNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GhostNativePlugin"
    public let jsName = "GhostNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "lifecycle", returnType: CAPPluginReturnNone)
    ]

    @objc public func setKeepAwake(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve(["enabled": enabled])
        }
    }

    @objc public func lifecycle(_ call: CAPPluginCall) {
        let event = call.getString("event") ?? ""
        DispatchQueue.main.async {
            // Lifecycle is intentionally lightweight for Stage 2.
            // Future native camera diagnostics can hook into this point.
            NotificationCenter.default.post(
                name: Notification.Name("GHOSTNativeLifecycle"),
                object: nil,
                userInfo: ["event": event]
            )
            call.resolve(["event": event])
        }
    }
}
