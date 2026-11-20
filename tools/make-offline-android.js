// Generates android-offline/: a tiny native Android app that contains the whole game
// and works with NO internet. It runs a local web server on the headset (127.0.0.1:8642)
// and opens the game in Meta Quest Browser at http://localhost:8642 (a secure context,
// so WebXR / ENTER VR works). Build: cd android-offline && gradle assembleDebug
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'); const out = path.join(root, 'android-offline');
const pkg = 'com.futongroup.golfvr.offline'; const PORT = 8642;
const w = (rel, txt) => { const p = path.join(out, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); };

w('settings.gradle', `pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = "FutonGolfOffline"
include ':app'
`);
w('build.gradle', `plugins { id 'com.android.application' version '8.5.2' apply false }
`);
w('gradle.properties', `org.gradle.jvmargs=-Xmx2g
android.useAndroidX=false
`);
w('app/build.gradle', `plugins { id 'com.android.application' }
android {
    namespace '${pkg}'
    compileSdk 34
    defaultConfig {
        applicationId '${pkg}'
        minSdk 29
        targetSdk 32
        versionCode 1
        versionName '1.0'
    }
    compileOptions { sourceCompatibility JavaVersion.VERSION_17; targetCompatibility JavaVersion.VERSION_17 }
    lint { checkReleaseBuilds false; abortOnError false }
    androidResources { ignoreAssetsPattern '!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~' }
}
`);
w('app/src/main/AndroidManifest.xml', `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <application
        android:label="FUTON GOLF VR"
        android:icon="@drawable/ic_launcher"
        android:theme="@android:style/Theme.DeviceDefault.NoActionBar">
        <activity android:name=".MainActivity" android:exported="true" android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        <service android:name=".GameServerService" android:exported="false" />
    </application>
</manifest>
`);
const jdir = 'app/src/main/java/' + pkg.replace(/\./g, '/') + '/';
w(jdir + 'MainActivity.java', `package ${pkg};

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    static final String URL = "http://localhost:" + GameServerService.PORT + "/index.html";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent svc = new Intent(this, GameServerService.class);
        startForegroundService(svc);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.rgb(11, 15, 18));
        root.setPadding(60, 60, 60, 60);

        TextView title = new TextView(this);
        title.setText("FUTON GOLF VR");
        title.setTextColor(Color.WHITE);
        title.setTextSize(36);
        title.setGravity(Gravity.CENTER);

        TextView info = new TextView(this);
        info.setText("Игра работает без интернета и открывается в браузере Meta Quest.\\n"
                + "Нажмите ИГРАТЬ, затем в браузере — ВОЙТИ В VR.\\n\\n"
                + "Если браузер не открылся сам, откройте Браузер и введите адрес:\\n" + URL + "\\n\\n"
                + "The game runs offline in Meta Quest Browser. Press PLAY, then ENTER VR.");
        info.setTextColor(Color.rgb(200, 205, 205));
        info.setTextSize(18);
        info.setGravity(Gravity.CENTER);
        info.setPadding(0, 30, 0, 30);

        Button play = new Button(this);
        play.setText("ИГРАТЬ / PLAY");
        play.setTextSize(22);
        play.setOnClickListener(v -> openGame());

        root.addView(title);
        root.addView(info);
        root.addView(play);
        setContentView(root);

        new Handler(Looper.getMainLooper()).postDelayed(this::openGame, 1500);
    }

    private void openGame() {
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(URL));
        view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            view.setPackage("com.oculus.browser");
            startActivity(view);
            return;
        } catch (Exception ignored) { }
        try {
            view.setPackage(null);
            startActivity(view);
        } catch (Exception ignored) { }
    }
}
`);
w(jdir + 'GameServerService.java', `package ${pkg};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/** Serves the game files bundled in assets/www on 127.0.0.1 — no internet required. */
public class GameServerService extends Service {
    public static final int PORT = ${PORT};
    private static volatile Thread serverThread;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel("futon", "FUTON GOLF VR", NotificationManager.IMPORTANCE_LOW);
        nm.createNotificationChannel(ch);
        Notification n = new Notification.Builder(this, "futon")
                .setContentTitle("FUTON GOLF VR")
                .setContentText("Offline game server")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .build();
        startForeground(1, n);
        startServer();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) { return START_STICKY; }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private synchronized void startServer() {
        if (serverThread != null) return;
        serverThread = new Thread(() -> {
            try (ServerSocket ss = new ServerSocket()) {
                ss.setReuseAddress(true);
                ss.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT));
                while (true) {
                    final Socket s = ss.accept();
                    new Thread(() -> handle(s)).start();
                }
            } catch (IOException e) {
                serverThread = null;
            }
        }, "futon-http");
        serverThread.start();
    }

    private void handle(Socket socket) {
        try (Socket s = socket) {
            s.setSoTimeout(15000);
            BufferedReader in = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.ISO_8859_1));
            String request = in.readLine();
            if (request == null) return;
            String header;
            while ((header = in.readLine()) != null && !header.isEmpty()) { /* skip headers */ }
            String[] parts = request.split(" ");
            String method = parts[0];
            String path = parts.length > 1 ? parts[1] : "/";
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            path = URLDecoder.decode(path, "UTF-8");
            if (path.endsWith("/")) path = path + "index.html";
            if (path.contains("..") || !path.startsWith("/")) path = "/__invalid__";

            String status = "200 OK";
            String type = mime(path);
            byte[] body;
            try (InputStream is = getAssets().open("www" + path)) {
                body = readAll(is);
            } catch (IOException notFound) {
                status = "404 Not Found";
                type = "text/plain; charset=utf-8";
                body = "Not found".getBytes(StandardCharsets.UTF_8);
            }
            String head = "HTTP/1.1 " + status + "\\r\\n"
                    + "Content-Type: " + type + "\\r\\n"
                    + "Content-Length: " + body.length + "\\r\\n"
                    + "Cache-Control: no-cache\\r\\n"
                    + "Connection: close\\r\\n\\r\\n";
            OutputStream out = s.getOutputStream();
            out.write(head.getBytes(StandardCharsets.ISO_8859_1));
            if (!"HEAD".equals(method)) out.write(body);
            out.flush();
        } catch (IOException ignored) { }
    }

    private static byte[] readAll(InputStream is) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }

    private static String mime(String p) {
        String l = p.toLowerCase();
        if (l.endsWith(".html")) return "text/html; charset=utf-8";
        if (l.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (l.endsWith(".json") || l.endsWith(".webmanifest")) return "application/json";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".css")) return "text/css";
        return "application/octet-stream";
    }
}
`);
// bundle the built game (dist/) as assets + launcher icon
const dist = path.join(root, 'dist'); const www = path.join(out, 'app/src/main/assets/www');
fs.rmSync(www, { recursive: true, force: true });
const copy = (src, dst) => { for (const e of fs.readdirSync(src, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const s = path.join(src, e.name), d = path.join(dst, e.name); if (e.isDirectory()) copy(s, d); else { fs.mkdirSync(dst, { recursive: true }); fs.copyFileSync(s, d); } } };
copy(dist, www);
fs.mkdirSync(path.join(out, 'app/src/main/res/drawable'), { recursive: true });
fs.copyFileSync(path.join(dist, 'icons/icon-192.png'), path.join(out, 'app/src/main/res/drawable/ic_launcher.png'));
console.log('android-offline/ generated with', fs.readdirSync(www).length, 'web files');
