import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, writeBatch, deleteDoc, query, where, Timestamp } from "firebase/firestore";
import fs from "node:fs";

const env = await initializeTestEnvironment({
  projectId: "steele-events-test",
  firestore: { rules: fs.readFileSync(process.argv[2], "utf8").replace("PASTE_OWNER_UID", "u_owner"), host: "127.0.0.1", port: 8080 },
});
const owner = env.authenticatedContext("u_owner", { email: "owner@example.com", email_verified: true }).firestore();
const host = env.authenticatedContext("u_host", { email: "coach@example.com", email_verified: true }).firestore();
const cohost = env.authenticatedContext("u_co", { email: "co@example.com", email_verified: true }).firestore();
const stranger = env.authenticatedContext("u_x", { email: "x@example.com", email_verified: true }).firestore();
const fakeOwner = env.authenticatedContext("u_fake", { email: "owner@example.com", email_verified: false }).firestore();
const guest = env.unauthenticatedContext().firestore();

let pass = 0, fail = 0;
async function t(name, p) { try { await p; pass++; console.log("  ✓", name); } catch (e) { fail++; console.log("  ✗", name, "-", e.message.split("\n")[0]); } }
const ev = (o = {}) => ({ title: "Party", ownerUid: "u_host", admins: ["co@example.com"], access: "open", published: true, plusMax: 2, capacity: 10, banner: null, deadline: null, ...o });
await env.withSecurityRulesDisabled(async c => { const f = c.firestore();
  await setDoc(doc(f, "events/draft"), ev({ published: false })); await setDoc(doc(f, "events/draft/meta/count"), { yes: 0 });
  await setDoc(doc(f, "events/full"), ev({ capacity: 3 })); await setDoc(doc(f, "events/full/meta/count"), { yes: 2 });
  await setDoc(doc(f, "events/late"), ev({ deadline: Timestamp.fromMillis(Date.now() - 60000) })); await setDoc(doc(f, "events/late/meta/count"), { yes: 0 });
  await setDoc(doc(f, "events/inv"), ev({ access: "invite" })); await setDoc(doc(f, "events/inv/meta/count"), { yes: 0 });
});

console.log("Hosts");
await t("stranger can request access", assertSucceeds(setDoc(doc(stranger, "hosts/u_x"), { email: "x@example.com", name: "X", status: "pending", requestedAt: 1 })));
await t("stranger cannot self-approve", assertFails(setDoc(doc(stranger, "hosts/u_x2"), { email: "x@example.com", name: "X", status: "approved", requestedAt: 1 })));
await t("stranger cannot create an event", assertFails(setDoc(doc(stranger, "events/s1"), ev({ ownerUid: "u_x" }))));
await t("unverified owner email is not the owner", assertFails(updateDoc(doc(fakeOwner, "hosts/u_x"), { status: "approved" })));
await t("site owner approves a host", assertSucceeds(setDoc(doc(owner, "hosts/u_host"), { email: "coach@example.com", status: "approved" })));
await t("site owner can list requests", assertSucceeds(getDocs(collection(owner, "hosts"))));
await t("host cannot list requests", assertFails(getDocs(collection(host, "hosts"))));

console.log("Events");
await t("approved host creates event", assertSucceeds(setDoc(doc(host, "events/e1"), ev())));
await t("host creates the headcount doc", assertSucceeds(setDoc(doc(host, "events/e1/meta/count"), { yes: 0 })));
await t("host cannot create event owned by someone else", assertFails(setDoc(doc(host, "events/e2"), ev({ ownerUid: "u_other" }))));
await t("oversized banner rejected", assertFails(setDoc(doc(host, "events/e3"), ev({ banner: "x".repeat(950000) }))));
await t("co-host can edit details", assertSucceeds(updateDoc(doc(cohost, "events/e1"), { title: "Party v2" })));
await t("co-host cannot change co-hosts", assertFails(updateDoc(doc(cohost, "events/e1"), { admins: ["co@example.com", "x@example.com"] })));
await t("owner of event can change co-hosts", assertSucceeds(updateDoc(doc(host, "events/e1"), { admins: ["co@example.com"] })));
await t("stranger cannot edit", assertFails(updateDoc(doc(stranger, "events/e1"), { title: "hacked" })));
await t("guest can read published event", assertSucceeds(getDoc(doc(guest, "events/e1"))));
await t("co-host can list their events", assertSucceeds(getDocs(query(collection(cohost, "events"), where("admins", "array-contains", "co@example.com")))));
await t("guest cannot list events", assertFails(getDocs(collection(guest, "events"))));
await t("guest cannot read a draft", assertFails(getDoc(doc(guest, "events/draft"))));

