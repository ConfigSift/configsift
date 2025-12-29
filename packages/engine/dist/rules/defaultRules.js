export const DEFAULT_RULES = [
    // -----------------------------
    // Secrets / auth material
    // -----------------------------
    {
        id: "key-secret-like",
        severity: "high",
        keyPattern: /(SECRET|TOKEN|PASSWORD|PASS(WD)?|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|JWT|AUTH|SESSION|COOKIE|CSRF)/i,
        message: (k) => `Sensitive key '${k}' changed/added/removed. Verify secrets and deployment settings.`,
    },
    // Empty secret-ish values (high signal)
    {
        id: "secret-empty",
        severity: "high",
        keyPattern: /(SECRET|TOKEN|PASSWORD|PASS(WD)?|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|JWT|CSRF)/i,
        valuePattern: /^\s*$/,
        message: "Sensitive-looking key is set but empty. This typically breaks auth or creates unsafe defaults.",
    },
    // Accidental private key / cert blocks
    {
        id: "pem-block-in-value",
        severity: "high",
        valuePattern: /-----BEGIN [A-Z0-9 _-]+-----/i,
        message: "Value appears to contain a PEM/key/cert block. Treat as a secret leak and rotate immediately.",
    },
    // AWS access key pattern (common leak)
    {
        id: "aws-access-key-like",
        severity: "high",
        valuePattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
        message: "Value looks like an AWS Access Key ID. Treat as sensitive and rotate if this is real.",
    },
    // -----------------------------
    // Databases / queues / caches
    // -----------------------------
    {
        id: "key-database-like",
        severity: "high",
        keyPattern: /(DATABASE|DB(_|$)|DBURL|CONNECTION_STRING|REDIS|MONGO|MYSQL|POSTGRES|PGHOST|PGUSER|PGPASSWORD|RABBIT|KAFKA)/i,
        message: (k) => `Database/infrastructure key '${k}' changed. Confirm the environment targets the correct backend.`,
    },
    // Empty DB/infrastructure values
    {
        id: "infra-empty",
        severity: "high",
        keyPattern: /(DATABASE|DB(_|$)|DBURL|CONNECTION_STRING|REDIS|MONGO|MYSQL|POSTGRES|PGHOST|PGUSER|PGPASSWORD|RABBIT|KAFKA|S3|BUCKET)/i,
        valuePattern: /^\s*$/,
        message: "Infrastructure key is set but empty. This typically breaks startup or routes to the wrong backend.",
    },
    // -----------------------------
    // Debug / env mode / logging
    // -----------------------------
    {
        id: "debug-true",
        severity: "high",
        keyPattern: /^(DEBUG|APP_DEBUG)$/i,
        valuePattern: /^(true|1|yes|on)$/i,
        message: "Debug mode appears enabled. Consider disabling for production environments.",
    },
    {
        id: "node-env-nonprod",
        severity: "medium",
        keyPattern: /^(NODE_ENV|ENV|APP_ENV)$/i,
        valuePattern: /^(dev|development|test|testing|local|staging)$/i,
        message: "Environment mode appears non-production. Double-check this is intended.",
    },
    {
        id: "loglevel-verbose",
        severity: "medium",
        keyPattern: /(LOG_LEVEL|LOGGER|LOGGING|LEVEL)$/i,
        valuePattern: /^(debug|trace|silly|verbose)$/i,
        message: "Log level is very verbose. Consider reducing in production to avoid leaking sensitive data.",
    },
    // -----------------------------
    // CORS / URLs / hosts
    // -----------------------------
    {
        id: "cors-wildcard",
        severity: "high",
        keyPattern: /(CORS|ORIGIN|ORIGINS|ALLOWED_ORIGINS|ALLOW_ORIGINS)/i,
        valuePattern: /(^|[,\s])\*($|[,\s])/,
        message: "CORS appears to allow wildcard '*'. This is usually unsafe for production APIs.",
    },
    {
        id: "localhost-in-value",
        severity: "medium",
        valuePattern: /(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/i,
        message: "Value references localhost/loopback. Ensure this is correct for the target environment.",
    },
    {
        id: "http-url",
        severity: "medium",
        keyPattern: /(URL|URI|ORIGIN|ENDPOINT|HOST)/i,
        valuePattern: /^http:\/\//i,
        message: "Value uses http://. Prefer https:// for production environments.",
    },
    // -----------------------------
    // “Footgun flags”
    // -----------------------------
    {
        id: "disable-auth-flag",
        severity: "high",
        keyPattern: /(DISABLE_AUTH|SKIP_AUTH|BYPASS_AUTH|NO_AUTH|ALLOW_INSECURE|INSECURE|DISABLE_TLS|SKIP_TLS_VERIFY)/i,
        valuePattern: /^(true|1|yes|on)$/i,
        message: "Auth/TLS safety flag appears enabled. Verify this is not set in production.",
    },
    // -----------------------------
    // Placeholder values (high value rule)
    // -----------------------------
    {
        id: "placeholder-value",
        severity: "high",
        valuePattern: /\b(changeme|change_me|todo|tbd|replace_me|your[_-]?(api|secret|token|key)|example|dummy|xxx+)\b/i,
        message: "Value looks like a placeholder (e.g., 'changeme', 'TODO', 'your_api_key'). Replace before deploying.",
    },
];
