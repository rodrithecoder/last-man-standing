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
    private static final int[] PICKUPS = {R.id.job_pickup_1, R.id.job_pickup_2, R.id.job_pickup_3};
    private static final int[] STATUSES = {R.id.job_status_1, R.id.job_status_2, R.id.job_status_3};
    private static final int[] OUT_STRIPES = {R.id.job_out_stripe_1, R.id.job_out_stripe_2, R.id.job_out_stripe_3};
    private static final int[] OVERDUE_STRIPES = {R.id.job_overdue_stripe_1, R.id.job_overdue_stripe_2, R.id.job_overdue_stripe_3};
    private static final int[] ITEM_BOXES = {R.id.job_items_container_1, R.id.job_items_container_2, R.id.job_items_container_3};
    private static final int[] ITEM_NAMES = {R.id.job_items_1, R.id.job_items_2, R.id.job_items_3};
    private static final int[] ITEM_MORE = {R.id.job_more_1, R.id.job_more_2, R.id.job_more_3};

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
                        boolean isOut = "out".equals(job.optString("status", ""));
                        boolean isOverdue = isOut && job.optBoolean("overdue", false);
                        views.setTextViewText(STATUSES[i], isOverdue ? "OVERDUE" : isOut ? "● OUT" : "");
                        views.setTextColor(STATUSES[i], android.graphics.Color.parseColor(
                            isOverdue ? "#FFB5A5" : "#F5DC9E"));
                        views.setViewVisibility(STATUSES[i], isOut ? View.VISIBLE : View.GONE);
                        views.setViewVisibility(OUT_STRIPES[i],
                            isOut && !isOverdue ? View.VISIBLE : View.GONE);
                        views.setViewVisibility(OVERDUE_STRIPES[i],
                            isOverdue ? View.VISIBLE : View.GONE);
                        String type = job.optString("type", "Rental");
                        String time = job.optString("time", "").trim();
                        views.setTextViewText(DETAILS[i], type + (time.isEmpty() ? "" : " · " + time));
                        String rep = job.optString("salesRep", "").trim();
                        views.setTextViewText(REPS[i], rep.isEmpty() ? "" : "Sales rep: " + rep);
                        String location = job.optString("pickupLocation", "");
                        String locationName = "sergio".equals(location) ? "Sergio" :
                            "rodri".equals(location) ? "Rodri" : "";
                        String locationLabel = locationName.isEmpty() ? "" :
                            ("Return".equals(type) ? "Return to " : "Pickup at ") + locationName;
                        views.setTextViewText(PICKUPS[i], locationLabel);
                        views.setViewVisibility(PICKUPS[i],
                            locationLabel.isEmpty() ? View.GONE : View.VISIBLE);
                        JSONArray rentalItems = job.optJSONArray("items");
                        int nItems = rentalItems == null ? 0 : rentalItems.length();
                        int remaining = job.optInt("moreCount", 0);
                        views.setViewVisibility(ITEM_BOXES[i],
                            nItems == 0 && remaining == 0 ? View.GONE : View.VISIBLE);
                        StringBuilder itemLabel = new StringBuilder();
                        if (rentalItems != null) {
                            for (int itemIndex = 0; itemIndex < Math.min(2, nItems); itemIndex++) {
                                if (itemIndex > 0) itemLabel.append((char) 10);
                                itemLabel.append(rentalItems.optString(itemIndex, ""));
                            }
                        }
                        views.setTextViewText(ITEM_NAMES[i], itemLabel.toString());
                        views.setTextViewText(ITEM_MORE[i], remaining > 0 ? "+" + remaining + " more" : "");
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
        for (int i = 0; i < CARDS.length; i++) {
            views.setViewVisibility(CARDS[i], View.GONE);
            views.setViewVisibility(ITEM_BOXES[i], View.GONE);
            views.setTextViewText(STATUSES[i], "");
            views.setViewVisibility(STATUSES[i], View.GONE);
            views.setViewVisibility(OUT_STRIPES[i], View.GONE);
            views.setViewVisibility(OVERDUE_STRIPES[i], View.GONE);
            views.setTextViewText(ITEM_NAMES[i], "");
            views.setTextViewText(ITEM_MORE[i], "");
            views.setTextViewText(PICKUPS[i], "");
            views.setViewVisibility(PICKUPS[i], View.GONE);
        }
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
        views.setTextViewText(PICKUPS[0], "");
        views.setViewVisibility(PICKUPS[0], View.GONE);
        views.setViewVisibility(ITEM_BOXES[0], View.GONE);
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
