# Buypal: an AI personal shopping agent with PayPal checkout

Buypal turns shopping into a conversation about *anything you can buy online*. Describe what you want in your own words ("salted butter 500 g", "a lightweight laptop for college under ₹60,000"). An AI agent reads the request, compares stores, and sorts the options into **cards**: *best overall*, *best quality*, *best price*, *most loved*, *best deal* and *picked for you*. The order and mix **adapt to each shopper** as they choose and buy. Checkout is through **PayPal Sandbox**.

Built for the PayPal *Build What's Next with PayPal and AI* hackathon.

> **Honest scope.** PayPal checkout cannot buy from arbitrary third-party stores. In this demo the Sandbox payment goes to Buypal's own test merchant. No retailer order is created, nothing is delivered, and there is no escrow. "View at retailer" links open the retailer's real product page.

> **Where the data comes from (please read).** Amazon, Flipkart, Blinkit and Zepto have no public product APIs and scraping them is against their terms, so Buypal does not claim to query them. It uses two providers behind one interface (`server/services/catalog.js`):
> 1. **Channel3** (real): live listings from US retailers such as Best Buy and Walmart. It carries almost no groceries.
> 2. **Google Shopping via SerpApi** (real, optional, `server/providers/googleShopping.js`): offers from many US merchants (Amazon, Walmart, Target and others) with prices and ratings. Set `SERPAPI_KEY` to enable it. Results are cached for a day and calls stop at `SERPAPI_MONTHLY_LIMIT` (default 200) so the free plan cannot be exceeded. Delivery text is used only when Google shows it, and an arrival time is only inferred when the text states one. It was written to SerpApi's documented response shape and should be checked against a live key.
> 3. **Demo store feed** (`server/providers/demoStores.js`, **simulated**): fictional stores (QuickCart, DashMart, FreshSlot, MegaMarket, BazaarHub) and fictional brands, with deterministic prices and ratings for everyday items. Every such listing is flagged `demo: true` and shown with a "Demo data" badge. It exists so the full comparison can be demonstrated for everyday items that no free, legal API covers.
>
> **Delivery time is deliberately not modelled.** It cannot be calculated reliably from any available source, so Buypal never shows or promises it.
>
> More real adapters (for example the eBay or Best Buy APIs) can be added the same way by returning the same listing shape. Turn the demo feed off with `DEMO_STORES=off`.

## The AI core: baskets that learn the shopper

1. **Understanding.** The LLM turns a free-form description into structured requirements (product, size, must-haves, budget, how soon it is needed) and calls the comparison tool once per item.
2. **Comparing.** Deterministic code (not the LLM) filters like with like (same pack size, relevant category), scores every listing and picks a winner per card. The final buckets are: **Best overall** (quality for the money), **Best quality**, **Best price**, **Most loved** (top rating with 50+ reviews), **Best deal** (a credible verified markdown on a well-rated product) and **Picked for you** (the best option from a brand the shopper has shown they like), plus a **Stretch pick** when the shopper allows going over budget. Extras only appear when the data supports them, and the screen says what was left out and why.
3. **Reading the shopper.** Buypal keeps an explainable model of each user (stated priority, which baskets they actually choose and buy, categories, brands, typical spend). It decides which baskets appear **first**, which get a **runner-up card**, and is passed to the LLM so its recommendation is personal. The "Why these baskets, in this order" box and the profile page show exactly why.
4. **Changing over time.** Choose Best price three times and it moves to the front for everything, and gets a runner-up card.

## Features

| Area | What it does |
|---|---|
| **Conversational agent** | One LLM agent (Groq, free tier) calls deterministic tools: search, scoring, cart, preferences. Falls back to a rule-based parser if the AI is unavailable. |
| **Product discovery** | Channel3 product search API (price, ratings, availability, specs from listing text). Nothing is invented: missing data is shown as "not listed". |
| **Your priority** | On first visit you choose what matters most: lowest price, best quality, or best balance. Buypal leads with that pick and tunes every ranking and recommendation to it. Change it any time. |
| **Personalised home** | Searches, likes, cart adds and purchases build an explainable interest list (fading by half every 14 days). The home page shows "Picked for you" and verified deals in those categories, and says which searches it is based on. |
| **Adaptive 3-strategy picks** | **Best price**, **Best overall** and **Best quality**, scored by code, not by the LLM. Each product also lists the retailers selling it and their prices. Cards merge when one product wins several strategies, and extra cards (runner-up, top rated, stretch) appear based on your history and the data. Each card shows pros, cons, why it was picked, and how it fits your preferences. |
| **Personalization** | Explainable counters per brand and strategy, with global and per-category scopes. Learns from adds, likes, rejections (with a reason) and purchases. View, edit, delete or reset everything in the profile panel. |
| **Setup baskets** | "Build me a high quality yet affordable gaming setup under ₹1,00,000" produces several COMPLETE setups (best overall, best quality and best price), each verified to fit the budget and ordered for the shopper. Open a basket to see each part with its **retailer link** (Amazon, Walmart, Best Buy and others, from Channel3 / Google Shopping), alternative stores, a "copy shopping list" button, and an "I bought this" tick that teaches Buypal. Only listings with a real retailer link are used. |
| **Cart edits** | A chosen basket can become the cart ("Use as cart"). Natural-language edits ("replace the mouse with a wireless one and reduce the total by ₹2,000") are re-searched and re-verified. |
| **Buy now (demo checkout)** | One click adds the pick and opens the review-and-pay step. Nothing is charged until you tick the approval box and approve in PayPal Sandbox. |

