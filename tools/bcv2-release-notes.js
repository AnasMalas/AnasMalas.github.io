// Prints a BCv2 release's notes as Markdown, for its GitHub release:
//   node tools/bcv2-release-notes.js v1.1 > notes.md
//   gh release create v1.1 --repo AnasMalas/bcv2-releases --title "Firmware v1.1" --notes-file notes.md <bin>
// The notes come from src/_data/bcv2Releases.json, the same file as the
// changelog page and its feed.
const fs = require("node:fs");
const path = require("node:path");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../src/_data/bcv2Releases.json"), "utf8"));
const version = process.argv[2];
const release = data.releases.find((entry) => entry.version === version);
if (!release) {
  console.error(`No ${version || "version given"} in src/_data/bcv2Releases.json`);
  process.exit(1);
}
if (!release.date) console.error(`Warning: ${version} has no date yet, so its not on the changelog feed.`);

const lines = release.changes.map((change) => `- ${change}`);
if (release.console?.length) lines.push("", "In the console:", "", ...release.console.map((change) => `- ${change}`));
lines.push("", "Update your card: https://anasmalas.com/bcv2/update/", "All release notes: https://anasmalas.com/bcv2/changelog/");
if (release.build) lines.push("", `Firmware ${release.build}`);
process.stdout.write(`${lines.join("\n")}\n`);
