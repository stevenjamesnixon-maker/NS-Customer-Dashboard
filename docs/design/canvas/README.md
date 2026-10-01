# Customer dashboard design canvas (reference only)

Exported 30 Sep 2026 from the Design canvas "Customer dashboard" (8 artboards). **These files are the visual spec for release 1.1. They are not code to deploy.**

- They are Design-canvas files: `<x-dc>`, `<helmet>`, and the `support.js` / `DCLogic` script are canvas plumbing. Ignore them. Read the markup and the `<style>` blocks.
- Bracketed text (`[AM name]`, `[SO number]`, `[Nu-Heat logo]`) is placeholder data.
- The artboards have fixed sizes (1440 wide for desktop, 390 for phone, 760 for the email). The built pages must be **fluid**: centred at the stated `max-width`, stacking as `Mobile.dc.html` shows below about 720 px.

| File | Screen |
|---|---|
| `Email.dc.html` | 14-day digest email |
| `Main.dc.html` | Dashboard, desktop |
| `Mobile.dc.html` | Dashboard, phone |
| `Delivery.dc.html` | Arrange delivery (one sales order) |
| `ConfirmBacs.dc.html` | Confirmation, BACS |
| `ConfirmCard.dc.html` | Confirmation, card |
| `Order.dc.html` | Place order (release 2, not 1.1) |
| `Update.dc.html` | Tell us where you're up to (release 2, not 1.1) |

## Customer emails v2 (added 1 Oct 2026)

| File | Screen |
|---|---|
| `EmailDeliveryLink.dc.html` | "Book your delivery" email for one sales order (send-link Suitelet) |
| `EmailDigestV2.dc.html` | The 14-day projects update (digest), v2 with progress bars |

These two replace `Email.dc.html` as the email spec. Grey boxes are image placeholders. Emails are built with tables and HTML attributes (Send Quote 2.2.0 robustness rules), not the flex/grid used to draw them here.
