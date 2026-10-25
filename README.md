# BALEOVA - fashion showcase, inventory and Telegram Mini App

*Born in Bale. Worn Everywhere.*

A product showcase and business system. **There is no cart, checkout or online payment.**
Customers browse, then contact you by phone, WhatsApp or Telegram. You agree the sale, record it in the admin, and stock and reports update.

One Node.js backend and one SQLite database serve three things: the website, the Telegram Mini App (same site, opened inside Telegram) and the admin dashboard.

**No `npm install` is needed.** The app uses only what is built into Node.js (22.13 or newer).

## Run it

```
copy .env.example .env      (Mac/Linux: cp .env.example .env)
npm start
```

- Store: http://localhost:3000
- Admin: http://localhost:3000/admin/
- First run creates the owner account. If `ADMIN_PASSWORD` in `.env` is empty, a random password is printed once in the console. Sign in and change it under Settings.
- The shop starts empty (no demo products). Only the homepage banners are added on first run; edit them in Admin > Settings.
- If you see "port 3000 is already in use", close the other copy of the server or set `PORT=3001` in `.env`.
- Run the automated checks with `npm test`.

## First setup (5 minutes)
1. Sign in to Admin > **Settings** and enter phone, WhatsApp number (with country code, e.g. 251911234567), Telegram username, location, hours and delivery information. The Call / WhatsApp / Telegram buttons on every product use these.
2. Admin > **Products**: add your products with photos, sizes, colours and opening stock.
3. Admin > Settings > **Homepage banners** to change the banners and offers.

## Categories
T-shirts, Hoodies & Sweatshirts, Sneakers & Shoes, Trousers & Pants, Bags & Accessories, **Electronics** and **Other**, plus New arrivals, Best sellers, Special offers and SHEIN Orders. Add products to any of them in Admin > Products. (Existing databases get the two new categories automatically on the next start.)

## Languages: English, Afaan Oromoo, Amharic
- The site has a language switcher (EN / OM / አማ) in the header. The choice is remembered. First-time visitors get Amharic or Afaan Oromoo if their phone or Telegram is set to it.
- All buttons, labels, messages, category names and the WhatsApp/Telegram order messages are translated.
- Your own content can be translated too, all optional: in Admin > Products fill "Name in Afaan Oromoo / Amharic" and the matching descriptions; in Settings > Languages edit the tagline, delivery, policy and SHEIN texts; banners and SHEIN reference items have translated title fields. Anything left blank falls back to English.
- The Telegram bot answers in the customer's language (`/language` lets them pick).
- The admin dashboard itself stays in English.
- **Please have a native speaker read the translations before launch** (`public/js/i18n.js`, `src/i18n.js`). They were written quickly and may need polishing.

## How the business flow works
1. Customer opens a product, picks size and colour, taps **Call**, **WhatsApp** or **Telegram**.
   - WhatsApp opens with a message already filled in: product name, code, size, colour and price.
   - Telegram cannot pre-fill a message for a person, so the message is copied and Telegram opens. The customer pastes it.
2. You confirm and arrange the purchase directly.
3. Admin > **Sales** > record the sale (items, price, channel, customer). Stock goes down in the same database transaction. If any item is short, the whole sale is refused and nothing changes.
4. If the sale is cancelled, **Reverse** it (manager or owner). Stock is restored and the sale stops counting.
5. Dashboard shows today, month and all-time sales, daily/weekly/monthly reports, best sellers and low-stock alerts. Admin > **Inventory** lists every stock movement (opening stock, restock, adjustment, sale, reversal) with who did it.

Nothing is invented. Units sold come only from recorded sales. Ratings and reviews come only from customers. A review shows **Verified purchase** only when the phone number the reviewer typed matches a sale you recorded. Phone numbers are never shown publicly.

## Roles
| Role | Can do |
|---|---|
| Staff | See dashboard, record sales, manage SHEIN requests, view products and stock history |
| Manager | Everything staff can, plus products, stock additions/adjustments, reversing sales, reviews, SHEIN reference items, banners |
| Owner | Everything, plus settings (contact details) and team accounts |

