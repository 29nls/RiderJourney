/**
 * One visibility rule for every audience-bearing row (posts, albums, trip
 * photos), so feed and albums cannot disagree about who may see what.
 *
 * Bind contract for every query that embeds this fragment:
 *   $1 viewer id (uuid)   $2 row deleted (boolean or null)   $3 row status (text or null)
 *
 * The row's own author/audience/community columns are referenced directly, so
 * the same fragment works for a single-row lookup and for a whole feed page.
 *
 * Precedence, from strictest to loosest:
 * - Authors always see their own rows, including ones hidden from everyone else.
 * - `private` never leaves the author.
 * - `followers` requires an accepted follow (a pending request is not enough).
 * - `community` requires an active membership of that same community.
 * - `public` still hides rows deleted by the author or removed by moderation.
 *
 * Blocks and mutes stay out of this rule: they are per-viewer social choices,
 * so each list query applies them as an extra filter.
 */
export function audienceAllowed(column: {
  author: string;
  audience: string;
  community: string;
}): string {
  const { author, audience, community } = column;
  return `(
    ${author} = $1
    OR (
      ${audience} = 'public'
      AND $2::boolean IS FALSE
      AND ($3::text IS NULL OR $3::text = 'published')
    )
    OR (
      ${audience} = 'followers'
      AND $2::boolean IS FALSE
      AND ($3::text IS NULL OR $3::text = 'published')
      AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = ${author})
      AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = ${author} AND b.blocked_id = $1)
    )
    OR (
      ${audience} = 'community'
      AND ${community} IS NOT NULL
      AND $2::boolean IS FALSE
      AND ($3::text IS NULL OR $3::text = 'published')
      AND EXISTS (
        SELECT 1 FROM community_members m
        WHERE m.community_id = ${community} AND m.user_id = $1 AND m.status = 'active'
      )
    )
  )`;
}
