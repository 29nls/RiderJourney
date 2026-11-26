export type AppConfig = {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  databaseSsl: boolean;
  authMode: 'local';
  jwtSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  exposeDevTokens: boolean;
  plateKey: Buffer | null;
  routingProvider: string;
  routingBaseUrl: string;
  routingApiKey: string;
  geocodingProvider: string;
  geocodingBaseUrl: string;
  geocodingApiKey: string;
  mapTileStyleUrl: string;
  mapAttribution: string;
  corsOrigins: string[];
  redisUrl: string;
  inviteHmacPepper: string;
  realtimeTicketTtlSeconds: number;
  positionTtlSeconds: number;
  staleAfterSeconds: number;
  convoyCapacityDefault: number;
  convoyCapacityMax: number;
  convoyInviteLinkBase: string;
  chatRateLimitPerMinute: number;
  chatTypingCharsPerSecond: number;
  hazardTtlSeconds: number;
  hazardMaxTtlSeconds: number;
  hazardDuplicateRadiusM: number;
  hazardRateLimitPerHour: number;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  voiceTokenTtlSeconds: number;
  contactKey: Buffer | null;
  mediaS3Endpoint: string;
  mediaS3Bucket: string;
  mediaS3Region: string;
  mediaS3AccessKey: string;
  mediaS3SecretKey: string;
  mediaS3ForcePathStyle: boolean;
  mediaUploadTtlSeconds: number;
  mediaDeletionMaxAttempts: number;
  mediaDeletionBackoffSeconds: number;
  mediaMaxBytes: number;
  mediaMaxVideoBytes: number;
  mediaSignedUrlTtlSeconds: number;
  albumQuotaBytesDefault: number;
  postRateLimitPerHour: number;
  commentRateLimitPerHour: number;
  fcmServerKey: string;
  fcmProjectId: string;
  billingEnabled: boolean;
  paidFeaturesEnabled: boolean;
  googlePlayPackageName: string;
  googlePlayServiceAccountJson: string;
  googlePlayApiBase: string;
  googlePlayAccessToken: string;
  billingNotificationSecret: string;
  redeemCodePepper: string;
  adminStepUpTtlSeconds: number;
  exportTtlDays: number;
  deletionGraceDays: number;
};

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Hazard TTL, typing budget, and other Phase 3 tunables accept deliberate
// fractional values (e.g. 0.002 s) because tests need short windows.
function positiveFloat(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const secret = env.AUTH_JWT_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('AUTH_JWT_SECRET must be set to at least 32 characters');
  }
  if ((env.AUTH_MODE ?? 'local') !== 'local') {
    throw new Error('Only AUTH_MODE=local is implemented in Phase 1');
  }

  let plateKey: Buffer | null = null;
  if (env.PLATE_ENCRYPTION_KEY) {
    const key = Buffer.from(env.PLATE_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) throw new Error('PLATE_ENCRYPTION_KEY must be 32 bytes base64');
    plateKey = key;
  }

  if (nodeEnv === 'production' && !env.REDIS_URL) {
    throw new Error('REDIS_URL must be set in production for convoy realtime');
  }

  let contactKey: Buffer | null = plateKey;
  if (env.CONTACT_ENCRYPTION_KEY) {
    const key = Buffer.from(env.CONTACT_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) throw new Error('CONTACT_ENCRYPTION_KEY must be 32 bytes base64');
    contactKey = key;
  }

  return {
    nodeEnv,
    port: int(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://riderjourney:riderjourney@localhost:5432/riderjourney',
    databaseSsl: bool(env.DATABASE_SSL, false),
    authMode: 'local',
    jwtSecret: secret,
    accessTtlSeconds: int(env.AUTH_ACCESS_TTL_SECONDS, 900),
    refreshTtlDays: int(env.AUTH_REFRESH_TTL_DAYS, 30),
    exposeDevTokens: bool(env.AUTH_EXPOSE_DEV_TOKENS, nodeEnv !== 'production'),
    plateKey,
    routingProvider: env.ROUTING_PROVIDER ?? '',
    routingBaseUrl: env.ROUTING_BASE_URL ?? '',
    routingApiKey: env.ROUTING_API_KEY ?? '',
    geocodingProvider: env.GEOCODING_PROVIDER ?? '',
    geocodingBaseUrl: env.GEOCODING_BASE_URL ?? '',
    geocodingApiKey: env.GEOCODING_API_KEY ?? '',
    mapTileStyleUrl: env.MAP_TILE_STYLE_URL ?? '',
    mapAttribution: env.MAP_ATTRIBUTION ?? '',
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    redisUrl: env.REDIS_URL ?? '',
    inviteHmacPepper: env.INVITE_HMAC_PEPPER ?? secret,
    realtimeTicketTtlSeconds: int(env.REALTIME_TICKET_TTL_SECONDS, 60),
    positionTtlSeconds: int(env.REALTIME_POSITION_TTL_SECONDS, 300),
    staleAfterSeconds: int(env.CONVOY_STALE_AFTER_SECONDS, 30),
    convoyCapacityDefault: int(env.CONVOY_CAPACITY_DEFAULT, 3),
    convoyCapacityMax: int(env.CONVOY_CAPACITY_MAX, 30),
    convoyInviteLinkBase: env.CONVOY_INVITE_LINK_BASE ?? 'riderjourney://convoy/join?code=',
    chatRateLimitPerMinute: int(env.CHAT_RATE_LIMIT_PER_MINUTE, 30),
    chatTypingCharsPerSecond: positiveFloat(env.CHAT_TYPING_CHARS_PER_SECOND, 4),
    hazardTtlSeconds: int(env.HAZARD_TTL_SECONDS, 7200),
    // A hazard may be shortened but never outlive the default window; shorter
    // windows only exist so tests can watch expiry without waiting two hours.
    hazardMaxTtlSeconds: Math.min(int(env.HAZARD_MAX_TTL_SECONDS, 7200), int(env.HAZARD_TTL_SECONDS, 7200)),
    hazardDuplicateRadiusM: int(env.HAZARD_DUPLICATE_RADIUS_M, 80),
    hazardRateLimitPerHour: int(env.HAZARD_RATE_LIMIT_PER_HOUR, 12),
    livekitUrl: env.LIVEKIT_URL ?? '',
    livekitApiKey: env.LIVEKIT_API_KEY ?? '',
    livekitApiSecret: env.LIVEKIT_API_SECRET ?? '',
    voiceTokenTtlSeconds: int(env.VOICE_TOKEN_TTL_SECONDS, 300),
    contactKey,
    mediaS3Endpoint: env.MEDIA_S3_ENDPOINT ?? '',
    mediaS3Bucket: env.MEDIA_S3_BUCKET ?? '',
    mediaS3Region: env.MEDIA_S3_REGION ?? 'auto',
    mediaS3AccessKey: env.MEDIA_S3_ACCESS_KEY ?? '',
    mediaS3SecretKey: env.MEDIA_S3_SECRET_KEY ?? '',
    // Path style is what MinIO and most S3-compatible servers require; AWS can
    // switch this off when it needs virtual-hosted buckets.
    mediaS3ForcePathStyle: bool(env.MEDIA_S3_FORCE_PATH_STYLE, true),
    mediaUploadTtlSeconds: int(env.MEDIA_UPLOAD_TTL_SECONDS, 300),
    mediaDeletionMaxAttempts: int(env.MEDIA_DELETION_MAX_ATTEMPTS, 5),
    mediaDeletionBackoffSeconds: int(env.MEDIA_DELETION_BACKOFF_SECONDS, 30),
    mediaMaxBytes: int(env.MEDIA_MAX_BYTES, 5_242_880),
    mediaMaxVideoBytes: int(env.MEDIA_MAX_VIDEO_BYTES, 104_857_600),
    // Signed URLs for private media expire on their own; nothing long-lived is stored.
    mediaSignedUrlTtlSeconds: int(env.MEDIA_SIGNED_URL_TTL_SECONDS, 300),
    albumQuotaBytesDefault: int(env.ALBUM_QUOTA_BYTES_DEFAULT, 209_715_200),
    postRateLimitPerHour: int(env.POST_RATE_LIMIT_PER_HOUR, 20),
    commentRateLimitPerHour: int(env.COMMENT_RATE_LIMIT_PER_HOUR, 120),
    // Push is optional: without these the service stores notifications and
    // registered devices but reports push as unconfigured instead of failing.
    fcmServerKey: env.FCM_SERVER_KEY ?? '',
    fcmProjectId: env.FCM_PROJECT_ID ?? '',
    // Paid features stay off until legal terms, Play products, and server
    // verification credentials are configured. Default is deliberately false.
    billingEnabled: bool(env.BILLING_ENABLED, false),
    paidFeaturesEnabled: bool(env.PAID_FEATURES_ENABLED, false),
    googlePlayPackageName: env.GOOGLE_PLAY_PACKAGE_NAME ?? '',
    googlePlayServiceAccountJson: env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ?? '',
    googlePlayApiBase: env.GOOGLE_PLAY_API_BASE ?? 'https://androidpublisher.googleapis.com',
    googlePlayAccessToken: env.GOOGLE_PLAY_ACCESS_TOKEN ?? '',
    billingNotificationSecret: env.BILLING_NOTIFICATION_SECRET ?? '',
    redeemCodePepper: env.REDEEM_CODE_PEPPER ?? secret,
    adminStepUpTtlSeconds: int(env.ADMIN_STEP_UP_TTL_SECONDS, 600),
    exportTtlDays: int(env.DATA_EXPORT_TTL_DAYS, 7),
    deletionGraceDays: int(env.ACCOUNT_DELETION_GRACE_DAYS, 30),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
