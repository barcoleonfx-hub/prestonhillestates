// When the office mail server can't be reached, the agents pause their emails for 30 minutes instead of retrying
// (and re-checking each email with Claude) every couple of minutes. One server process, so memory is enough.

let downUntil = 0
export const MAIL_DOWN = /password|connect the mailbox|couldn’t reach|ECONN|ETIMEDOUT/i
/** True while the agents should wait before trying the mail server again. */
export const mailPaused = (at = Date.now()) => at < downUntil
/** Notes a failed send; pauses only when the mail server itself is the problem. Returns whether it paused. */
export function noteMailError(error: string, at = Date.now()): boolean {
  if (!MAIL_DOWN.test(error)) return false
  downUntil = at + 30 * 60e3
  return true
}
