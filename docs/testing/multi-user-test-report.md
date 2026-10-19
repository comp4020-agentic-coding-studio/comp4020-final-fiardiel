# Multi-user test report

Crit 10, Monday 19 October 2026, 03:19 to 03:33 UTC (14:19 to 14:33 Canberra), against the deployed app at
https://comp4020-final-fiardiel.fly.dev, read from `mise exec -- flyctl logs -a comp4020-final-fiardiel`.

Scenarios a, b, d and e were done by my pod in separate Chrome profiles (Rafi, Benedict, Andriyo in house `h3`).
Scenarios c, f, g and h were scripted with `curl`, each person with their own cookie jar, so the timing was exact.

## What the log says

Every line is one event: `house=<label> person="<name>"#<id> action=<event> [details]`.

| The crit's list | Serumah's log |
| --- | --- |
| user joins the room | `action=join` (new name) or `action=sign_in` (existing name, with its PIN) |
| user connects / disconnects | `action=connect clients=N` when a house page opens its live stream, `action=disconnect clients=N` when it closes; `N` is how many pages in the house are still listening |
| server receives an action | `add_bill`, `delete_bill`, `pay`, `dispute`, `reset_pin`, `create_house` |
| server broadcasts an update | `person=- action=broadcast clients=N`: how many open pages were told |
| server rejects an action | `action=rejected status=… reason="…"`, plus `wrong_pin`, `wrong_code`, `delete_refused`, `dispute_refused` |
| server sends a state snapshot to one user | `action=snapshot page="house"` (or `"history"`): one person's page loaded or refreshed |

A "room" is a house. The house is named by a label such as `h3`, never by its code, because the code is the one secret that gets you in and the log is shown on a projector. `by="…"` appears on a PIN sign-in or reset to say whose browser did it.

Every line shows as `[info]` in Fly's log: that is Fly's label for anything the app prints, not a level the app chose. A refusal is told apart by `action=rejected`, not by the label.

## Results

| | Scenario | Expected | Observed | Result |
| --- | --- | --- | --- | --- |
| a | 2 users join | each join logged under their own name; the first page hears the second join | Rafi joins (`broadcast clients=0`), Benedict joins (`broadcast clients=1`), Rafi's page refreshes by itself, `connect clients=2` | Pass |
| b | an action propagates | the other user's page updates without them touching it | Rafi `add_bill cents=2000`, `broadcast clients=1`, Benedict `snapshot` in the same second | Pass |
| c | simultaneous actions | two people's bills in one second both kept; a double-tap Delete deletes once | Dev and Cara `add_bill` at 03:25:16, both kept; Cara's two Deletes: one `delete_bill`, one `rejected status=404 "That bill isn't here any more."` | Pass |
| d | late user joins | the newcomer's first snapshot already has the history | Andriyo `join`, the two open pages refresh, Andriyo `snapshot` then `connect clients=3` | Pass |
| e | leave and return (tab close) | close logs a disconnect; coming back opens straight in, no PIN | Benedict `disconnect clients=1` at 03:24:13, back at 03:24:27 with `snapshot` and `connect clients=2`, no `sign_in` | Pass |
| f | isolated rooms | an action in one house reaches no one in another | Eve `add_bill` in `h5` broadcast to `h5` only; Fay listening in `h6` heard 0 events in 8 s; Eve's cookie on `h6` was sent to its join page | Pass |
| g | two machines | (see below) | a house made on machine 1 is a 404 "no such house" on machine 2; Hana could not join it there; Gita on machine 1 heard nothing | **Fails, by design** |
| h | restart mid-session | open pages reconnect by themselves; data survives | restart at 03:32:31, answering again by 03:32:38; Rafi's and Benedict's pages reconnected by themselves at 03:32:44–45 and refreshed; Gita still signed in and her bill still there | Pass |

### a, b: the pod, in house h3

