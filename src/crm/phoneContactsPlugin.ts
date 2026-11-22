/**
 * Thin wrapper around this app's own Android plugin "ContactsReader"
 * (android/app/src/main/java/com/personaldataanalyst/app/ContactsReaderPlugin.java).
 * Android app only; read only (READ_CONTACTS).
 */

import { registerPlugin } from '@capacitor/core'

import type { PhoneContact } from './phoneContactImport'

export type ContactsPermission = 'granted' | 'denied' | 'prompt'

interface ContactsReaderPluginApi {
  checkPermission(): Promise<{ state: ContactsPermission }>
  requestPermission(): Promise<{ state: ContactsPermission }>
  readContacts(): Promise<{ contacts: unknown[] }>
}

const ContactsReader = registerPlugin<ContactsReaderPluginApi>('ContactsReader')

export async function checkContactsPermission(): Promise<ContactsPermission> {
  return (await ContactsReader.checkPermission()).state
}

/** Shows Android's "Allow access to contacts?" prompt when it may still be shown. */
export async function requestContactsPermission(): Promise<ContactsPermission> {
  return (await ContactsReader.requestPermission()).state
}

/** Reads every contact. The data is checked (src/crm/phoneContactImport.ts) before use. */
export async function readPhoneContacts(): Promise<PhoneContact[]> {
  const { readPhoneContactList } = await import('./phoneContactImport')
  return readPhoneContactList((await ContactsReader.readContacts()).contacts)
}
