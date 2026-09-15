+++
title = "The Personalized Discounting Problem"
+++

A shop wants customers to come back. A discount can help, but every discount
costs margin. Give it to someone who was about to buy anyway and the shop earns
less on the same sale. Give everyone the same offer and it may be too small to
interest one customer and unnecessarily generous for another.

The owner needs to decide **who needs an offer, how much to offer, and why**.
The answers depend on each customer's history and the shop's promotion policy.

There is also a limit to what the discount agent needs to know. Purchase dates
and basket amounts are enough for these calculations. A customer's name, home
address, email, and phone number are not. Giving the agent a general customer
lookup would expose personal information that contributes nothing to its task.

## Thirty days means different things

Two customers last bought something thirty days ago.

One normally buys every ten days. The other buys every two months. The first
has missed several expected purchases. The second is still on schedule.

![Two customers last purchased thirty days ago. A ten-day regular is overdue; a sixty-day buyer is still on schedule. A shared inactivity threshold misses the difference.](/img/personalized-discounting-history.svg)

A rule such as "give 10% off to customers inactive for thirty days" treats them
alike. The owner would rather say:

> Offer an incentive when a customer is late relative to their own buying
> pattern, not simply because thirty days have passed.

That requires calculating a purchasing interval for each customer. It also
requires deciding what to do with someone who has bought only once: there is
not enough history to infer a pattern.

## The variety of policies

Choosing the customer is only the beginning. Consider three requests:

> Use the last three purchases to estimate when each customer would normally
> return. Offer a discount after they miss that interval by half again.

The program must order purchases by date, calculate the intervals, and compare
them with the time since the last purchase. A monthly buyer and a weekly buyer
have different deadlines.

> Make the offer about a tenth of their usual basket, with a minimum spend that
> makes sense for that customer.

Now the calculation includes purchase amounts. A customer who usually spends
CHF 30 should not receive the same minimum-spend requirement as one who usually
spends CHF 200. A fixed discount also needs a ceiling so a large historical
order cannot produce an enormous coupon.

> When the allocation is limited, prioritize customers who are furthest past
> their usual return date.

Now the program must compare customers, rank them, and allocate the available
discount budget. Processing rows in database order would produce a different
campaign.

These are different calculations over the same evidence. A promotion form can
expose familiar conditions. Supporting a new calculation means adding another
feature, writing a script, or doing the work in a spreadsheet. The owner then
has to carry those results back into customer-specific coupons and check that
each one reflects the intended policy.

**The problem is turning a changing business policy into individually justified
offers, without manually calculating and configuring each customer's coupon.**

## Why individual tool calls are not enough

Suppose the agent can read a customer's orders and create a discount. Those
tools supply the data and perform the final action. They do not calculate the
campaign.

For every customer, the agent must find the relevant purchases, calculate the
interval and average basket, apply exceptions, and choose an offer. A shared
budget adds comparisons across customers. Sending all the purchase histories
through the model makes the conversation carry the working data and leaves
repeated arithmetic to the model.

Batching the reads reduces calls, but the calculations still need to happen
somewhere. A tool named `calculateReplenishmentOffers` could do them reliably.
Its implementation would then need changing when the owner asks for a different
method, such as comparing seasonal purchases or ranking by relative lateness.

**A generated program supplies that missing computation.** It loops over the
histories, performs the arithmetic, ranks candidates, and produces a list of
offers. The model interprets the policy and writes the program; it does not
have to calculate each customer's offer in its conversation.

This still uses a tool to run code. The distinction is where the work happens:
inside an executable program rather than a long sequence of model-mediated
reads, calculations, and writes. New policies still require the necessary
data; code generation cannot invent missing purchase history.

## The agentic solution

The owner writes the promotion policy in plain language and asks for proposals.
The agent reads the policy and customer histories, generates a Jo program, and
executes it through Harpe.

Each proposal contains:

- The customer and proposed coupon code.
- The discount amount, minimum basket, and expiry.
- A reason showing the purchase figures behind the offer.

The code is a **draft coupon**, not an active Shopify discount. The owner can
approve or reject each proposal. Approval creates that customer-bound coupon;
rejection leaves it inactive. Coupon creation does not send a marketing message.

The owner can change a sentence and generate a new set of proposals. The demo
keeps the policy and customer snapshot used by each run, so the explanation has
a specific body of evidence behind it.

## Purchase history without customer identity

The agent must distinguish one customer's purchases from another's. It does
not need to know who those people are.

In the demo, the agent sees records like this:

