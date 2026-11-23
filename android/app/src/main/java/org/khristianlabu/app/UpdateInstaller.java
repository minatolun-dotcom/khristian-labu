package org.khristianlabu.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Downloads the published APK into app-private cache, verifies the published
 * SHA-256, then hands it to Android's package installer through FileProvider.
 * Android still shows its own install confirmation; nothing is silent.
 */
final class UpdateInstaller {

    private static final String UPDATE_DIR = "updates";
    private static final String APK_NAME = "khristian-labu-update.apk";
    private static final String MIME_APK = "application/vnd.android.package-archive";

    private final Activity activity;
    private final WebView webView;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean downloading = new AtomicBoolean(false);

    private volatile File pendingFile;
    private volatile boolean installing = false;

    UpdateInstaller(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    boolean isInstallAllowed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return activity.getPackageManager().canRequestPackageInstalls();
    }

    void start(String url, String sha256, String expectedSize, String version) {
        if (!url.startsWith("https://")) {
            notifyState("error", 0, "Update URL is not secure.");
            return;
        }
        if (sha256 == null || !sha256.matches("(?i)[0-9a-f]{64}")) {
            notifyState("error", 0, "Update checksum is missing.");
            return;
        }
        if (!downloading.compareAndSet(false, true)) {
            notifyState("error", 0, "An update download is already running.");
            return;
        }
        long size = 0;
        try {
            size = Long.parseLong(expectedSize == null ? "" : expectedSize.trim());
        } catch (NumberFormatException ignored) {
        }
        final long expected = size;
        final String expectedHash = sha256.toLowerCase(Locale.US);
        final String safeVersion = String.valueOf(version == null ? "" : version)
                .replaceAll("[^0-9A-Za-z._-]", "_");

        executor.execute(() -> {
            File part = null;
            try {
                File dir = new File(activity.getCacheDir(), UPDATE_DIR);
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new IllegalStateException("Could not create the update folder.");
                }
                File target = new File(dir, "khristian-labu-" + safeVersion + ".apk");
                part = new File(dir, APK_NAME + ".part");
                deleteQuietly(part);
                deleteQuietly(target);
                pendingFile = null;

                notifyState("downloading", expected > 0 ? 0 : -1, "Downloading update…");
                String actualHash = download(url, part, expected, safeVersion);
                if (!expectedHash.equals(actualHash)) {
                    throw new IllegalStateException("Downloaded update failed its checksum.");
                }
                if (part.length() <= 0) {
                    throw new IllegalStateException("Downloaded update is empty.");
                }
                if (!part.renameTo(target)) {
                    throw new IllegalStateException("Could not finalize the downloaded update.");
                }
                part = null;
                pendingFile = target;
                notifyState("ready", 100, "Update downloaded.");
                main.post(this::installPending);
            } catch (Exception e) {
                if (part != null) deleteQuietly(part);
                pendingFile = null;
                notifyState("error", 0, readableError(e));
            } finally {
                downloading.set(false);
            }
        });
    }

    void openInstallSettings() {
        main.post(() -> {
            notifyState("permission", 0, "Allow installs from Khristian Labu, then return here.");
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Intent intent = new Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(intent);
                } else {
                    activity.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
                }
            } catch (ActivityNotFoundException e) {
                try {
                    activity.startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
                } catch (ActivityNotFoundException ignored) {
                    notifyState("error", 0, "Could not open install settings.");
                }
            }
        });
    }

    void onResume() {
        File file = pendingFile;
        if (file != null && file.exists() && !installing && isInstallAllowed()) {
            installPending();
        }
    }

    private void installPending() {
        File file = pendingFile;
        if (file == null || !file.exists()) {
            notifyState("error", 0, "The downloaded update is no longer available.");
            return;
        }
        if (!isInstallAllowed()) {
            openInstallSettings();
            return;
        }
        installing = true;
        try {
            Uri uri = FileProvider.getUriForFile(
                    activity, activity.getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, MIME_APK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(intent);
            pendingFile = null;
            notifyState("installing", 100, "Confirm the installation.");
        } catch (Exception e) {
            notifyState("error", 0, readableError(e));
        } finally {
            installing = false;
        }
    }

    private String download(String url, File destination, long expectedSize, String version) throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
            connection.setRequestProperty("User-Agent", "KhristianLabu/" + version);
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IllegalStateException("Update server returned HTTP " + code + ".");
            }
            long total = connection.getContentLengthLong();
            if (total <= 0 && expectedSize > 0) total = expectedSize;
            if (expectedSize > 0 && total > 0 && total != expectedSize) {
                throw new IllegalStateException("Update size does not match the published file.");
            }

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long readTotal = 0;
            long lastProgress = 0;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream in = new BufferedInputStream(connection.getInputStream());
                 FileOutputStream fileOut = new FileOutputStream(destination);
                 BufferedOutputStream out = new BufferedOutputStream(fileOut)) {
                int read;
                long now;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    digest.update(buffer, 0, read);
                    readTotal += read;
                    now = System.currentTimeMillis();
                    if (now - lastProgress >= 150) {
                        int percent = total > 0 ? (int) Math.min(99, (readTotal * 100) / total) : -1;
                        notifyState("downloading", percent, "Downloading update…");
                        lastProgress = now;
                    }
                }
            }
            if (readTotal <= 0) throw new IllegalStateException("Update download was empty.");
            if (expectedSize > 0 && readTotal != expectedSize) {
                throw new IllegalStateException("Update download was incomplete.");
            }
            return hex(digest.digest());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void notifyState(String state, int percent, String message) {
        final String script = "window.__labuUpdateProgress&&window.__labuUpdateProgress("
                + JSONObject.quote(state) + "," + percent + "," + JSONObject.quote(message) + ");";
        main.post(() -> {
            try {
                webView.evaluateJavascript(script, null);
            } catch (Exception ignored) {
            }
        });
    }

    private static String readableError(Exception e) {
        String message = e.getMessage();
        if (message == null || message.trim().isEmpty()) message = "Update failed.";
        return message;
    }

    private static void deleteQuietly(File file) {
        try {
            if (file != null && file.exists()) file.delete();
        } catch (Exception ignored) {
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) out.append(String.format(Locale.US, "%02x", b));
        return out.toString();
    }
}
