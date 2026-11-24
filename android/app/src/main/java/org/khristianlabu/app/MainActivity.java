package org.khristianlabu.app;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

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
        webView.addJavascriptInterface(new DownloadBridge(), "KhristianDownload");
        webView.postDelayed(() -> webReady = true, 10000); // fail-safe for a broken page
    }

    @Override
    public void onResume() {
        super.onResume();
        if (updateInstaller != null) updateInstaller.onResume();
    }

    // Capacitor's WebView has no DownloadListener, so an <a download> with a blob
    // URL silently does nothing. The web layer hands the bytes here instead and
    // MediaStore writes the file into the public Downloads folder.
    private final class DownloadBridge {
        @JavascriptInterface
        public String save(String name, String base64, String mime) {
            String safe = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "_");
            if (safe.isEmpty()) safe = "solfa.avif";
            String type = (mime == null || !mime.startsWith("image/")) ? "image/avif" : mime;
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, type);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return "error:insert";
                    OutputStream out = getContentResolver().openOutputStream(uri);
                    if (out == null) return "error:stream";
                    try { out.write(bytes); } finally { out.close(); }
                    values.clear();
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(uri, values, null, null);
                } else {
                    // API 24-28 needs WRITE_EXTERNAL_STORAGE for public Downloads;
                    // use the app's own external Downloads folder instead.
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) return "error:dir";
                    if (!dir.exists() && !dir.mkdirs()) return "error:mkdir";
                    try (FileOutputStream fos = new FileOutputStream(new File(dir, safe))) {
                        fos.write(bytes);
                    }
                }
                final String message = "Saved to Downloads/" + safe;
                runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
                return "ok";
            } catch (Exception e) {
                return "error:" + e.getMessage();
            }
        }
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
