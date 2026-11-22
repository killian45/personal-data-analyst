package com.personaldataanalyst.app;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.provider.ContactsContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Read-only access to the phone's contacts (Personal CRM step 3).
 *
 * Only READ_CONTACTS is requested; this plugin has no code that writes,
 * changes or deletes anything. For each contact it returns the lasting
 * lookup key (survives contact merges better than the numeric id), the
 * display name, postal addresses, birthdays (raw text, parsed in the web
 * app where the rules are tested) and notes. Phone numbers and e-mail
 * addresses are not read.
 */
@CapacitorPlugin(
    name = "ContactsReader",
    permissions = { @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = "contacts") }
)
public class ContactsReaderPlugin extends Plugin {

    private static String stateName(PermissionState state) {
        if (state == PermissionState.GRANTED) return "granted";
        if (state == PermissionState.DENIED) return "denied";
        return "prompt";
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("state", stateName(getPermissionState("contacts")));
        call.resolve(result);
    }

    /** Shows Android's permission prompt if needed; resolves with the resulting state. */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            checkPermission(call);
            return;
        }
        requestPermissionForAlias("contacts", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        checkPermission(call);
    }

    private static String text(Cursor cursor, String column) {
        int index = cursor.getColumnIndex(column);
        return index < 0 || cursor.isNull(index) ? null : cursor.getString(index);
    }

    private static int number(Cursor cursor, String column) {
        int index = cursor.getColumnIndex(column);
        return index < 0 || cursor.isNull(index) ? 0 : cursor.getInt(index);
    }

    @PluginMethod
    public void readContacts(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            call.reject("Access to contacts is not allowed.");
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        Map<Long, JSObject> byId = new LinkedHashMap<>();
        Map<Long, JSArray[]> lists = new HashMap<>();

        // Every contact, even one with only a phone number.
        String[] contactColumns = {
            ContactsContract.Contacts._ID,
            ContactsContract.Contacts.LOOKUP_KEY,
            ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
        };
        try (Cursor cursor = resolver.query(ContactsContract.Contacts.CONTENT_URI, contactColumns, null, null,
                ContactsContract.Contacts.DISPLAY_NAME_PRIMARY + " ASC")) {
            if (cursor == null) {
                call.reject("The phone's contacts could not be read.");
                return;
            }
            while (cursor.moveToNext()) {
                long id = cursor.getLong(cursor.getColumnIndexOrThrow(ContactsContract.Contacts._ID));
                String lookupKey = text(cursor, ContactsContract.Contacts.LOOKUP_KEY);
                if (lookupKey == null) continue;
                JSObject contact = new JSObject();
                contact.put("lookupKey", lookupKey);
                contact.put("name", text(cursor, ContactsContract.Contacts.DISPLAY_NAME_PRIMARY));
                byId.put(id, contact);
                lists.put(id, new JSArray[] { new JSArray(), new JSArray(), new JSArray() });
            }
        }

        // Addresses, birthdays and notes.
        String[] dataColumns = {
            ContactsContract.Data.CONTACT_ID,
            ContactsContract.Data.MIMETYPE,
            ContactsContract.Data.DATA1,
            ContactsContract.Data.DATA2,
            ContactsContract.Data.DATA3,
        };
        String selection = ContactsContract.Data.MIMETYPE + " IN (?, ?, ?)";
        String[] args = {
            ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE,
            ContactsContract.CommonDataKinds.Event.CONTENT_ITEM_TYPE,
            ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE,
        };
        try (Cursor cursor = resolver.query(ContactsContract.Data.CONTENT_URI, dataColumns, selection, args, null)) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    long contactId = cursor.getLong(cursor.getColumnIndexOrThrow(ContactsContract.Data.CONTACT_ID));
                    JSArray[] contactLists = lists.get(contactId);
                    if (contactLists == null) continue;
                    String mime = text(cursor, ContactsContract.Data.MIMETYPE);
                    String data1 = text(cursor, ContactsContract.Data.DATA1);
                    if (data1 == null || data1.trim().isEmpty()) continue;

                    if (ContactsContract.CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE.equals(mime)) {
                        // DATA1 = formatted address, DATA2 = type, DATA3 = custom label.
                        JSObject address = new JSObject();
                        address.put("formatted", data1);
                        address.put("type", number(cursor, ContactsContract.Data.DATA2));
                        address.put("label", text(cursor, ContactsContract.Data.DATA3));
                        contactLists[0].put(address);
                    } else if (ContactsContract.CommonDataKinds.Event.CONTENT_ITEM_TYPE.equals(mime)) {
                        // DATA1 = start date (text as stored), DATA2 = type.
                        if (number(cursor, ContactsContract.Data.DATA2) == ContactsContract.CommonDataKinds.Event.TYPE_BIRTHDAY) {
                            contactLists[1].put(data1);
                        }
                    } else if (ContactsContract.CommonDataKinds.Note.CONTENT_ITEM_TYPE.equals(mime)) {
                        contactLists[2].put(data1);
                    }
                }
            }
        }

        JSArray contacts = new JSArray();
        for (Map.Entry<Long, JSObject> entry : byId.entrySet()) {
            JSObject contact = entry.getValue();
            JSArray[] contactLists = lists.get(entry.getKey());
            contact.put("addresses", contactLists[0]);
            contact.put("birthdays", contactLists[1]);
            contact.put("notes", contactLists[2]);
            contacts.put(contact);
        }

        JSObject result = new JSObject();
        result.put("contacts", contacts);
        call.resolve(result);
    }
}
