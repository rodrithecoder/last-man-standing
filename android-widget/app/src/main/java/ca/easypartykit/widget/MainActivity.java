package ca.easypartykit.widget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.widget.Button;
import android.widget.TextView;
import android.widget.LinearLayout;
import android.view.Gravity;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private WebView webView;
    private TextView syncStatus;
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private void status(String value) {
        if (syncStatus != null) syncStatus.setText(value);
    }
    private void syncNow() {
        if (webView == null) return;
        String url = webView.getUrl();
        if (url == null || !isTrusted(url)) {
            status("Cannot sync: app is at " + (url == null ? "no page" : android.net.Uri.parse(url).getHost()));
            return;
        }
        status("Checking widget connection…");
        // Only return state labels to Android; never return customers or amounts
        // through evaluateJavascript's callback.
        String js = "(function(){"
            + "var b=window.EasyPartyWidget;"
            + "if(!b||typeof b.update!=='function')return 'Bridge unavailable';"
            + "var s=window.__epkWeeklySnapshot;"
            + "if(!s)return 'Waiting for booking data';"
            + "try{b.update(JSON.stringify(s));return 'Snapshot sent: '+s.counts.rentals+' rentals';}"
            + "catch(e){return 'Sync error: '+String(e.message).slice(0,80);}"
            + "})()";
        webView.evaluateJavascript(js, result -> status(result == null ? "No response from page" :
            result.replace("\\\"", "").replace("\"", "")));
    }
    private String lastSyncIssue = "Waiting for website data";
    private static final String TRUSTED_HOST = android.net.Uri.parse(BuildConfig.APP_URL).getHost();

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        FrameLayout root = new FrameLayout(this);
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        controls.setPadding(16, 4, 12, 4);
        controls.setBackgroundColor(Color.rgb(229, 240, 229));
        syncStatus = new TextView(this);
        syncStatus.setTextColor(Color.rgb(33, 79, 57));
        syncStatus.setTextSize(11);
        syncStatus.setText("Widget: waiting for bookings");
        controls.addView(syncStatus, new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button syncButton = new Button(this);
        syncButton.setText("Sync Widget");
        syncButton.setAllCaps(false);
        syncButton.setOnClickListener(v -> syncNow());
        controls.addView(syncButton);
        FrameLayout.LayoutParams controlParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM);
        root.addView(controls, controlParams);
        setContentView(root);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface public void update(String json) {
                // A write-only bridge. No database token or customer records are
                // exposed to JS; data came from the existing web session.
                if (json == null || json.length() > 30000) return;
                runOnUiThread(() -> {
                    if (webView == null || webView.getUrl() == null ||
                        !isTrusted(webView.getUrl())) {
                        lastSyncIssue = "Widget sync blocked: unexpected app URL";
                        status(lastSyncIssue);
                        Toast.makeText(MainActivity.this, lastSyncIssue, Toast.LENGTH_LONG).show();
                        return;
                    }
                    try {
                        JSONObject obj = new JSONObject(json);
                        if (obj.optInt("schemaVersion") != 1) return;
                        getSharedPreferences("weekly", MODE_PRIVATE).edit()
                            .putString("snapshot", obj.toString()).apply();
                        AppWidgetManager manager = AppWidgetManager.getInstance(MainActivity.this);
                        int[] ids = manager.getAppWidgetIds(new ComponentName(
                            MainActivity.this, WeeklyWidgetProvider.class));
                        for (int id : ids) WeeklyWidgetProvider.render(MainActivity.this, manager, id);
                        lastSyncIssue = "Widget synced";
                        status("Widget synced · " + obj.getJSONObject("counts").optInt("rentals") + " rentals");
                        Toast.makeText(MainActivity.this,
                            "Widget synced: " + obj.getJSONObject("counts").optInt("rentals") +
                            " rentals this week", Toast.LENGTH_LONG).show();
                    } catch (Exception e) {
                        lastSyncIssue = "Widget sync failed: invalid snapshot";
                        status(lastSyncIssue);
                        Toast.makeText(MainActivity.this, lastSyncIssue, Toast.LENGTH_LONG).show();
                    }
                });
            }
        }, "EasyPartyWidget");
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (isTrusted(url)) {
                    // The page may have loaded before the JS bridge status changed.
                    // A webpage can invoke this after its bookings finish loading.
                    view.evaluateJavascript("window.dispatchEvent(new Event('easy-party-widget-sync'))", null);
                    handler.postDelayed(() -> syncNow(), 2500);
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (isTrusted(url)) return false;
                if (req.isForMainFrame()) {
                    startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl()));
                    return true;
                }
                return false;
            }
        });
        loadIntent(getIntent());
    }
    private boolean isTrusted(String url) {
        try {
            android.net.Uri uri = android.net.Uri.parse(url);
            return "https".equals(uri.getScheme()) && TRUSTED_HOST.equalsIgnoreCase(uri.getHost());
        } catch (Exception e) { return false; }
    }
    private void loadIntent(Intent intent) {
        boolean newBooking = intent != null && "new".equals(intent.getStringExtra("widgetAction"));
        webView.loadUrl(BuildConfig.APP_URL + (newBooking ? "?widget=new" : ""));
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadIntent(intent);
    }
    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
