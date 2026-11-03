// Full host and guest run in a real browser against the Firebase emulators and the real rules. See .github/workflows/tests.yml.
import { createRequire } from "module"; const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright");
import fs from "node:fs"; import { execSync } from "node:child_process"; import http from "node:http"; import path from "node:path";
const ROOT = process.env.EVENTS_ROOT || process.cwd(), CDN = process.cwd() + "/node_modules", OUT = process.env.OUT_DIR || "/tmp/events-shots"; fs.mkdirSync(OUT, { recursive: true });
http.createServer((q, s) => { const p = decodeURIComponent(new URL(q.url, "http://x").pathname); const f = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript" : "application/octet-stream" }); s.end(fs.readFileSync(f)); }).listen(5050);
const CONFIG = `window.EVENTS_CONFIG={appName:"Steele Events",ownerUid:"none",firebase:{apiKey:"fake",authDomain:"demo-events.firebaseapp.com",projectId:"demo-events",appId:"x"}};`;
const browser = await chromium.launch();
async function ctx(opts = {}) { const c = await browser.newContext({ deviceScaleFactor: 1, ...opts });
  await c.route(/gstatic\.com\/firebasejs\/10\.14\.1\/(.+)/, (r, q) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(`${CDN}/firebase/${q.url().split("/").pop()}`) }));
  await c.route(/cdnjs\.cloudflare\.com.*qrcode/, r => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(`${CDN}/qrcodejs/qrcode.min.js`) }));
  await c.route(/fonts\.g/, r => r.fulfill({ contentType: "text/css", body: "" }));
  await c.route(/config\.js/, r => r.fulfill({ contentType: "text/javascript", body: CONFIG })); return c; }
let pass = 0, fail = 0; const check = (n, ok, x = "") => { ok ? pass++ : fail++; console.log(ok ? "  ✓" : "  ✗", n, ok ? "" : x); };
const errs = []; const watch = p => { p.on("pageerror", e => errs.push(e.message)); return p; };
const phone = { viewport: { width: 390, height: 844 } }, B = "http://127.0.0.1:5050/?emu";
const shot = (p, n, full = false) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: full });

// test image
const py = `from PIL import Image,ImageDraw
im=Image.new('RGB',(2400,1500))
d=ImageDraw.Draw(im)
for y in range(1500): d.line((0,y,2400,y),fill=(20+y//12,40+y//20,120-y//30))
for i in range(40): d.ellipse((i*60,200+i*25%900,i*60+90,290+i*25%900),fill=(255,200-i*3,80+i*3))
im.save('${OUT}/bg.jpg',quality=95)`; fs.writeFileSync(OUT + "/m.py", py); execSync(`python3 ${OUT}/m.py`);

console.log("Host signs up with email");
const hc = await ctx(phone); const h = watch(await hc.newPage());
await h.goto(B); await h.waitForSelector("#gin"); await shot(h, "1-home");
await h.click("#toUp"); await h.fill("#aName", "Pat Host"); await h.fill("#aEmail", "pat@example.com"); await h.fill("#aPass", "secret12"); await h.click("#af button");
await h.waitForSelector("#vDone"); check("new account must verify email first", true);
await h.click("#vDone"); await h.waitForTimeout(500); check("unverified stays out", await h.locator("#vDone").count() === 1);
const oob = await (await fetch("http://127.0.0.1:9099/emulator/v1/projects/demo-events/oobCodes", )).json();
await fetch(oob.oobCodes.find(o => o.email === "pat@example.com" && o.requestType === "VERIFY_EMAIL").oobLink);
await h.click("#vDone"); await h.waitForSelector("text=Your events"); check("verified host reaches the dashboard, no approval step", true);

