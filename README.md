# Buypal

**An AI shopping agent that compares stores for anything you want to buy, explains every pick, and is paid for with PayPal.**

Describe what you want in your own words ("a lightweight laptop for college under ₹60,000", "salted butter 500 g", "build me a high quality yet affordable gaming setup"). Buypal's AI agent understands the request, deterministic code compares real listings across stores, and the options come back as clear cards (*best overall, best quality, best price, most loved, best deal, picked for you*) arranged around how **you** shop. The shopper completes the purchase at the retailer they choose. The AI work itself runs on **Pal Points**, which shoppers earn by paying with **PayPal**.

Built for the PayPal *Build What's Next with PayPal and AI* hackathon. Open source under the [MIT license](LICENSE).

| | |
|---|---|
| **Repository** | https://github.com/Saharsh6246/BuyPal |
| **Submission text** | [SUBMISSION.md](SUBMISSION.md) |
| **Demo video script** | [docs/VIDEO_SCRIPT.md](docs/VIDEO_SCRIPT.md) |

---

## Quick start for judges

Requires **Node.js 22.5 or newer** (the app uses the built-in `node:sqlite`, so there is no database to install).

```bash
git clone https://github.com/Saharsh6246/BuyPal.git
cd BuyPal
npm install
npm run build      # builds the React client
npm start          # open http://localhost:3000
```

**It runs with no API keys at all.** Without keys you get the full interface, the comparison engine, personalisation, setup baskets, the Pal Points wallet and a built-in demo store feed (clearly labelled "Demo data"). Add keys to switch on the rest:

