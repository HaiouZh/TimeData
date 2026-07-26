import UIKit
import ObjectiveC

/// 去掉 WKWebView 键盘上方系统强加的 inputAccessoryView(▲▼/完成 工具条)。
/// 输入法自带的候选词条是输入法本体的一部分,原生应用也去不掉,不受此影响。
///
/// 做法:改掉私有类 WKContentView 的 `inputAccessoryView` 实现,让它返回 nil。
/// 这是 Cordova/Capacitor 社区多年验证的标准做法(Cordova 的 hideFormAccessoryBar 同源)。
/// 刻意不走"找到 webView.scrollView 里的 WKContentView 实例再换类"那条路——
/// 该实例是懒创建的,页面加载完成前拿不到,时机稍早就静默失效。
enum KeyboardAccessoryRemover {
    private static var applied = false

    /// 幂等,可以在多个时机重复调用(WebKit 类未注册时会原样返回,等下次调用)。
    static func apply() {
        guard !applied else { return }
        guard let contentViewClass = NSClassFromString("WKContentView") else { return }

        let selector = sel_getUid("inputAccessoryView")
        let block: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        let imp = imp_implementationWithBlock(block)

        // 先试 add:成功说明 WKContentView 自己没实现(继承自 UIResponder),
        // 此时新增的覆盖只作用于 WKContentView。失败说明它自己实现了,
        // 才改它本身那份 IMP——两条路都不会误伤 UIResponder 的全局实现。
        if !class_addMethod(contentViewClass, selector, imp, "@@:") {
            guard let method = class_getInstanceMethod(contentViewClass, selector) else { return }
            method_setImplementation(method, imp)
        }
        applied = true
    }
}
