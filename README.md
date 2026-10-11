# Serumah

## Who it's for

It's for the whole house: split billing, and later chore rotations. Bills come first because they are the main issue in my house. There are five of us, and we shop at different times, with different people, so splitting and owing happen a lot.

For example, I go to Coles one day and buy a lot. The next day Radit goes to Coles again and buys cleaning stuff. The day after, Budi buys the things we always forget, like sauces and fried shallots. Now Derrick and Aldi are confused about who to pay, and Budi and I don't remember either.

Usually someone asks in the group chat, and there are a lot of messages. Imagine it builds up for six months. How many bills would be missed, and who would keep up? We'd either chase people or let it go, and the money would be gone. Everyone would feel awkward.

That's where Serumah comes in: it remembers every bill and payment.

## What good means here

Good means nobody is confused about who to pay who. We don't have to chase the others around, and we don't have to check the group chat for the bills. Instead the debts add up, so you can see who owes who, and the history shows what for.

We are housemates and we trust each other. That's why there is no login, and it's also why a payment counts as soon as someone records it. If the money never arrived, the person who was paid can say so and it's removed.

I don't want to nag, or blame anyone for owing. My housemates are good people; they just shouldn't be confused about who to pay.

## What I chose not to build

**Not built yet, because of time:**

- **Chores**, the second half of the house.
- **Reading receipts (OCR).** The payer types the amounts.
- **Editing a bill.** For now you delete it and add it again.

**Left out on purpose:**

- **Reminders**, because they nag.
- **Logins**, because we trust each other.
- **Simplifying debts.** Aldi would pay Budi $10 without knowing why, and have to dig through the history to find out.
- **Everyone confirming each bill**, which would be annoying with so many bills.

## What is enforced and what is judged

**Enforced by checks in `spec/`:**

- A payment counts as soon as it's recorded, and only the person paid can remove it.
- Only the payer can delete their bill, and two taps at once only change things once.
- An equal split adds up to the total, to the cent.
- Balances are listed by name, never ranked by who owes the most.
- No page says "overdue", "late" or "remind".
- A change shows up on every open page in the house within a second, and never in another house.

**Judged by looking:** whether a housemate can tell me who they owe, and how much, in about three seconds with the phone at arm's length.

**Not true yet:** the judged test. The page has no real design yet, so it doesn't pass.

## What I read and looked at

This app is based on [Serumah](https://github.com/davinpwk), my housemate's Telegram bot that splits grocery bills, tracks debts and rotates chores each week.

I looked at [Splitwise](https://www.splitwise.com/). It is made for any group, needs accounts, simplifies debts, sends reminders, and the free version allows three expenses a day. Serumah is tailor-made for the house: no login, no payment, only what the house needs.

I read Robin Sloan's ["An app can be a home-cooked meal"](https://www.robinsloan.com/notes/home-cooked-app/). He built a messaging app just for his family. Like his app, Serumah removes the extra features and is made for one house only.
