/**
 * Editorial input rules, kept pure so they can be tested without a database.
 * Every one is enforced again by a check constraint or a trigger; the point here
 * is a readable message at the moment of typing.
 */

export const EDITORIAL_KINDS = ["article", "analysis", "video"] as const;
export type EditorialKind = (typeof EDITORIAL_KINDS)[number];

export const EDITORIAL_KIND_LABELS: Record<EditorialKind, string> = {
  article: "Article",
  analysis: "Analysis",
  video: "Video",
};

export const MAX_TITLE = 200;
export const MAX_STANDFIRST = 400;
export const MAX_CLAIM = 500;

/** Mirrors the slug check constraint: lowercase words joined by single hyphens. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Mirrors the video_id check constraint. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The reader-facing notice on every video. Guests speak for themselves, and a
 * financial platform must not let an interview read as its own recommendation.
 */
export const VIDEO_DISCLAIMER = "Guest views are their own. Not investment advice.";

export function isValidSlug(value: string): boolean {
  const slug = value.trim();
  return slug.length >= 3 && slug.length <= 120 && SLUG.test(slug);
}

/**
 * A YouTube video id from either a bare id or a YouTube URL.
 *
 * Only the id is ever stored, so no arbitrary address can reach an href or an
 * image source. Anything not recognisably a YouTube video returns null rather
 * than being passed through.
 */
export function extractVideoId(value: string): string | null {
  const input = value.trim();
  if (!input) return null;
  if (VIDEO_ID.test(input)) return input;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let candidate: string | null = null;

  if (host === "youtu.be") {
    candidate = url.pathname.slice(1);
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") candidate = url.searchParams.get("v");
    else if (url.pathname.startsWith("/embed/")) candidate = url.pathname.slice("/embed/".length);
    else if (url.pathname.startsWith("/shorts/")) candidate = url.pathname.slice("/shorts/".length);
  }

  if (!candidate) return null;
  const id = candidate.split("/")[0];
  return VIDEO_ID.test(id) ? id : null;
}

/** Watch link, built from the stored id rather than any supplied address. */
export function youTubeWatchUrl(videoId: string): string {
  if (!VIDEO_ID.test(videoId)) throw new Error("Not a YouTube video id.");
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Thumbnail, from the one Google image host allowed by the Content Security Policy. */
export function youTubeThumbnailUrl(videoId: string): string {
  if (!VIDEO_ID.test(videoId)) throw new Error("Not a YouTube video id.");
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Body text as paragraphs. Plain prose only — nothing is interpreted as markup. */
export function toParagraphs(body: string): string[] {
  return body
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export interface EditorialInput {
  kind: string;
  slug: string;
  title: string;
  standfirst?: string;
  body?: string;
  video?: string;
  guestName?: string;
  aiAssisted?: boolean;
  aiModel?: string;
}

export type EditorialValidation =
  | { ok: true; videoId: string | null }
  | { ok: false; error: string };

export function validateEditorialItem(input: EditorialInput): EditorialValidation {
  if (!(EDITORIAL_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, error: "Choose article, analysis or video." };
  }

  if (!isValidSlug(input.slug)) {
    return {
      ok: false,
      error: "The web address may only use lowercase letters, numbers and single hyphens, e.g. mtn-q3-2026-results.",
    };
  }

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give it a title." };
  if (title.length > MAX_TITLE) return { ok: false, error: `Keep the title under ${MAX_TITLE} characters.` };

  if ((input.standfirst ?? "").length > MAX_STANDFIRST) {
    return { ok: false, error: `Keep the standfirst under ${MAX_STANDFIRST} characters.` };
  }

  if (input.aiAssisted && !(input.aiModel ?? "").trim()) {
    return { ok: false, error: "Name the model that assisted, so readers can be told." };
  }

  if (input.kind === "video") {
    const videoId = extractVideoId(input.video ?? "");
    if (!videoId) {
      return { ok: false, error: "Paste a YouTube link or video id. Only YouTube videos can be shown." };
    }
    if (!(input.guestName ?? "").trim()) {
      return { ok: false, error: "Name the guest." };
    }
    return { ok: true, videoId };
  }

  if (toParagraphs(input.body ?? "").length === 0) {
    return { ok: false, error: "Write the body." };
  }

  return { ok: true, videoId: null };
}
