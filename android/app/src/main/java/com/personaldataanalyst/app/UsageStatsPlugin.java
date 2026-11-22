package com.personaldataanalyst.app;

import android.app.AppOpsManager;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.PowerManager;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Read-only access to Android's app usage history (Phase 5 screen time;
 * docs/PHASE5_PLAN.md §5). Needs the special "Usage access" permission,
 * which only the user can switch on in the phone's Settings.
 *
 * Nothing is written anywhere. Daily totals are calculated in the web
 * app (src/screenTime/usageEvents.ts) so the rules can be tested there.
 */
@CapacitorPlugin(name = "UsageStats")
public class UsageStatsPlugin extends Plugin {

    private static final long DAY_MS = 24L * 60 * 60 * 1000;

    /** Event types the web app uses (android.app.usage.UsageEvents.Event). */
    private static final Set<Integer> RELEVANT_EVENTS = new HashSet<>();

    static {
        RELEVANT_EVENTS.add(1);  // ACTIVITY_RESUMED (app came to the screen)
        RELEVANT_EVENTS.add(2);  // ACTIVITY_PAUSED
        RELEVANT_EVENTS.add(23); // ACTIVITY_STOPPED
        RELEVANT_EVENTS.add(15); // SCREEN_INTERACTIVE
        RELEVANT_EVENTS.add(16); // SCREEN_NON_INTERACTIVE (screen off)
        RELEVANT_EVENTS.add(17); // KEYGUARD_SHOWN (locked)
        RELEVANT_EVENTS.add(18); // KEYGUARD_HIDDEN
        RELEVANT_EVENTS.add(26); // DEVICE_SHUTDOWN
        RELEVANT_EVENTS.add(27); // DEVICE_STARTUP
    }