> **Future work: one-click purchase at the retailer.** Today the shopper completes each purchase on the retailer's own site. Amazon, Walmart and similar stores have no public API that lets an outside app place orders for a customer, and Channel3's checkout is listed as "coming soon". If such an API becomes available (a retailer ordering API, Channel3 checkout, or a retailer-supported agentic-commerce protocol), Buypal's design supports it: baskets already hold verified listings, totals and approvals, and the PayPal order flow in `server/services/paypal.js` is where a real purchase would plug in.
| **PayPal Sandbox** | Orders API v2 with the v6 JS SDK. Server-side amounts, live price re-verification before the order, explicit user approval step, atomic capture lock, idempotency, amount and currency verification, and failed / cancelled / pending handling. |

## Architecture

```
React + Vite + Tailwind (client/)           Express API (server/)
  chat UI, cards, cart, profile  ───────►   routes (app.js)
                                              ├─ agent.js        orchestrating agent (Groq tool-calling loop)
                                              │    └─ tools.js    find_products · build_setup · modify_cart · show_cart · update_preference
                                              ├─ intent.js       rule-based fallback understanding
                                              ├─ scoring.js      deterministic Budget / Smart / Premium engine
                                              ├─ setupBuilder.js multi-product optimiser + cart edits
                                              ├─ preferences.js  explainable learning
                                              ├─ channel3.js     product search + 1h cache
                                              ├─ paypal.js       Orders API, verification, capture lock
                                              └─ SQLite (node:sqlite): users, preferences, carts, orders, products, messages
```

Design choices:

- **One orchestrating agent with tools**, not many agents. Simpler to debug and cheaper on a free LLM quota.
- **The LLM never ranks products and never touches payments.** There is deliberately no payment tool. Only the signed-in browser can start checkout, and capture happens only after the user approves in PayPal.
- **Free LLM with a hard stop.** Groq's free tier needs no card and cannot bill. Buypal also counts calls per day and stops calling the model at `LLM_DAILY_LIMIT`.
- **SQLite** (built into Node 22+) means zero database setup and persistence across restarts.
- Identity is an anonymous per-browser id (no passwords). Swap it for real auth before any production use.

## Brand and design

The logo (`design/logo/buypal-mark.svg`) is a shopping bag with a navy handle and a check: buying, verified. The interface is built from it: navy for structure and text, azure for actions and key data, mist and white surfaces, crisp 1px lines, tabular numerals, and a Outfit / Instrument Sans type pairing. Tokens live in `client/src/index.css`; the card bucket colours in `client/src/buckets.js`. The wordmark and icons are in `client/src/components/Logo.jsx` and `icons.jsx`. The other logo explorations are in `design/logo-concepts.html`.

## Run it locally

Requires **Node.js 22.5 or newer** (uses the built-in `node:sqlite`).

1. Get keys (all free):
   - **Channel3** product API key: <https://trychannel3.com/developers>
   - **PayPal Sandbox** REST app (Client ID + Secret): <https://developer.paypal.com/dashboard/applications/sandbox>. Create the merchant (business) sandbox account in the **United States**: other countries may not be able to receive USD, and PayPal then shows `UNSUPPORTED_PAYEE_CURRENCY`. Test as a **Personal** sandbox buyer account.
   - **Groq** API key (no credit card): <https://console.groq.com/keys>. Optional: without it Buypal runs in basic mode.
2. Copy `.env.example` to `.env` and fill in the values. Never commit `.env`.
3. Install and run:

```bash
npm install
npm run build        # builds the React client (installs client dependencies too)
npm start            # http://localhost:3000
```

For development with hot reload (client on <http://localhost:5173>, API on 3000):

```bash
npm run dev
```

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `CHANNEL3_API_KEY` | Product search |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | PayPal **Sandbox** REST app |
| `GROQ_API_KEY` | AI agent (optional) |
| `GROQ_MODEL` | Default `openai/gpt-oss-120b` |
| `LLM_DAILY_LIMIT` | Hard stop for AI calls per day (default 600) |
| `INR_PER_USD` | Approximate rate used to convert ₹ budgets (default 85). Channel3 prices are in USD. |
| `PORT`, `DB_PATH` | Server port, SQLite file (default `data/buypal.db`) |

## Try it

1. "Lightweight laptop for college under ₹60,000" → Budget / Smart / Premium cards. Tap **Add to cart** or **Like** on a few picks, then open the heart icon to see what Buypal learned.
2. "Build me a complete gaming setup under ₹1,00,000" → a 5-item cart with the total checked against the budget.
3. "Replace the mouse with a wireless one and reduce the total cost by ₹2,000" → recalculated and verified.
4. Open the cart → **Review order & checkout** → tick the approval box → PayPal → log in with a Sandbox **personal** account.

## Payment safeguards

- PayPal secrets stay on the server. The browser only receives the public Client ID and an order id.
- Amounts come from the server cart and are re-verified against Channel3 right before the order is created. If a price changed, nothing is charged.
- The user must tick an explicit approval box and approve in PayPal. The LLM has no payment tool.
- Capture is locked atomically so a double click or retry cannot capture twice. The captured amount and currency are checked against the order.
- Failed, cancelled and pending outcomes are handled and shown; a changed cart blocks capture.

## Tests

```bash
npm test
```

29 tests cover spec extraction, intent parsing, the scoring engine (budget, dedupe, personalization, missing data), the cart optimiser, preference learning, your priority setting, the interest model, currency handling and the HTTP API.

## Known limitations

- Specs are parsed from listing text, so coverage varies by product. Compatibility between parts (ports, sizes) is not verified from listings.
- Channel3 is a US-centric USD catalogue. Rupee budgets are converted at an approximate configurable rate.
- `legacy-mvp/` holds the first dependency-free prototype and can be deleted.

## Roadmap

Voice input and output, price and availability monitoring, more category-specific spec parsers, real accounts, and additional discovery providers.

## License

MIT, see [LICENSE](LICENSE).
