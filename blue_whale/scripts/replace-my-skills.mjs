import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

const skills = JSON.parse(
  readFileSync(join(projectRoot, "docs/my-skills.json"), "utf-8")
);

const items = skills
  .map((s) => {
    return `  {
    id: ${JSON.stringify(s.id)},
    title: ${JSON.stringify(s.title)},
    description: ${JSON.stringify(s.description)},
    cover: ${JSON.stringify(s.cover)},
  }`;
  })
  .join(",\n");

const replacement = `const MY_SKILLS: MySkill[] = [\n${items}\n];`;

const tsxPath = join(projectRoot, "components/SkillPanel.tsx");
let tsx = readFileSync(tsxPath, "utf-8");

const replaced = tsx.replace(
  /const MY_SKILLS: MySkill\[\] = \[[\s\S]*?\n\];/,
  replacement
);

if (replaced === tsx) {
  console.error("Failed to replace MY_SKILLS block");
  process.exit(1);
}

writeFileSync(tsxPath, replaced, "utf-8");
console.log("MY_SKILLS replaced with 32 skills.");
