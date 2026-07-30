# Blog Feeds (SAM)

Fetches the latest post from each recommended blog's RSS/Atom feed daily.
Outputs a single JSON file to your static site's S3 bucket, rendered client-side
under "Je recommande ces blogs" on the Jekyll home page.

[![Quality gate status](https://sonarcloud.io/api/project_badges/measure?project=christ-off_blog-feeds&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=christ-off_blog-feeds) [![Coverage](https://sonarcloud.io/api/project_badges/measure?project=christ-off_blog-feeds&metric=coverage)](https://sonarcloud.io/summary/new_code?id=christ-off_blog-feeds)

## Architecture

```
EventBridge (daily 06:15 UTC)
  └─ Lambda (Node.js 22)
       ├─ Reads src/blogs.json (name, url, feedUrl per blog)
       ├─ Fetches + parses each feed (RSS or Atom)
       ├─ Writes about/data/blogs.json to website S3
       └─ Invalidates CloudFront cache
```

## Prerequisites

- AWS CLI configured (`aws configure`)
- SAM CLI installed (`pip install aws-sam-cli`)

## Deploy

```bash
sam build
sam deploy --guided
```

On first deploy, SAM will prompt for:

| Parameter        | Value                             |
|-------------------|------------------------------------|
| `WebsiteBucket`   | Your website S3 bucket name        |
| `DistributionId`  | Your CloudFront distribution ID    |

SAM saves your answers in `samconfig.toml` for subsequent deploys (`sam deploy` without `--guided`).

## Test locally

```bash
npm install
npm test
```

```bash
sam build
sam local invoke BlogFeedsFunction
```

## Test in AWS (manual trigger)

```bash
aws lambda invoke \
  --region eu-west-3 \
  --cli-read-timeout 0 \
  --function-name $(sam list stack-outputs --stack-name blog-feeds --region eu-west-3 --output json | jq -r '.[] | select(.OutputKey=="FunctionName") | .OutputValue') \
  /dev/stdout
```

## Adding / removing a blog

Edit `src/blogs.json` — `{ name, url, feedUrl }` — then redeploy (`sam build && sam deploy`).

## Output JSON shape

```json
{
  "generated": "2026-07-30T06:15:00.000Z",
  "blogs": [
    {
      "name": "Un Spicilège",
      "url": "https://blogz.zaclys.com/un-spicilege/",
      "latestPost": { "title": "Evil Dead Burn", "date": "2026-07-15T15:08:42.000Z", "link": "https://..." }
    },
    { "name": "...", "url": "...", "latestPost": null }
  ]
}
```

`latestPost` is `null` when the feed couldn't be fetched or parsed that day (logged as an error in CloudWatch) — e.g. a blog whose feed is proxied through `follow.it` (a Blogger newsletter redirect), which returns HTTP 400 to non-browser requests.

## Jekyll integration

See `PostTenebrasLire/_includes/home_blogs.html` and `javascript/recommended-blogs.js`,
which fetch `/about/data/blogs.json` client-side (same pattern as `blog-analytics`'s
`chart-snippet.html`).

## Monthly cost

| Resource                          | Cost     |
|-----------------------------------|----------|
| Lambda (1 run/day, ~10s, 256MB)   | ~$0.00   |
| CF invalidation (1/day)           | $0.00    |
| **Total**                         | **~$0**  |
