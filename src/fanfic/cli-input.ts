import fs from "fs/promises";

interface IdeaInputArgs {
  idea?: string;
  ideaFile?: string;
}

export async function readFanficIdeaInput(args: string[]): Promise<string> {
  const parsed = parseIdeaInputArgs(args);
  if (parsed.idea && parsed.ideaFile) {
    throw new Error("choose either --idea or --idea-file, not both");
  }
  if (parsed.ideaFile) {
    const text = await fs.readFile(parsed.ideaFile, "utf-8");
    return requireNonEmptyIdea(text);
  }
  if (parsed.idea) {
    return requireNonEmptyIdea(parsed.idea);
  }
  throw new Error("parse_idea requires --idea or --idea-file");
}

function parseIdeaInputArgs(args: string[]): IdeaInputArgs {
  const parsed: IdeaInputArgs = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--idea") {
      parsed.idea = readOptionValue(args, index, arg);
      index += 1;
    } else if (arg === "--idea-file") {
      parsed.ideaFile = readOptionValue(args, index, arg);
      index += 1;
    }
  }
  return parsed;
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(flag + " requires a value");
  }
  return value;
}

function requireNonEmptyIdea(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("parse_idea requires non-empty idea text");
  }
  return trimmed;
}
