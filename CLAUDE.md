# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AWS SAM application — a Node.js Lambda that runs daily, fetches each blog's RSS/Atom feed from `src/blogs.json`, and writes `about/data/blogs.json` to the `post-tenebras-lire.net` static website S3 bucket. EventBridge triggers it at 06:15 UTC. Sibling project to `../blog-analytics` (same conventions).

## Commands

```bash
# Tests
npm test

# Build
sam build

# Deploy (first time — prompts for WebsiteBucket, DistributionId)
sam deploy --guided

# Deploy (subsequent)
sam deploy

# Run locally (requires AWS credentials)
sam local invoke BlogFeedsFunction

# Trigger deployed function manually
aws lambda invoke \
  --region eu-west-3 \
  --cli-read-timeout 0 \
  --function-name $(sam list stack-outputs --stack-name blog-feeds --region eu-west-3 --output json | jq -r '.[] | select(.OutputKey=="FunctionName") | .OutputValue') \
  /tmp/lambda-out.json && cat /tmp/lambda-out.json
```

## Architecture

- `src/handler.mjs` — single Lambda entry point (`handler(event, context)`); pure functions (`extractLatestPost`, `normalizeRssItem`, `normalizeAtomEntry`) are exported for testing
- `src/blogs.json` — canonical config: `[{ name, url, feedUrl }, ...]`, bundled into the Lambda package
- `src/package.json` — `fast-xml-parser` production dependency (bundled by `sam build`'s Node.js esbuild/npm-install step; AWS SDK v3 comes from the Lambda runtime, not bundled)
- `tests/handler.test.mjs` — Vitest unit tests
- `template.yaml` — SAM template; defines the function, IAM policies, schedule, and parameters

## Runtime

- Node.js 22, 256 MB, 120s timeout
- Native `fetch` for HTTP; `fast-xml-parser` for RSS/Atom parsing

### Data flow

1. Lambda reads `src/blogs.json`, fetches each `feedUrl` in parallel (`Promise.allSettled`, 10s timeout each)
2. Parses XML and normalizes either RSS `<item>` (`pubDate`, falling back to `dc:date` for SPIP feeds) or Atom `<entry>` (`updated`/`published`, `<link rel="alternate">`) into `{ title, link, date }`
3. On fetch/parse failure for a blog, logs the error and sets `latestPost: null` for it — the rest of the run is unaffected
4. Writes `about/data/blogs.json` to `WEBSITE_BUCKET` and invalidates that CloudFront path

### Output JSON shape

```json
{ "generated": "...", "blogs": [{ "name": "...", "url": "...", "latestPost": { "title": "...", "date": "...", "link": "..." } }] }
```

### fast-xml-parser entity limits

`processEntities.maxTotalExpansions` is raised from the library default of 1000 — Blogspot/Blogger feeds embed full HTML post content with entity-dense markup that trips the default anti-billion-laughs guard on legitimate feeds.