## SHEIN Orders
Separate page on the site, kept apart from in-stock products. Customers see reference photos, links and estimated prices, and can request through WhatsApp, Telegram or phone (messages include the code or link, size, colour and quantity). The page explains that price, shipping, availability and delivery time must be confirmed first. In Admin > SHEIN Orders you log each request and move it through: Requested, Price Quoted, Confirmed, Ordered, In Transit, Arrived, Delivered, Cancelled. Every status change is kept in a history.

## Telegram bot and Mini App
1. In Telegram open @BotFather, send `/newbot`, copy the token.
2. Your site needs a public **HTTPS** address (see Free hosting). For testing use `cloudflared tunnel --url http://localhost:3000`.
3. In `.env` set `BOT_TOKEN=...` and `WEBAPP_URL=https://your-domain`, then restart.
4. Message your bot. `/start` shows the welcome and the **Open BALEOVA Store** button. The bot also has `/stock <name or code>` (availability), `/contact` and `/help`, and a **Store** menu button.
The bot token stays on the server. When a customer submits a review from inside Telegram, their identity is checked on the server using Telegram's signed login data.

## Posting new products to Telegram channels
The same bot posts to **any number of channels or groups**. You do not need a second bot (make a new one only if you want a different name or picture for a channel).
1. In Telegram create a channel (for example one for Men, one for Women, one per language).
2. Open it > Administrators > **Add your bot** and allow **Post messages**.
3. Admin > Settings > **Telegram posting** > **+ Add channel**. Enter `@channelname` (or the `-100...` number for a private channel or group), choose the **language** (English, Afaan Oromoo or Amharic) and which products it receives (everything, Men or Women; unisex items go to both). Press **Save, then send test post** to confirm.
4. **Every new product is then posted automatically** with its first photo, name, code, price (and discount), the sizes and colours that are in stock, condition and gender, your phone and address, and buttons: **Order on WhatsApp** (opens a ready message with the product code), **Message on Telegram**, and **Open in store**.
- When adding a product there is a tick box "Post to Telegram when saved". Untick it to keep a product quiet. Turn automatic posting off completely in Settings > Telegram posting.
- Products list > **Post / Post again** sends it (again) to the channels you tick, for example after a restock. Each channel is posted in its own language, using your Afaan Oromoo / Amharic names and descriptions when you filled them in.
- If Telegram refuses a post (for example the bot is not an admin) the admin shows a plain message, the product is still saved, and the last error is shown next to the channel.
- Posts never include stock counts, ratings or sales numbers. Out-of-stock and archived products are not posted.
- Telegram does not allow "call" buttons, so the phone number is written in the post (tap to call). Captions are limited to 1,024 characters, so long descriptions are shortened. Posts are sent one by one with a short pause to stay inside Telegram's limits.
- **Open in store opens the product inside Telegram:** in @BotFather create a Mini App with `/newapp` (URL = your site), put its short name in Settings > Telegram posting > *Mini App short name*, and fill *Telegram bot username* in the contact details. Without this, the button opens the website address instead.
- Posting needs the server to be awake. On a free host adding a product in Admin wakes it, so automatic posting works; scheduled posts at a set time are not included.
- Please have a native speaker check the Afaan Oromoo and Amharic post wording (`POST` in `src/i18n.js`).

## Free hosting (no credit card)

**Recommended: Render free web service** + a free GitHub account.

1. Create a free account at github.com, make a new **private** repository, and upload the contents of this folder (not the zip itself). Do not upload `.env`.
2. In Telegram: @BotFather > `/newbot` > copy the token. Open your new bot and press **Start**. Message @userinfobot to get your numeric ID.
3. At render.com sign up with GitHub (no card asked for free web services), choose **New > Blueprint** (or **New > Web Service**: runtime Node, plan Free, start command `node server.js`), pick your repository.
4. In the service's Environment, set `ADMIN_PASSWORD` (long), `BOT_TOKEN`, `ADMIN_CHAT_ID`, and `WEBAPP_URL` = `https://<your-service-name>.onrender.com`. Save; it redeploys.
5. Open the URL, then `/admin/`, sign in as `owner`, fill Settings (phone, WhatsApp, Telegram), add products.
6. In @BotFather: `/setuserpic` and choose `public/brand/telegram-avatar.png`; `/setdomain` is not needed. The bot's Store button opens the Mini App.
7. Optional but recommended: add a free monitor at uptimerobot.com that visits `https://<your-service>.onrender.com/healthz` every 5 minutes. (`KEEP_AWAKE=1` already makes the site visit itself.)

