import { describe, expect, it } from "vitest";
import {
  EDITORIAL_KINDS,
  EDITORIAL_KIND_LABELS,
  extractVideoId,
  isValidSlug,
  toParagraphs,
  validateEditorialItem,
  youTubeThumbnailUrl,
  youTubeWatchUrl,
} from "./validation";

const ARTICLE = {
  kind: "article",
  slug: "mtn-q3-2026-results",
  title: "MTN Nigeria lifts margin on data growth",
  body: "First paragraph.\n\nSecond paragraph.",
};

const VIDEO = {
  kind: "video",
  slug: "interview-with-an-analyst",
  title: "What the results mean",
  video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  guestName: "Dr Adaeze Okafor",
};

describe("kinds", () => {
  it("labels every kind the database accepts", () => {
    for (const kind of EDITORIAL_KINDS) expect(EDITORIAL_KIND_LABELS[kind]).toBeTruthy();
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase words joined by single hyphens", () => {
    expect(isValidSlug("mtn-q3-2026-results")).toBe(true);
    expect(isValidSlug("abc")).toBe(true);
  });

  it("rejects anything that could become a path, scheme or traversal", () => {
    for (const slug of ["../etc/passwd", "a/b", "a//b", "Upper", "has space", "dot.dot", "a%2fb", "-lead", "trail-", "a--b", "ab", "x".repeat(121)]) {
      expect(isValidSlug(slug)).toBe(false);
    }
  });
});

describe("extractVideoId", () => {
  it("accepts a bare id and the usual YouTube link shapes", () => {
    expect(extractVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30s")).toBe("dQw4w9WgXcQ");
  });

  it("refuses anything that is not a YouTube video", () => {
    for (const value of [
      "",
      "   ",
      "javascript:alert(1)",
      "https://evil.test/watch?v=dQw4w9WgXcQ",
      "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
      "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/channel/dQw4w9WgXcQ",
      "https://youtu.be/../../etc",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      expect(extractVideoId(value)).toBeNull();
    }
  });

  it("never returns anything the URL builders would reject", () => {
    const id = extractVideoId("https://www.youtube.com/watch?v=aBc-123_xyZ");
    expect(id).toBe("aBc-123_xyZ");
    expect(youTubeWatchUrl(id as string)).toBe("https://www.youtube.com/watch?v=aBc-123_xyZ");
    expect(youTubeThumbnailUrl(id as string)).toBe("https://i.ytimg.com/vi/aBc-123_xyZ/hqdefault.jpg");
  });

  it("refuses to build a URL from anything else", () => {
    expect(() => youTubeWatchUrl("javascript:x")).toThrow();
    expect(() => youTubeThumbnailUrl("../../evil")).toThrow();
  });
});

describe("toParagraphs", () => {
  it("splits on blank lines and collapses whitespace", () => {
    expect(toParagraphs("One.\n\nTwo.")).toEqual(["One.", "Two."]);
    expect(toParagraphs("Wrapped\nline.\n\n\n  Next.  ")).toEqual(["Wrapped line.", "Next."]);
  });

  it("returns nothing for empty prose", () => {
    expect(toParagraphs("")).toEqual([]);
    expect(toParagraphs("   \n\n   ")).toEqual([]);
  });

  it("does not interpret markup, it is only ever text", () => {
    // The renderer puts these in a text node; nothing here becomes an element.
    expect(toParagraphs("<script>alert(1)</script>")).toEqual(["<script>alert(1)</script>"]);
  });
});

describe("validateEditorialItem", () => {
  it("accepts a well-formed article and video", () => {
    expect(validateEditorialItem(ARTICLE)).toEqual({ ok: true, videoId: null });
    expect(validateEditorialItem(VIDEO)).toEqual({ ok: true, videoId: "dQw4w9WgXcQ" });
  });

  it("requires a kind the database accepts", () => {
    expect(validateEditorialItem({ ...ARTICLE, kind: "podcast" }).ok).toBe(false);
  });

  it("requires a usable address and a title", () => {
    expect(validateEditorialItem({ ...ARTICLE, slug: "../escape" }).ok).toBe(false);
    expect(validateEditorialItem({ ...ARTICLE, title: "  " }).ok).toBe(false);
    expect(validateEditorialItem({ ...ARTICLE, title: "x".repeat(201) }).ok).toBe(false);
  });

  it("requires prose for an article and none for a video", () => {
    expect(validateEditorialItem({ ...ARTICLE, body: "   " }).ok).toBe(false);
    expect(validateEditorialItem({ ...VIDEO, body: undefined }).ok).toBe(true);
  });

  it("requires a YouTube video and a named guest for a video", () => {
    expect(validateEditorialItem({ ...VIDEO, video: "https://evil.test/x" }).ok).toBe(false);
    expect(validateEditorialItem({ ...VIDEO, guestName: " " }).ok).toBe(false);
  });

  it("requires AI-assisted work to name the model", () => {
    expect(validateEditorialItem({ ...ARTICLE, aiAssisted: true }).ok).toBe(false);
    expect(validateEditorialItem({ ...ARTICLE, aiAssisted: true, aiModel: "claude-opus-5" }).ok).toBe(true);
  });
});
