/**
 * Guided comment prompts (user decision 2026-11-16).
 *
 * Every comment box opens pre-filled with four optional prompt lines.
 * The comment is still stored as ONE plain text (no schema change).
 * When saving, prompt lines left empty are removed, so a comment where
 * nothing was filled in is saved as "no comment". Pure functions.
 *
 * The prompts are in the app's language; empty prompts of EVERY language
 * are removed, so comments written in English and French can be mixed
 * (owner decision 2026-11-21). Saved comments are never rewritten.
 */

import { allMessages, messages } from '../i18n'

/** The prompts in the current language. */
export function commentPrompts(): readonly string[] {
  return messages().commentPrompts
}

/** A new comment box: one empty prompt per line. */
export function commentTemplate(): string {
  return commentPrompts().map((prompt) => `${prompt} `).join('\n')
}

function emptyPrompts(): Set<string> {
  return new Set(allMessages().flatMap((catalogue) => catalogue.commentPrompts.map((prompt) => prompt.toLowerCase())))
}

/**
 * Removes the prompt lines that were left empty (e.g. "Why:" with
 * nothing after it), then trims. Everything the user wrote is kept.
 */
export function cleanComment(text: string): string {
  const empty = emptyPrompts()
  return text
    .split(/\r?\n/)
    .filter((line) => !empty.has(line.trim().toLowerCase()))
    .join('\n')
    .trim()
}

/**
 * What an edit form's comment box shows: the saved comment unchanged,
 * or the empty prompts when there is no comment yet.
 */
export function commentForEditing(saved: string | null): string {
  return saved === null || saved.trim() === '' ? commentTemplate() : saved
}
