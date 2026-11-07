# Buypal: an AI personal shopping agent with PayPal checkout

Buypal turns shopping into a conversation. Tell it what you need ("a lightweight laptop for college under ₹60,000", "build me a complete gaming setup under ₹1,00,000"). It searches real product listings, scores them with transparent logic, explains every pick, learns what you like, builds multi-product carts and checks out through **PayPal Sandbox**.

Built for the PayPal *Build What's Next with PayPal and AI* hackathon.

> **Honest scope.** PayPal checkout cannot buy from arbitrary third-party stores. In this demo the Sandbox payment goes to Buypal's own test merchant. No retailer order is created, nothing is delivered, and there is no escrow. "View at retailer" links open the retailer's real product page.

## Features

| Area | What it does |
|---|---|
| **Conversational agent** | One LLM agent (Groq, free tier) calls deterministic tools: search, scoring, cart, preferences. Falls back to a rule-based parser if the AI is unavailable. |
| **Product discovery** | Channel3 product search API (price, ratings, availability, specs from listing text). Nothing is invented: missing data is shown as "not listed". |
| **Adaptive 3-strategy picks** | **Budget**, **Smart** (best value) and **Premium**, scored by code, not by the LLM. Cards merge when one product wins several strategies, and extra cards (runner-up, top rated, stretch) appear based on your history and the data. Each card shows pros, cons, why it was picked, and how it fits your preferences. |
| **Personalization** | Explainable counters per brand and strategy, with global and per-category scopes. Learns from adds, likes, rejections (with a reason) and purchases. View, edit, delete or reset everything in the profile panel. |
| **Multi-product carts** | "Build a complete gaming setup under X" allocates budget across parts, picks best value per part, trims or upgrades to fit, and verifies the total never exceeds the budget. Natural-language edits ("replace the mouse with a wireless one and reduce the total by ₹2,000") are re-searched and re-verified. |
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
| `GROQ_MODEL` | Default `llama-3.3-70b-versatile` |
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

18 tests cover spec extraction, intent parsing, the scoring engine (budget, dedupe, personalization, missing data), the cart optimiser, preference learning, currency handling and the HTTP API.

## Known limitations

- Specs are parsed from listing text, so coverage varies by product. Compatibility between parts (ports, sizes) is not verified from listings.
- Channel3 is a US-centric USD catalogue. Rupee budgets are converted at an approximate configurable rate.
- `legacy-mvp/` holds the first dependency-free prototype and can be deleted.

## Roadmap

Voice input and output, price and availability monitoring, more category-specific spec parsers, real accounts, and additional discovery providers.

## License

MIT, see [LICENSE](LICENSE).
