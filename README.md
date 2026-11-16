# Arc News Workers

Runs the **official Arc 3.2 `news.arc` source** on Cloudflare Workers. The original application executes in the [Rainbow.js Arc VM](https://github.com/arclanguage/rainbow-js). A SQLite-backed Durable Object supplies persistent files and serializes requests. Runtime code uses Workers APIs and Web Crypto, without a Scheme process, Node compatibility flag, external server, or JavaScript `eval`.

The complete [official archive](http://www.arclanguage.org/arc3.2.tar) is preserved unchanged under `upstream/`. Its Arc libraries, news application, and static assets are bundled into the Worker. Platform adaptations live separately in `native/workers.arc` and the JavaScript host. This replaces the earlier partial TypeScript/D1 rewrite in this repository. Compatibility is checked against the official Scheme compiler running in Racket, as well as workerd. This is application compatibility work, not a claim that every Scheme runtime operation has an identical Workers equivalent.

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

The site keeps the official defaults: `My Forum`, the original logo destination and RSS URLs, grey colours, HTML, CSS, images, labels, and administrator bar. The Worker does not override site configuration or page rendering.

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
| Background ranking and averages | Original `defbg` functions invoked when due; alarms track the next 30-second ranking or 45-second averaging deadline |
| OpenSSL password subprocess | Original SHA1 records computed by Web Crypto; earlier PBKDF2 records remain readable |
| Random bytes | `crypto.getRandomValues`, including the original `/dev/urandom` reader |
| Static files | Original `respond` handler reads virtual binary files; HTTP output preserves the bytes and request statistics |

The compatibility layer implements Arc 3.2 interpolation and Scheme string literals, UTF-8 byte ports, Unicode character indexing, signed arithmetic, numeric predicates, real-number formatting, string ordering, and iterative construction of long lists. It also corrects Rainbow's file/directory existence adapters. The original admin status bar is retained. Workers does not expose process-memory usage, so the `memory` primitive returns `0` as an unsupported sentinel; its `0 mb` display is not a measurement. New and reset passwords use the original OpenSSL-style SHA1 record format. Salted PBKDF2 records written by earlier versions of this port can still authenticate; resetting their password writes the original format.

Arc controls the response body, cookies, MIME types, redirects, and cache headers. The Worker strips only HTTP connection/framing headers managed by the Fetch runtime. It does not add a content-security policy, cookie attributes, origin checks, or a custom form-size limit. Query strings, form fields, and cookies are parsed by the original Arc functions. The original request logger runs for HTML and static requests. Cryptographic computation uses Web Crypto.

## Operational limits

- **Open forms and closure links expire on a cold restart or object eviction.** Arc stores callbacks in memory. Reload the page to obtain a new callback. Accounts, cookies, posts, comments, profiles, votes, and other saved Arc files persist. Unsaved REPL changes and request-rate counters do not persist.
- A single object owns the site. Original Arc tables are loaded into its memory, and requests run sequentially. Large sites must be measured against Workers memory, CPU, and storage limits; this port does not add sharding. Cold starts compile the Arc libraries and load saved items.
- Alarms continue after the first request, scheduled for the next original maintenance deadline. This generates ongoing Durable Object activity.
- General OS subprocesses, sockets, native threads, and process/GC metrics are unavailable. Directory creation and temporary-file cleanup are adapted. Administrator programs that depend on other OS facilities need additional adapters.
- HTTP connection teardown is controlled by Cloudflare. An IP rejected by Arc receives an empty 429 response instead of the original socket being forcibly closed. HTTP framing is supplied by the platform.
- Arbitrary Arc programs can still expose VM differences, including JavaScript-number precision and printed representations of functions and exceptions. The compatibility suite covers the news application and selected language operations; it is not a language conformance proof.
- This runs historical Arc 3.2, not today's Hacker News. Original behavior and bugs are retained except for the documented platform adaptations. The tested flows below establish practical compatibility, not complete runtime equivalence.
- Existing Arc data uses the same text representation inside SQLite, and legacy password verification is supported. An import/export tool is not included. The earlier D1 rewrite's data is not automatically migrated.

See Cloudflare's [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) for platform constraints.

## Verify

```sh
pnpm check
pnpm test
pnpm build
```

`check` verifies every official file against its recorded SHA256, verifies the vendored VM, and checks JavaScript syntax. `test` runs the bundled Worker in workerd/Miniflare with real SQLite Durable Object storage. It exercises original forms for registration, submission, comments, nested replies, voting, profile editing, polls, moderation, and the administrator REPL. It also checks restart persistence, expired callbacks, private profile data, static assets, and original request/response behaviour.

The native suite currently has 25 passing tests. It includes Unicode and literal `#(text)` round-trips, invalid item IDs, original query decoding, binary file reads, request logs, password reset, edit/delete confirmation, and saved Arc programs surviving a full restart.

Run the separate original-runtime comparison suite with:

```sh
pnpm reference:setup
pnpm test:reference
```

`reference:setup` downloads the [official Racket 5.3.6 textual distribution](https://download.racket-lang.org/racket-textual-v5.3.6.html), verifies its pinned SHA256, and extracts it into the ignored `.reference/` directory. It does not install system packages or execute the installer shell script. The bundled setup supports Linux x86_64; alternatively set `RACKET` to a compatible installed executable. The reference runtime is used only for tests and is never bundled into the Worker.

The comparison runner copies the unmodified official archive into an isolated temporary directory and executes its `ac.scm`, libraries, and `news.arc`. It checks:

- All 54 registered handlers for anonymous, member, editor, and administrator identities: 216 response comparisons, including closure endpoints, stats, and logout.
- Original forms and their callbacks for registration, reset/login/logout, voting and saved items, editing, deletion/restoration, flagging, poll choices, scrub rules, IP bans, moderation, anti-procrastination, saved Arc programs, delayed comments, submission limits, and pagination. Responses and relevant state are compared after each action.
- Numeric predicates and arithmetic, UTF-8 byte streams, Unicode strings, Scheme reader behaviour, long lists, request parsing, hashing, formatting, and ranking.

Page comparisons use the same seeded data, fixed clocks, and a fixed memory value in both runtimes. Only random callback and cookie identifiers are normalized. The suite preserves original application bugs: for example, anti-procrastination also blocks the affected user's profile, despite the original message suggesting that page as a way to change the setting. Tests compare actual outputs, rather than assuming every advertised original behaviour works.

A smaller presentation regression test also runs without Racket. Storage tests cover chunk boundaries and staged writes. Passing these tests establishes the cases above; it does not establish literal equivalence for every possible input or administrator program.

`build` produces a deployable bundle in `dist/` without deploying it. Generated modules under `native/generated/` are rebuilt from checked-in inputs and excluded from Git.

## Source

- `upstream/`: unmodified official Arc 3.2 distribution; checksums in `SOURCE.json`.
- `vendor/rainbow/`: pinned JavaScript VM, attribution, and checksums.
- `native/worker.js`: HTTP adapter, Durable Object lifecycle, request queue, alarms.
- `native/engine.js`, `host.js`, `runtime-bridge.js`: initialization, virtual filesystem, VM bindings.
- `native/runtime-compat.js`, `parser-string.js`: compatibility corrections applied separately from the unchanged vendored VM.
- `native/reference/`: live comparisons against the original Scheme implementation.
- `native/workers.arc`: platform overrides loaded after the official libraries.
- `native/storage.js`, `passwords.js`: SQLite files and Web Crypto passwords.
- `scripts/build-native.mjs`: bundles the original source and VM.

Licensed under Artistic-2.0. See `LICENSE`, `NOTICE`, `upstream/copyright`, and `vendor/rainbow/LICENSE.md`.