```text
customer-1
  50 days ago: CHF 60
  40 days ago: CHF 65
  30 days ago: CHF 55
```

`customer-1` is a reference valid for this proposal run. The trusted application
keeps the mapping to the Shopify customer. The agent uses that reference when
proposing an offer; the application resolves it when the owner approves.

| Needed for the calculation | Not exposed to the agent |
| --- | --- |
| An opaque customer reference | Shopify customer ID |
| Purchase dates | Name, email, phone number |
| Basket amounts | Billing and shipping addresses |
| Campaign policy and limits | Customer notes, payment details |

This is more precise than "read-only access to customers." Read-only access
can still reveal too much. The boundary needs to control **which fields the
generated program can read**, as well as which operations it can perform.

## Why Harpe and Jo?

The generated program needs to read purchase histories and save proposals. It
does not need authority to approve them, publish discounts, change the policy,
or administer the shop.

The demo grants four operations:

```text
Read the campaign limits
Read the promotion policy
Read the customer purchase histories
Save draft offers with reasons
```

Harpe compiles the generated Jo program against this interface. Access to an
undeclared operation, the database implementation, or a network client fails
compilation. Its customer type contains only the opaque reference and purchase
history. There is no `name`, `email`, or `address` field and no operation for
looking them up. A program that tries to read them fails compilation, even if
the trusted implementation could access a richer customer record.

The trusted implementation validates customer scope, discount
amounts, minimum baskets, and the total maximum liability before saving drafts.

Approval belongs to the owner's application. No operation available to the
agent moves a draft into the approved state. The Shopify credential is held by
the merchant process, not passed to the generated program.

These boundaries do not prove that an offer is commercially sensible or that
the agent interpreted the prose correctly. That is why the owner sees the
calculation and decides. Approval also reserves the full value of the coupon
against the campaign allocation; it does not assume that only some customers
will redeem their offers.

Python in a sandbox with a separate trusted service can enforce this design,
too, by exposing only the necessary fields and operations. Jo expresses that
boundary in the types the generated program is compiled against. The trusted
implementation and its broader authority cannot be imported by that program.
This case study demonstrates that narrowing of authority; it does not claim
another language cannot implement it. Purchase histories themselves remain
sensitive data, and anything printed by a generated program can reach the model.

Shopify already supports customer-specific discounts, and Sidekick can create
discounts and generate admin apps. The contribution here is a complete example
of **generated personalized calculations with limited customer data and
draft-only authority**, not a claim that natural-language discount creation is new.

## Try the demo

The [Personalized Discounting project](https://github.com/typescope/personalized-discounting)
provides a customer-history view, an editable policy, coupon proposals, owner
approval, and run reports.

The customer view puts buying patterns next to each other. These labels belong
to the owner's view; the generated program receives only opaque references.

![The demo's customer-history page compares recent purchase dates and basket amounts for six synthetic customers.](/img/personalized-discounting-customers.png)

The policy is editable prose. Saving a change makes it the input to the next
proposal run.

![The policy editor describes how to estimate purchasing intervals, calculate individual offers, and allocate the campaign budget.](/img/personalized-discounting-policy.png)

Proposals show the coupon, its terms, and the calculation behind it. The owner
can review and approve one or reject it.

![Draft coupons show individual discounts, minimum baskets, expiry dates, and reasons, with owner approval and rejection controls.](/img/personalized-discounting-proposals.png)

```sh
git clone https://github.com/typescope/personalized-discounting.git
cd personalized-discounting
pip install -r requirements.txt
cp .env.example .env
jo start
```

Open **http://127.0.0.1:8767**. The initial data is synthetic. **Run sample
policy** executes the included Jo program without an API key. **Generate
proposals** uses a configured model to write and execute a new program for the
saved policy.

Try replacing the first-come allocation rule with prioritization by relative
lateness. Compare the resulting recipients and reasons before approving any
offer. The project README explains how to import a Shopify development store
and create real customer-bound coupons after approval.

The demo has no measured revenue uplift. Commercial effectiveness would need a
controlled campaign that measures incremental purchases and margin after
discounts. It is a local, single-owner prototype, not a deployed marketing
service.

### Shopify references

- [Sidekick discount and segment creation](https://help.shopify.com/en/manual/ai-powered-tools/sidekick/generate-content)
- [Sidekick app generation](https://help.shopify.com/en/manual/ai-powered-tools/sidekick/generate-apps)
- [Customer-specific discount creation](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/DiscountCodeBasicInput)
