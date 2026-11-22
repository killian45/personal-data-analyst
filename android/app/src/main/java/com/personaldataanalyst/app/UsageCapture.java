package com.personaldataanalyst.app;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Process;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * Background capture of Android usage events (Phase 5, docs/PHASE5_PLAN.md).
 *
 * Why: Android keeps only ~10 days of usage events and deletes an app's
 * history when the app is uninstalled. Saving a private copy regularly
 * keeps that time (and the app's name) for the screen-time import.
 *
 * Storage (app-private, never synced, Android backup disabled):
 * usage-capture/events-YYYY-MM-DD.tsv  (UTC day): time, type, package, class
 * usage-capture/labels.tsv             package, app name (last line wins)
 * usage-capture/ranges.tsv             start, end of each covered span
 * Files older than 60 days are removed. Reads only from Android.
 */
public final class UsageCapture {

    static final long DAY_MS = 24L * 60 * 60 * 1000;
    private static final int KEEP_DAYS = 60;
    private static final String PREFS = "usage_capture";
    private static final Set<Integer> RELEVANT = new HashSet<>();

    static {
        // Same event types the web app uses (see src/screenTime/usageEvents.ts).
        int[] types = { 1, 2, 23, 15, 16, 17, 18, 26, 27 };
        for (int type : types) RELEVANT.add(type);
    }

    private UsageCapture() {}

    static boolean isRelevant(int type) {
        return RELEVANT.contains(type);
    }

    static boolean hasAccess(Context context) {
        AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        String pkg = context.getPackageName();
        int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), pkg)
            : appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), pkg);
        if (mode == AppOpsManager.MODE_DEFAULT) {
            return context.checkCallingOrSelfPermission(android.Manifest.permission.PACKAGE_USAGE_STATS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static File dir(Context context) {
        File dir = new File(context.getFilesDir(), "usage-capture");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static String utcDay(long ms) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date(ms));
    }

    private static String clean(String text) {
        return text == null ? "" : text.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ');
    }

    /**
     * Deletes the saved history ("Delete all data on this device"). The
     * capture choice ("enabled") is kept; the next capture starts again
     * from what Android itself still keeps. Throws if a file cannot be
     * deleted.
     */
    static synchronized void clear(Context context) throws IOException {
        File[] files = dir(context).listFiles();
        if (files != null) {
            for (File file : files) {
                if (file.isFile() && !file.delete()) throw new IOException("Could not delete " + file.getName());
            }
        }
        prefs(context).edit().remove("lastEndMs").remove("lastRunMs").commit();
    }

    /**
     * Saves the usage events since the last capture. Returns the number of
     * events saved, or -1 when Usage access is off (nothing is done).
     */
    static synchronized int capture(Context context) throws IOException {
        if (!hasAccess(context)) return -1;

        SharedPreferences prefs = prefs(context);
        long now = System.currentTimeMillis();
        long lastEnd = prefs.getLong("lastEndMs", -1);
        // Recent last capture: continue from there. Otherwise (first run, or a
        // long pause) read everything Android still keeps.
        boolean continuous = lastEnd >= 0 && lastEnd >= now - 7 * DAY_MS && lastEnd <= now;
        long queryStart = continuous ? lastEnd : now - 400 * DAY_MS;

        UsageStatsManager manager = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
        UsageEvents events = manager.queryEvents(queryStart, now);
        UsageEvents.Event event = new UsageEvents.Event();

        Map<String, StringBuilder> byDay = new HashMap<>();
        Set<String> packages = new HashSet<>();
        long firstEvent = -1;
        int saved = 0;

        while (events != null && events.hasNextEvent()) {
            events.getNextEvent(event);
            int type = event.getEventType();
            if (!isRelevant(type)) continue;
            long ts = event.getTimeStamp();
            if (firstEvent < 0) firstEvent = ts;
            String pkg = clean(event.getPackageName());
            packages.add(pkg);
            String day = utcDay(ts);
            StringBuilder lines = byDay.get(day);
            if (lines == null) {
                lines = new StringBuilder();
                byDay.put(day, lines);
            }
            lines.append(ts).append('\t').append(type).append('\t').append(pkg).append('\t')
                .append(clean(event.getClassName())).append('\n');
            saved++;
        }

        File dir = dir(context);
        for (Map.Entry<String, StringBuilder> entry : byDay.entrySet()) {
            append(new File(dir, "events-" + entry.getKey() + ".tsv"), entry.getValue().toString());
        }

        // App names now, while the apps are installed.
        Map<String, String> known = readLabels(context);
        StringBuilder labels = new StringBuilder();
        PackageManager pm = context.getPackageManager();
        for (String pkg : packages) {
            if (pkg.isEmpty()) continue;
            try {
                ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
                String label = clean(String.valueOf(pm.getApplicationLabel(info)));
                if (!label.isEmpty() && !label.equals(known.get(pkg))) {
                    labels.append(pkg).append('\t').append(label).append('\n');
                }
            } catch (PackageManager.NameNotFoundException ignored) {
                // Not visible or already uninstalled: keep any earlier name.
            }
        }
        if (labels.length() > 0) append(new File(dir, "labels.tsv"), labels.toString());

        // The span this capture covers. A first run (or after a long pause)
        // covers only from the oldest event Android still had.
        long coveredStart = continuous ? lastEnd : (firstEvent >= 0 ? firstEvent : now);
        if (coveredStart < now) append(new File(dir, "ranges.tsv"), coveredStart + "\t" + now + "\n");

        prefs.edit().putLong("lastEndMs", now).putLong("lastRunMs", now).apply();
        prune(context, now);
        return saved;
    }

    private static void append(File file, String text) throws IOException {
        try (Writer writer = new OutputStreamWriter(new FileOutputStream(file, true), StandardCharsets.UTF_8)) {
            writer.write(text);
        }
    }

    private static List<String[]> readLines(File file) throws IOException {
        List<String[]> rows = new ArrayList<>();
        if (!file.exists()) return rows;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.isEmpty()) rows.add(line.split("\t", -1));
            }
        }
        return rows;
    }

    static Map<String, String> readLabels(Context context) throws IOException {
        Map<String, String> labels = new HashMap<>();
        for (String[] row : readLines(new File(dir(context), "labels.tsv"))) {
            if (row.length >= 2) labels.put(row[0], row[1]);
        }
        return labels;
    }

    static List<long[]> readRanges(Context context) throws IOException {
        List<long[]> ranges = new ArrayList<>();
        for (String[] row : readLines(new File(dir(context), "ranges.tsv"))) {
            try {
                if (row.length >= 2) ranges.add(new long[] { Long.parseLong(row[0]), Long.parseLong(row[1]) });
            } catch (NumberFormatException ignored) {
                // A damaged line is skipped: that span simply counts as not covered.
            }
        }
        return ranges;
    }

    /** Saved event lines (time, type, package, class) from startMs on. */
    static List<String[]> readEvents(Context context, long startMs) throws IOException {
        List<String[]> rows = new ArrayList<>();
        String firstDay = utcDay(startMs);
        File[] files = dir(context).listFiles();
        if (files == null) return rows;
        for (File file : files) {
            String name = file.getName();
            if (!name.startsWith("events-") || !name.endsWith(".tsv")) continue;
            String day = name.substring(7, name.length() - 4);
            if (day.compareTo(firstDay) < 0) continue;
            for (String[] row : readLines(file)) {
                if (row.length >= 4) rows.add(row);
            }
        }
        return rows;
    }

    /** Removes saved days older than KEEP_DAYS, and clips the covered spans. */
    private static void prune(Context context, long now) throws IOException {
        long cutoff = now - KEEP_DAYS * DAY_MS;
        String cutoffDay = utcDay(cutoff);
        File dir = dir(context);
        File[] files = dir.listFiles();
        if (files != null) {
            for (File file : files) {
                String name = file.getName();
                if (name.startsWith("events-") && name.endsWith(".tsv") && name.substring(7, name.length() - 4).compareTo(cutoffDay) < 0) {
                    file.delete();
                }
            }
        }
        // Spans may only claim days whose events are still kept.
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        long keptFrom;
        try {
            keptFrom = format.parse(cutoffDay).getTime();
        } catch (java.text.ParseException e) {
            return;
        }
        List<long[]> ranges = readRanges(context);
        StringBuilder kept = new StringBuilder();
        boolean changed = false;
        for (long[] range : ranges) {
            if (range[1] <= keptFrom) {
                changed = true;
                continue;
            }
            long start = Math.max(range[0], keptFrom);
            if (start != range[0]) changed = true;
            kept.append(start).append('\t').append(range[1]).append('\n');
        }
        if (changed) {
            try (Writer writer = new OutputStreamWriter(new FileOutputStream(new File(dir, "ranges.tsv"), false), StandardCharsets.UTF_8)) {
                writer.write(kept.toString());
            }
        }
    }
}
