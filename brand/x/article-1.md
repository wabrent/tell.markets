# Every token has a tell

*Why we built Tell, what it reads, and how to use it before you buy anything on Robinhood Chain.*

[IMAGE: 0-cover.png]

## The table you sit at

In the last 24 hours, 771 tokens launched on Pons.

Most of them will never trade. Of the 3,565 launches Tell has scored so far, fewer than 1% still had a pool with $5,000 of liquidity a few days later. That's not a bug of the launchpad. That's what a permissionless casino looks like: anyone can deal, everyone can play.

Most of those tokens die quietly. Nobody bought them. Nobody did anything wrong.

Some are killed. A deployer who keeps half the supply and sells it into the first buyers. Six fresh wallets funded from the same address. A site that promises buybacks that never happen. A "buy" link to a launchpad that isn't the real one.

Those are tells. In poker, a tell is the small gesture that gives a bluff away. Every rug has one. Most people just don't have fifteen minutes to look for it before they ape.

[IMAGE: 1-numbers.png]

## What Tell reads

Paste a token address or a DexScreener link at tell.markets. Within seconds you get one score from 0 to 100 and a plain-English verdict, built from six groups of checks:

**01 Contract.** Who owns it, whether the owner can mint, pause, blacklist or change taxes, and whether the code can be swapped behind a proxy.

**02 Holders.** Top wallets without the pools and curves, wallets seeded from one address, snipers from the first blocks. Rebuilt from every transfer since launch.

**03 Deployer.** Who pressed launch, what they still hold, whether they've sold, and every token they launched before.

**04 Website.** An AI read of the project's site: a working product or a waitlist, wallet-harvesting forms, promises that don't add up.

**05 Promises vs the chain.** What the site says against what the chain shows: burns that never happened, an audit that is "done" and "not done" on the same page, buy links to look-alike launchpad domains, dead GitHub and app links.

**06 Market.** Liquidity, pool age and sell pressure, straight from the DEX.

0–29 is low risk, 30–59 medium, 60–79 caution, 80+ high. A critical finding, like an owner who can still mint, pushes the score to 80 on its own.

[IMAGE: 2-checks.png]

Every report has its own link, so you can drop it in the group chat before anyone buys:

[IMAGE: 3-report.png]

## Watch where the supply goes

Numbers tell you what. The token map tells you who. Every address that touched the token, every transfer since launch, and a replay you can scrub block by block: the deployer selling into the pool, the wallets that move together, the snipers from block one.

[IMAGE: 4-map.png]

## Your bot buys fast. Let it read first.

More and more buying on Robinhood Chain is done by agents, not people. They need the same check, in a form they can call.

Tell runs a public MCP server and a plain HTTP API. Add one line to Claude, Cursor or your own agent:

`https://tell.markets/mcp`

and it can call `check_token`, `compare_tokens` and `recent_launches` before every trade. Quick checks are free. Full checks are free right now; pay-per-check in USDG over x402 is built and switches on soon, so an agent can pay for exactly what it uses without an account or an API key.

[IMAGE: 5-agents.png]

## Don't trust the score. Check it.

A risk score is only worth something if you can see how it holds up. So we publish that too, at tell.markets/accuracy, including the parts that don't flatter us.

The first thing it shows: a low score doesn't mean a token will go up. Low-risk launches die about as often as high-risk ones, because most launches die regardless. Tell doesn't predict winners. It looks for the people holding a knife. The measure that matters is what happened after the check: did the deployer dump, did the holders run? That data is filling in now, and it will be published as it comes, good or bad.

Every verdict is also hashed into an hourly ledger, so a score can't quietly change after the fact. Anchoring those roots on Robinhood Chain is next.

## About $TELL

There is no $TELL token yet.

When there is, the only official address will be posted on tell.markets and pinned here. Anything called TELL before that is a fake, and Tell flags it as one in every check.

## Try it

Check any token: tell.markets
Watch today's launches: tell.markets/launches
Connect your agent: tell.markets/docs

Read the tell before you buy.

*Tell states facts and a risk score. It can be wrong, and nothing here is financial advice.*
