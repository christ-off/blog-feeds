import { describe, it, expect } from "vitest";
import { extractLatestPost, normalizeRssItem, decodeEntities, normalizeAtomEntry, sortByLatestPostFirst } from "../src/handler.mjs";

describe("normalizeRssItem", () => {
  it("normalizes a valid item", () => {
    const post = normalizeRssItem({
      title: "Evil Dead Burn",
      link: "https://blogz.zaclys.com/un-spicilege/evil-dead-burn",
      pubDate: "Thu, 30 Jul 2026 18:50:51 +0200",
    });
    expect(post).toEqual({
      title: "Evil Dead Burn",
      link: "https://blogz.zaclys.com/un-spicilege/evil-dead-burn",
      date: new Date("Thu, 30 Jul 2026 18:50:51 +0200").toISOString(),
    });
  });

  it("returns null when title is missing", () => {
    expect(normalizeRssItem({ link: "https://example.com", pubDate: "Thu, 30 Jul 2026 18:50:51 +0200" })).toBeNull();
  });

  it("returns null when date is invalid", () => {
    expect(normalizeRssItem({ title: "T", link: "https://example.com", pubDate: "not a date" })).toBeNull();
  });

  it("falls back to dc:date when pubDate is missing (SPIP feeds)", () => {
    const post = normalizeRssItem({
      title: "Don Mark Lemon",
      link: "https://livres.gloubik.info/spip.php?article1524",
      "dc:date": "2026-07-28T15:42:41Z",
    });
    expect(post).toEqual({
      title: "Don Mark Lemon",
      link: "https://livres.gloubik.info/spip.php?article1524",
      date: "2026-07-28T15:42:41.000Z",
    });
  });
});

describe("normalizeAtomEntry", () => {
  it("normalizes an entry with a single link object", () => {
    const post = normalizeAtomEntry({
      title: "Post title",
      link: { "@_href": "https://example.blogspot.com/2026/07/post.html", "@_rel": "alternate" },
      updated: "2026-07-28T10:00:00.000Z",
    });
    expect(post).toEqual({
      title: "Post title",
      link: "https://example.blogspot.com/2026/07/post.html",
      date: "2026-07-28T10:00:00.000Z",
    });
  });

  it("picks the alternate link among multiple links", () => {
    const post = normalizeAtomEntry({
      title: "Post title",
      link: [
        { "@_href": "https://example.blogspot.com/feeds/comments", "@_rel": "replies" },
        { "@_href": "https://example.blogspot.com/2026/07/post.html", "@_rel": "alternate" },
      ],
      published: "2026-07-28T10:00:00.000Z",
    });
    expect(post.link).toBe("https://example.blogspot.com/2026/07/post.html");
  });

  it("returns null when link is missing", () => {
    expect(normalizeAtomEntry({ title: "T", updated: "2026-07-28T10:00:00.000Z" })).toBeNull();
  });
});

describe("sortByLatestPostFirst", () => {
  it("orders blogs by most recent post first", () => {
    const blogs = [
      { name: "Old", latestPost: { date: "2026-01-01T00:00:00.000Z" } },
      { name: "New", latestPost: { date: "2026-07-01T00:00:00.000Z" } },
      { name: "Mid", latestPost: { date: "2026-04-01T00:00:00.000Z" } },
    ];
    expect(sortByLatestPostFirst(blogs).map(b => b.name)).toEqual(["New", "Mid", "Old"]);
  });

  it("pushes blogs with no latest post to the end", () => {
    const blogs = [
      { name: "NoPost", latestPost: null },
      { name: "HasPost", latestPost: { date: "2026-01-01T00:00:00.000Z" } },
    ];
    expect(sortByLatestPostFirst(blogs).map(b => b.name)).toEqual(["HasPost", "NoPost"]);
  });

  it("does not mutate the input array", () => {
    const blogs = [
      { name: "A", latestPost: { date: "2026-01-01T00:00:00.000Z" } },
      { name: "B", latestPost: { date: "2026-07-01T00:00:00.000Z" } },
    ];
    sortByLatestPostFirst(blogs);
    expect(blogs.map(b => b.name)).toEqual(["A", "B"]);
  });
});

describe("extractLatestPost", () => {
  it("parses an RSS 2.0 feed and returns the first item", () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Un Spicilège</title>
          <item>
            <title>Evil Dead Burn</title>
            <link>https://blogz.zaclys.com/un-spicilege/evil-dead-burn</link>
            <pubDate>Thu, 30 Jul 2026 18:50:51 +0200</pubDate>
          </item>
          <item>
            <title>Older post</title>
            <link>https://blogz.zaclys.com/un-spicilege/older</link>
            <pubDate>Mon, 20 Jul 2026 10:00:00 +0200</pubDate>
          </item>
        </channel>
      </rss>`;
    const post = extractLatestPost(xml);
    expect(post.title).toBe("Evil Dead Burn");
    expect(post.link).toBe("https://blogz.zaclys.com/un-spicilege/evil-dead-burn");
  });

  it("parses an Atom feed and returns the first entry", () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Example blog - Atom</title>
        <entry>
          <title>Post title</title>
          <link href="https://example.blogspot.com/2026/07/post.html" rel="alternate"/>
          <updated>2026-07-28T10:00:00.000Z</updated>
        </entry>
      </feed>`;
    const post = extractLatestPost(xml);
    expect(post.title).toBe("Post title");
    expect(post.link).toBe("https://example.blogspot.com/2026/07/post.html");
  });

  it("returns null for a feed with no valid entries", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;
    expect(extractLatestPost(xml)).toBeNull();
  });

  it("returns null for malformed/unrecognized XML", () => {
    expect(extractLatestPost("<html><body>Not a feed</body></html>")).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("decodes numeric, hex and named entities", () => {
    expect(decodeEntities("D&#39;un &#8211; Dja&#239;z &amp; M&#xe9;thode")).toBe("D'un – Djaïz & Méthode");
  });

  it("leaves unknown entities untouched", () => {
    expect(decodeEntities("a &foo; b")).toBe("a &foo; b");
  });
});

describe("double-encoded titles", () => {
  it("decodes entities left after XML parsing", () => {
    const xml = `<rss><channel><item><title>La route &amp;#8211; Connie</title><link>http://x/1</link><pubDate>Sun, 13 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    expect(extractLatestPost(xml).title).toBe("La route – Connie");
  });
});
