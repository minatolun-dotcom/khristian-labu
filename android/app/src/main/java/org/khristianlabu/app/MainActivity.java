package org.khristianlabu.app;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private volatile boolean webReady = false;
    private UpdateInstaller updateInstaller;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Hold Android's own branded splash until the WebView has a complete,
        // painted home screen. This removes the gap and placeholder flash that
        // happen when the native window is dismissed on the first WebView frame.
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        splashScreen.setKeepOnScreenCondition(() -> !webReady);

        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            webReady = true;
            return;
        }
        // The app draws its own list rail; keep Android's stock scrollbar out of it.
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.addJavascriptInterface(new ReadyBridge(), "KhristianSplash");
        updateInstaller = new UpdateInstaller(this, webView);
        webView.addJavascriptInterface(new UpdateBridge(), "KhristianUpdate");
        webView.postDelayed(() -> webReady = true, 10000); // fail-safe for a broken page
    }

    @Override
    public void onResume() {
        super.onResume();
        if (updateInstaller != null) updateInstaller.onResume();
    }

    private final class ReadyBridge {
        @JavascriptInterface
        public void ready() {
            runOnUiThread(() -> webReady = true);
        }
    }

    private final class UpdateBridge {
        @JavascriptInterface
        public boolean isInstallAllowed() {
            return updateInstaller != null && updateInstaller.isInstallAllowed();
        }

        @JavascriptInterface
        public void start(String url, String sha256, String size, String version) {
            if (updateInstaller != null) updateInstaller.start(url, sha256, size, version);
        }

        @JavascriptInterface
        public void openInstallSettings() {
            if (updateInstaller != null) updateInstaller.openInstallSettings();
        }
    }
}
