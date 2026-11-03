import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, writeBatch, deleteDoc, query, where, Timestamp, serverTimestamp } from "firebase/firestore";
import fs from "node:fs";

const env = await initializeTestEnvironment({
  projectId: "steele-events-test",
  firestore: { rules: fs.readFileSync(process.argv[2], "utf8").replace("PASTE_OWNER_UID", "u_owner"), host: "127.0.0.1", port: 8080 },
});
const ctx = (uid, email, v = true) => env.authenticatedContext(uid, { email, email_verified: v }).firestore();
const owner = ctx("u_owner", "owner@example.com");
const host = ctx("u_host", "coach@example.com");
const cohost = ctx("u_co", "co@example.com");
const stranger = ctx("u_x", "x@example.com");
const unverified = ctx("u_new", "new@example.com", false);
const fakeCo = ctx("u_fake", "co@example.com", false);
const blocked = ctx("u_bad", "bad@example.com");
const guest = env.unauthenticatedContext().firestore();

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { fail++; console.log("  ✗", name, "-", e.message.split("\n")[0]); } }
const ok = (name, p) => t(name, () => assertSucceeds(p));
const no = (name, p) => t(name, () => assertFails(p));

const ev = (o = {}) => ({ title: "Party", ownerUid: "u_host", admins: ["co@example.com"], access: "code", code: "TIGER42", published: true, plusMax: 2, capacity: 10, deadline: null, ...o });
const theme = { primary: "#0B1D5E", accent: "#3A63FF", bg: "#E9F0FF", text: "#14224F" };
const card = (o = {}) => ({ title: "Party", theme, image: null, ...o });
function createAll(db, id, e = ev(), code = e.code) {
  const b = writeBatch(db);
  b.set(doc(db, `events/${id}`), e); b.set(doc(db, `events/${id}/public/card`), card());
  b.set(doc(db, `events/${id}/locked/${code}`), { location: "Secret place", wishlist: [] });
  b.set(doc(db, `events/${id}/meta/count`), { yes: 0 }); b.set(doc(db, `codes/${code}`), { e: id });
  return b.commit();
}
await env.withSecurityRulesDisabled(async c => { const f = c.firestore();
  for (const [id, o] of [["draft", { published: false, code: "DRAFT1" }], ["full", { capacity: 3, code: "FULL11" }], ["late", { deadline: Timestamp.fromMillis(Date.now() - 60000), code: "LATE11" }], ["inv", { access: "invite", code: "INVITE123456" }]]) {
    const e = ev(o); await setDoc(doc(f, `events/${id}`), e); await setDoc(doc(f, `events/${id}/public/card`), card()); await setDoc(doc(f, `events/${id}/locked/${e.code}`), { location: "x" });
    await setDoc(doc(f, `events/${id}/meta/count`), { yes: id === "full" ? 2 : 0 }); await setDoc(doc(f, `codes/${e.code}`), { e: id });
  }
  await setDoc(doc(f, "hosts/u_bad"), { email: "bad@example.com", status: "blocked" });
  await setDoc(doc(f, "events/late/rsvps/r_late"), { name: "L", attending: false, partySize: 0, email: "l@example.com", remind: true, code: "LATE11", updatedAt: 1 });
});

console.log("Becoming a host");
await ok("verified email can create an event with no approval", createAll(host, "e1"));
await no("unverified email cannot create an event", createAll(unverified, "n1", ev({ ownerUid: "u_new", code: "NEWONE" })));
await no("blocked host cannot create an event", createAll(blocked, "b1", ev({ ownerUid: "u_bad", code: "BADONE" })));
await ok("host can add themselves to the directory", setDoc(doc(stranger, "hosts/u_x"), { email: "x@example.com", name: "X", status: "active", createdAt: 1 }));
await no("host cannot unblock themselves", updateDoc(doc(blocked, "hosts/u_bad"), { status: "active" }));
await no("host cannot delete their block", deleteDoc(doc(blocked, "hosts/u_bad")));
await ok("site owner can list hosts", getDocs(collection(owner, "hosts")));
await no("host cannot list hosts", getDocs(collection(host, "hosts")));
await no("cannot create an event owned by someone else", createAll(host, "e2", ev({ ownerUid: "u_other", code: "OTHER1" })));

