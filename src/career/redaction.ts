const EXCLUDED_PREFIXES = ["downloads/", "novels/", "fanfics/", "materials/runs/"];
const EXCLUDED_NAMES = new Set([".env"]);

export function isExcludedEvidencePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return EXCLUDED_NAMES.has(normalized)
    || EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || /(^|\/)(raw-response|model-response)\.(txt|json|md)$/i.test(normalized);
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(?:sk|api)[-_][A-Za-z0-9_-]{8,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\/(?:Users|home)\/[^/\s]+/g, "/[REDACTED_HOME]");
}
