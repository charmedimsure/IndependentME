# IndependentME

Two apps and one small backend.

| File | Runs on | Job |
|---|---|---|
| `independentme.html` | Karelynn's Android tablet | Her day, her reminders, her messages |
| `care.html` | Your phone | Set everything up, watch the day, write back |
| `worker.js` + `schema.sql` | Cloudflare | Keeps the two in sync |

---

## 1. Backend

```bash
wrangler d1 create independentme-db
# copy the database_id it prints into wrangler.toml

wrangler d1 execute independentme-db --remote --file=./schema.sql
wrangler deploy
```

`wrangler.toml`:

```toml
name = "independentme"
main = "worker.js"
compatibility_date = "2026-01-01"

[triggers]
crons = ["* * * * *"]

[[d1_databases]]
binding = "DB"
database_name = "independentme-db"
database_id = "PASTE_ID_HERE"
```

Note the deployed URL, something like `https://independentme.your-account.workers.dev`.

## 2. Front ends

The `docs` folder holds everything the browser needs:

```
docs/
├── index.html            ← independentme.html, renamed
├── care.html
├── sw.js
├── manifest.json
├── manifest-care.json
├── icon-192.png
├── icon-512.png
├── icon-care-192.png
└── icon-care-512.png
```

The manifests and service worker are what make both apps properly installable — a real icon on the home screen, opening full screen with no browser chrome, and still opening when the wifi is down. There's an **Add to the home screen** button in each app's setup.

## 3. Pick two codes

- **Household code** — both apps use it. Something like `karelynn-home-7f3a`.
- **Caregiver key** — your phone only. Long, private, not reused anywhere.

## 4. Set up your phone first

Open `care.html`, go to Setup, enter the worker address, household code, and caregiver key, then Save. That writes the starter routine to the database. Edit the tasks, add yourself and anyone else as a person she can message, adjust the phrases.

## 5. Then the tablet

Open `independentme.html`, hold the faint gear in the top corner for about a second, enter the worker address and household code, and Save. It pulls everything down. Then Chrome menu → Add to Home Screen.

On the tablet: turn on notifications, keep it plugged in, and consider Settings → Display → Screen timeout → longest available, plus Digital Wellbeing off so nothing interrupts.

## The four of you

Everyone shares one caregiver key. The difference between you is which name your device claims, picked once in Setup. Anyone with the key could claim to be anyone — for four family members that's fine, but it's a name tag, not a login.

**Adding the others.** Add Seth, Shelby, and Nan as people in Setup (they double as the faces she picks from when messaging). Give each one their own ntfy topic. Then use **Copy an invite link**, which produces a URL with everything pre-filled including their name, and send it to them privately. They open it once and they're set up. Nan never types a worker address.

The link contains the caregiver key, so send it person to person, not to a group chat.

**One thread.** Every message, reply, and alert is visible to all four of you, tagged with who sent it. If Shelby has already answered, you'll see it and won't double up.

**Help goes where she aimed it.** When she taps "I need help", the tablet asks *who* — she picks a face, and that person's phone buzzes. Anyone can tap **I've got this**, which tells the others and puts "Nan is coming" on her tablet, spoken out loud, so she knows the request landed.

**Schedules.** Each person has hours they can't be reached — Seth's shift, Shelby's shift, Nan's school day. During those hours she simply isn't offered that person, because an ask that goes unanswered is worse than a shorter list. There's also a manual **Right now** toggle for a meeting or a day off.

At least one person must be marked **always shown**, so she can never open the help screen and find it empty. That person also gets the routine nudges.

**Keeping Nan off the ladder.** Anyone can be excluded from being chased for unanswered help requests — worth doing for a teenager in class. She can still be asked directly; she just won't get the urgent all-hands buzz. Since Nan shares a room, give her a two-minute grace instead of ten: if she hasn't answered by then she's asleep or out, and it should move to you.

