package com.personaldataanalyst.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // This app's own plugins must be registered before the bridge starts.
        registerPlugin(UsageStatsPlugin.class);
        registerPlugin(ContactsReaderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