console.log("RSVPs (open event)");
const rsvp = (o = {}) => ({ name: "Sam", attending: true, partySize: 2, answers: { pizza: "Cheese" }, note: "", createdAt: 1, updatedAt: 1, ...o });
async function send(db, e, id, data, newYes) { const b = writeBatch(db); b.set(doc(db, `events/${e}/rsvps/${id}`), data); b.set(doc(db, `events/${e}/meta/count`), { yes: newYes }); return b.commit(); }
await t("guest RSVPs yes for 2 with matching headcount", assertSucceeds(send(guest, "e1", "r_sam_secret", rsvp(), 2)));
await t("guest cannot skip the headcount", assertFails(setDoc(doc(guest, "events/e1/rsvps/r2"), rsvp({ name: "Lee" }))));
await t("guest cannot fake the headcount", assertFails(send(guest, "e1", "r3", rsvp({ name: "Lee" }), 3)));
await t("party bigger than plus-ones allows is rejected", assertFails(send(guest, "e1", "r4", rsvp({ partySize: 4 }), 6)));
await t("guest reads own RSVP by its id", assertSucceeds(getDoc(doc(guest, "events/e1/rsvps/r_sam_secret"))));
await t("guest cannot list other RSVPs", assertFails(getDocs(collection(guest, "events/e1/rsvps"))));
await t("guest edits own RSVP (2 -> 3 people)", assertSucceeds(send(guest, "e1", "r_sam_secret", rsvp({ partySize: 3 }), 3)));
await t("guest changes to no, headcount drops", assertSucceeds(send(guest, "e1", "r_sam_secret", rsvp({ attending: false, partySize: 0 }), 0)));
await t("host lists RSVPs", assertSucceeds(getDocs(collection(host, "events/e1/rsvps"))));
await t("unknown fields rejected", assertFails(send(guest, "e1", "r5", { ...rsvp({ name: "Q" }), admin: true }, 2)));

console.log("Capacity and deadline");
await t("RSVP that would pass capacity is rejected", assertFails(send(guest, "full", "rA", rsvp({ partySize: 2 }), 4)));
await t("RSVP that fits is accepted", assertSucceeds(send(guest, "full", "rB", rsvp({ partySize: 1 }), 3)));
await t("RSVP after the deadline is rejected", assertFails(send(guest, "late", "rC", rsvp({ partySize: 1 }), 1)));
await t("host can still add one after the deadline", assertSucceeds(send(host, "late", "rD", rsvp({ partySize: 1 }), 1)));

console.log("Invite-only");
await t("host adds an invite", assertSucceeds(setDoc(doc(host, "events/inv/invites/inv_abc"), { name: "The Lees", max: 3 })));
await t("guest opens their invite", assertSucceeds(getDoc(doc(guest, "events/inv/invites/inv_abc"))));
await t("guest cannot list invites", assertFails(getDocs(collection(guest, "events/inv/invites"))));
await t("invited guest RSVPs with their invite id", assertSucceeds(send(guest, "inv", "inv_abc", rsvp({ inviteId: "inv_abc" }), 2)));
await t("uninvited guest is rejected", assertFails(send(guest, "inv", "random_id", rsvp({ inviteId: "random_id" }), 4)));

console.log("Clean-up rights");
await t("guest cannot delete an RSVP", assertFails(deleteDoc(doc(guest, "events/e1/rsvps/r_sam_secret"))));
await t("co-host cannot delete the event", assertFails(deleteDoc(doc(cohost, "events/e1"))));
await t("event owner deletes the event", assertSucceeds(deleteDoc(doc(host, "events/e1"))));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