**If nobody answers.** A cron job checks every minute. If a help request goes unclaimed past the grace period (default 10 minutes, set in Setup), it opens up to all four topics at urgent priority. She never loses a request because the person she picked had their phone in a purse.

## Optional: alerts on your phone when she messages

Install **ntfy** (free, Play Store or App Store), subscribe to a made-up topic name like `karelynn-msgs-9x4f`, and put that same topic in Setup → Phone alerts. The worker pushes her messages to it, so you get buzzed even when `care.html` is closed.

Anyone can subscribe to an ntfy topic if they guess the name, so make it long and random and don't put anything private in the phrase list.

---

## Weather and getting dressed

Set her location in Setup → Weather (Lancaster is pre-filled). Forecast comes from Open-Meteo, which is free and needs no account.

A weather strip sits at the top of her day: icon, temperature, and a spoken button. The forecast is deliberately quiet — it only says something when it would change what she puts on. Rain coming, a fourteen-degree drop later, a hard freeze. A warning she gets every single morning stops being a warning.

**Kinds of clothing, not specific garments.** It ships ready to use with twelve categories — coat, sweater, raincoat, t-shirt, long sleeves, shorts, pants, sneakers, boots, sandals, hat and gloves, umbrella — each with a temperature range. Nothing to set up.

This is deliberate. Naming her actual green coat means the app can send her looking for something that's in the wash, and being told to find a specific thing that isn't there is worse than no help at all. "A sweater" is satisfiable by whatever sweater is clean.

Adjust the temperature ranges to suit her; if she runs cold, push the coat up to 55. Photos are optional per item and are best kept general — a pile of folded t-shirts rather than one particular shirt.

Then mark a task as the dressing one and its button becomes **Pick clothes** instead of a checkmark. That screen shows the weather big, a red banner if there's something to know, and only the clothes that suit today's temperature, grouped into coat / shirt / pants / shoes. She taps what she wants and hits **I'm dressed**.

She picks. The app narrows the closet, which is the genuinely hard part, and leaves the choosing to her. Her picks aren't reported back to you.

## If the voice doesn't work

Tablet setup has a **Test the voice** button. If you hear nothing:

- Check the tablet's media volume, not just the ringer
- Settings → Accessibility → Text-to-speech output. If nothing's listed, install **Google Text-to-speech** from the Play Store
- Android won't speak until the screen has been touched once, which is handled automatically, but it does mean the very first prompt after a restart can be silent

Speech rate is adjustable from the tablet as well as the care app. Hearing loss is common with Down syndrome and often undetected, so slower and louder is usually the right call.

## Checking in on her

Two buttons in the caregiver app's Messages tab.

**Ask to see her** puts a full-screen prompt on her tablet with your name and photo on it, and three choices: send a picture, start a video call, or not right now. If she sends a picture, it appears as a thumbnail in your Messages tab; tap it to enlarge.

**Video call** rings her tablet. She answers or declines. Either side can hang up.

The rule the design holds to: **it always takes a tap from her.** Browsers won't let a remote party switch on a camera, and that limit is worth keeping rather than working around. "Not right now" is a real answer and gets sent back to you, so a decline isn't the same as being ignored.

### If calls won't connect

Video uses free public STUN servers, which works when both devices can see a route to each other — same house, or most home-to-mobile situations. Some networks need a relay, and there isn't a free public one worth relying on. If calls fail from certain places, get a TURN credential (metered.ca has a free tier, Twilio and Cloudflare Calls are paid) and add it to the config as `turn: {urls, username, credential}`.

Photo check-in doesn't need any of that and works everywhere. It's the reliable one; treat video as the nicer option when it connects.

## Missed weekly tasks

A weekly task that gets missed used to disappear until the following week. Any task can now be set to **keep it on the list** instead, so a missed hair wash stays there, labelled "Still to do", until it actually happens. Wash hair, laundry and sheets ship with this on.

## Step by step

Any task can be broken into steps. Its button then becomes **Show me how**: one large picture at a time, one big Next, her place saved so an interruption doesn't mean starting over. Showering ships with nine steps already written; edit them to match how she actually does it.