console.log("Host builds the event");
await h.click("text=＋ New event"); await h.waitForSelector("#title");
const code = await h.inputValue("#code"); check("access code auto-generated", /^[A-Z]+\d{3}$/.test(code), code);
const d = new Date(Date.now() + 6 * 3600e3); const ds = d.toISOString().slice(0, 10);
await h.fill("#title", "Backyard Bash"); await h.fill("#subtitle", "You're invited"); await h.fill("#date", ds); await h.fill("#start", d.toISOString().slice(11, 16)); await h.fill("#location", "Our house"); await h.fill("#address", "1 Main St, Town"); await h.fill("#description", "Bring a chair."); 
check("host name filled from account", await h.inputValue("#hostName") === "Pat Host");
await h.click('[data-p="3"]');
await h.setInputFiles("#banFile", OUT + "/bg.jpg"); await h.waitForFunction(() => document.querySelector("#banprev img")); 
await h.locator("details:has(#wl)").evaluate(e => e.open = true); await h.click("#addW");
await h.fill('[data-wf="title"][data-i="0"]', "Lego set"); await h.fill('[data-wf="url"][data-i="0"]', "https://www.example-store.com/lego"); await h.fill('[data-wf="price"][data-i="0"]', "$40"); await h.fill('[data-wf="note"][data-i="0"]', "The big fire truck one");
await h.setInputFiles('[data-wp="0"]', OUT + "/bg.jpg"); await h.waitForFunction(() => document.querySelector(".wrow .thumb").style.backgroundImage);
await h.click("#addW"); await h.fill('[data-wf="title"][data-i="1"]', "Bad link"); await h.fill('[data-wf="url"][data-i="1"]', "javascript:alert(1)");
await h.check("#published"); await h.click("#save"); await h.waitForTimeout(400);
check("bad wishlist link blocked at save", (await h.locator(".toast").last().innerText()).includes("Check the link"));
await h.click('[data-wx="1"]');
await h.locator("details:has(#qs)").evaluate(e => e.open = true); await h.click("#addQ"); await h.fill('[data-ql="0"]', "Pizza"); await h.fill('[data-qopts="0"]', "Cheese, Pepperoni");
await h.click("#save"); await h.waitForFunction(() => location.hash.startsWith("#edit/")); await h.waitForSelector("#sharebox .linkbox");
const eid = h.url().split("#edit/")[1]; check("event saved and share box shows", !!eid);
const shareText = await h.locator("#sharebox").innerText(); check("share box shows the code", shareText.includes(code));
await shot(h, "2-builder", true);

console.log("Guest: wrong and right code");
const gc = await ctx(phone); const g = watch(await gc.newPage());
await g.goto(`http://127.0.0.1:5050/?e=${eid}&emu`); await g.waitForSelector("#gc");
check("gate shows title, not details", (await g.innerText("body")).includes("Backyard Bash") && !(await g.innerText("body")).includes("1 Main St")); await shot(g, "3-gate");
await g.fill("#gc", "NOPE99"); await g.click("#gb"); await g.waitForSelector("#ge:not([hidden])"); check("wrong code refused", true);
await g.fill("#gc", code.toLowerCase()); await g.click("#gb"); await g.waitForSelector("#rf");
const body = await g.innerText("body"); check("right code (lowercase too) opens details and wishlist", body.includes("1 Main St") && body.includes("Lego set") && body.includes("$40"));
check("wishlist link safe, opens store", (await g.locator("a.item").getAttribute("href")).startsWith("https://www.example-store.com") && (await g.locator("a.item").getAttribute("rel")).includes("noopener"));
await shot(g, "4-invite", true);

console.log("Guest RSVPs with comment and reminder");
await g.fill("#rName", "Ann Guest"); await g.click('[data-att="1"]'); await g.click('[data-qo][data-v="Cheese"]'); await g.click('[data-step="1"]');
await g.fill("#rNote", "Can't wait! <b>nut allergy</b>"); await g.check("#rRemind"); await g.fill("#rEmail", "not-an-email"); await g.click("#rSubmit"); await g.waitForSelector("#rErr:not([hidden])"); check("bad reminder email caught", true);
await g.fill("#rEmail", "ann@example.com"); await g.click("#rSubmit"); await g.waitForSelector(".done");
check("confirmation names the reminder", (await g.innerText(".done")).includes("ann@example.com")); await shot(g, "5-done");
await g.reload(); await g.waitForSelector(".done"); check("returning guest stays signed into their RSVP", true);
const gc2 = await ctx(phone); const g2 = watch(await gc2.newPage());
await g2.goto(B); await g2.waitForSelector("#homeCode"); await g2.fill("#homeCode", code); await g2.click("#codeF button"); await g2.waitForSelector("#rf"); check("guest can type code on the home page", true);
await g2.fill("#rName", "Bo No"); await g2.click('[data-att="0"]'); await g2.click("#rSubmit"); await g2.waitForSelector(".done");

