import fs from "fs/promises";

export async function readNovelTextFile(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  if (looksLikeUtf16Le(buffer)) {
    return stripBom(buffer.toString("utf16le"));
  }
  return stripBom(buffer.toString("utf-8"));
}

function looksLikeUtf16Le(buffer: Buffer): boolean {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return true;
  const sampleLength = Math.min(buffer.length, 2000);
  if (sampleLength < 4) return false;

  let oddNulls = 0;
  let evenNulls = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index % 2 === 0) evenNulls += 1;
    else oddNulls += 1;
  }
  return oddNulls > sampleLength * 0.2 && oddNulls > evenNulls * 4;
}

function stripBom(text: string): string {
  return text.replace(/^\ufeff/, "");
}
