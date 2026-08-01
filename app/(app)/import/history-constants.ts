/**
 * Kept out of actions.ts: a "use server" file may only export async
 * functions, so a plain constant shared with the page and the client list
 * component has to live in its own module.
 */
export const IMPORT_HISTORY_PAGE_SIZE = 5;
