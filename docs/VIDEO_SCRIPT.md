# Buypal: 3-minute demo video

**Target length: 2:45** (the rule is under 3:00; judges need not watch past it). Narration is about 400 words. Speak at an unhurried pace and pause on the screen actions rather than rushing.

## Before you record (10 minutes)

1. Run the app with all keys set (`npm start`), open it in a **clean browser window** at 1080p, 110% zoom, notifications off.
2. **Warm the cache** so nothing waits on screen: do the three searches below once beforehand (results are cached for an hour; the day for Google Shopping). Then use a **new shopper**: open the browser console and run `localStorage.clear()`, reload. A new shopper starts with 25 points, which looks right on screen.
3. Have a PayPal **Sandbox personal buyer** login ready in a **private window**. Type the password off camera, or approve the payment beforehand and just show the result. Never show `.env`, API keys or the PayPal developer dashboard credentials.
4. Do a full dry run of the **PayPal top-up** (the one step I could not click through myself): pick a pack, tick approval, approve in PayPal, and confirm the balance rises.
5. **No music**, or only music you have the rights to. **Avoid third-party trademarks on screen**: do not click through to retailer sites and do not linger on retailer names. Hover over a "Buy at" link instead of opening it. The PayPal pop-up shows PayPal's own branding: check the hackathon rules are happy with that (it is the sponsor's product, but confirm).
6. Upload to **YouTube as Public** (not Unlisted) and put the link in the submission form and at the top of `SUBMISSION.md`.

## Script

### 0:00 to 0:15 · Hook (screen: home page, hero)
> "Shopping online means ten tabs, reviews you can't trust, and paying wherever you end up. Buypal is an AI shopping agent that does the comparing for you, and PayPal is what powers it."

### 0:15 to 0:50 · One search, six ways to decide
*Screen:* click the priority **Best balance**, then search **"a lightweight laptop for college under ₹60,000"**. Let the cards appear. Scroll slowly along them.
> "I just describe what I want, in my own words, even in rupees. Buypal compares real listings and gives me clear choices: best overall, best quality, best price, most loved, best deal. Each card tells me why it was picked."

*Screen:* open **Pros, cons and fit** on one card, then **Why these cards, in this order**.
> "The AI understands and explains, but a transparent rules engine does the ranking. The AI never ranks products and never touches money."

### 0:50 to 1:20 · It learns you
*Screen:* click **Add to cart** on a card, **Like** another. Open **Profile**: show the priority switcher and "Buypal's read on you".
> "Every click teaches it. Buypal builds an explainable picture of me, which price versus quality I choose, and re-arranges the cards around it. I can see everything it has learned, edit it, or reset it."

### 1:20 to 1:55 · Whole setups
*Screen:* new chat: **"Build me a high quality yet affordable gaming setup under ₹1,00,000"**. Show three baskets; open one; hover over a **Buy at** button; tick **I bought this**.
> "For bigger goals it builds complete setups, each verified to fit my budget. I open a basket and get the retailer link for every part. No public API lets an app place orders at the big retailers, so I finish each purchase at the store I choose. We're honest about that."

### 1:55 to 2:45 · PayPal is the engine (about 50 seconds; if you run over, trim "It learns you")
*Screen:* click the coin chip to open the **wallet**. Point at the balance, the costs, then the two earning paths. Do the **top-up** with PayPal Sandbox; show the balance rise and the history line.
> "Here is where PayPal comes in. Buypal's AI work is paid for in Pal Points: a search costs one, a full setup costs four. Shoppers earn points by paying with PayPal. They can top up through the PayPal Orders API: the server sets the price, verifies the capture with PayPal, and credits the points exactly once."

*Screen:* scroll to the first earning option, "Paid with PayPal at a retailer".
> "The second way to earn is to pay with PayPal at a retailer and claim a reward. We have not built automatic checking of those payments yet. No app can see a customer's payments at another store, so today these claims are self-reported, with limits and duplicate protection, and labelled that way. Verifying them properly, through retailer partnerships or PayPal data, is the next thing we would build."

### 2:45 to 2:58 · Close
*Screen:* back to the home page, then the GitHub repo page.
> "Buypal: find the best version of anything, explained, personal, and powered by PayPal. It's open source under MIT, and it runs from the README with no API keys."

## Backup plan if something breaks on camera

- If the PayPal pop-up is slow, narrate over the wallet and cut to the balance after the capture (edit the pause out).
- If a search is slow, you warmed it already; if not, cut the wait in the edit.
- Keep the total under 3:00 after editing; trim the "It learns you" section first if you are over.

## Submission form checklist

- [ ] **Text description**: paste from [`SUBMISSION.md`](../SUBMISSION.md).
- [ ] **Functional demo access**: judges can run it from the README quick start (no keys needed). A hosted URL is optional.
- [ ] **Public repository**: https://github.com/Saharsh6246/BuyPal (public, MIT license file detected by GitHub).
- [ ] **GitHub "About" section**: add a description and topics (see below) so the license and summary show at the top of the repo page.
- [ ] **YouTube video**: under 3:00, public, no third-party trademarks or copyrighted music, link added to the form.

**Suggested About text:** *An AI shopping agent that compares stores for anything you want to buy, explains every pick, and runs on PayPal.*
**Suggested topics:** `paypal` `ai-agent` `agentic-commerce` `shopping` `llm` `react` `express` `hackathon`
