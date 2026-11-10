# Buypal: submission text

> Paste the sections below into the submission form. Links: **code** https://github.com/Saharsh6246/BuyPal · **video** _(add your YouTube link here)_ · **license** MIT.

## Tagline

An AI shopping agent that compares stores for anything you want to buy, explains every pick, and runs on PayPal.

## Inspiration

Shopping online still means ten open tabs, guessing which reviews to trust, and paying wherever you end up. Existing comparison sites show the same list to everyone and give no reason for their ranking. We wanted an agent that reads *you*: whether you care most about price, quality or value, what you chose last time, and what you are actually trying to build. And we wanted PayPal at the centre of the product, not at the end of a checkout button.

## What it does

You describe what you want in your own words ("a lightweight laptop for college under ₹60,000", "salted butter 500 g", "build me a high quality yet affordable gaming setup"). Buypal's AI agent understands the request and compares real listings from several sources. The options come back as clear cards:

- **Best overall**, **Best quality**, **Best price**
- **Most loved** (top rating backed by 50+ reviews)
- **Best deal** (a credible, verified markdown on a well-rated product)
- **Picked for you** (the best option from a brand you have shown you like)

Every card explains why it was chosen, shows pros and cons, what is verified, and other stores selling the same product. The order and mix of cards **adapt to each shopper**: their stated priority, what they click, add, like, reject and buy. A "Why these cards, in this order" panel and a profile page show exactly what Buypal has learned, and the shopper can edit or reset it.

For bigger goals, one request builds several **complete setups** (for a gaming setup: laptop, monitor, keyboard, mouse, headphones), each verified to fit the budget. Opening a setup shows the retailer link for every part, so the shopper completes the purchase at the store they choose.

## How PayPal powers it

PayPal is the economy the product runs on:

- The AI's work is paid for in **Pal Points**: a search costs 1, a complete setup costs 4.
- Shoppers **earn points by paying with PayPal**:
  1. **Top-ups (verified):** packs are bought with a PayPal Sandbox order to Buypal's own merchant account using the **Orders API v2 and JS SDK v6**. The server owns the amount, captures once (atomic lock + idempotency keys), verifies status, amount and currency with PayPal, and credits points once per PayPal order id.
  2. **Rewards for paying with PayPal at retailers (self-reported):** cards and baskets nudge shoppers to choose PayPal at the retailer's checkout, then claim up to 50 points with the PayPal transaction ID. These claims are validated, capped and de-duplicated, and clearly labelled self-reported.
- The in-app cart also checks out through PayPal Sandbox, with live price re-verification before the order is created and an explicit approval step. The AI has **no payment tool**, so only the shopper can pay.

## How AI is used

- A tool-calling **agent** (Groq, `openai/gpt-oss-120b`, free tier) turns free-form text into structured requirements and calls search, setup-building, cart-editing and preference tools, then writes a short personal recommendation.
- **The LLM never ranks products and never touches payments.** Ranking is deterministic, explainable code on real listing data, so it is testable (43 automated tests).
- A **user model** (priority, chosen styles, brands, categories, typical spend) decides which cards lead and which get a runner-up, and is passed to the model so its advice is personal.
- Guardrails: no invented prices or specs, simulated data always disclosed, a hard daily cap on model calls (the free tier cannot bill), and a rule-based fallback if the AI is unavailable.

## How we built it

React + Vite + Tailwind front end, Express back end, SQLite (Node's built-in `node:sqlite`, nothing to install). Product data comes from three providers behind one interface, run in parallel:

1. **Channel3**: live US retailer listings.
2. **Google Shopping via SerpApi** (optional): offers from many US merchants, cached and hard-capped so the free plan cannot be exceeded.
3. **A labelled, simulated demo store feed** for everyday items no free, legal API covers.

The brand and interface were designed from scratch: a bag-and-check logo and a navy / azure design system.

## Challenges

- **There is no public API to buy from the big retailers.** Amazon, Flipkart, Blinkit, Zepto and Walmart expose no ordering API to outside apps, and scraping them is against their terms. We chose honesty: Buypal does the finding, comparing and assembling, and the shopper completes the purchase at the retailer.
- **Verifying PayPal use at third-party retailers is impossible for an outside app.** So the verified earning path is the top-up, and retailer rewards are explicitly self-reported with safeguards.
- Keeping an LLM-driven product trustworthy: ranking in code, disclosure of simulated data, and spending caps on every metered API.

## Accomplishments we are proud of

- A comparison engine whose every ranking is explained, and that provably adapts to the shopper.
- Payments that are server-authoritative, idempotent and verified end to end.
- Zero-key run mode: judges can run the whole app locally with `npm install && npm run build && npm start`.

## What we learned

Agentic commerce works best when the model understands and explains while deterministic code decides and the user approves. Being explicit about what cannot be verified builds more trust than pretending.

## What's next

Retailer ordering as soon as a partner API or protocol is available (the basket and PayPal order flow are ready to plug into), automatic verification of retailer PayPal checkouts, price and availability alerts, voice input, and real accounts.

## Built with

PayPal Orders API v2, PayPal JS SDK v6, Groq (`openai/gpt-oss-120b`), Channel3, SerpApi (Google Shopping), React, Vite, Tailwind CSS, Node.js, Express, SQLite.

## Try it

Judges can run it locally from the repository: see **Quick start for judges** in the [README](README.md). It runs with no API keys; add a PayPal Sandbox app to see checkout and top-ups, and a Groq key to see the AI agent.

## Notes for judges

- Simulated demo-store listings are flagged "Demo data" in the product and the code.
- The in-app checkout is a PayPal Sandbox demonstration: no real money moves and no retailer order is created.