console.log("Host-only settings stay private");
await no("guest cannot read event settings (owner, co-host emails, code)", getDoc(doc(guest, "events/e1")));
await no("stranger cannot read event settings", getDoc(doc(stranger, "events/e1")));
await ok("host reads event settings", getDoc(doc(host, "events/e1")));
await ok("co-host reads event settings", getDoc(doc(cohost, "events/e1")));
await no("unverified account using a co-host's email gets nothing", getDoc(doc(fakeCo, "events/e1")));
await no("guest cannot list events", getDocs(collection(guest, "events")));
await ok("co-host lists their events", getDocs(query(collection(cohost, "events"), where("admins", "array-contains", "co@example.com"))));
await ok("co-host can edit details", updateDoc(doc(cohost, "events/e1"), { title: "Party v2" }));
await no("co-host cannot change co-hosts", updateDoc(doc(cohost, "events/e1"), { admins: ["co@example.com", "x@example.com"] }));
await no("stranger cannot edit", updateDoc(doc(stranger, "events/e1"), { title: "hacked" }));

console.log("Access code");
await ok("guest sees the gate card", getDoc(doc(guest, "events/e1/public/card")));
await no("guest cannot read a draft's card", getDoc(doc(guest, "events/draft/public/card")));
await no("wrong code opens nothing", getDoc(doc(guest, "events/e1/locked/WRONG1")));
await ok("right code opens the details", getDoc(doc(guest, "events/e1/locked/TIGER42")));
await no("guest cannot list locked docs to find the code", getDocs(collection(guest, "events/e1/locked")));
await no("right code on a draft opens nothing", getDoc(doc(guest, "events/draft/locked/DRAFT1")));
await ok("guest can look up a code", getDoc(doc(guest, "codes/TIGER42")));
await no("guest cannot list codes", getDocs(collection(guest, "codes")));
await no("another host cannot take a used code", (async () => { const b = writeBatch(stranger); b.set(doc(stranger, "events/s1"), ev({ ownerUid: "u_x" })); b.set(doc(stranger, "codes/TIGER42"), { e: "s1" }); await b.commit(); })());
await no("stranger cannot delete someone's code", deleteDoc(doc(stranger, "codes/TIGER42")));
await no("bad code format rejected", createAll(host, "e4", ev({ code: "no spaces" })));
await ok("host changes the code", (async () => { const b = writeBatch(host);
  b.update(doc(host, "events/e1"), { code: "LION77" }); b.delete(doc(host, "events/e1/locked/TIGER42")); b.set(doc(host, "events/e1/locked/LION77"), { location: "Secret place" });
  b.delete(doc(host, "codes/TIGER42")); b.set(doc(host, "codes/LION77"), { e: "e1" }); await b.commit(); })());
await no("old code stops working", getDoc(doc(guest, "events/e1/locked/TIGER42")));

console.log("Look: nothing dangerous can reach guests");
await no("non-color theme value rejected", setDoc(doc(host, "events/e1/public/card"), card({ theme: { ...theme, primary: "red;}</style><script>" } })));
await no("non-image background rejected", setDoc(doc(host, "events/e1/public/card"), card({ image: "javascript:alert(1)" })));
await no("image with injected text rejected", setDoc(doc(host, "events/e1/public/card"), card({ image: "data:image/png;base64,AA');x:url('" })));
await no("oversized background rejected", setDoc(doc(host, "events/e1/public/card"), card({ image: "data:image/png;base64," + "A".repeat(950000) })));
await ok("real background accepted", setDoc(doc(host, "events/e1/public/card"), card({ image: "data:image/jpeg;base64,AAAA" })));
await no("stranger cannot change the look", setDoc(doc(stranger, "events/e1/public/card"), card()));
await no("stranger cannot change the details", setDoc(doc(stranger, "events/e1/locked/LION77"), { wishlist: [] }));
await no("wishlist over 40 items rejected", setDoc(doc(host, "events/e1/locked/LION77"), { wishlist: Array(41).fill({ title: "x" }) }));

