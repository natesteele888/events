# Steele Events

Invitations, RSVPs and wishlists for any event. Anyone can sign in with their email and become a host.
Each host sets the look, gets an access code to share, and sees the guest list and comments in one place.
Guests never need an account.

## How it fits together

```mermaid
flowchart LR
  G[Guest phone] -->|types the code, RSVPs| FS[(Firestore)]
  H[Host<br/>email or Google sign-in] -->|builds events, reads guest list| FS
  FS -. firestore.rules decide<br/>who can do what .- R[firestore.rules]
  P[Firebase Hosting<br/>steele-events.web.app] --> G
  P --> H
  A[GitHub Actions<br/>every hour] -->|finds who's due| FS
  A -->|emails| M[Gmail SMTP]
  M --> G
```

| Who | Can do |
|---|---|
| **Host** (any verified email) | Create events, edit and delete their own, add co-hosts, see their guest list |
| **Co-host** (an email the host adds) | Edit that event and see the guest list. Can't delete it or change co-hosts |
| **Guest** (no login) | Open an invite with the code, RSVP, comment, ask for reminders, change their own RSVP |
| **You** (site owner) | See all hosts on the **Hosts** page and block misuse |

Guests never see each other's answers. The code, capacity, plus-one limits, invite lists and RSVP deadline
are enforced by the database rules, not just the screen.

## How the access code works

The event's details are stored in a document **named after the code**. Nobody can list those documents,
so you can only open it by knowing the code. Before the code, a guest sees only the title, look and host name.
Changing the code renames the document, so old codes stop working right away.

```
events/abc123              owner, co-hosts, code, limits  → host only
events/abc123/public/card  title, colors, background      → anyone with the link
events/abc123/locked/TIGER42  date, place, wishlist       → only if you know TIGER42
events/abc123/rsvps/…      guest answers and emails       → hosts list them; a guest opens only their own
codes/TIGER42              → points to abc123, so a guest can just type the code
```

A simple code keeps out casual visitors, not a determined attacker, because the database has no limit on guesses.
Use **Invite list** for anything sensitive: each guest gets a long private link.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app |
| `config.js` | Firebase settings (public by design) and your owner ID |
| `firestore.rules` | Security rules. Your user ID is on the `isSiteOwner` line |
| `manifest.json`, `sw.js`, `icon-*.png` | Install to phone home screen |
| `scripts/` | The reminder job |
| `.github/workflows/reminders.yml` | Runs the reminder job every hour |
| `.github/workflows/tests.yml` | Runs the rule tests and browser run on every push |
| `tests/` | `rules.test.mjs` (security rules), `e2e.mjs` (full host and guest run) |

## Live address

**https://steele-events.web.app** (Firebase Hosting, free). GitHub Pages stays on only to forward old links.

To publish a change, from this folder: `npx firebase-tools deploy --only hosting --project steele-events`.
Rule changes: `npx firebase-tools deploy --only firestore:rules --project steele-events`.

## Turning on reminders

Automatic reminders need something running on a schedule. Firebase's scheduled functions need the paid Blaze plan,
so this uses a free GitHub Actions schedule instead. The guest list stays in Firebase and nothing personal is stored in GitHub.

1. **Make a sending account.** Create a Gmail just for this (like `steele.events.reminders@gmail.com`), since guests see the address.
   Turn on 2-Step Verification, then create an App Password.
2. **Make a Firebase key.** Firebase console → Project settings → Service accounts → Generate new private key.
   This file is a master key: never put it in the repo or a chat. Delete your download after step 3.
3. **Add three secrets.** GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
   - `FIREBASE_SERVICE_ACCOUNT`: the whole key file's contents
   - `SMTP_USER`: the Gmail address
   - `SMTP_PASS`: the App Password
4. **Test it.** Actions tab → *Send event reminders* → Run workflow. The log shows counts only.

Until the secrets are added, the job does nothing and guests just don't get emails.
GitHub logs on a public repo are public, so the job prints counts and never names or addresses.
Gmail allows about 500 emails a day, which is plenty here.

## Everyday use

- **New event:** Sign in → *＋ New event* → fill it in → tick **Published** → **Save**. The share box gives you the code, a link, a QR code and a ready-to-send message.
- **Guest list:** *Guest list* on any event: headcount, answers, comments, reminder status, search, CSV.
- **Wishlist:** add items with a link, name, price, a short note and an optional photo.
- **Add to calendar:** the guest's calendar file also carries a 1-day alert, separate from emails.

## Limits worth knowing

- Images are resized in the browser and stored with the event (free plan, no Firebase Storage). Scheduled backups aren't on the free plan either.
- A single event holds up to 30 wishlist items.
- If two guests RSVP in the same second, one gets "try again".
- Reminder timing is on the hour-ish: GitHub schedules can run late when it's busy.
- Someone who RSVPs after a reminder's moment has passed doesn't get that one, only later ones.

## Running the tests

Happens automatically on every push (see the Actions tab). To run them yourself from a fresh copy
you need Node 22, Java 21 and Python with Pillow (`pip install pillow`, for the browser run's test image):

```
cd tests
npm install
npx playwright install chromium   # first time only
npm test                          # rule checks, then the full browser run
```

`npm run test:rules` runs only the security rules (77 checks, needs Java). `npm run test:e2e` runs only the
host-and-guest browser run in `tests/e2e.mjs` (38 checks). Both start and stop the Firebase emulators themselves.
