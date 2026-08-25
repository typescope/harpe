# flight-booker

A Telegram bot that searches for flights and places bookings via the [Duffel API](https://duffel.com/docs) (test mode). Powered by a Harpe agent named **Sky**.

## What it does

1. User describes a trip in chat (e.g. "I need a flight from London to New York on October 1st")
2. Sky searches Duffel for the cheapest options and presents them
3. User picks a flight; Sky collects passenger details conversationally
4. Sky shows a booking summary and asks for confirmation
5. On confirmation, Sky places the order and returns the booking reference (PNR)

All bookings use Duffel's sandbox — no real flights, no real charges.

## Setup

**1. Get a Duffel test API key**

Sign up at [app.duffel.com](https://app.duffel.com), go to **Developers → API keys**, and create a key starting with `duffel_test_`.

**2. Get a Telegram bot token**

Talk to [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`, and copy the token.

**3. Configure**

```sh
cp .env.example .env
```

Fill in `.env`:

```
TELEGRAM_BOT_TOKEN=<your bot token>
DUFFEL_API_KEY=duffel_test_<your key>
ANTHROPIC_API_KEY=<your key>
MODEL=claude-opus-4-6
```

**4. Find your Telegram user id**

Start the bot without adding yourself to `TELEGRAM_ALLOWED_SENDERS`. DM the bot — it will reply with your user id. Add it to `.env`:

```
TELEGRAM_ALLOWED_SENDERS=123456789
```

**5. Create the project and install dependencies**

```sh
jo new my-booker --template typescope/harpe:flight-booker
cd my-booker
pip install -r requirements.txt
```

**6. Start**

```sh
jo start
```

See [Create a Flight Booking Agent](https://harpe.typescope.ai/tutorial/create-flight-booking-agent/)
for how the approval boundary works.