console.log("Host guest list");
await h.goto(`${B}#responses/${eid}`); await h.reload(); await h.waitForSelector(".gcard");
const l = await h.innerText("#main"); check("list shows people, comment, email, reminder", l.includes("Ann Guest") && l.includes("nut allergy") && l.includes("ann@example.com") && l.includes("reminders on") && l.includes("Bo No"));
check("guest HTML is shown as text", await h.locator(".comment b").count() === 0);
check("headcount right", (await h.locator(".stat b").first().innerText()) === "2", await h.locator(".stat b").first().innerText()); await shot(h, "6-guestlist", true);
await h.click('[data-t="comments"]'); check("comments tab filters", await h.locator(".gcard").count() === 1);

console.log("Reminder job");
const env = `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-events REMINDER_DRY_RUN=1 REMINDER_DRY_OUT=${OUT}/mail.jsonl SMTP_USER=test@example.com SITE_URL=http://127.0.0.1:5050/`;
const NM = process.cwd() + "/node_modules"; fs.rmSync(OUT + "/mail.jsonl", { force: true });
const { initializeApp } = require("firebase-admin/app"); const { getFirestore } = require("firebase-admin/firestore");
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"; initializeApp({ projectId: "demo-events" }); const adb = getFirestore();
const rs0 = await adb.collection(`events/${eid}/rsvps`).get(); for (const r of rs0.docs) await r.ref.update({ createdAt: new Date(Date.now() - 10 * 864e5) });
const run = () => execSync(`cp ${ROOT}/scripts/*.mjs ${process.cwd()}/ && ${env} node send-reminders.mjs`).toString();
const o1 = run(); console.log("   ", o1.trim()); check("job log has no names or emails", !/ann|example|Backyard/i.test(o1));
const mails = fs.readFileSync(OUT + "/mail.jsonl", "utf8").trim().split("\n").map(JSON.parse);
check("one email to the opted-in guest only", mails.length === 1 && mails[0].to[0].address === "ann@example.com", JSON.stringify(mails.map(m => m.to)));
const o2 = run(); check("second run sends nothing", /Sent 0/.test(o2));
const stop = mails[0].text.match(/Stop these reminders: (\S+)/)?.[1] || ""; check("email has a stop link", stop.includes("unsub=1"), mails[0].text.slice(0, 300));

console.log("Stop link");
const gc3 = await ctx(phone); const g3 = watch(await gc3.newPage()); await g3.goto(stop.replace("?e=", "?emu&e=")); await g3.waitForSelector(".notice"); check("stop link confirms with no code", (await g3.innerText("body")).includes("Reminders are off"));

console.log("Host changes the code");
await h.goto(`${B}#edit/${eid}`); await h.reload(); await h.waitForSelector("#code"); await h.fill("#code", "ZEBRA7"); await h.click("#save"); await h.waitForTimeout(800);
const gc4 = await ctx(phone); const g4 = watch(await gc4.newPage()); await g4.goto(`http://127.0.0.1:5050/?e=${eid}&c=${code}&emu`); await g4.waitForSelector("#gc"); check("old code link stops opening it", true);
await g4.goto(`http://127.0.0.1:5050/?e=${eid}&c=ZEBRA7&emu`); await g4.waitForSelector("#rf"); check("new code works", true);

