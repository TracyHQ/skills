// Survey and capture in one command, because every command costs a person an interruption.
//
// Tracy asks the customer to approve each shell command an agent runs, and it is right to: a shell
// runs anything. But the approval is charged per COMMAND, not per risk, so a review that ran its
// survey and its capture as two calls asked twice for one indivisible step — nobody surveys a site
// and then declines to look at it. Two questions, one decision, and the second one teaches people
// to stop reading the dialog.
//
// So the two run here, in order, as one call. Nothing else moves: `survey.mjs` and `capture.mjs`
// keep working on their own, which is what standalone use and every test rely on.
//
// The one thing this refuses to do is carry on past a survey that said no. A site that is not
// WordPress, a Preview that answered with a wrapper, an address that never replied — each is a
// reason to stop and say so, and capturing twenty pages afterwards would spend minutes proving it.
//
// Usage: node scan.mjs --site <url> --work <dir> [--target auto|preview|live] [--since <review.json>]
//                      [--viewports desktop,mobile] [--max-pages 20]

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

const SITE = arg("site");
const WORK = arg("work");
const TARGET = arg("target", "auto");
const SINCE = arg("since");
const VIEWPORTS = arg("viewports", "desktop,mobile");
/** Passed straight through: "look at fewer pages" is the one knob people reach for, and a scan
 *  that silently ignored it would spend six minutes proving it had. */
const MAX_PAGES = arg("max-pages");

if (!SITE || !WORK) {
  process.stderr.write("usage: scan.mjs --site <url> --work <dir> [--target auto|preview|live] [--since <review.json>]\n");
  process.exit(2);
}

/** Run one of this skill's own scripts, letting its progress reach the person as it happens. */
function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(HERE, script), ...args], {
      // stdout is captured because it is the script's ANSWER; stderr is inherited because it is its
      // running commentary, and a capture that prints nothing for four minutes looks like a hang.
      stdio: ["ignore", "pipe", "inherit"]
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(Object.assign(new Error(`${script} exited ${code}`), { code }))));
  });
}

const surveyFile = path.join(WORK, "survey.json");
const captureDir = path.join(WORK, "capture");

try {
  const surveyOut = await run("survey.mjs", [
    "--site", SITE,
    "--out", surveyFile,
    "--target", TARGET,
    ...(MAX_PAGES ? ["--max-pages", MAX_PAGES] : []),
    ...(SINCE ? ["--since", SINCE] : [])
  ]);
  const survey = JSON.parse(readFileSync(surveyFile, "utf8"));

  // Each of these is a finished answer, not a failure to work around. Saying it and stopping is the
  // whole value: a review that carried on would describe something nobody asked about.
  if (survey.error || survey.reachable === false || survey.isWordPress === false) {
    process.stdout.write(surveyOut);
    process.exit(2);
  }
  if ((survey.pagesToReview ?? []).length === 0) {
    // A recheck where nothing moved lands here, and it is the good outcome rather than a dead end.
    process.stdout.write(JSON.stringify({ ...JSON.parse(surveyOut), captured: 0, note: "nothing to open" }) + "\n");
    process.exit(0);
  }

  const captureOut = await run("capture.mjs", [
    "--pages", surveyFile,
    "--out", captureDir,
    "--viewports", VIEWPORTS
  ]);

  process.stdout.write(
    JSON.stringify({ survey: JSON.parse(surveyOut), capture: JSON.parse(captureOut), surveyFile, captureDir }) + "\n"
  );
} catch (error) {
  process.stderr.write(`scan failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(typeof error?.code === "number" ? error.code : 1);
}
