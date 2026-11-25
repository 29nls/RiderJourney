export type UserRow = {
  id: string;
  email: string;
  username: string;
  password_hash: string | null;
  display_name: string;
  bio: string | null;
  city: string | null;
  avatar_url: string | null;
  visibility: string;
  status: string;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
};

export type PublicUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  bio: string | null;
  city: string | null;
  avatarUrl: string | null;
  visibility: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
};

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    city: row.city,
    avatarUrl: row.avatar_url,
    visibility: row.visibility,
    status: row.status,
    emailVerified: row.email_verified,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export const ACCESS_TOKEN_ISSUER = 'riderjourney';
export const ACCESS_TOKEN_AUDIENCE = 'riderjourney-android';