**Your data is safe on a free host.** Free hosts wipe the disk on restart. This app saves a compressed backup (database + photos) into your private chat with the bot, pinned, a few minutes after any change and on shutdown. On a fresh start it restores from that pinned file automatically. Rules: do not pin other messages in that chat, do not delete the backup file, keep `BOT_TOKEN` and `ADMIN_CHAT_ID` the same. Limit: Telegram allows 20 MB, so if photos grow past about 19 MB only the database is backed up (a message is logged). Keep photos small, or move to a paid disk/VPS later.

Free-tier limits: Render sleeps a free site after 15 minutes without visitors (about 1 minute to wake), unless KEEP_AWAKE/UptimeRobot keeps it up; 750 free hours a month is enough for one always-on service.

**Other free options**
- Hugging Face Spaces (Docker, free, no card): create a Space with the Docker SDK, upload these files (the `Dockerfile` is included, port 7860). Same environment variables as Secrets. Same Telegram backup protects the data.
- Your own PC/phone: `npm start` plus a free Cloudflare Tunnel for HTTPS. Data stays on your disk; it is only online while the PC is on.

**Paid-free alternative** (VPS): copy the folder, create `.env` from `.env.example`, run behind Caddy for HTTPS, keep alive with pm2, back up `baleova.db` and `uploads/`.

## Security notes
- Passwords are hashed with scrypt. Sessions are random tokens stored hashed, sent in an HttpOnly, SameSite cookie, and expire after 12 hours. Login attempts are rate limited.
- All admin actions check the role on the server. State-changing admin requests need a custom header, which blocks cross-site form attacks.
- All input is validated on the server. Page content is built with safe DOM calls (no raw HTML from data). A Content-Security-Policy limits scripts to this site and Telegram's script.
- Uploaded images are checked by their real file signature (JPEG, PNG, WebP only), renamed randomly, and size limited. Public review photo uploads and review submissions are rate limited. Reviews wait for your approval.
- Images are shrunk in the browser before upload, lazy-loaded on the site and cached for a week.
- Secrets are only in `.env` on the server. Never commit `.env`.

## Project layout
```
server.js            start-up, headers, routes
src/db.js            schema, settings, transactions
src/services.js      products, stock, sales, reversals, reports
src/public-api.js    site API (products, reviews, SHEIN)
src/admin-api.js     admin API (role-protected)
src/auth.js          login, sessions, roles
src/telegram.js      bot + Mini App signature check
src/channels.js      posts products to Telegram channels (design, languages, buttons, queue)
src/i18n.js          category names, default shop texts and bot messages in 3 languages
public/js/i18n.js    storefront text in 3 languages
src/mini.js          tiny built-in web framework (no dependencies)
public/              website      public/admin/  dashboard
scripts/test.js      automated checks     scripts/test-backup.js  backup/restore check
src/backup.js        Telegram backup + restore (free hosting)
public/brand/        logo files (SVG + PNG icons, Telegram avatar)
```

## Men / Women and New / Bonda

- Every product has **For** (Unisex, Men, Women) and **Condition** (Brand new, Bonda = second-hand). Set both in Admin > Products > Edit.
- Storefront: nav and home tiles for Men, Women, Brand new and Bonda. Men and Women also include unisex items. The shop page has filter chips for both.
- Bonda items show a "Bonda" badge and a short note. The condition is included in the WhatsApp/Telegram order message.
- API: `/api/products?category=men|women|brand-new|bonda` or `?gender=` / `?cond=`.
- Search: visible Search buttons in the header and on the shop page; the admin Products, Sales and Inventory search boxes have them too.
