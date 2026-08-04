import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseDoc, SIZE_CAPS } from "./check-evergreen-docs.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = "docs_local/tmp/batch2-prep";

const SECTION_REF = /§\d+(?:\.\d+)*/g;
const MD_LINK = /\[[^\]]*\]\(([^)]*\.md)\)/g;

export function buildHeadingIndex(content) {
  const index = new Map();
  const headingRe = /^#{2,4}\s+(\d+(?:\.\d+)*)(?:\.)?\s+(.+?)\s*$/;
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  for (const [lineIndex, line] of lines.entries()) {
    const match = headingRe.exec(line);
    if (!match) continue;
    index.set(match[1], { line: lineIndex + 1, title: match[2] });
  }

  return index;
}

function isHeadingLine(line) {
  return /^#{1,6}\s/.test(line);
}

function normalizeDocTarget(fromFilePath, href) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFilePath), href));
}

function sectionRefsForLinkSegment(segment) {
  const sameSentence = segment.split(/[。！？!?]/, 1)[0];
  const refs = [...sameSentence.matchAll(SECTION_REF)];
  if (refs.length === 0) return [];
  if (refs[0].index > 12) return [];
  if (refs.length === 1) return refs;
  const firstEnd = refs[0].index + refs[0][0].length;
  return refs[1].index - firstEnd <= 20 ? refs : [refs[0]];
}

export function buildAnchorNeeds(docs) {
  const headingIndexes = new Map(docs.map((doc) => [doc.filePath, buildHeadingIndex(doc.content)]));
  const resolvedByKey = new Map();
  const broken = [];
  const ambiguous = [];

  for (const doc of docs) {
    const lines = doc.content.replace(/\r\n/g, "\n").split("\n");
    for (const [lineIndex, line] of lines.entries()) {
      if (isHeadingLine(line)) continue;

      const lineNumber = lineIndex + 1;
      const links = [...line.matchAll(MD_LINK)];
      for (const [index, link] of links.entries()) {
        const segmentStart = link.index + link[0].length;
        const segmentEnd = links[index + 1]?.index ?? line.length;
        const segment = line.slice(segmentStart, segmentEnd);
        const refs = sectionRefsForLinkSegment(segment);

        if (refs.length === 0) continue;

        const target = normalizeDocTarget(doc.filePath, link[1]);
        if (!headingIndexes.has(target) && !target.startsWith("docs/evergreen/")) continue;
        const from = { filePath: doc.filePath, line: lineNumber, text: line.trim() };

        if (refs.length > 1) {
          const text = line.slice(link.index, segmentEnd).trim();
          ambiguous.push({
            from: doc.filePath,
            line: lineNumber,
            target,
            text,
          });
          continue;
        }

        const section = refs[0][0].slice(1);
        const targetHeading = headingIndexes.get(target)?.get(section);

        if (!targetHeading) {
          broken.push({ ...from, target, section });
          continue;
        }

        const key = `${target}#${section}`;
        const existing = resolvedByKey.get(key);
        if (existing) {
          existing.from.push(from);
        } else {
          resolvedByKey.set(key, {
            target,
            section,
            title: targetHeading.title,
            line: targetHeading.line,
            from: [from],
          });
        }
      }
    }
  }

  return { resolved: [...resolvedByKey.values()], broken, ambiguous };
}

export function classifyBand(chars, caps = SIZE_CAPS) {
  if (chars >= caps.criticalChars) return "critical";
  if (chars >= caps.warnChars) return "warn";
  if (chars >= caps.softChars) return "soft";
  return "ok";
}

function countSectionRefs(text) {
  return [...text.matchAll(SECTION_REF)].length;
}

function countCrossRefs(line) {
  const links = [...line.matchAll(MD_LINK)];
  let count = 0;

  for (const [index, match] of links.entries()) {
    const start = match.index + match[0].length;
    const end = links[index + 1]?.index ?? line.length;
    count += sectionRefsForLinkSegment(line.slice(start, end)).length;
  }

  return count;
}

