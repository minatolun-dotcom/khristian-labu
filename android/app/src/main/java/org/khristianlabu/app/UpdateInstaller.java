package org.khristianlabu.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Downloads the published APK into app-private cache, verifies the published
 * SHA-256, then hands it to Android's package installer through FileProvider.
 * Android still shows its own install confirmation; nothing is silent.
 *
 * Interrupted downloads keep a .part file and a small metadata sidecar so the
 * next attempt can continue with an HTTP Range request instead of starting over.
 */
final class UpdateInstaller {

    private static final String UPDATE_DIR = "updates";
    private static final String APK_NAME = "khristian-labu-update.apk";
    private static final String PART_NAME = APK_NAME + ".part";
    private static final String PART_META = PART_NAME + ".json";
    private static final String MIME_APK = "application/vnd.android.package-archive";
    private static final String TAG = "KhristianUpdate";

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
            notifyState("error", -1, "Update URL is not secure.");
            return;
        }
        if (sha256 == null || !sha256.matches("(?i)[0-9a-f]{64}")) {
            notifyState("error", -1, "Update checksum is missing.");
            return;
        }
        if (!downloading.compareAndSet(false, true)) {
            notifyState("error", -1, "An update download is already running.");
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
            File meta = null;
            try {
                File dir = new File(activity.getCacheDir(), UPDATE_DIR);
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new IllegalStateException("Could not create the update folder.");
                }
                File target = new File(dir, "khristian-labu-" + safeVersion + ".apk");
                part = new File(dir, PART_NAME);
                meta = new File(dir, PART_META);
                pendingFile = null;
                deleteQuietly(target);

                preparePartial(part, meta, url, expectedHash, expected, safeVersion);
                if (part.length() > 0 && expected > 0) {
                    int percent = (int) Math.min(99, (part.length() * 100) / expected);
                    notifyState("downloading", percent, "Resuming update…");
                } else {
                    notifyState("downloading", expected > 0 ? 0 : -1, "Downloading update…");
                }

                String actualHash = download(url, part, expected, safeVersion);
                if (!expectedHash.equals(actualHash)) {
                    throw new VerificationException("Downloaded update failed its checksum.");
                }
                if (part.length() <= 0) {
                    throw new VerificationException("Downloaded update is empty.");
                }
                if (!part.renameTo(target)) {
                    throw new IllegalStateException("Could not finalize the downloaded update.");
                }
                deleteQuietly(meta);
                part = null;
                pendingFile = target;
                notifyState("ready", 100, "Update downloaded.");
                main.post(this::installPending);
            } catch (VerificationException e) {
                deleteQuietly(part);
                deleteQuietly(meta);
                pendingFile = null;
                notifyState("error", 0, readableError(e));
            } catch (Exception e) {
                // Network/HTTP failures keep the partial file and its metadata for the next try.
                pendingFile = null;
                notifyState("error", -1, readableError(e) + " Retry to resume the download.");
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
            notifyState("error", -1, "The downloaded update is no longer available.");
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
            // Keep the verified file: if the user backs out of the confirmation,
            // onResume offers it again instead of downloading 45 MB a second time.
            notifyState("installing", 100, "Confirm the installation.");
        } catch (Exception e) {
            notifyState("error", -1, readableError(e));
        } finally {
            installing = false;
        }
    }

    private String download(String url, File destination, long expectedSize, String version) throws Exception {
        long existing = destination.exists() ? destination.length() : 0;
        Log.i(TAG, "GET existing=" + existing + " expected=" + expectedSize);
        if (existing > 0 && expectedSize > 0 && existing > expectedSize) {
            deleteQuietly(destination);
            existing = 0;
        }
        if (existing > 0 && expectedSize > 0 && existing == expectedSize) {
            notifyState("downloading", 99, "Verifying update…");
            return sha256File(destination);
        }

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", MIME_APK);
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("User-Agent", "KhristianLabu/" + version);
            if (existing > 0) {
                connection.setRequestProperty("Range", "bytes=" + existing + "-");
            }

            int code = connection.getResponseCode();
            boolean append = code == HttpURLConnection.HTTP_PARTIAL && existing > 0;
            Log.i(TAG, "HTTP " + code + " append=" + append + " existing=" + existing);
            if (code == 416) {
                if (expectedSize > 0 && existing == expectedSize) {
                    notifyState("downloading", 99, "Verifying update…");
                    return sha256File(destination);
                }
                deleteQuietly(destination);
                throw new IllegalStateException("Server rejected the partial download. Retry to start over.");
            }
            if (code == HttpURLConnection.HTTP_OK) {
                append = false;
                existing = 0;
            } else if (code != HttpURLConnection.HTTP_PARTIAL) {
                throw new IllegalStateException("Update server returned HTTP " + code + ".");
            }

            long contentLength = connection.getContentLengthLong();
            long total = contentLength > 0 ? (append ? existing + contentLength : contentLength) : expectedSize;
            long lastProgress = 0;
            long received = existing;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream in = new BufferedInputStream(connection.getInputStream());
                 FileOutputStream fileOut = new FileOutputStream(destination, append);
                 BufferedOutputStream out = new BufferedOutputStream(fileOut)) {
                int read;
                long now;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    received += read;
                    now = System.currentTimeMillis();
                    if (now - lastProgress >= 150) {
                        int percent = total > 0 ? (int) Math.min(99, (received * 100) / total) : -1;
                        notifyState("downloading", percent,
                                append ? "Resuming update…" : "Downloading update…");
                        lastProgress = now;
                    }
                }
            }
            if (expectedSize > 0 && destination.length() != expectedSize) {
                throw new VerificationException("Update download was incomplete.");
            }
            if (destination.length() <= 0) {
                throw new VerificationException("Update download was empty.");
            }
            return sha256File(destination);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void preparePartial(File part, File meta, String url, String hash,
                                long expectedSize, String version) {
        boolean resumable = false;
        if (part.exists() && part.length() > 0) {
            JSONObject previous = readJson(meta);
            resumable = previous != null
                    && url.equals(previous.optString("url"))
                    && hash.equals(previous.optString("sha256"))
                    && (expectedSize <= 0 || expectedSize == previous.optLong("size", -1))
                    && (expectedSize <= 0 || part.length() <= expectedSize);
        }
        Log.i(TAG, "partial resume=" + resumable + " bytes=" + part.length());
        if (!resumable) {
            deleteQuietly(part);
            deleteQuietly(meta);
        }
        try {
            JSONObject data = new JSONObject();
            data.put("url", url);
            data.put("sha256", hash);
            data.put("size", expectedSize);
            data.put("version", version);
            try (FileOutputStream out = new FileOutputStream(meta)) {
                out.write(data.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) {
        }
    }

    private static JSONObject readJson(File file) {
        if (file == null || !file.exists()) return null;
        try (FileInputStream in = new FileInputStream(file);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
        } catch (Exception e) {
            return null;
        }
    }

    private static String sha256File(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        return hex(digest.digest());
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

    private static final class VerificationException extends Exception {
        VerificationException(String message) {
            super(message);
        }
    }
}
