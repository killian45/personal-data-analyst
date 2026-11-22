package com.personaldataanalyst.app;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Runs the usage capture about every hour (scheduled by UsageStatsPlugin). */
public class UsageCaptureWorker extends Worker {

    public UsageCaptureWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            UsageCapture.capture(getApplicationContext());
            return Result.success();
        } catch (Exception error) {
            // Try again at the next run; nothing saved so far is lost.
            return Result.retry();
        }
    }
}
