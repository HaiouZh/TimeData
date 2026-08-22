package app.timedata.mobile;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        View contentView = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(contentView, (view, windowInsets) -> {
            Insets insets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            // 键盘让位走 overlay 模型：**壳完全不动，底部 padding 恒 0**，键盘直接盖在 WebView 上，
            // 输入条由网页层按插件报的键盘高用 transform 抬起（与 iOS resize:none 同一套模型）。
            //
            // 为什么不消费 ime inset（两条路都实测淘汰过）：
            // 1) 一次性 setPadding：静态 insets 回调在键盘动画开始就带终态 inset，一次缩掉整个键盘高，
            //    WebView 底边与还在上升的键盘之间露出窗口背景白框、输入条被瞬移进已裁掉区域。
            // 2) 逐帧 setPadding（WindowInsetsAnimationCompat.onProgress）：@capacitor/keyboard 的
            //    Keyboard.java 在 decorView 上注册了 DISPATCH_MODE_STOP 的动画回调（它靠这个发
            //    keyboardWillShow/Hide 事件），动画分发被拦停在根上，子 view 的 onProgress 根本不触发，
            //    实际退化回 1)。且 WebView 内容在渲染进程异步重画，即便逐帧生效，缩的每一帧底部
            //    都是先空后画。
            //
            // overlay 模型下插件事件照发（它读 inset 动画，不依赖壳让位），且 willShow 在动画开始
            // 那一刻就带最终高度——网页层 transform 过渡与键盘动画同步滑动，零重排零重画。
            // 底部同样不给手势条/导航栏让位：产品取向是内容延伸到横条之下（横条浮在其上），与 CSS 侧
            // --safe-bottom: 0 同源，见 packages/client/src/index.css 的安全区变量注释。
            // 顶部与左右仍在原生层让位，CSS 侧对应的 --safe-top/left/right 已按 data-platform=android
            // 清零，避免与 WebView 里照常报值的 env() 叠成双倍。
            view.setPadding(insets.left, insets.top, insets.right, 0);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(contentView);
    }
}