console.log("RSVPs");
const rsvp = (o = {}) => ({ name: "Sam", attending: true, partySize: 2, answers: {}, note: "", code: "LION77", createdAt: 1, updatedAt: serverTimestamp(), ...o });
async function send(db, e, id, data, newYes) { const b = writeBatch(db); b.set(doc(db, `events/${e}/rsvps/${id}`), data); b.set(doc(db, `events/${e}/meta/count`), { yes: newYes, by: id }); return b.commit(); }
await ok("guest RSVPs with the code", send(guest, "e1", "r_sam", rsvp(), 2));
await no("guest without the code is rejected", send(guest, "e1", "r_no", rsvp({ code: "WRONG1" }), 4));
await no("guest cannot skip the headcount", setDoc(doc(guest, "events/e1/rsvps/r2"), rsvp({ name: "Lee" })));
await no("guest cannot fake the headcount", send(guest, "e1", "r3", rsvp({ name: "Lee" }), 3));
await no("headcount cannot change without a real RSVP", setDoc(doc(guest, "events/e1/meta/count"), { yes: 0, by: "r_sam" }));
await no("party bigger than allowed rejected", send(guest, "e1", "r4", rsvp({ partySize: 4 }), 6));
await no("reminder without an email rejected", send(guest, "e1", "r6", rsvp({ remind: true }), 4));
await ok("guest opts into reminders with an email", send(guest, "e1", "r_rem", rsvp({ name: "Ann", partySize: 1, email: "ann@example.com", remind: true }), 3));
await ok("guest reads own RSVP by its key", getDoc(doc(guest, "events/e1/rsvps/r_sam")));
await no("guest cannot list RSVPs (names, emails, comments)", getDocs(collection(guest, "events/e1/rsvps")));
await no("stranger cannot list RSVPs", getDocs(collection(stranger, "events/e1/rsvps")));
await ok("guest edits own RSVP", send(guest, "e1", "r_sam", rsvp({ partySize: 3 }), 4));
await ok("guest changes to no, headcount drops", send(guest, "e1", "r_sam", rsvp({ attending: false, partySize: 0 }), 1));
await ok("host sees the guest list and comments", getDocs(collection(host, "events/e1/rsvps")));
await ok("co-host sees the guest list", getDocs(collection(cohost, "events/e1/rsvps")));
await no("unknown fields rejected", send(guest, "e1", "r5", { ...rsvp({ name: "Q" }), admin: true }, 3));

console.log("Reminders");
await ok("guest stops reminders from the email link", updateDoc(doc(guest, "events/e1/rsvps/r_rem"), { remind: false, updatedAt: serverTimestamp() }));
await ok("stopping reminders still works after the deadline", updateDoc(doc(guest, "events/late/rsvps/r_late"), { remind: false, updatedAt: serverTimestamp() }));
await no("that shortcut can't change anything else", updateDoc(doc(guest, "events/late/rsvps/r_late"), { remind: false, name: "Changed" }));
await no("guest cannot read the reminder log", getDoc(doc(guest, "events/e1/reminderLog/x")));
await no("host cannot write the reminder log", setDoc(doc(host, "events/e1/reminderLog/x"), { at: 1 }));

console.log("Capacity and deadline");
await no("RSVP past capacity rejected", send(guest, "full", "rA", rsvp({ partySize: 2, code: "FULL11" }), 4));
await ok("RSVP that fits accepted", send(guest, "full", "rB", rsvp({ partySize: 1, code: "FULL11" }), 3));
await no("RSVP after the deadline rejected", send(guest, "late", "rC", rsvp({ partySize: 1, code: "LATE11" }), 1));
await ok("host can still add one after the deadline", send(host, "late", "rD", rsvp({ partySize: 1, code: "LATE11" }), 1));

console.log("Invite-only");
await ok("host adds an invite", setDoc(doc(host, "events/inv/invites/inv_abc"), { name: "The Lees", max: 3, code: "INVITE123456" }));
await ok("guest opens their invite", getDoc(doc(guest, "events/inv/invites/inv_abc")));
await no("guest cannot list invites", getDocs(collection(guest, "events/inv/invites")));
await ok("invited guest RSVPs", send(guest, "inv", "inv_abc", (({ code, ...x }) => x)(rsvp({ inviteId: "inv_abc" })), 2));
await no("knowing the code isn't enough for invite-only", send(guest, "inv", "rand", rsvp({ code: "INVITE123456", inviteId: "rand" }), 4));

console.log("Clean-up rights");
await no("guest cannot delete an RSVP", deleteDoc(doc(guest, "events/e1/rsvps/r_sam")));
await no("co-host cannot delete the event", deleteDoc(doc(cohost, "events/e1")));
await ok("host removes RSVPs and details", (async () => { const b = writeBatch(host); for (const p of ["rsvps/r_sam", "rsvps/r_rem", "public/card", "locked/LION77", "meta/count"]) b.delete(doc(host, `events/e1/${p}`)); b.delete(doc(host, "codes/LION77")); await b.commit(); })());
await ok("host deletes the event", deleteDoc(doc(host, "events/e1")));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
