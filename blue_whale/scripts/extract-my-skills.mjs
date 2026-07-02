import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const htmlPath = join(
  projectRoot,
  "docs/reference-my-skills.html"
);

const html = readFileSync(htmlPath, "utf-8");

// Split by the row start marker used in the reference HTML.
const rowParts = html.split(
  '<div class="tc-agent-skill-row tc-agent-skill-row--checked tc-agent-skill-row--switch-control tc-agent-skill-row--with-cover">'
);

const skills = rowParts.slice(1).map((part, index) => {
  const titleMatch = part.match(
    /<span class="tc-agent-skill-row__title">([^<]+)<\/span>/
  );
  const descMatch = part.match(
    /<span class="tc-agent-skill-row__desc">([^<]+)<\/span>/
  );
  const coverMatch = part.match(
    /style="background-image: url\(&quot;(.*?)&quot;\);"/
  );

  const title = titleMatch ? titleMatch[1].trim() : `Skill ${index + 1}`;
  const description = descMatch ? descMatch[1].trim() : "";
  const cover = coverMatch ? coverMatch[1] : "";

  // Decode common HTML entities in the cover URL.
  const decodedCover = cover
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // Create a stable id from the title.
  const id = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return { id, title, description, cover: decodedCover };
});

const jsonPath = join(projectRoot, "docs/my-skills.json");
writeFileSync(jsonPath, JSON.stringify(skills, null, 2), "utf-8");

console.log(`Extracted ${skills.length} skills to ${jsonPath}`);
for (const s of skills) {
  console.log(`- ${s.title}`);
}
