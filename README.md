# Serumah

## Who it's for

It's for my house of five, who shop at different times, with different people.

I go to Coles one day and buy a lot. The next day Radit buys cleaning stuff. The day after, Budi buys the things we always forget, like sauces and fried shallots. Now Derrick and Aldi are confused about who to pay, and Budi and I don't remember either. The group chat fills up, and we either chase people or let the money go.

Serumah remembers every bill and payment, and can read the receipt for you.

## What good means here

Good means nobody is confused about who to pay who, and nobody has to chase anyone. You can see who owes who, and the history shows what for: with a receipt, each person sees what they had.

We are housemates and we trust each other. That's why there is no login, and why a payment counts as soon as someone records it; if the money never arrived, the person paid can say so. I don't want to nag, or blame anyone for owing.

## Getting in

The house code gets you to "Who's using Serumah?", and each name has a 4-digit PIN. The PIN stops someone tapping the wrong name by accident; it isn't a password, because we trust each other. If you forget it, you retype the house code and choose a new one, and everyone sees it changed.

## Reading receipts

Take a photo of the receipt and Claude Haiku reads every line. Then pick each housemate and tap the lines they had, or share them all evenly. A promo comes off its own item, GST is never split because it's already in the prices, and a surcharge is shared in proportion to what each person had. Nothing is added until you tap Add bill. Photos go to Anthropic to be read and aren't stored; if reading fails, you type the bill in.

## What I chose not to build

**Not built yet, because of time:** chores, and editing a bill (you delete it and add it again).

**Left out on purpose:** reminders, because they nag; logins, because we trust each other; simplifying debts, because Aldi would pay Budi $10 without knowing why; and everyone confirming each bill.

## What is enforced and what is judged

**Enforced by checks in `spec/`:**

- Only the person paid can say a payment never arrived, and only the payer can delete a bill.
- Every split, equal or from a receipt, adds up to the cent.
- On a receipt, promos stay on their item, GST is never split, and fees are shared in proportion.
- A receipt only fills in the form; nothing is added until Add bill.
- Balances are listed by name, and no page says "overdue" or "remind".
- A change shows on every open page in the house within a second, and never in another house.

**Judged by looking:** whether a housemate can tell who they owe, and how much, in about three seconds at arm's length. I tried it on my phone, with a real receipt, and it passes.

## What I read and looked at

Serumah is based on my housemate's [Telegram bot](https://github.com/davinpwk) of the same name. [Splitwise](https://www.splitwise.com/) is for any group, with accounts, simplified debts and reminders; I left those out. Robin Sloan's ["An app can be a home-cooked meal"](https://www.robinsloan.com/notes/home-cooked-app/) is about an app for one family; Serumah is for one house.

A house for markers: code `NR67SC`, names Marker 1, Marker 2 and Marker 3, all with PIN 2026.
