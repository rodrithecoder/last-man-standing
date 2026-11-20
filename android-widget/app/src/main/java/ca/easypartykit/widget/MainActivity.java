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
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private WebView webView;
    private String lastSyncIssue = "Waiting for website data";
    private static final String TRUSTED_HOST = android.net.Uri.parse(BuildConfig.APP_URL).getHost();

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        setContentView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
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
                        Toast.makeText(MainActivity.this,
                            "Widget synced: " + obj.getJSONObject("counts").optInt("rentals") +
                            " rentals this week", Toast.LENGTH_LONG).show();
                    } catch (Exception e) {
                        lastSyncIssue = "Widget sync failed: invalid snapshot";
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
