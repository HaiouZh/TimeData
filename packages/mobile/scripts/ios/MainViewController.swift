import UIKit
import Capacitor

/// 自定义 bridge VC:去掉键盘上方的系统工具条。
/// Main.storyboard 的 customClass 由 patch-ios.rb 从 CAPBridgeViewController 改为本类。
final class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        // super 里已创建 WKWebView,WebKit 的类此时通常已注册。
        KeyboardAccessoryRemover.apply()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // 兜底:万一 viewDidLoad 时 WKContentView 类还没注册。apply() 幂等。
        KeyboardAccessoryRemover.apply()
    }
}
