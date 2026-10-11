# 1. Payments count straight away

Status: accepted, 2026-10-11

## Context

Serumah is used by the whole house at once. When someone pays a housemate back, the app has to decide whether that payment counts straight away or waits for the person who was paid to confirm it. The same question applies to bills: does a bill count on the payer's word, or does everyone in it confirm their share first?

## Options considered

- **A. Everyone confirms their share of each bill.** Nothing counts until each person accepts it.
- **B. Everything counts straight away.** Bills and payments count as soon as they are recorded. The person who was paid can tap "Didn't get it" to remove a payment that never arrived.
- **C. Bills count straight away, payments wait.** A payment only counts once the person who was paid taps "Got it".

## Decision

B.

At first I chose C, because it seemed careful, and it was built that way. Then I thought about a busy week: the person who paid would have to accept every payback one by one, and everyone else would wait and ask. In a house where we trust each other and are close, that's just annoying. The Serumah bot we already use registers payments straight away without asking, and it works fine for us. So I switched to B.

A was ruled out for the same reason: it would be annoying for everyone to accept every bill, especially with so many bills.

## Consequences

- Nobody waits and nobody chases, which is what good means for this app.
- If someone records a payment by mistake, the debt disappears until the person who was paid notices and taps "Didn't get it". Mistakes are rare in our house, and the payment shows up straight away in the receiver's history, so they can see it. Even if one slips through, it is written down where anyone can check, which is better than a message buried in the group chat.
- The payer can also put a wrong amount on someone with nobody checking. This is the same trust as the house code, where anyone with the code can act as anyone in the house.
