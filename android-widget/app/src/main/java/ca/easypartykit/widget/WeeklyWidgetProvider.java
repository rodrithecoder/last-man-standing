package ca.easypartykit.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.DayOfWeek;
import java.time.temporal.TemporalAdjusters;

public final class WeeklyWidgetProvider extends AppWidgetProvider {
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, manager, id);
    }
    static void render(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.weekly_widget);
        views.setOnClickPendingIntent(R.id.title, openIntent(context, false, 1));
        views.setOnClickPendingIntent(R.id.new_booking, openIntent(context, true, 2));
        views.setOnClickPendingIntent(R.id.counts, openIntent(context, false, 3));
        try {
            String raw = context.getSharedPreferences("weekly", Context.MODE_PRIVATE)
                .getString("snapshot", null);
            if (raw == null) {
                views.setTextViewText(R.id.counts, "Open the app to load your rentals");
                views.setTextViewText(R.id.updated, "Not synchronized");
            } else {
                JSONObject snapshot = new JSONObject(raw);
                String currentMonday = LocalDate.now()
                    .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).toString();
                if (!currentMonday.equals(snapshot.optString("weekStart"))) {
                    views.setTextViewText(R.id.counts, "New week: open app to refresh");
                    views.setTextViewText(R.id.collections, "Expected collections: —");
                    views.setTextViewText(R.id.updated, "Previous week's data hidden");
                } else {
                    JSONObject counts = snapshot.getJSONObject("counts");
                    String summary = counts.optInt("rentals") + " rentals  ·  " +
                        counts.optInt("deliveries") + " deliveries  ·  " +
                        counts.optInt("returns") + " returns";
                    if (counts.optInt("overdue") > 0)
                        summary += "  ·  " + counts.optInt("overdue") + " overdue";
                    views.setTextViewText(R.id.counts, summary);
                    views.setTextViewText(R.id.collections, "Expected: " +
                        snapshot.optString("expectedCollectionsLabel", "—"));
                    JSONArray jobs = snapshot.optJSONArray("nextJobs");
                    int[] lines = {R.id.job1, R.id.job2, R.id.job3};
                    for (int i = 0; i < lines.length; i++) {
                        String text = "";
                        if (jobs != null && i < jobs.length()) {
                            JSONObject job = jobs.getJSONObject(i);
                            String date = job.optString("date", "");
                            if (date.length() >= 10) date = date.substring(5);
                            text = date + " · " + job.optString("type") + " · " +
                                job.optString("name") +
                                (job.optString("time").isEmpty() ? "" : " · " + job.optString("time"));
                        }
                        views.setTextViewText(lines[i], text);
                    }
                    String timestamp = snapshot.optString("generatedAt", "");
                    views.setTextViewText(R.id.updated,
                        timestamp.length() >= 16 ? "Updated: " + timestamp.substring(0, 16).replace('T', ' ') + " UTC"
                            : "Last synced in Easy Party Kit");
                }
            }
        } catch (Exception e) {
            views.setTextViewText(R.id.counts, "Open app to refresh widget");
            views.setTextViewText(R.id.collections, "Expected collections: —");
            views.setTextViewText(R.id.updated, "Data unavailable");
        }
        manager.updateAppWidget(widgetId, views);
    }
    private static PendingIntent openIntent(Context context, boolean isNew, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.putExtra("widgetAction", isNew ? "new" : "calendar");
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP |
            Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
