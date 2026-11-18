/** Telegram's own reasons that a chat can NEVER be delivered to again until the person acts: the bot was blocked, the user is deactivated, the chat was deleted or not found, the bot was removed from the group.
 *  A transient failure (timeout, 429, 5xx) is NOT in this list, so a flaky send never unlinks anyone. Used by the alert route to clear a dead link (the Settings status then reads not connected). */
export function isDeadChatReason(why: string): boolean {
  return /bot was blocked by the user|user is deactivated|chat not found|bot was kicked|group chat was deleted|bot is not a member of the (?:channel|supergroup) chat|PEER_ID_INVALID/i.test(why);
}
