import type { Database } from '../db/database.js';

const HASHTAG = /#([\p{L}\p{N}_]{1,60})/gu;
const MENTION = /@([a-zA-Z0-9_]{3,30})/g;

export function hashtagsOf(text: string | null | undefined): string[] {
  if (!text) return [];
  const tags = new Set<string>();
  for (const match of text.matchAll(HASHTAG)) tags.add(match[1].toLowerCase());
  return [...tags].slice(0, 20);
}

export function mentionsOf(text: string | null | undefined): string[] {
  if (!text) return [];
  const names = new Set<string>();
  for (const match of text.matchAll(MENTION)) names.add(match[1].toLowerCase());
  return [...names].slice(0, 10);
}

/** Counts are maintained on write so the tag page never scans every post. */
export async function recordHashtags(db: Database, postId: string, tags: string[]): Promise<void> {
  for (const tag of tags) {
    await db.query(
      `INSERT INTO hashtags (tag, post_count) VALUES ($1, 1)
       ON CONFLICT (tag) DO UPDATE SET post_count = hashtags.post_count + 1`,
      [tag],
    );
    await db.query(`INSERT INTO post_hashtags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [postId, tag]);
  }
}

/** Resolves @names to real accounts and stores one mention row per account. */
export async function recordMentions(
  db: Database,
  input: { postId: string; commentId?: string | null; usernames: string[] },
): Promise<Array<{ id: string; username: string }>> {
  const found: Array<{ id: string; username: string }> = [];
  for (const username of input.usernames) {
    const rows = await db.query<{ id: string; username: string }>(
      `SELECT id, username FROM users WHERE lower(username) = $1 AND status = 'active'`,
      [username],
    );
    const user = rows[0];
    if (!user) continue;
    await db.query(
      `INSERT INTO mentions (post_id, comment_id, mentioned_id) VALUES ($1, $2, $3)`,
      [input.postId, input.commentId ?? null, user.id],
    );
    found.push(user);
  }
  return found;
}