function countRefs(content) {
  let allRefs = 0;
  let crossRefs = 0;

  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    if (isHeadingLine(line)) continue;
    allRefs += countSectionRefs(line);
    crossRefs += countCrossRefs(line);
  }

  return { crossRefs, bareRefs: Math.max(0, allRefs - crossRefs) };
}

export function buildDocProfiles(docs) {
  return docs.map((doc) => {
    const parsed = parseDoc(doc.filePath, doc.content);
    const { crossRefs, bareRefs } = countRefs(doc.content);

    return {
      filePath: parsed.filePath,
      chars: parsed.chars,
      band: classifyBand(parsed.chars),
      covers: parsed.covers,
      contracts: parsed.contracts,
      anchors: parsed.anchors,
      crossRefs,
      bareRefs,
    };
  });
}

function topicOf(filePath) {
  const rel = filePath.startsWith("docs/evergreen/") ? filePath.slice("docs/evergreen/".length) : filePath;
  const [head] = rel.split("/");
  return path.posix.basename(head, ".md");
}

function pushAssignment(out, topic, docs) {
  if (docs.length === 0) return;
  out.push({
    topic,
    docs: docs.map((doc) => doc.filePath),
    chars: docs.reduce((sum, doc) => sum + doc.chars, 0),
  });
}

export function buildAssignments(profiles, capChars) {
  const assignments = [];
  const byTopic = new Map();

  for (const profile of profiles) {
    const topic = topicOf(profile.filePath);
    if (profile.chars > capChars) {
      pushAssignment(assignments, topic, [profile]);
      continue;
    }
    const group = byTopic.get(topic) ?? [];
    group.push(profile);
    byTopic.set(topic, group);
  }

  for (const [topic, topicProfiles] of [...byTopic.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...topicProfiles].sort((a, b) => b.chars - a.chars || a.filePath.localeCompare(b.filePath));
    let current = [];
    let currentChars = 0;

    for (const profile of sorted) {
      if (current.length > 0 && currentChars + profile.chars > capChars) {
        pushAssignment(assignments, topic, current);
        current = [];
        currentChars = 0;
      }
      current.push(profile);
      currentChars += profile.chars;
    }
    pushAssignment(assignments, topic, current);
  }

  return assignments.sort(
    (a, b) => b.chars - a.chars || a.topic.localeCompare(b.topic) || a.docs[0].localeCompare(b.docs[0]),
  );
}

function readEvergreenDocs() {
  const out = execFileSync("git", ["ls-files", "docs/evergreen"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out
    .split(/\r?\n/)
    .filter((filePath) => filePath.endsWith(".md"))
    .map((filePath) => ({
      filePath,
      content: fs.readFileSync(path.join(REPO_ROOT, filePath), "utf8"),
    }));
}

function writeJson(relPath, value) {
  const absPath = path.join(REPO_ROOT, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function main() {
  const docs = readEvergreenDocs();
  const profiles = buildDocProfiles(docs).sort((a, b) => b.chars - a.chars || a.filePath.localeCompare(b.filePath));
  const assignments = buildAssignments(profiles, SIZE_CAPS.warnChars);
  const anchorNeeds = buildAnchorNeeds(docs);

  writeJson(path.posix.join(OUTPUT_DIR, "profiles.json"), profiles);
  writeJson(path.posix.join(OUTPUT_DIR, "assignments.json"), assignments);
  writeJson(path.posix.join(OUTPUT_DIR, "anchor-needs.json"), anchorNeeds);

  console.log(`文档 ${docs.length} 份，分派 ${assignments.length} 组`);
  console.log(
    `锚点需求 ${anchorNeeds.resolved.length} 个章节 / 断链 ${anchorNeeds.broken.length} 处 / 待人工判定 ${anchorNeeds.ambiguous.length} 处`,
  );
  if (anchorNeeds.broken.length === 0) {
    console.log("断链列表：无");
  } else {
    console.log("断链列表：");
    for (const item of anchorNeeds.broken) {
      console.log(`- ${item.filePath}:${item.line} -> ${item.target} §${item.section}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
