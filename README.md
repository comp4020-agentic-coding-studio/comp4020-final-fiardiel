# The kitchen

## Who it's for

Imagine you're in a household with friends. You go to the kitchen and it's dirty, and you don't know who cooked last, so you don't know who to blame. Or you go to the kitchen because you want to cook, and there are already two people cooking. Now you're in the kitchen and annoyed that you can't cook, expecting to eat, especially when you're hungry. That's who the app is for. It shows who is in the kitchen and whether it's clean or not.

## What good means here

Good for this app means you can see the message clearly. You can check who is cooking, who cooked last, and whether the kitchen is clean or not. The text has a clear hierarchy, so the message is clear. It has to handle several people cooking at the same time. It should also update in real time without refreshing. That last part isn't built yet; it comes next week.

## What I chose not to build

- **A chore rota.** It's the median answer: the same app with the noun changed to housemates.
- **Notifications.** The app shows you the state when you look, instead of pinging anyone, because I don't want it to nag.
- **Passwords.** A household already trusts each other, so the house code is the one shared secret. Anyone who has the code can pretend to be anyone in the house, and I accept that. Passwords would also add friction when you're hungry and just want to know if you can cook.

## What is enforced and what is judged

**Enforced by tests:** you can see who is cooking now; you can see who cooked last and whether the kitchen is clean; several people can cook at the same time.

**Judged by looking:** whether the text hierarchy is clear. I'll judge it by looking at the phone at arm's length and checking whether a housemate can tell me the state of the kitchen in about three seconds.

**Not true yet:** live updates without a refresh.

## What I read and looked at

This app is also a tribute to Serumah, a Telegram bot my housemate made. It splits the bills for groceries, tracks debts and expenses for each person, and does the chore rotation each week. This app is inspired by that, and could be an extension of it, or a spin-off.

I read Robin Sloan's ["An app can be a home-cooked meal"](https://www.robinsloan.com/notes/home-cooked-app/). He built a video messaging app for his family. What I took from it is the simplicity of what the app is for, and the purpose it gave to the family. In my app that shows up as an app for one household that only does one thing, the kitchen, and that you join with a house code instead of an account.
