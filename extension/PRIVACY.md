# Privacy: Merchant Transaction Details extension

**What it collects.** When you click **Read my Amazon purchases**, the
extension opens your own Amazon Your Payments and Your Orders pages (and an
order's details page where needed) in the Amazon tab you clicked in, and
keeps only: the date and amount of each charge or refund, its order number,
the names and quantities of the products in that order, and the name Amazon
gives the charge in its Your Payments data (for example "Prime Video
Channels"). It reads nothing when you have not clicked.

**Where it goes.** Only to the Piggy Banks import page the extension opens
when you click **Send to Piggy Banks**, or to a file when you click **Save as
a file**. Any script running on that import page can read what is handed to
it, as it can read the rest of the page. The extension has no server, sends
no analytics, and loads no code from anywhere.

**How long it is kept.** In the browser's memory until you click **Done** or
**Discard**. It stays after sending so you can send it again if the import
page could not load your account. Closing the browser clears it. The
extension writes nothing to disk except a file you save with **Save as a
file**.

**What it does not take.** Your Amazon password (it never sees it). From the
pages it opens it takes only the fields above, not the card, names or
addresses those pages also show, and it drops a charge's name if it could be
part of a card or account number. It does not answer sign-in pages or
security checks; it stops and asks you to.

**What Piggy Banks does with it.** It adds the product names and order number
to the notes of the matching transactions in your Piggy Banks account. See
the Piggy Banks privacy policy at piggybanksonline.com.