| To see | Add to `.env` (copy `.env.example`) | Cost |
|---|---|---|
| **PayPal checkout and top-ups** (Sandbox) | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Free Sandbox |
| **The AI agent** | `GROQ_API_KEY` ([console.groq.com/keys](https://console.groq.com/keys)) | Free tier, no card |
| **Real US retailer listings** | `CHANNEL3_API_KEY` ([trychannel3.com/developers](https://trychannel3.com/developers)) | Free key |
| **Google Shopping offers** (Amazon, Walmart, Target...) | `SERPAPI_KEY` ([serpapi.com](https://serpapi.com)) | Free plan, hard-capped by Buypal |

**PayPal Sandbox setup (5 minutes).** At [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox) create a Sandbox REST app. Make its merchant (business) sandbox account **United States**: other countries can fail with `UNSUPPORTED_PAYEE_CURRENCY`. Pay with a **Personal** sandbox buyer account (use a private window so PayPal does not reuse a logged-in seller session). No real money ever moves.

**Try this:**
1. Open the app, choose what matters most to you, and search *"a 20W phone charger"* or *"lightweight laptop for college under ₹60,000"*.
2. Open **"Why these cards, in this order"** and **Pros, cons and fit** on a card.
3. Ask *"Build me a high quality yet affordable gaming setup under ₹1,00,000"*, open a basket and see the per-part retailer links.
4. Open your **Profile** to see what Buypal has learned about you, and your **wallet** (coin icon) to see Pal Points. Top up with PayPal Sandbox.

`npm test` runs the 43 automated tests (no keys or network needed).

---

## What it does

| Area | Detail |
|---|---|
| **Any product** | Works for electronics, everyday items and more. Free-form descriptions, pack sizes and budgets in ₹ or $ are understood. |
| **Six card types** | **Best overall**, **Best quality**, **Best price**, **Most loved** (top rating with 50+ reviews), **Best deal** (credible verified markdown on a well-rated product), **Picked for you** (best option from a brand you like), plus **Stretch pick** if you allow going over budget. Extras only appear when the data supports them, and the screen says what was left out and why. |
| **Explained** | Each card shows why it was picked, pros, cons, how it fits you, what is verified, and the other stores selling it. |
| **Learns the shopper** | Stated priority plus explainable counters for brands and styles, by category. Learns from retailer clicks, adds, likes, rejections (with a reason) and purchases. Fully viewable, editable and resettable. |
| **Personal home page** | "Picked for you" and credible deals based on what you have searched, with a note on which searches it used. |
| **Setup baskets** | One request produces several **complete** setups (best overall, best quality, best price), each verified to fit the budget. Open a basket for the retailer link of every part, a copyable shopping list and an "I bought this" tick. |
| **Cart and demo checkout** | A basket can become the cart; natural-language edits ("replace the mouse with a wireless one and reduce the total by ₹2,000") are re-searched and re-verified. Checkout runs on PayPal Sandbox. |
| **Pal Points wallet** | AI searches cost points; points are earned with PayPal (below). |

## How PayPal is used

PayPal is not bolted on; it is the economy the product runs on.

1. **Orders API v2 + JS SDK v6 (Sandbox)** for two real checkouts: the cart (demo purchase) and **Pal Points top-up packs**.
2. **Server-authoritative payments.** Amounts always come from the server (cart or pack list), never the browser. Cart prices are re-verified against the retailer data right before an order is created. The shopper must tick an approval box and approve inside PayPal. The AI has **no payment tool**.
3. **Verified captures.** Capture is locked atomically (no double capture), uses idempotency keys, and checks status, amount and currency against the order before anything is credited. Failed, cancelled and pending outcomes are handled.
4. **PayPal as the reward loop.** Shoppers are rewarded for choosing PayPal: they top up through PayPal (verified), or claim points for a PayPal checkout made at a retailer (self-reported, see below). Points are credited once per PayPal order id, so a retry can never pay twice.

> **About reward claims.** Buypal cannot see what a shopper pays at Amazon, Walmart or any other retailer, and PayPal has no API that reveals a user's payments at third-party merchants. Claims are therefore **self-reported**: the PayPal transaction ID format is checked (17 letters and digits), claims are capped at 3 a day and 50 points each, each transaction ID counts once across all users, and the ledger labels them "self-reported". Verifying them automatically would need retailer conversion data (for example affiliate postbacks) or a PayPal partner integration. The verified earning path is the top-up.

## How AI is used

- **An orchestrating agent with tools** (Groq, `openai/gpt-oss-120b`, free tier): it turns a free-form request into structured requirements (product, size, must-haves, budget) and calls `find_products`, `build_setup`, `modify_cart`, `show_cart` and `update_preference`. It then writes a short, personal recommendation.
- **The LLM never ranks products and never touches payments.** Ranking is deterministic code on real listing data (price, ratings, review counts, specs parsed from the listing, verified markdowns), so results are explainable and testable.
- **A user model** (priority, chosen styles, brands, categories, typical spend) decides which cards appear first and which get a runner-up, and is passed (compactly) to the model so its advice is personal.
- **Guardrails:** it never invents products, prices or specs; simulated data is always disclosed; Buypal says plainly that it cannot place retailer orders. A hard daily cap stops model calls, so the free tier can never bill. If the AI is unavailable, a rule-based parser keeps the app working.

## Where the data comes from

All behind one interface (`server/services/catalog.js`), run in parallel:

1. **Channel3** (real): live listings from US retailers such as Best Buy and Walmart. Cached for an hour.
2. **Google Shopping via SerpApi** (real, optional): offers from many US merchants with prices and ratings. Cached for a day, with a hard monthly call cap (`SERPAPI_MONTHLY_LIMIT`, default 200) so the free plan cannot be exceeded.
3. **Demo store feed** (**simulated**, `server/providers/demoStores.js`): fictional stores and brands with deterministic prices and ratings for everyday items that no free, legal API covers. Every such listing is flagged `demo: true` and shown with a "Demo data" badge. Turn it off with `DEMO_STORES=off`.

Amazon, Flipkart, Blinkit and Zepto have no public product APIs and scraping them is against their terms, so Buypal does not claim to query them. **Delivery time is deliberately not modelled**: it cannot be calculated reliably from any available source.

## Architecture

```
React + Vite + Tailwind (client/)            Express API (server/)
  chat, cards, baskets, wallet,   ───────►     app.js (routes)
  profile, cart                                  ├─ agent.js         orchestrating agent (Groq tool-calling loop)
                                                 │    └─ tools.js     find_products · build_setup · modify_cart · show_cart · update_preference
                                                 ├─ intent.js        rule-based fallback understanding
                                                 ├─ scoring.js       deterministic card engine (six buckets)
                                                 ├─ setupBuilder.js  multi-product optimiser, baskets, cart edits
                                                 ├─ preferences.js   explainable learning     insights.js  user model
                                                 ├─ catalog.js       providers/ channel3 · googleShopping · demoStores
                                                 ├─ paypal.js        Orders API: cart + top-ups, verified capture
                                                 ├─ wallet.js        Pal Points ledger, spend, claims, packs
                                                 └─ SQLite (node:sqlite)
```

Design choices: one agent with tools (not many agents), SQLite so there is nothing to install, and an anonymous per-browser identity (no passwords; swap for real auth before production).

## Pal Points

Buypal's AI work is paid for in **Pal Points** (rename them in one place: `UNIT` in `server/services/wallet.js`). They have no cash value and cannot be withdrawn.

- **Start:** 25 points for every new shopper.
- **Spend:** a product search costs 1 point, a complete setup costs 4. Failed or empty searches, the home feed and plain conversation are free. Spending is atomic and a balance never goes negative.
- **Earn:** top up with PayPal (packs of 25, 75 or 200 points, verified), or claim up to 50 points for a PayPal checkout made at a retailer (self-reported).

## Project layout

```
server/            Express API, agent, scoring, wallet, PayPal, providers, tests
client/            React + Vite + Tailwind app (design tokens in src/index.css)
design/            Logo and logo explorations
docs/              Demo video script
SUBMISSION.md      Hackathon submission text
```

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal **Sandbox** REST app |
| `GROQ_API_KEY`, `GROQ_MODEL`, `LLM_DAILY_LIMIT` | AI agent (model default `openai/gpt-oss-120b`; hard daily cap, default 600) |
| `CHANNEL3_API_KEY` | Real US retailer listings |
| `SERPAPI_KEY`, `SERPAPI_MONTHLY_LIMIT` | Google Shopping offers and its hard monthly cap (default 200) |
| `DEMO_STORES` | `off` hides the simulated demo store feed |
| `INR_PER_USD` | Approximate rate for ₹ budgets (default 85); real listings are in USD |
| `PORT`, `DB_PATH` | Server port, SQLite file (default `data/buypal.db`) |

For development with hot reload (client on http://localhost:5173, API on 3000) run `npm run dev`.

## Tests

```bash
npm test
```

43 tests cover spec extraction, intent parsing, the scoring engine and all six card types, personalisation and the user model, the setup optimiser and baskets, Google Shopping parsing, the wallet (atomic spending, idempotent credits, claim validation and caps) and the HTTP API.

## Known limitations

- **No retailer ordering.** Amazon, Walmart and similar stores have no public API that lets an outside app place orders, and Channel3's checkout is "coming soon". The shopper completes each purchase at the retailer. If such an API appears, baskets already hold verified listings, totals and approvals, and `server/services/paypal.js` is where a real purchase would plug in.
- Retailer PayPal rewards are self-reported (see above).
- Specs are parsed from listing text, so coverage varies; part compatibility (ports, sizes) is not verified.
- Real listings are US retailers in USD; rupee budgets use an approximate configurable rate.
- Google Shopping support was written to SerpApi's documented response format and tested with a live key on a few searches.

## Roadmap

Retailer ordering through a partner or protocol when available, automatic verification of retailer PayPal checkouts, price and availability alerts, voice input, more category-specific spec parsers, and real accounts.

## License

[MIT](LICENSE)
