# Arc News Workers

Runs the **official Arc 3.2 `news.arc` source** on Cloudflare Workers. The original application executes in the [Rainbow.js Arc VM](https://github.com/arclanguage/rainbow-js). A SQLite-backed Durable Object supplies persistent files and serializes requests. Runtime code uses Workers APIs and Web Crypto, without a Scheme process, Node compatibility flag, external server, or JavaScript `eval`.

The complete [official archive](http://www.arclanguage.org/arc3.2.tar) is preserved unchanged under `upstream/`. Its Arc libraries, news application, and static assets are bundled into the Worker. Platform adaptations live separately in `native/workers.arc` and the JavaScript host. This replaces the earlier partial TypeScript/D1 rewrite in this repository.

## Run

Requires Node.js 22.13+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open **http://travis.adn:8787** on travis, or `http://localhost:8787` on another machine. Wrangler binds to `0.0.0.0:8787`. Data persists in `.wrangler/state/`. The Durable Object creates its SQLite schema automatically.

Use the front page's **login** link to create an account. To make your existing account an administrator, add this to an untracked `.dev.vars` file, then restart:

```dotenv
ADMIN_USERS=your_username
```

Register the account before granting it administrator access. The first account is not automatically an administrator. `ADMIN_USERS` accepts comma-separated names and replaces the administrator list when a runtime starts; an empty value clears it. If omitted, the stored list is retained. Administrators have the original `/newsadmin`, `/prompt`, and `/repl` pages, including the ability to execute Arc code.

Set `SITE_NAME` in `wrangler.jsonc` to change the title.

## Deploy

```sh
pnpm exec wrangler login
pnpm deploy
```

Wrangler creates the SQLite-backed Durable Object namespace using the checked-in migration. No D1 database or database ID is needed. Register your production account, add its username to `vars.ADMIN_USERS` in `wrangler.jsonc`, then deploy again. Configuration changes apply when the runtime restarts.

Deployment requires your Cloudflare account. This repository has been built and tested locally; it has not been deployed to Cloudflare.

## What runs

The original application supplies its routes, HTML, Arc macros, forms, closure URLs, rankings, threaded comments, voting, polls, profiles, formatting, RSS, moderation, abuse heuristics, preferences, and administrator tools. These are loaded from the official source. Original behavior includes multiple poll-option votes and GET-based action links.

| Platform facility | Worker adapter |
| --- | --- |
| Scheme Arc runtime | Rainbow.js interpreter and bytecode VM, scoped to each object instance |
| Socket accept loop | Worker `fetch` calls the original `respond` function |
| Files under `arc/` | Ordered SQLite text chunks; all request writes commit together |
| Shared tables and closures | One named Durable Object per site; an explicit queue prevents request interleaving during asynchronous crypto |
| Background ranking and averages | Original `defbg` functions invoked when due, on requests and a 30-second alarm |
| OpenSSL password subprocess | Salted PBKDF2-SHA256 via Web Crypto, with legacy SHA1 verification |
| Random bytes | `crypto.getRandomValues`, including the original `/dev/urandom` reader |
| Static files | Original images and `robots.txt` served by the outer Worker |

The bridge implements Arc 3.2 string interpolation and corrects Rainbow's file/directory existence adapters. The admin status bar omits process-memory usage because Workers does not expose it. New password records use 100,000 PBKDF2 iterations; existing SHA1 records remain unchanged until the password is set again.

Cookies use `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS. POST requests require a matching `Origin`. Cross-site browser requests to closure actions, voting, and the administrator REPL are rejected using Fetch Metadata. Forms have a 64 KiB request limit. Personalized responses are not HTTP-cached. Arc's original cookie lifetime, password-length policy, and account logic otherwise remain in effect.

## Operational limits

- **Open forms and closure links expire on a cold restart or object eviction.** Arc stores callbacks in memory. Reload the page to obtain a new callback. Accounts, cookies, posts, comments, profiles, votes, and other saved Arc files persist. Unsaved REPL changes and request-rate counters do not persist.
- A single object owns the site. Original Arc tables are loaded into its memory, and requests run sequentially. Large sites must be measured against Workers memory, CPU, and storage limits; this port does not add sharding. Cold starts compile the Arc libraries and load saved items.
- The 30-second alarm continues after the first request, running the original maintenance functions. This generates ongoing Durable Object activity.
- General OS subprocesses, sockets, native threads, and process/GC metrics are unavailable. Directory creation and temporary-file cleanup are adapted. Administrator programs that depend on other OS facilities need additional adapters.
- This runs historical Arc 3.2, not today's Hacker News. Original behavior and bugs are retained except for the documented platform adaptations. The tested flows below establish practical compatibility, not complete runtime equivalence.
- Existing Arc data uses the same text representation inside SQLite, and legacy password verification is supported. An import/export tool is not included. The earlier D1 rewrite's data is not automatically migrated.

See Cloudflare's [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) for platform constraints.

## Verify

```sh
pnpm check
pnpm test
pnpm build
```

`check` verifies every official file against its recorded SHA256, verifies the vendored VM, and checks JavaScript syntax. `test` runs the bundled Worker in workerd/Miniflare with real SQLite Durable Object storage. It exercises original forms for registration, submission, comments, nested replies, voting, profile editing, polls, moderation, and the administrator REPL. It also checks restart persistence, expired callbacks, private profile data, static assets, and request validation.

Runtime tests cover macros, closures, continuations, interpolation, background jobs, Unicode serialization, password compatibility, and independent VM state. Storage tests cover chunk boundaries and staged writes.

`build` produces a deployable bundle in `dist/` without deploying it. Generated modules under `native/generated/` are rebuilt from checked-in inputs and excluded from Git.

## Source

- `upstream/`: unmodified official Arc 3.2 distribution; checksums in `SOURCE.json`.
- `vendor/rainbow/`: pinned JavaScript VM, attribution, and checksums.
- `native/worker.js`: HTTP adapter, Durable Object lifecycle, request queue, alarms.
- `native/engine.js`, `host.js`, `runtime-bridge.js`: initialization, virtual filesystem, VM bindings.
- `native/workers.arc`: platform overrides loaded after the official libraries.
- `native/storage.js`, `passwords.js`: SQLite files and Web Crypto passwords.
- `scripts/build-native.mjs`: bundles the original source and VM.

Licensed under Artistic-2.0. See `LICENSE`, `NOTICE`, `upstream/copyright`, and `vendor/rainbow/LICENSE.md`.