console.log("A second host can't take a code; invite list");
const h2c = await ctx(phone); const h2 = watch(await h2c.newPage()); await h2.goto(B); await h2.waitForSelector("#toUp"); await h2.click("#toUp"); await h2.fill("#aEmail", "sue@example.com"); await h2.fill("#aPass", "secret12"); await h2.click("#af button"); await h2.waitForSelector("#vDone");
const o3 = await (await fetch("http://127.0.0.1:9099/emulator/v1/projects/demo-events/oobCodes")).json(); await fetch(o3.oobCodes.find(o => o.email === "sue@example.com").oobLink); await h2.click("#vDone"); await h2.waitForSelector("text=Your events");
await h2.click("text=＋ New event"); await h2.waitForSelector("#title"); await h2.fill("#title", "Sue Party"); await h2.fill("#date", ds); await h2.fill("#code", "ZEBRA7"); await h2.click("#save"); await h2.waitForTimeout(500);
check("taken code refused", (await h2.locator(".toast").last().innerText()).includes("taken"));
await h2.click('#access [data-v="invite"]'); check("code hidden for invite list", await h2.locator("#code").count() === 0); await h2.check("#published"); await h2.click("#save"); await h2.waitForFunction(() => location.hash.startsWith("#edit/")); const e2 = h2.url().split("#edit/")[1]; await h2.waitForSelector("#invNames");
await h2.fill("#invNames", "The Lees"); await h2.click("#invForm button"); await h2.waitForSelector("[data-icopy]"); const iid = await h2.locator("[data-icopy]").getAttribute("data-icopy");
const g5c = await ctx(phone); const g5 = watch(await g5c.newPage()); await g5.goto(`http://127.0.0.1:5050/?e=${e2}&emu`); await g5.waitForSelector(".notice"); check("invite-only without a link shows notice", (await g5.innerText("body")).includes("personal link"));
await g5.goto(`http://127.0.0.1:5050/?e=${e2}&i=${iid}&emu`); await g5.waitForSelector("#rf"); check("personal link opens, name filled", await g5.inputValue("#rName") === "The Lees"); await g5.click('[data-att="1"]'); await g5.click("#rSubmit"); await g5.waitForSelector(".done"); check("invited guest RSVPs", true);

console.log("Hostile event data can't run on the page");
const X = `"><img src=x onerror="window.__pwn=1">`;
await adb.doc("events/evil").set({ title: X, code: "EVIL11", published: true, access: "code", ownerUid: "z", admins: [], plusMax: 1, capacity: 0 });
await adb.doc("events/evil/public/card").set({ title: X, subtitle: X, hostName: X, access: "code", openCode: "EVIL11", imageMode: "page", image: `data:image/png;base64,A');background:url(x);--x:('`, theme: { primary: `red;"><img src=x onerror="window.__pwn=1">`, accent: X, bg: X, text: X, font: X } });
await adb.doc("events/evil/locked/EVIL11").set({ location: X, address: X, description: X, plusMax: 1, capacity: 0, timeline: [{ time: X, label: X }], questions: [{ id: X, label: X, type: "choice", options: [X] }], wishlistTitle: X, wishlist: [{ title: X, url: "javascript:window.__pwn=1", price: X, note: X, image: X }], date: "2030-01-01", start: "" });
const gxc = await ctx(phone); const gx = watch(await gxc.newPage()); await gx.goto(`http://127.0.0.1:5050/?e=evil&emu`); await gx.waitForSelector(".item"); await gx.waitForTimeout(400); await gx.click('[data-att="1"]'); await gx.waitForTimeout(300);
check("no script ran", !(await gx.evaluate(() => window.__pwn))); check("javascript: wishlist link isn't a link", await gx.locator("a.item").count() === 0);

console.log("Delete cleans everything");
await h.goto(`${B}#edit/${eid}`); await h.reload(); await h.waitForSelector("#del"); await h.click("#del"); await h.click("#del"); await h.waitForFunction(() => !location.hash.includes("edit"));
const left = await adb.collection(`events/${eid}/rsvps`).get(); const cd = await adb.doc("codes/ZEBRA7").get(); check("guest answers and code removed", left.empty && !cd.exists);

console.log("Phone layout"); for (const [n, p] of [["host", h], ["guest", g]]) { const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); check(`${n}: no sideways scroll`, over <= 0, over); }
check("no page errors", errs.length === 0, errs.join(" | ").slice(0, 400));
console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); process.exit(fail ? 1 : 0);
