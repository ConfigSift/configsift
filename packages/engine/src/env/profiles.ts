// packages/engine/src/env/profiles.ts
import { EnvParseOptions } from "../core/types";

export type EnvProfileId = "dotenv" | "compose";

export type EnvProfile = {
  id: EnvProfileId;
  label: string;
  parse: EnvParseOptions;
};

export const ENV_PROFILES: Record<EnvProfileId, EnvProfile> = {
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
