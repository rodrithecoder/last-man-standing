package ca.easypartykit.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.DayOfWeek;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.Locale;

public final class WeeklyWidgetProvider extends AppWidgetProvider {
    private static final int[] CARDS = {R.id.job_card_1, R.id.job_card_2, R.id.job_card_3};
    private static final int[] DAYS = {R.id.job_day_1, R.id.job_day_2, R.id.job_day_3};
    private static final int[] DATES = {R.id.job_date_1, R.id.job_date_2, R.id.job_date_3};
    private static final int[] NAMES = {R.id.job_name_1, R.id.job_name_2, R.id.job_name_3};
    private static final int[] DETAILS = {R.id.job_detail_1, R.id.job_detail_2, R.id.job_detail_3};
    private static final int[] REPS = {R.id.job_rep_1, R.id.job_rep_2, R.id.job_rep_3};

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, manager, id);
    }

    static void render(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.weekly_widget);
        PendingIntent calendar = openIntent(context, false, 1);
        views.setOnClickPendingIntent(R.id.widget_header, calendar);
        views.setOnClickPendingIntent(R.id.open_calendar, calendar);
        views.setOnClickPendingIntent(R.id.new_booking, openIntent(context, true, 2));
        for (int card : CARDS) views.setOnClickPendingIntent(card, calendar);
        reset(views);

        try {
            String raw = context.getSharedPreferences("weekly", Context.MODE_PRIVATE)
                .getString("snapshot", null);
            if (raw == null) {
                showEmpty(views, "Open Easy Party Kit to sync your rentals", "Not synchronized");
            } else {
                JSONObject snapshot = new JSONObject(raw);
                String currentMonday = LocalDate.now()
                    .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).toString();
                if (!currentMonday.equals(snapshot.optString("weekStart"))) {
                    showEmpty(views, "Open app to refresh this week's rentals", "Previous week's data hidden");
                } else {
                    JSONObject counts = snapshot.getJSONObject("counts");
                    views.setTextViewText(R.id.metric_rentals, String.valueOf(counts.optInt("rentals")));
                    views.setTextViewText(R.id.metric_deliveries, String.valueOf(counts.optInt("deliveries")));
                    views.setTextViewText(R.id.metric_returns, String.valueOf(counts.optInt("returns")));
                    int overdue = counts.optInt("overdue");
                    views.setTextViewText(R.id.overdue, overdue > 0 ? overdue + " overdue" : "");
                    views.setTextViewText(R.id.collections,
                        snapshot.optString("expectedCollectionsLabel", "—"));

                    JSONArray jobs = snapshot.optJSONArray("nextJobs");
                    int total = jobs == null ? 0 : Math.min(CARDS.length, jobs.length());
                    for (int i = 0; i < total; i++) {
                        JSONObject job = jobs.getJSONObject(i);
                        LocalDate date = LocalDate.parse(job.optString("date"));
                        views.setViewVisibility(CARDS[i], View.VISIBLE);
                        views.setTextViewText(DAYS[i],
                            date.format(DateTimeFormatter.ofPattern("EEE", Locale.CANADA)).toUpperCase(Locale.CANADA));
                        views.setTextViewText(DATES[i], String.valueOf(date.getDayOfMonth()));
                        views.setTextViewText(NAMES[i], job.optString("name", "Rental"));
                        String type = job.optString("type", "Rental");
                        String time = job.optString("time", "").trim();
                        views.setTextViewText(DETAILS[i], type + (time.isEmpty() ? "" : " · " + time));
                        String rep = job.optString("salesRep", "").trim();
                        views.setTextViewText(REPS[i], rep.isEmpty() ? "" : "Sales rep: " + rep);
                    }
                    if (total == 0) showEmptyJob(views, "No upcoming rentals");
                    String timestamp = snapshot.optString("generatedAt", "");
                    views.setTextViewText(R.id.updated,
                        timestamp.length() >= 16 ? "Synced " + timestamp.substring(0, 16).replace('T', ' ') + " UTC"
                            : "Synced from Easy Party Kit");
                }
            }
        } catch (Exception e) {
            reset(views);
            showEmpty(views, "Open the app to refresh", "Widget data unavailable");
        }
        manager.updateAppWidget(widgetId, views);
    }

    private static void reset(RemoteViews views) {
        views.setTextViewText(R.id.metric_rentals, "—");
        views.setTextViewText(R.id.metric_deliveries, "—");
        views.setTextViewText(R.id.metric_returns, "—");
        views.setTextViewText(R.id.overdue, "");
        views.setTextViewText(R.id.collections, "—");
        for (int card : CARDS) views.setViewVisibility(card, View.GONE);
    }

    private static void showEmpty(RemoteViews views, String description, String updated) {
        showEmptyJob(views, description);
        views.setTextViewText(R.id.updated, updated);
    }

    private static void showEmptyJob(RemoteViews views, String description) {
        views.setViewVisibility(CARDS[0], View.VISIBLE);
        views.setTextViewText(DAYS[0], "");
        views.setTextViewText(DATES[0], "•");
        views.setTextViewText(NAMES[0], description);
        views.setTextViewText(DETAILS[0], "");
        views.setTextViewText(REPS[0], "");
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
