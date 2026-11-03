// Sends due reminder emails. Runs on a schedule from GitHub Actions (.github/workflows/reminders.yml).
// The run logs are public, so this prints counts only: never names, emails or event details.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import nodemailer from "nodemailer";
import { eventStartMs, dueFor } from "./reminder-logic.mjs";

const E = process.env, DRY = E.REMINDER_DRY_RUN === "1";
const SITE = (E.SITE_URL || "https://natesteele888.github.io/events/").replace(/\/?$/, "/");
const APP = "Steele Events";
const FROM = E.SMTP_USER;
if (E.FIRESTORE_EMULATOR_HOST) initializeApp({ projectId: E.GCLOUD_PROJECT || "steele-events-test" });
else initializeApp({ credential: cert(JSON.parse(E.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();
const transport = DRY ? nodemailer.createTransport({ jsonTransport: true })
  : nodemailer.createTransport({ host: E.SMTP_HOST || "smtp.gmail.com", port: +(E.SMTP_PORT || 465), secure: (E.SMTP_PORT || "465") === "465", auth: { user: E.SMTP_USER, pass: E.SMTP_PASS } });

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function when(date, start, end) {
  const d = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const t = s => { const [h, m] = s.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  return d + (start ? ` at ${t(start)}` : "") + (start && end ? ` to ${t(end)}` : "");
}
// Worded from the real time left, since a late RSVP or a delayed run can shift it from the chosen reminder.
const leadFor = startMs => { const d = Math.round((startMs - Date.now()) / 86400000); return d <= 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`; };

function buildEmail({ ev, card, lock, rsvp, rsvpId, eid, startMs, to }) {
  const lead = leadFor(startMs);
  const q = rsvp.inviteId ? `&i=${rsvpId}` : `&r=${rsvpId}&c=${ev.code}`;
  const link = `${SITE}?e=${eid}${q}`, stop = `${SITE}?e=${eid}&r=${rsvpId}&unsub=1`;
  const whenText = lock.date ? when(lock.date, lock.start, lock.end) : "";
  const place = [lock.location, lock.address].filter(Boolean).join(", ");
  const color = /^#[0-9a-fA-F]{6}$/.test(card.theme?.primary || "") ? card.theme.primary : "#1D3FD1";
  const hasWish = (lock.wishlist || []).length > 0;
  const text = [`${lead}: ${card.title}`, "", `Hi ${rsvp.name},`, "", `Here's your reminder.`, whenText && `When: ${whenText}`, place && `Where: ${place}`, rsvp.partySize && `Your group: ${rsvp.partySize}`, "", `See the invitation or change your RSVP: ${link}`, hasWish ? "The wishlist is on the invitation too." : "", "", `Stop these reminders: ${stop}`].filter(l => l !== false && l !== 0 && l !== undefined).join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1a1a1a"><div style="background:${color};color:#fff;padding:20px;border-radius:12px 12px 0 0"><div style="font-size:13px;letter-spacing:.1em;text-transform:uppercase">${lead}</div><div style="font-size:26px;font-weight:bold">${esc(card.title)}</div></div>
<div style="border:1px solid #ddd;border-top:0;border-radius:0 0 12px 12px;padding:20px"><p>Hi ${esc(rsvp.name)}, here's your reminder.</p>
${whenText ? `<p><b>When:</b> ${esc(whenText)}</p>` : ""}${place ? `<p><b>Where:</b> ${esc(place)}</p>` : ""}${rsvp.partySize ? `<p><b>Your group:</b> ${rsvp.partySize}</p>` : ""}
<p><a href="${esc(link)}" style="display:inline-block;background:${color};color:#fff;padding:11px 18px;border-radius:9px;text-decoration:none;font-weight:bold">Open the invitation</a></p>
${hasWish ? `<p>The wishlist is on the invitation too.</p>` : ""}
<p style="font-size:12px;color:#777;margin-top:24px">You asked for this reminder when you RSVP'd${card.hostName ? ` to ${esc(card.hostName)}'s event` : ""}. <a href="${esc(stop)}" style="color:#777">Stop these reminders</a></p></div></div>`;
  return { from: `"${APP}" <${FROM || "reminders@example.com"}>`, to, subject: `${lead}: ${card.title}`, text, html, headers: { "List-Unsubscribe": `<${stop}>` } };
}

const now = Date.now();
let sent = 0, failed = 0, eventsDue = 0;
const events = await db.collection("events").where("published", "==", true).select("code", "date", "start", "tz", "reminders").get();
for (const eSnap of events.docs) {
  const ev = eSnap.data(), eid = eSnap.id;
  if (!ev.reminders?.on || !ev.date || !(ev.reminders.days || []).length) continue;
  const startMs = eventStartMs(ev.date, ev.start, ev.tz);
  const maxLead = Math.max(...ev.reminders.days) * 86400000;
  if (now >= startMs || now < startMs - maxLead) continue;
  const rsvps = await eSnap.ref.collection("rsvps").where("remind", "==", true).where("attending", "==", true).get();
  if (rsvps.empty) continue;
  eventsDue++;
  const logRef = eSnap.ref.collection("reminderLog");
  const [cardS, lockS] = await Promise.all([eSnap.ref.collection("public").doc("card").get(), eSnap.ref.collection("locked").doc(ev.code).get()]);
  const card = cardS.data() || {}, lock = lockS.data() || {};
  for (const r of rsvps.docs) {
    const rsvp = r.data(); if (!rsvp.email) continue;
    const logs = await Promise.all(ev.reminders.days.map(d => logRef.doc(`${r.id}_${d}`).get()));
    const already = ev.reminders.days.filter((d, i) => logs[i].exists);
    const { send, skip } = dueFor({ startMs, days: ev.reminders.days, nowMs: now, rsvpCreatedMs: rsvp.createdAt?.toMillis?.() || 0, sent: already });
    for (const d of skip) await logRef.doc(`${r.id}_${d}`).set({ at: FieldValue.serverTimestamp(), skipped: true });
    if (send == null) continue;
    try {
      // Mark first: if this crashes between the two steps a guest misses one reminder instead of getting one every hour.
      await logRef.doc(`${r.id}_${send}`).create({ at: FieldValue.serverTimestamp() });
      const mail = buildEmail({ ev, card, lock, rsvp, rsvpId: r.id, eid, startMs, to: rsvp.email });
      const info = await transport.sendMail(mail);
      if (DRY && E.REMINDER_DRY_OUT) { const fs = await import("node:fs"); fs.appendFileSync(E.REMINDER_DRY_OUT, info.message + "\n"); }
      sent++;
    } catch { failed++; }
  }
}
console.log(`Checked ${events.size} events, ${eventsDue} with reminders due. Sent ${sent}, failed ${failed}.`);
process.exit(failed && !sent ? 1 : 0);