**Water and tablets.** Mark a task as *anywhere with water* and it changes shape: she's walked through every step first, then told to leave the tablet where it is and press a green button when she's back. The tablet never goes into the bathroom.

Any set of steps can also be printed as a **wall card** — numbered, large icons, A4. Print it, laminate it, hang it where she'll use it. No battery, no water damage, always there. For showering this is the version that will actually get used.

## Days she's out

Mark an event as **out of the house** — day service already is — and the app goes quiet for those hours. No alarms fire into an empty room, no warnings, and no postponement nudges reach your phone.

Anything scheduled inside that window doesn't count as missed. It moves to just after she gets back and reads "when you get home" instead of a time. She walks in at three to a calm screen with a welcome-home card and what's actually left, rather than a wall of red.

## Transition warnings

Every task and event has a heads-up, five minutes by default. It's deliberately quiet: a small card on screen, one soft note, and a spoken sentence. No countdown, no alarm sound, nothing that means hurry. The point is giving her time to finish what she's doing and arrive under her own steam rather than being moved along.

## What's happening

Her day's plan sits under the weather as picture cards she can tap to hear. Day service is pre-set for Tuesday, Wednesday and Thursday, 8:45 to 3:00, with a twenty-minute heads-up before she needs to leave. Add the week's activities to it on a Monday, and add one-off cards for appointments or visitors.

Knowing what's coming is worth as much as being reminded what to do.

## Timers

Some things aren't finished when you start them, they're finished when enough time has passed. Any task can carry a duration, set in the task editor.

When a task has a timer, its big button becomes **Start** instead of a check. A ring drains on screen — that's the real display, since it shows how much is left without needing to read the number underneath. She's told out loud when she's halfway and again at ten seconds, then it chimes and checks itself off.

Brushing teeth ships at 3 minutes and showering at 10. **Stop** doesn't count as refusing; it just puts the task back on the list five minutes later. There's also a small ✓ on timed cards for the times she's already done it and doesn't need the timer at all.

## Reminders she can't just swipe away

Notifications are built to be dismissed, so they're only a backstop here. When something comes due, the app takes over the whole screen: big picture, spoken out loud, re-asking every 26 seconds. There is no X, no close, and no edge to swipe from. It ends when she taps **I did it** — or when it hands her to a person.

**Not yet** is deliberately still there. Removing every out turns a reminder into a fight, and she'd learn to work around the app instead of with it. But it's finite: after the number of postponements you set, that button is replaced by **I need help**, which messages you. The alarm never gets louder or scolds her. It escalates to a human, not to pressure. You also get a quiet heads-up on the second postponement without her being told on.

Set both numbers in the care app under **How firm the reminders are**. Setting postponements to zero removes the button entirely.

## Making the tablet stay put

The screen alarm only helps if she's on the app. Android has two ways to guarantee that:

1. **App pinning** (free, built in) — Settings → Security → App pinning → on. Open IndependentME, tap Recents, tap the icon, Pin. Home and Recents stop working until a PIN is entered. This is the simple answer and it's usually enough.
2. **Fully Kiosk Browser** (~$10, one time) — if pinning gets defeated. It relaunches on boot, blocks the status bar, keeps the screen on, and can wake the screen at alarm time, which a web app cannot do on its own.

Either way: plug it in, and set Display → Screen timeout to the longest option.

## What's honest about the limits

- **The tablet has to be awake and on the app.** No web app can wake a sleeping Android tablet by itself. Pinning plus always-plugged-in gets you most of the way; Fully Kiosk gets you the rest. For medication or anything with a hard consequence, set a duplicate alarm in the tablet's Clock app as well.
- **Security is shared-secret.** Two codes, no accounts. Fine for a family, not fine for anything regulated. Don't put medical details in phrase text.
- **The tablet works offline.** Check-offs queue locally and sync when the wifi comes back. It never goes blank on her.
- **Photos** are cropped square and shrunk to 256px before saving, so the config stays small.
