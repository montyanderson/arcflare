# Arc News Workers

A TypeScript port of the core `news.arc` application to Cloudflare Workers and D1. The Worker uses standard Fetch and Web Crypto APIs. No Node compatibility flag, Scheme process, filesystem, external database, or client-side JavaScript is required at runtime.

Based on the [public Arc 3 news source](https://github.com/wting/hackernews/blob/master/news.arc), with an unmodified copy in `upstream/news.arc`. This is a functional port, not an Arc interpreter or a complete behavior-compatible replacement for the original application.

## Run locally

Requires Node.js 22.12+ and pnpm. Dependencies and their build permissions are pinned in the lockfile and `pnpm-workspace.yaml`.

```sh
pnpm install
pnpm db:migrate
pnpm dev
```

The development server binds to `0.0.0.0:8787`. On travis, open **http://travis.adn:8787**. The local database persists under `.wrangler/state/`; it is excluded from Git. No sample accounts or passwords are installed.

Create your account through `/login`, then explicitly grant it administrator access:

```sh
pnpm exec wrangler d1 execute DB --local --command "UPDATE users SET role='admin' WHERE id='your_username'"
```

The first person to register does not automatically become an administrator. Editors can review flags and kill/restore items. Administrators can also ban/unban users. Roles can be assigned with D1 SQL.

## Deploy to your Cloudflare account

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create arc-news
```

Replace the all-zero `database_id` in `wrangler.jsonc` with the returned ID. Set `SITE_NAME` and `SITE_DESCRIPTION`, then run:

```sh
pnpm exec wrangler d1 migrations apply DB --remote
pnpm deploy
```

Register your production account and run the administrator SQL above with `--remote`. The hourly cron deletes expired sessions and rate-limit entries. An authenticated Cloudflare account with Workers and D1 permissions is required. No production database has been created and no Cloudflare deployment has been performed by this project setup.

## Implemented

- Ranked front page, newest, best, active discussions, ask/show filters, polls, recent/best comments, per-user submissions and comments, leaders, and RSS.
- Link/text submissions, normalized duplicate URLs, nested replies, paragraph/italic/code formatting, two-hour author editing, and deletion that preserves replies.
- Upvotes, undoing votes, comment downvotes at 500 karma, atomic score/karma changes, one poll choice per user, private saved items, and flags.
- Registration/login, private profile email, password changes, session expiry/revocation, administrator bans, moderation queues, and an action log.
- Server-rendered responsive HTML, accessible form labels, POST-only mutations, origin/CSRF checks, escaped content, restrictive CSP, request-size limits, and database-backed rate limits.

## Porting decisions and limits

| Original Arc implementation | Worker implementation |
| --- | --- |
| `srv.arc` socket server and closure URLs | ES module `fetch` handler and explicit routes |
| Files under `arc/news/` | D1 relational tables, indexes, constraints and transactions |
| Process-wide item/profile/vote tables | Per-request D1 reads; no durable state in isolate globals |
| Random background re-ranking | Recompute on each front-page read across the latest 1,000 stories |
| `frontpage-rank` | Original score exponent `.8`, gravity `1.8`, 120-minute base, text `.4`, image and controversy penalties |
| In-process login/session state | Salted PBKDF2-SHA256 passwords; random sessions stored as SHA256 hashes |
| Background cleanup | Workers scheduled handler |

This release deliberately differs from Arc in several areas:

- It does not run arbitrary Arc code or preserve REPL hooks, server administration pages, IP/domain ban lists, word-scrubbing rules, sockpuppet scoring, voting-bias heuristics, automatic flag killing, delayed comments, or anti-procrastination settings.
- It does not import an existing Arc data directory or migrate legacy password hashes. Start with a new database; do not replace a live Arc installation without a separate data migration.
- Email is private profile metadata only; outbound mail, address verification and forgotten-password recovery are not implemented. Password changes require the current password.
- Comment rendering is limited to 500 descendants and 20 visible nesting levels per view, with links to continue subthreads. The recursive query caps depth at 64. Listings paginate 30 items at a time. Ranking/best/active consider the latest 1,000 stories.
- Code/italics/paragraphs are supported; automatic linkification, some Arc formatting rules, custom colors, and user display preferences are not ported.
- PBKDF2 uses 100,000 iterations, compatible with the tested Workers Web Crypto runtime. Authentication CPU cost must be evaluated against your selected Workers plan before exposing registration at scale. Rate limits are basic per-IP/per-account limits, not the original abuse detection system.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS. Local HTTP preview omits `Secure`. All form POSTs require a matching `Origin`; authenticated forms also require a CSRF token. API clients must supply both.
- No shared HTTP cache is used. Personalized pages are marked `no-store`.

## Verification

```sh
pnpm check
pnpm test
pnpm build
```

Tests run the actual bundled Worker in workerd/Miniflare with D1, rather than mocking the database. They cover accounts and cookies, CSRF, submission, concurrent voting, nested replies, authorization, polls, moderation, private profile data, password/session revocation, pagination, rate limits, deleted-thread rendering, and the Arc ranking formula.

The test runtime is pinned to the Miniflare version bundled with the pinned Wrangler release, including its v4 options adapter. Test data is isolated from the local preview database. The build command creates a deployable Worker bundle without deploying it.

## Source layout

`src/index.ts` handles HTTP and scheduled events. `auth.ts` handles identity, forms, and rate limits. `actions.ts` contains mutations; `pages.ts` contains reads; `html.ts` renders HTML; `ranking.ts` contains the ranking formula. `migrations/0001_news.sql` defines the database and voting triggers.

Licensed under Artistic-2.0. Original copyright and modification notes are in `NOTICE` and `upstream/copyright`.
