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
