export const ENV_PROFILES = {
    dotenv: {
        id: "dotenv",
        label: "Dotenv (.env) — allow `export KEY=...`",
        parse: {
            allowExportPrefix: true,
            allowEmptyValues: true,
            allowDuplicateKeys: true,
        },
    },
    compose: {
        id: "compose",
        label: "Docker Compose env_file — KEY=VALUE only",
        parse: {
            allowExportPrefix: false,
            allowEmptyValues: true,
            allowDuplicateKeys: true,
        },
    },
};
