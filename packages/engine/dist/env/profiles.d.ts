import { EnvParseOptions } from "../core/types";
export type EnvProfileId = "dotenv" | "compose";
export type EnvProfile = {
    id: EnvProfileId;
    label: string;
    parse: EnvParseOptions;
};
export declare const ENV_PROFILES: Record<EnvProfileId, EnvProfile>;
//# sourceMappingURL=profiles.d.ts.map