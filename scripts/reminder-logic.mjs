// Decides which reminder a guest is due. No I/O, so it can be tested on its own.

// "2026-12-05" + "17:00" in "America/New_York" -> the real moment, in ms.
export function eventStartMs(date, start, tz) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (start || "12:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = t => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(t).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  // Twice, so a daylight-saving change between the guess and the answer still lands right.
  const once = guess - offsetAt(guess);
  return guess - offsetAt(once);
}

const DAY = 86400000;

// Returns { send: days|null, skip: [days...] }.
// send: the one reminder to email now (the closest to the event).
// skip: older reminders that are now pointless and get marked done, so a guest never gets two at once.
export function dueFor({ startMs, days, nowMs, rsvpCreatedMs, sent }) {
  if (nowMs >= startMs) return { send: null, skip: [] };
  const due = [...days].filter(d => !sent.includes(d) && startMs - d * DAY <= nowMs).sort((a, b) => a - b);
  // Someone who RSVPs after a reminder's moment passed doesn't need that one.
  const live = due.filter(d => !rsvpCreatedMs || rsvpCreatedMs <= startMs - d * DAY);
  const send = live.length ? live[0] : null;
  return { send, skip: due.filter(d => d !== send) };
}