```
03:19:10 house=h3 person="Rafi Ardiel Erinaldi"#6 action=join
03:19:10 house=h3 person=- action=broadcast clients=0
03:19:10 house=h3 person="Rafi Ardiel Erinaldi"#6 action=connect clients=1
03:19:48 house=h3 person="Benedict Siregar"#7 action=join
03:19:48 house=h3 person=- action=broadcast clients=1
03:19:48 house=h3 person="Rafi Ardiel Erinaldi"#6 action=snapshot page="house"
03:19:48 house=h3 person="Benedict Siregar"#7 action=connect clients=2
03:20:51 house=h3 person="Rafi Ardiel Erinaldi"#6 action=disconnect clients=1
03:21:13 house=h3 person="Rafi Ardiel Erinaldi"#6 action=add_bill bill=3 cents=2000
03:21:13 house=h3 person=- action=broadcast clients=1
03:21:13 house=h3 person="Benedict Siregar"#7 action=snapshot page="house"
03:21:13 house=h3 person="Rafi Ardiel Erinaldi"#6 action=connect clients=2
```

The disconnect at 03:20:51 is Rafi opening "Add a bill": the form pages have no live stream, so nothing someone is typing is ever wiped. His house page reconnects when he comes back. A page connecting logs two snapshots: the page load, and the refresh when its live stream opens, so a change in between is never missed.

### c: the same second, in house h4

```
03:25:16 house=h4 person="Dev"#10 action=add_bill bill=4 cents=300
03:25:16 house=h4 person="Cara"#9 action=add_bill bill=5 cents=500
03:25:16 house=h4 person="Cara"#9 action=delete_bill bill=5
03:25:16 house=h4 person="Cara"#9 action=rejected status=404 reason="That bill isn't here any more."
```

The delete is one conditional statement in SQLite, so of two taps exactly one lands.

### g: two machines

`fly scale count 2` added machine `1850d52b994908` with its own new volume. Requests were pinned to each machine with the `fly-force-instance-id` header.

| | machine 1 (`81112eb99e7018`) | machine 2 (`1850d52b994908`) |
| --- | --- | --- |
| join page of a house made on machine 1 | 200 | 404 "There's no house with that code" |
| that house's page with Gita's cookie | 200 | 404 |
| Hana joining with the code | | 404 |
| Gita listening live on machine 1, after Hana's attempt | 0 events | |

Expected for this design: each machine has its own SQLite file on its own volume, and the list of open pages is in memory, so two machines share no houses, no people and no updates. Fly would send each person to either machine, so housemates could each see a different, partial app. Serumah is built for one house on one small machine (`fly.toml` keeps it to one), so the answer is to stay at one machine. Running on two would need one shared database and a way for machines to pass updates to each other.

After the test the second machine and its volume were destroyed by id; the app is back to machine `81112eb99e7018` with volume `vol_40oj02qq27mnjy94`, its data untouched.

### h: restart

```
03:32:29 house=h7 person="Gita"#13 action=connect clients=1
03:32:31 Sending signal SIGINT to main child process
03:32:36 listening on 0.0.0.0:8080, data in /data
03:32:44 house=h3 person="Rafi Ardiel Erinaldi"#6 action=connect clients=1
03:32:45 house=h3 person="Benedict Siregar"#7 action=connect clients=2
```

Fly's proxy refused connections for about two seconds while the app started. The pages' own script restarts a dropped stream, waiting a little longer each time, which is why the pod's pages came back a few seconds after the server did.

## Gaps the test found in the logs, and their fixes

- **A request for an unknown house was not logged.** On machine 2 in scenario g, the 404s left no line. It now logs `house=- action=rejected status=404 reason="no house with that code"`; the typed code is left out, since a wrong one can be one letter off the real one.
- **A restart logged no disconnects.** The server exited before the streams' `disconnect` lines reached the log. It now lets the process end by itself after closing, so the lines are written.
- **Opening a house you aren't signed in to was not logged.** In f it was a quiet redirect. It now logs `action=rejected status=303 reason="not signed in to this house"`.

All three were checked against a local server (a stream open, then SIGTERM) before deploying. None of them let anyone do something they shouldn't; they were places the log was quieter than the app.
