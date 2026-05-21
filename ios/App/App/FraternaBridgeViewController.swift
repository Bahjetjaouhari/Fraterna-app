import UIKit
import Capacitor

class FraternaBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(LocationServicePlugin())
        NSLog("[FraternaBridge] LocationServicePlugin registered manually (SPM)")
    }
}