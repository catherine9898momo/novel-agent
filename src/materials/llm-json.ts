export function parseJsonObjectFromText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    return JSON.parse(fenced[1]);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Model response does not contain a JSON object");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}


export function extractJsonArrayPropertyFromText(text: string, propertyName: string): unknown[] | undefined {
  const propertyPattern = new RegExp(`"${escapeRegExp(propertyName)}"\\s*:\\s*\\[`);
  const match = propertyPattern.exec(text);
  if (!match) return undefined;

  const arrayStart = text.indexOf("[", match.index);
  if (arrayStart === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = arrayStart; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (depth === 0) {
      return JSON.parse(text.slice(arrayStart, index + 1)) as unknown[];
    }
  }

  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
