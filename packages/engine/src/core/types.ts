// packages/engine/src/core/types.ts

export type Severity = "high" | "medium" | "low";

/** Parser preset (drives defaults in parseEnv) */
export type EnvProfile = "basic" | "dotenv";

export type ParseErrorCode =
  | "INVALID_LINE"
  | "EMPTY_KEY"
  | "UNTERMINATED_QUOTE"
  | "INVALID_ESCAPE";

export type ParseError = {
  line: number;
  code: ParseErrorCode;
  message: string;
  raw: string;
};

export type EnvParseOptions = {
  /** Choose a preset; you can still override individual options below. */
  profile?: EnvProfile;

  allowExportPrefix?: boolean;
  allowEmptyValues?: boolean;
  allowDuplicateKeys?: boolean;

  /** Strip inline comments like `KEY=value # comment` (not inside quotes) */
  stripInlineComments?: boolean;

  /** Allow multiline quoted values (dotenv-like) */
  allowMultiline?: boolean;

  /** Expand $VAR and ${VAR} from already-parsed keys */
  expandVariables?: boolean;

  /** Extra variables available to expansion (optional) */
  expandFrom?: Record<string, string>;
};

export type ParsedConfig = {
  format: "env";
  entries: Record<string, string>;
  duplicates: { key: string; lines: number[] }[];
  errors: ParseError[];
  warnings: string[];
  meta: { lineCount: number; profile: EnvProfile };
};

// --------------------
// Diff types
// --------------------
export type AddedEntry = { key: string; value: string };
export type RemovedEntry = { key: string; value: string };
export type ChangedEntry = { key: string; from: string; to: string };
export type UnchangedEntry = { key: string; value: string };

export type DiffResult = {
  added: AddedEntry[];
  removed: RemovedEntry[];
  changed: ChangedEntry[];
  unchanged: UnchangedEntry[];
};

export type RiskFinding = {
  key: string;
  severity: Severity;
  ruleId: string;
  message: string;
};

export type DiffWithRisk = DiffResult & {
  findings: RiskFinding[];
  warnings: string[];
};

// --------------------
// Redaction types
// --------------------
export type RedactionOptions = {
  maskChar?: string;
  revealLast?: number;
  revealFirst?: number;
  minMaskLength?: number;
};

export type RedactedValue = {
  originalLength: number;
  redacted: string;
};

// --------------------
// Display model used by the web app
// --------------------
export type DiffDisplayModel = DiffWithRisk & {
  redactedValues: Record<
    string,
    { from?: RedactedValue; to?: RedactedValue; value?: RedactedValue }
  >;

  /** Optional extra metadata your UI/worker can use */
  meta?: {
    profile: EnvProfile;
    parse: {
      left: Pick<ParsedConfig, "errors" | "duplicates" | "warnings" | "meta">;
      right: Pick<ParsedConfig, "errors" | "duplicates" | "warnings" | "meta">;
    };
  };
};