    private UsageStatsManager manager() {
        return (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
    }

    private boolean hasAccess() {
        AppOpsManager appOps = (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
        String pkg = getContext().getPackageName();
        int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), pkg)
            : appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), pkg);
        if (mode == AppOpsManager.MODE_DEFAULT) {
            return getContext().checkCallingOrSelfPermission(android.Manifest.permission.PACKAGE_USAGE_STATS)
                == PackageManager.PERMISSION_GRANTED;
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    /** Rejects the call (and returns false) when Usage access is off. */
    private boolean requireAccess(PluginCall call) {
        if (!hasAccess()) {
            call.reject("Usage access is not switched on for this app.", "NO_ACCESS");
            return false;
        }
        return true;
    }

    /** Reads startMs/endMs; rejects invalid ranges (at most 400 days). */
    private long[] range(PluginCall call) {
        Long start = call.getLong("startMs");
        Long end = call.getLong("endMs");
        if (start == null || end == null || start < 0 || end <= start || end - start > 400 * DAY_MS) {
            call.reject("Invalid time range.", "INVALID_RANGE");
            return null;
        }
        return new long[] { start, end };
    }

    @PluginMethod
    public void checkAccess(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasAccess());
        call.resolve(result);
    }

    @PluginMethod
    public void openAccessSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /**
     * Usage events in a time range, compactly: packages and screen
     * (activity class) names once, then [timestamp, type, package index,
     * class index or -1] for each relevant event. The class is needed
     * because one app's screens overlap when it moves between them.
     */
    @PluginMethod
    public void readEvents(PluginCall call) {
        if (!requireAccess(call)) return;
        long[] r = range(call);
        if (r == null) return;

        UsageEvents events = manager().queryEvents(r[0], r[1]);
        UsageEvents.Event event = new UsageEvents.Event();
        Map<String, Integer> index = new HashMap<>();
        Map<String, Integer> classIndex = new HashMap<>();
        JSArray packages = new JSArray();
        JSArray classes = new JSArray();
        JSArray list = new JSArray();

        while (events != null && events.hasNextEvent()) {
            events.getNextEvent(event);
            int type = event.getEventType();
            if (!RELEVANT_EVENTS.contains(type)) continue;

            String pkg = event.getPackageName() == null ? "" : event.getPackageName();
            Integer position = index.get(pkg);
            if (position == null) {
                position = index.size();
                index.put(pkg, position);
                packages.put(pkg);
            }

            int classPosition = -1;
            String cls = event.getClassName();
            if (cls != null) {
                Integer known = classIndex.get(cls);
                if (known == null) {
                    known = classIndex.size();
                    classIndex.put(cls, known);
                    classes.put(cls);
                }
                classPosition = known;
            }

            JSArray row = new JSArray();
            row.put(event.getTimeStamp());
            row.put(type);
            row.put(position.intValue());
            row.put(classPosition);
            list.put(row);
        }

        JSObject result = new JSObject();
        result.put("packages", packages);
        result.put("classes", classes);
        result.put("events", list);
        call.resolve(result);
    }

    /** How far back Android still has usage information. */
    @PluginMethod
    public void historyDepth(PluginCall call) {
        if (!requireAccess(call)) return;
        long now = System.currentTimeMillis();

        Long earliestEvent = null;
        UsageEvents events = manager().queryEvents(now - 400 * DAY_MS, now);
        UsageEvents.Event event = new UsageEvents.Event();
        // Events come oldest first: the first one is the earliest kept.
        if (events != null && events.hasNextEvent()) {
            events.getNextEvent(event);
            earliestEvent = event.getTimeStamp();
        }

        JSObject result = new JSObject();
        result.put("nowMs", now);
        result.put("earliestEventMs", earliestEvent);
        call.resolve(result);
    }

    private Set<String> homePackageSet() {
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_HOME);
        Set<String> packages = new HashSet<>();
        List<ResolveInfo> found = getContext().getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
        for (ResolveInfo info : found) {
            if (info.activityInfo != null) packages.add(info.activityInfo.packageName);
        }
        return packages;
    }

    /**
     * Display names of apps, by package. Only apps with a launcher icon
     * are visible to this app (no "see all apps" permission); others are
     * left out and keep their package name in the web app.
     */
    @PluginMethod
    public void appLabels(PluginCall call) {
        JSArray requested = call.getArray("packages");
        if (requested == null) {
            call.reject("Missing packages.", "INVALID_INPUT");
            return;
        }
        PackageManager pm = getContext().getPackageManager();
        JSObject labels = new JSObject();
        for (int i = 0; i < requested.length(); i++) {
            String pkg = requested.optString(i, null);
            if (pkg == null || pkg.isEmpty()) continue;
            try {
                ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
                CharSequence label = pm.getApplicationLabel(info);
                if (label != null && label.length() > 0) labels.put(pkg, label.toString());
            } catch (PackageManager.NameNotFoundException ignored) {
                // Not visible or uninstalled: the web app shows the package name.
            }
        }
        JSObject result = new JSObject();
        result.put("labels", labels);
        call.resolve(result);
    }

    // --- Background capture (UsageCapture / UsageCaptureWorker) -------------

    private static final String CAPTURE_WORK = "usage-capture";

    /** Schedules the hourly capture (kept across restarts by WorkManager). */
    @PluginMethod
    public void startCapture(PluginCall call) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(UsageCaptureWorker.class, 1, TimeUnit.HOURS).build();
        WorkManager.getInstance(getContext())
            .enqueueUniquePeriodicWork(CAPTURE_WORK, ExistingPeriodicWorkPolicy.KEEP, request);
        UsageCapture.prefs(getContext()).edit().putBoolean("enabled", true).apply();
        call.resolve();
    }

    /** Stops the hourly capture. Already saved data is kept. */
    @PluginMethod
    public void stopCapture(PluginCall call) {
        WorkManager.getInstance(getContext()).cancelUniqueWork(CAPTURE_WORK);
        UsageCapture.prefs(getContext()).edit().putBoolean("enabled", false).apply();
        call.resolve();
    }

    private JSObject captureStatusObject() throws IOException {
        SharedPreferences prefs = UsageCapture.prefs(getContext());
        JSObject result = new JSObject();
        // enabled: true / false, or absent when never chosen.
        if (prefs.contains("enabled")) result.put("enabled", prefs.getBoolean("enabled", false));
        long lastRun = prefs.getLong("lastRunMs", -1);
        if (lastRun >= 0) result.put("lastRunMs", lastRun);
        List<long[]> ranges = UsageCapture.readRanges(getContext());
        Long earliest = null;
        for (long[] range : ranges) {
            if (earliest == null || range[0] < earliest) earliest = range[0];
        }
        if (earliest != null) result.put("coveredFromMs", earliest);
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        result.put("batteryUnrestricted", power != null && power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        return result;
    }

    @PluginMethod
    public void captureStatus(PluginCall call) {
        try {
            call.resolve(captureStatusObject());
        } catch (IOException error) {
            call.reject("Could not read the saved usage history.", "IO_ERROR");
        }
    }

    /** Deletes the saved history ("Delete all data on this device"). */
    @PluginMethod
    public void clearCapture(PluginCall call) {
        try {
            UsageCapture.clear(getContext());
            call.resolve();
        } catch (IOException error) {
            call.reject("Could not delete the saved usage history.", "IO_ERROR");
        }
    }

    /** Saves the latest events now (used just before an import). */
    @PluginMethod
    public void captureNow(PluginCall call) {
        try {
            int saved = UsageCapture.capture(getContext());
            JSObject result = captureStatusObject();
            result.put("saved", saved);
            call.resolve(result);
        } catch (IOException error) {
            call.reject("Could not save the usage history.", "IO_ERROR");
        }
    }

    /**
     * The saved history from startMs on, compactly like readEvents, plus the
     * saved app names and the covered spans [start, end].
     */
    @PluginMethod
    public void readCaptured(PluginCall call) {
        Long start = call.getLong("startMs");
        if (start == null || start < 0) {
            call.reject("Invalid start.", "INVALID_RANGE");
            return;
        }
        try {
            Map<String, Integer> index = new HashMap<>();
            Map<String, Integer> classIndex = new HashMap<>();
            JSArray packages = new JSArray();
            JSArray classes = new JSArray();
            JSArray list = new JSArray();
            for (String[] row : UsageCapture.readEvents(getContext(), start)) {
                long ts;
                int type;
                try {
                    ts = Long.parseLong(row[0]);
                    type = Integer.parseInt(row[1]);
                } catch (NumberFormatException damaged) {
                    continue;
                }
                if (ts < start) continue;
                Integer position = index.get(row[2]);
                if (position == null) {
                    position = index.size();
                    index.put(row[2], position);
                    packages.put(row[2]);
                }
                int classPosition = -1;
                if (!row[3].isEmpty()) {
                    Integer known = classIndex.get(row[3]);
                    if (known == null) {
                        known = classIndex.size();
                        classIndex.put(row[3], known);
                        classes.put(row[3]);
                    }
                    classPosition = known;
                }
                JSArray item = new JSArray();
                item.put(ts);
                item.put(type);
                item.put(position.intValue());
                item.put(classPosition);
                list.put(item);
            }
            JSObject labels = new JSObject();
            for (Map.Entry<String, String> entry : UsageCapture.readLabels(getContext()).entrySet()) {
                labels.put(entry.getKey(), entry.getValue());
            }
            JSArray ranges = new JSArray();
            for (long[] range : UsageCapture.readRanges(getContext())) {
                JSArray pair = new JSArray();
                pair.put(range[0]);
                pair.put(range[1]);
                ranges.put(pair);
            }
            JSObject result = new JSObject();
            result.put("packages", packages);
            result.put("classes", classes);
            result.put("events", list);
            result.put("labels", labels);
            result.put("ranges", ranges);
            call.resolve(result);
        } catch (IOException error) {
            call.reject("Could not read the saved usage history.", "IO_ERROR");
        }
    }

    /** Opens this app's page in the phone's Settings (to allow background use). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** Packages of the home screen apps (launchers). */
    @PluginMethod
    public void homePackages(PluginCall call) {
        JSArray list = new JSArray();
        for (String pkg : homePackageSet()) list.put(pkg);
        JSObject result = new JSObject();
        result.put("packages", list);
        call.resolve(result);
    }
}
