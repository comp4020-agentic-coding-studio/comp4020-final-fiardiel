# Process overview

## From the brief to the idea

The brief asked for a multi-user, real-time website that is good, with no subject. I was stuck because that was too broad to start from. So I started from my house of four people and listed what annoys us: the kitchen, cleanliness and splitting costs. The agent pointed out that the kitchen is where the live problem (people colliding while cooking) and the slow problem (mess left for the next person) meet, and I chose it as the centre of the app. I left out showers, a chore rota, rent and bills, and notifications. Splitting costs for shared kitchen items stays as a later extension.

## How I worked with the agent

I brainstormed with the agent before any code, and I decided the main rules myself. A person is a name inside a house, joined with a house code and no passwords. Several people can cook at once. Anyone can mark the kitchen clean or messy, and anyone can end a cooking session someone forgot. The cook is named as responsible only while the kitchen is messy. The agent wrote these into a design spec and a task plan, which are committed before any code ([`51a94fa`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/51a94fa)).

For building, the agent recommended doing the tasks itself in one session with one review at the end. I asked how that differed from the other option and was told it costs more but gives an independent check on every task. I chose that one. Each of the seven tasks was built by a fresh agent and checked by a separate reviewer before the next task started, and a final reviewer checked the whole thing.

## Where the work was corrected

- The spec's first wording of the blame rule contradicted what I had decided. It would have blamed someone who starts cooking in a messy kitchen. A review of the spec caught it, and the corrected rule is in the spec as committed in [`51a94fa`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/51a94fa).
- A task reviewer found that the store trusted its caller, so a person from another house could act. This was fixed in [`8d330db`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/8d330db).
- Another reviewer found that one late error could crash the whole server. This was fixed in [`8130d53`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/8130d53).
- The final review found that invisible or look-alike names were accepted and that returning people were not recognised. These were fixed in [`e449931`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/e449931) and [`47fa5d8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/47fa5d8), and the spec was updated in [`8bd2b11`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-fiardiel/commit/8bd2b11).

## Stack

One Node and TypeScript server, SQLite on the Fly volume, plain HTML forms and no framework. The app is small and the machine has 256 MB, so I kept it to as little as possible. For live updates next week I chose server-sent events over WebSockets or polling, because the app mostly pushes updates to people and the button presses are ordinary requests.

## What is not done

Live updates are not built yet; that is next week. Docker Desktop would not start on my laptop, so the image was first built on Fly's remote builder, and I checked that a house survives a machine restart. Splitting costs for shared items and a per-burner tag are later extras.
