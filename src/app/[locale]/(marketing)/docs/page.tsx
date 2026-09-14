import type { Metadata } from "next"

export const metadata: Metadata = { title: "Docs" }

const SECTIONS = [
  {
    title: "1 — Install the tracker",
    body: "Paste the snippet before </head> on the site your affiliates link to. It reads ?ref= from the URL, sets a first-party cookie called _referral_id (SameSite=Lax, one year) and posts the click to Indica.",
    code: `<script defer
  src="https://app.example.com/t.js"
  data-key="pk_live_xxxxxxxx"></script>`,
  },
  {
    title: "2 — Identify the customer",
    body: "A click alone proves nothing. When someone signs up, call identify from YOUR SERVER with your secret key. Never from the browser: a customer id posted by a browser could be used to reassign commissions.",
    code: `curl -X POST https://app.example.com/api/identify \\
  -H "Authorization: Bearer sk_live_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "visitorId": "v_ab12cd34ef56gh78",
    "externalId": "user_4821",
    "providerCustomerId": "cus_QX1y2Z"
  }'`,
  },
  {
    title: "3 — Point your webhook at Indica",
    body: "Add the endpoint in Stripe and subscribe to invoice.payment_succeeded, charge.refunded, charge.dispute.created, customer.subscription.updated and customer.subscription.deleted. Every event is verified, then claimed exactly once, so a redelivery can never create a second commission.",
    code: `https://app.example.com/api/webhooks/stripe`,
  },
  {
    title: "4 — Read the commission",
    body: "When Stripe confirms $49.00 on a 30% program, Indica writes a commission of $14.70 against the affiliate that owns the attribution, holds it for the program's hold period, and then makes it payable. A refund adds a −$14.70 reversal and marks the original reversed; nothing is ever deleted.",
    code: `base   4900  (USD minor units)
rate   3000  (basis points = 30%)
────────────────────────────────
result 1470  → $14.70`,
  },
]

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-16 sm:px-6 sm:py-24">
      <h1 className="text-heading-sm font-medium sm:text-heading">
        Integration guide
      </h1>
      <p className="mt-4 text-body-sm leading-relaxed text-muted-foreground">
        Four steps between a fresh workspace and a working referral program.
      </p>

      <div className="mt-12 space-y-10">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h2 className="text-body-lg font-medium tracking-tight">{section.title}</h2>
            <p className="mt-2 text-ui leading-relaxed text-muted-foreground">{section.body}</p>
            <pre
              data-slot="scrollable"
              className="mt-4 overflow-x-auto rounded-panel border border-border bg-surface-1 p-4 font-mono text-meta leading-relaxed text-foreground-secondary"
            >
              <code>{section.code}</code>
            </pre>
          </section>
        ))}
      </div>
    </div>
  )
}
