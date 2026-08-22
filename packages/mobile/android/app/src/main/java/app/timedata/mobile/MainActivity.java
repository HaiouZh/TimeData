package app.timedata.mobile;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import java.util.List;

public class MainActivity extends BridgeActivity {
    // IME 动画进行中为 true。静态 insets 回调在键盘动画**开始**时就带着终态 ime inset 到来，此时
    // 直接套用会一次性缩掉整个键盘高：WebView 底边与还在上升的键盘之间露出一条窗口背景（真机
    // 「先拉起一个输入法区域的白框」），bottom 锚定的输入条被瞬移进已被裁掉的区域、等键盘就位才
    // 回到可视区。动画期间改由下方 onProgress 的插值 inset 逐帧驱动，WebView 底边全程贴着键盘
    // 上沿走（Telegram 式跟随；WindowInsetsAnimationCompat 的官方推荐用法，androidx.core 对
    // API < 30 也有 IME 动画兼容模拟，退化路径只是回到一次到位）。
    private boolean imeAnimationInProgress = false;
    private WindowInsetsCompat lastWindowInsets;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        final View contentView = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(contentView, (view, windowInsets) -> {
            lastWindowInsets = windowInsets;
            // IME 动画期间不套用（见字段注释）：终态由 onEnd 补，逐帧由 onProgress 驱动。
            if (!imeAnimationInProgress) {
                applyInsets(view, windowInsets);
            }
            return windowInsets;
        });
        ViewCompat.setWindowInsetsAnimationCallback(
            contentView,
            new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                @Override
                public void onPrepare(WindowInsetsAnimationCompat animation) {
                    if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) {
                        imeAnimationInProgress = true;
                    }
                }

                @Override
                public WindowInsetsCompat onProgress(
                    WindowInsetsCompat insets,
                    List<WindowInsetsAnimationCompat> runningAnimations
                ) {
                    // 逐帧插值 inset：弹起时 WebView 逐帧变矮、收起时逐帧恢复，底部输入条零滞后跟随。
                    applyInsets(contentView, insets);
                    return insets;
                }

                @Override
                public void onEnd(WindowInsetsAnimationCompat animation) {
                    if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) {
                        imeAnimationInProgress = false;
                        // 补一次终态：onProgress 的最后一帧未必恰好落在终态 inset 上。
                        if (lastWindowInsets != null) {
                            applyInsets(contentView, lastWindowInsets);
                        }
                    }
                }
            }
        );
        ViewCompat.requestApplyInsets(contentView);
    }

    // 键盘（IME）让位：edge-to-edge 下 manifest 的 adjustResize 只是禁掉系统 adjustPan
    //（pan 对 visualViewport 无感，网页层实测失明后插件兜底会再抬一次 = 双倍避让），
    // 真正的让位靠这里消费 ime inset——键盘弹起时底部 padding = 键盘高，WebView 整体变矮，
    // 网页层 useKeyboardHeight 实测归零、fixed 输入条以 bottom:0 自然贴键盘上沿。
    // 键盘收起时底部传 0，不给手势条/导航栏让位：systemBars() 天然含 navigationBars()，照搬
    // 会在底栏下方留一条空带。产品取向是内容延伸到横条之下（横条浮在其上），与 CSS 侧
    // --safe-bottom: 0 同源，见 packages/client/src/index.css 的安全区变量注释。
    // ime.bottom 从屏幕物理底边起算（已含导航栏那段），键盘弹起时直接用它即可。
    // 顶部与左右仍在原生层让位，CSS 侧对应的 --safe-top/left/right 已按 data-platform=android
    // 清零，避免与 WebView 里照常报值的 env() 叠成双倍。
    private void applyInsets(View view, WindowInsetsCompat windowInsets) {
        Insets insets = windowInsets.getInsets(
            WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
        );
        Insets imeInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
        view.setPadding(insets.left, insets.top, insets.right, imeInsets.bottom);
    }
}
