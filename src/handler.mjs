import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { XMLParser } from "fast-xml-parser";

const s3 = new S3Client({});
const cf = new CloudFrontClient({});

const WEBSITE_BUCKET = process.env.WEBSITE_BUCKET;
const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID;
const OUTPUT_PREFIX = "about/data";
const FETCH_TIMEOUT_MS = 10_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOGS = JSON.parse(readFileSync(join(__dirname, "blogs.json"), "utf-8"));

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Blogspot/Blogger feeds embed full HTML post content with dense entity
  // usage that exceeds fast-xml-parser's default anti-billion-laughs limits.
  processEntities: { maxTotalExpansions: 20_000, maxExpandedLength: 2_000_000 },
});

function text(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "object" && "#text" in node) return String(node["#text"]);
  return String(node);
}

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

// Some feeds double-encode titles (e.g. "&amp;#39;"), leaving entities after XML parsing.
export function decodeEntities(str) {
  return str.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? m;
    const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

function asArray(node) {
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}

function atomLink(entry) {
  const links = asArray(entry.link);
  const alternate = links.find(l => typeof l === "object" && (l["@_rel"] === "alternate" || !l["@_rel"]));
  const chosen = alternate ?? links[0];
  if (!chosen) return "";
  return typeof chosen === "object" ? (chosen["@_href"] ?? "") : text(chosen);
}

export function normalizeRssItem(item) {
  const title = decodeEntities(text(item.title)).trim();
  const link = text(item.link).trim();
  const date = new Date(text(item.pubDate ?? item["dc:date"]));
  if (!title || !link || Number.isNaN(date.getTime())) return null;
  return { title, link, date: date.toISOString() };
}

export function normalizeAtomEntry(entry) {
  const title = decodeEntities(text(entry.title)).trim();
  const link = atomLink(entry).trim();
  const date = new Date(text(entry.updated ?? entry.published));
  if (!title || !link || Number.isNaN(date.getTime())) return null;
  return { title, link, date: date.toISOString() };
}

export function extractLatestPost(xml) {
  const parsed = xmlParser.parse(xml);

  if (parsed.rss?.channel) {
    const items = asArray(parsed.rss.channel.item);
    for (const item of items) {
      const post = normalizeRssItem(item);
      if (post) return post;
    }
    return null;
  }

  if (parsed.feed) {
    const entries = asArray(parsed.feed.entry);
    for (const entry of entries) {
      const post = normalizeAtomEntry(entry);
      if (post) return post;
    }
    return null;
  }

  return null;
}

async function fetchLatestPost(feedUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(feedUrl, { signal: controller.signal, headers: { "User-Agent": "post-tenebras-lire-blog-feeds/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return extractLatestPost(xml);
  } finally {
    clearTimeout(timeout);
  }
}

export function sortByLatestPostFirst(blogs) {
  return [...blogs].sort((a, b) => {
    if (!a.latestPost && !b.latestPost) return 0;
    if (!a.latestPost) return 1;
    if (!b.latestPost) return -1;
    return new Date(b.latestPost.date) - new Date(a.latestPost.date);
  });
}

export async function handler(_event, _context) {
  const now = new Date();

  const results = await Promise.allSettled(BLOGS.map(blog => fetchLatestPost(blog.feedUrl)));

  const blogs = sortByLatestPostFirst(BLOGS.map((blog, i) => {
    const result = results[i];
    if (result.status === "rejected") {
      console.error(`Error fetching ${blog.name} (${blog.feedUrl}): ${result.reason}`);
    }
    return {
      name: blog.name,
      url: blog.url,
      latestPost: result.status === "fulfilled" ? result.value : null,
    };
  }));

  const output = { generated: now.toISOString(), blogs };

  await s3.send(new PutObjectCommand({
    Bucket: WEBSITE_BUCKET,
    Key: `${OUTPUT_PREFIX}/blogs.json`,
    Body: JSON.stringify(output),
    ContentType: "application/json",
    CacheControl: "max-age=86400",
    ACL: "public-read",
  }));

  await cf.send(new CreateInvalidationCommand({
    DistributionId: DISTRIBUTION_ID,
    InvalidationBatch: {
      Paths: { Quantity: 1, Items: [`/${OUTPUT_PREFIX}/blogs.json`] },
      CallerReference: `blog-feeds-${now.toISOString().replace(/\D/g, "").slice(0, 14)}`,
    },
  }));

  const summary = {
    blogsProcessed: blogs.length,
    blogsWithPost: blogs.filter(b => b.latestPost).length,
  };
  console.log(JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify(summary) };
}
