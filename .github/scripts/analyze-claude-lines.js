#!/usr/bin/env node
#!/usr/bin/env -S bun run

// src/scripts/analyze-claude-lines.ts
import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
var execGitCommand = (args, cwd) => {
  return new Promise((resolve) => {
    const proc = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => stdout += data.toString());
    proc.stderr.on("data", (data) => stderr += data.toString());
    proc.on("close", (code) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code || 0 });
    });
  });
};
var collectClaudeNotesFromCommits = async (testDir, baseCommit, headCommit) => {
  const commitsResult = await execGitCommand(["log", "--format=%H", `${baseCommit}..${headCommit}`], testDir);
  const commits = commitsResult.stdout.split(`
`).filter((hash) => hash.trim());
  const contributions = [];
  const contentSignatures = { hashes: new Set };
  for (const commitHash of commits) {
    const notesResult = await execGitCommand(["notes", "show", commitHash], testDir);
    if (notesResult.code === 0) {
      const noteLines = notesResult.stdout.split(`
`);
      for (const line of noteLines) {
        if (line === "claude-was-here" || line.startsWith("version:")) {
          continue;
        }
        if (line.startsWith("content-signatures:")) {
          const hashesStr = line.substring("content-signatures:".length).trim();
          if (hashesStr) {
            const hashes = hashesStr.split(",").map((h) => h.trim()).filter((h) => h);
            hashes.forEach((hash) => contentSignatures.hashes.add(hash));
          }
          continue;
        }
        const match = line.match(/^([^:]+):\s+(.+)$/);
        if (match) {
          const filepath = match[1].trim();
          const ranges = match[2].trim();
          contributions.push({ commitHash, filepath, ranges });
        }
      }
    }
  }
  return { contributions, contentSignatures };
};
var consolidateClaudeContributions = async (testDir, contributions) => {
  const finalClaudeLines = {};
  const parseRanges = (ranges) => {
    const lines = [];
    for (const rangeStr of ranges.split(",")) {
      const trimmed = rangeStr.trim();
      if (trimmed.includes("-")) {
        const [start, end] = trimmed.split("-").map((n) => parseInt(n));
        for (let i = start;i <= end; i++) {
          lines.push(i);
        }
      } else {
        lines.push(parseInt(trimmed));
      }
    }
    return lines;
  };
  for (const contribution of contributions) {
    const { filepath, ranges } = contribution;
    if (!finalClaudeLines[filepath]) {
      finalClaudeLines[filepath] = new Set;
    }
    const lines = parseRanges(ranges);
    for (const lineNum of lines) {
      finalClaudeLines[filepath].add(lineNum);
    }
  }
  const existingFiles = {};
  for (const [filepath, lineSet] of Object.entries(finalClaudeLines)) {
    try {
      const fileContent = await readFile(join(testDir, filepath), "utf-8");
      const totalLines = fileContent.split(`
`).length;
      const validLines = new Set;
      for (const lineNum of lineSet) {
        if (lineNum >= 1 && lineNum <= totalLines) {
          validLines.add(lineNum);
        }
      }
      if (validLines.size > 0) {
        existingFiles[filepath] = validLines;
      }
    } catch (error) {
      continue;
    }
  }
  return existingFiles;
};
var convertLinesToRanges = (lines) => {
  if (lines.length === 0)
    return "";
  const sortedLines = [...new Set(lines)].sort((a, b) => a - b);
  const ranges = [];
  let start = sortedLines[0];
  let end = sortedLines[0];
  for (let i = 1;i < sortedLines.length; i++) {
    if (sortedLines[i] === end + 1) {
      end = sortedLines[i];
    } else {
      if (start === end) {
        ranges.push(start.toString());
      } else {
        ranges.push(`${start}-${end}`);
      }
      start = end = sortedLines[i];
    }
  }
  if (start === end) {
    ranges.push(start.toString());
  } else {
    ranges.push(`${start}-${end}`);
  }
  return ranges.join(",");
};
var generateClaudeNote = (claudeLineMapping, contentSignatures) => {
  let output = `claude-was-here
version: 1.1
`;
  const filesWithLines = Object.keys(claudeLineMapping).filter((filepath) => claudeLineMapping[filepath].size > 0);
  if (filesWithLines.length > 0) {
    const maxLength = Math.max(...filesWithLines.map((path) => path.length));
    for (const filepath of filesWithLines.sort()) {
      const lineSet = claudeLineMapping[filepath];
      const ranges = convertLinesToRanges(Array.from(lineSet));
      if (ranges) {
        const paddedPath = `${filepath}:`.padEnd(maxLength + 2);
        output += `${paddedPath} ${ranges}
`;
      }
    }
  }
  if (contentSignatures && contentSignatures.hashes.size > 0) {
    output += `
`;
    output += `content-signatures: ${Array.from(contentSignatures.hashes).join(",")}
`;
  }
  return output;
};
var analyzePRSquashClaudeContributions = async (testDir, baseCommit, headCommit) => {
  const { contributions, contentSignatures } = await collectClaudeNotesFromCommits(testDir, baseCommit, headCommit);
  const claudeLineMapping = await consolidateClaudeContributions(testDir, contributions);
  return generateClaudeNote(claudeLineMapping, contentSignatures);
};
async function main() {
  if (process.argv.length < 5) {
    console.error("Usage: bun run analyze-claude-lines.ts <claude_data_file> <base_commit> <latest_commit>");
    console.error("");
    console.error("This script analyzes Claude Code contributions across commits and maps them");
    console.error("to the final diff, generating accurate attribution for squashed commits.");
    process.exit(1);
  }
  const claudeDataFile = process.argv[2];
  const baseCommit = process.argv[3];
  const latestCommit = process.argv[4];
  try {
    await readFile(claudeDataFile, "utf-8");
    console.error(`Processing Claude contributions from ${claudeDataFile}`);
    const noteContent = await analyzePRSquashClaudeContributions(process.cwd(), baseCommit, latestCommit);
    console.log(noteContent);
  } catch (error) {
    console.error("Error analyzing Claude contributions:", error);
    process.exit(1);
  }
}
main().catch(console.error);
