// Reminder job limits, run against the Firestore emulator with REMINDER_DRY_RUN (no email leaves).
// Run: npm run test:reminders
import { createRequire } from "module"; const require = createRequire(process.cwd() + "/");
import fs from "node:fs"; import { execSync } from "node:child_process"; import path from "node:path";
const { initializeApp } = require("firebase-admin/app"); const { getFirestore } = require("firebase-admin/firestore");
const ROOT = process.env.EVENTS_ROOT || path.resolve(process.cwd(), ".."), OUT = "/tmp/events-reminders"; fs.mkdirSync(OUT, { recursive: true });
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
initializeApp({ projectId: "demo-events" }); const db = getFirestore();

let pass = 0, fail = 0; const check = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(ok ? "  ✓" : "  ✗", n, ok ? "" : x); };

// Two events starting in 6 hours, each with 5 guests who asked for the 1-day reminder.
const start = new Date(Date.now() + 6 * 3600e3);
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(start).reduce((a, p) => (a[p.type] = p.value, a), {});
async function seed(id, ownerUid = "u_host") {
  const code = id.toUpperCase() + "1";
  await db.doc(`events/${id}`).set({ title: "T", ownerUid, admins: [], access: "code", code, published: true, plusMax: 2, capacity: 0,
    date: `${fmt.year}-${fmt.month}-${fmt.day}`, start: `${fmt.hour}:${fmt.minute}`, tz: "America/New_York", reminders: { on: true, days: [1] } });
  await db.doc(`events/${id}/public/card`).set({ title: "T", theme: { primary: "#112233" } });
  await db.doc(`events/${id}/locked/${code}`).set({ location: "x" });
  for (let i = 0; i < 5; i++) await db.doc(`events/${id}/rsvps/${id}_r${i}`).set({ name: "G", attending: true, partySize: 1, email: `g${i}@example.com`, remind: true, code, createdAt: new Date(Date.now() - 10 * 864e5) });
}
for (const id of ["capA", "capB"]) await seed(id);

fs.rmSync(OUT + "/mail.jsonl", { force: true });
const env = `FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST} GCLOUD_PROJECT=demo-events REMINDER_DRY_RUN=1 REMINDER_DRY_OUT=${OUT}/mail.jsonl SMTP_USER=test@example.com REMINDER_MAX_PER_EVENT=3 REMINDER_MAX_PER_RUN=4`;
// Same as the browser run: copy the job next to the installed packages (the copies are gitignored).
const run = () => execSync(`cp ${ROOT}/scripts/*.mjs ${process.cwd()}/ && ${env} node send-reminders.mjs`).toString();
const sentTo = () => fs.existsSync(OUT + "/mail.jsonl") ? fs.readFileSync(OUT + "/mail.jsonl", "utf8").trim().split("\n").map(l => JSON.parse(l).to[0].address) : [];
const perEvent = async () => Object.fromEntries(await Promise.all(["capA", "capB"].map(async id => [id, (await db.collection(`events/${id}/reminderLog`).get()).docs.filter(d => !d.data().skipped).length])));

console.log("Limits (per event 3, per run 4)");
const o1 = run(); console.log("   ", o1.trim().replace(/\n/g, "\n    "));
let n = await perEvent();
check("first run stops at the run limit", sentTo().length === 4, sentTo().length);
check("no event goes past its limit", n.capA <= 3 && n.capB <= 3, JSON.stringify(n));
check("log says the run limit was reached", /run limit \(4\) reached/.test(o1), o1);
check("log has counts only, no addresses", !/@|example/.test(o1));
const o2 = run(); console.log("   ", o2.trim().replace(/\n/g, "\n    "));
n = await perEvent();
check("second run tops both events up to their limit", n.capA === 3 && n.capB === 3 && sentTo().length === 6, JSON.stringify(n));
check("log says events hit the per-event limit", /2 events at the per-event limit/.test(o2), o2);
const o3 = run();
check("third run sends nothing more", /Sent 0/.test(o3) && sentTo().length === 6, o3);

console.log("Blocked host");
await db.doc("hosts/u_bad").set({ email: "bad@example.com", status: "blocked" }); await seed("capC", "u_bad");
const o4 = run(); console.log("   ", o4.trim().replace(/\n/g, "\n    "));
check("a blocked host's event sends nothing", /Sent 0/.test(o4) && sentTo().length === 6, o4);
check("log counts the blocked event", /Skipped 1 events whose host is blocked/.test(o4), o4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
