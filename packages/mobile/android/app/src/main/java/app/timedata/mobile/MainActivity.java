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
            // 键盘（IME）让位：edge-to-edge 下 manifest 的 adjustResize 只是禁掉系统 adjustPan
            //（pan 对 visualViewport 无感，网页层实测失明后插件兜底会再抬一次 = 双倍避让），
            // 真正的让位靠这里消费 ime inset——键盘弹起时底部 padding = 键盘高，WebView 整体变矮，
            // 网页层 useKeyboardHeight 实测归零、fixed 输入条以 bottom:0 自然贴键盘上沿。
            Insets imeInsets = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            // 键盘收起时底部传 0，不给手势条/导航栏让位：systemBars() 天然含 navigationBars()，照搬
            // 会在底栏下方留一条空带。产品取向是内容延伸到横条之下（横条浮在其上），与 CSS 侧
            // --safe-bottom: 0 同源，见 packages/client/src/index.css 的安全区变量注释。
            // ime.bottom 从屏幕物理底边起算（已含导航栏那段），键盘弹起时直接用它即可。
            // 顶部与左右仍在原生层让位，CSS 侧对应的 --safe-top/left/right 已按 data-platform=android
            // 清零，避免与 WebView 里照常报值的 env() 叠成双倍。
            view.setPadding(insets.left, insets.top, insets.right, imeInsets.bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(contentView);
    }
}
