// `check-skill` had seven rules and nothing locking any of them. Its calibration was done by
// hand against the 21 real skills and by pointing it at two historical commits — good evidence
// that it fires, no protection at all against the next edit quietly widening or narrowing what
// it accepts.
//
// That gap was self-inflicted, and it is the same one the file itself was written to find: a
// rule with nobody checking it. So the tests run the real script as a subprocess against skills
// built for the occasion, rather than importing pieces of it. What ships is a command whose exit
// code is the gate, and a command is what gets tested.
//
// Each fixture is the smallest skill that trips exactly one rule, and every rule has a NEGATIVE
// case beside it — the half that catches a future edit turning a check into a rubber stamp.
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(import.meta.dirname, "..", "check-skill.mjs");
const made: string[] = [];

afterEach(() => {
  while (made.length) fs.rmSync(made.pop()!, { recursive: true, force: true });
});

/** A skills root holding one or more skills, each `{ "path/inside": "contents" }`. */
function skillsRoot(skills: Record<string, Record<string, string>>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-skill-"));
  made.push(root);
  for (const [name, files] of Object.entries(skills)) {
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(root, name, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
      if (rel.endsWith(".sh")) fs.chmodSync(full, 0o755);
    }
  }
  return root;
}

function run(root: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, root], { encoding: "utf8" }) };
  } catch (e: any) {
    return { code: e.status ?? 1, out: String(e.stdout ?? "") };
  }
}

const FRONTMATTER = `---\nname: %s\ndescription: A skill.\n---\n`;
const skill = (name: string, body: string) => FRONTMATTER.replace("%s", name) + body;

describe("a skill with nothing wrong", () => {
  it("passes silently and exits 0", () => {
    const root = skillsRoot({
      tidy: {
        "SKILL.md": skill("tidy", "Run `scripts/go.sh --host h`.\nSee [the spec](references/spec.md).\n"),
        "scripts/go.sh": "#!/usr/bin/env bash\ncase \"$1\" in --host) HOST=\"$2\";; esac\n",
        "references/spec.md": "# Spec\n",
      },
    });
    const { code, out } = run(root);
    expect(code).toBe(0);
    expect(out).toMatch(/1 skill\(s\), 0 failure\(s\), 0 warning\(s\)/);
  });
});

describe("broken_link", () => {
  it("fails a markdown link to a path that does not resolve", () => {
    const root = skillsRoot({ a: { "SKILL.md": skill("a", "See [the spec](references/spec.md).\n") } });
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL \[a\] broken_link: .*references\/spec\.md, which does not exist/);
  });

  it("says nothing about a name mentioned in prose rather than linked", () => {
    // `working-copy` names `references/spec.md` as where its traps will MOVE once there are
    // enough of them. Judging prose would fail a skill for planning ahead.
    const root = skillsRoot({ a: { "SKILL.md": skill("a", "They move to `references/spec.md` later.\n") } });
    expect(run(root).code).toBe(0);
  });

  it("ignores anchors and external URLs", () => {
    const root = skillsRoot({
      a: { "SKILL.md": skill("a", "[top](#heading) and [site](https://example.com/x).\n") },
    });
    expect(run(root).code).toBe(0);
  });
});

describe("script_not_executable", () => {
  it("fails a shipped .sh without the bit", () => {
    const root = skillsRoot({ a: { "SKILL.md": skill("a", "x\n"), "scripts/go.sh": "#!/usr/bin/env bash\n" } });
    fs.chmodSync(path.join(root, "a", "scripts", "go.sh"), 0o644);
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toMatch(/script_not_executable: scripts\/go\.sh/);
  });
});

describe("flag_unhonoured", () => {
  it("fails a flag shown with one of the skill's own scripts that appears in none of them", () => {
    const root = skillsRoot({
      a: {
        "SKILL.md": skill("a", "Run `go.sh --host h --varaint x`.\n"),
        "scripts/go.sh": "#!/usr/bin/env bash\ncase \"$1\" in --host) H=$2;; --variant) V=$2;; esac\n",
      },
    });
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toMatch(/flag_unhonoured: text shows `--varaint`/);
  });

  it("accepts a flag the parser cannot be read for but that appears in the source", () => {
    // `visibility-audit` takes `--domain` through a helper this checker cannot recognise,
    // surfacing it only inside a thrown error. Judging by the parser marked fifteen working
    // flags as unhonoured — a gate failing two of twenty-one real skills.
    const root = skillsRoot({
      a: {
        "SKILL.md": skill("a", "Run `go.mjs --domain acme.com`.\n"),
        "scripts/go.mjs": "if (!domain) throw new Error('--domain is required')\n",
      },
    });
    expect(run(root).code).toBe(0);
  });

  it("says nothing about a flag belonging to a tool the skill merely invokes", () => {
    const root = skillsRoot({ a: { "SKILL.md": skill("a", "Run `docker run --network host`.\n") } });
    expect(run(root).code).toBe(0);
  });
});

describe("undeclared_skill_dependency", () => {
  const engine = { "SKILL.md": "---\nname: engine\ndescription: E.\n---\n", "scripts/e.mjs": "export const x = 1\n" };

  it("fails when a script reaches into another skill the text never names", () => {
    const root = skillsRoot({
      engine,
      user: { "SKILL.md": skill("user", "Nothing to declare.\n"), "scripts/u.mjs": "import '../../engine/scripts/e.mjs'\n" },
    });
    const { code, out } = run(root);
    expect(code).toBe(1);
    expect(out).toMatch(/undeclared_skill_dependency: scripts\/u\.mjs reaches into the engine skill/);
  });

  it("passes when the text names it, which is the only delivery mechanism there is", () => {
    // Nothing resolves skill-to-skill dependencies: the index carries `requiresMcp` and Tracy
    // Desk's SkillService reads only that. A person reading the text is what stands between the
    // pair and a dead gate.
    const root = skillsRoot({
      engine,
      user: {
        "SKILL.md": skill("user", "Install the engine skill alongside this one.\n"),
        "scripts/u.mjs": "import '../../engine/scripts/e.mjs'\n",
      },
    });
    expect(run(root).code).toBe(0);
  });
});

describe("quantified_flag_claim", () => {
  const gate = (flags: string) =>
    `#!/usr/bin/env bash\ncase "$1" in ${flags} esac\n`;
  const HOST_PAGES = '--host) H=$2;; --pages) P=$2;;';

  it("warns when a claim over every gate is false for one of them", () => {
    const root = skillsRoot({
      a: {
        "SKILL.md": skill("a", "All three take `--variant <slug>`.\n"),
        "scripts/one.sh": gate(`${HOST_PAGES} --variant) V=$2;;`),
        "scripts/two.sh": gate(HOST_PAGES),
      },
    });
    const { code, out } = run(root);
    expect(code).toBe(0); // a warning, never a failure
    expect(out).toMatch(/warn \[a\] quantified_flag_claim/);
    expect(out).toMatch(/scripts\/two\.sh/);
    expect(out).not.toMatch(/one\.sh/);
  });

  it("does not name a script that takes no pages to judge", () => {
    // Listing every script in the skill was the first attempt and it was useless: it named
    // `pixel-diff`, which compares two directories and has no host to send a header to.
    const root = skillsRoot({
      a: {
        "SKILL.md": skill("a", "Every gate takes `--variant <slug>`.\n"),
        "scripts/gate.sh": gate(`${HOST_PAGES} --variant) V=$2;;`),
        "scripts/offline.sh": '#!/usr/bin/env bash\ncase "$1" in --before) B=$2;; esac\n',
      },
    });
    expect(run(root).out).not.toMatch(/quantified_flag_claim/);
  });

  it("does not fire on a quantifier that is not a claim about a command", () => {
    // "Each tier still declares its own viewports" quantifies over tiers and says nothing about
    // any script's flags.
    const root = skillsRoot({
      a: {
        "SKILL.md": skill("a", "Each tier still declares its own viewports, so `--tiers visual` renders three.\n"),
        "scripts/gate.sh": gate(HOST_PAGES),
      },
    });
    expect(run(root).out).not.toMatch(/quantified_flag_claim/);
  });
});

describe("host_env_assumed", () => {
  it("warns about a variable the text reads and no script sets or reads", () => {
    const root = skillsRoot({ a: { "SKILL.md": skill("a", 'Run `echo "$SOME_HOST_DIR"` first.\n') } });
    const { code, out } = run(root);
    expect(code).toBe(0);
    expect(out).toMatch(/host_env_assumed: text tells the reader to use \$SOME_HOST_DIR/);
  });

  it("says nothing about a variable the instructions create themselves", () => {
    // `VIEWER_PID=$!` then `kill $VIEWER_PID` assumes nothing about any runtime.
    const root = skillsRoot({ a: { "SKILL.md": skill("a", "VIEWER_PID=$!\nlater: kill $VIEWER_PID\n") } });
    expect(run(root).out).not.toMatch(/host_env_assumed/);
  });

  it("says nothing when a script reads the variable too", () => {
    const root = skillsRoot({
      a: {
        "SKILL.md": skill("a", "Set `$QA_HOME` before running.\n"),
        "scripts/go.sh": '#!/usr/bin/env bash\necho "${QA_HOME:-/opt}"\n',
      },
    });
    expect(run(root).out).not.toMatch(/host_env_assumed/);
  });
});

describe("unresolved_script_name", () => {
  it("warns about a script name resolving to no file in any skill", () => {
    // `reskin`'s spec cited `visual-qa.mjs` for a week after that file was absorbed into
    // another, telling readers to run something that was not there.
    const root = skillsRoot({ a: { "SKILL.md": skill("a", "Run `gone.mjs` afterwards.\n") } });
    const { code, out } = run(root);
    expect(code).toBe(0);
    expect(out).toMatch(/unresolved_script_name: `gone\.mjs`/);
  });

  it("says nothing about a script belonging to another skill in the same repo", () => {
    // `reskin` legitimately names `design-qa.sh`, which it orchestrates.
    const root = skillsRoot({
      owner: { "SKILL.md": "---\nname: owner\ndescription: O.\n---\n", "scripts/tool.sh": "#!/usr/bin/env bash\n" },
      caller: { "SKILL.md": skill("caller", "Then run `tool.sh`.\n") },
    });
    expect(run(root).out).not.toMatch(/unresolved_script_name/);
  });
});

describe("the three budgets", () => {
  // Warnings rather than failures, deliberately: three skills in this repo are over a limit
  // today, and a gate that fails the repo it ships with gets switched off before it has caught
  // anything. The tests assert exit 0 alongside the warning, so promoting these to failures
  // later is a visible decision rather than a side effect.
  const long = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

  it("warns past 500 lines of body, and not at 500", () => {
    const under = skillsRoot({ a: { "SKILL.md": skill("a", long(480)) } });
    expect(run(under).out).not.toMatch(/skill_md_too_long/);
    const over = skillsRoot({ a: { "SKILL.md": skill("a", long(600)) } });
    const { code, out } = run(over);
    expect(code).toBe(0);
    expect(out).toMatch(/warn \[a\] skill_md_too_long: SKILL\.md is \d+ lines/);
  });

  it("FAILS past a 100-word description, unlike the two shape rules beside it", () => {
    // The budget is shared: /doctor records that the listing gets ~1% of the context window and
    // that entries are truncated once the sum exceeds it, so one long description spends what
    // every other skill needs to be findable.
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    const ok = skillsRoot({ a: { "SKILL.md": `---\nname: a\ndescription: ${words(60)}\n---\nbody\n` } });
    expect(run(ok).out).not.toMatch(/description_too_long/);
    const over = skillsRoot({ a: { "SKILL.md": `---\nname: a\ndescription: ${words(160)}\n---\nbody\n` } });
    const { code, out } = run(over);
    // The cost of this one lands on other people: the listing is a shared allowance, and the
    // entries truncated when it overruns are the ones at the end, not the one that overran.
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL \[a\] description_too_long: description is 160 words/);
  });

  it("exempts a vendored skill from the shape rules, by LICENSE.txt rather than by name", () => {
    // skill-creator came from Anthropic with its own licence. Editing it to recover 3% would fork
    // the copy from upstream — the same divergence the vendored Mention Network skills are in,
    // where an upstream fix never arrives and a local fix never travels back.
    const files = { "SKILL.md": skill("a", long(600)), "references/spec.md": "# Spec\n" + long(400) };
    const judged = skillsRoot({ a: files });
    expect(run(judged).out).toMatch(/skill_md_too_long/);
    expect(run(judged).out).toMatch(/reference_needs_toc/);

    const exempt = skillsRoot({ a: { ...files, "LICENSE.txt": "MIT\n" } });
    expect(run(exempt).out).not.toMatch(/skill_md_too_long/);
    expect(run(exempt).out).not.toMatch(/reference_needs_toc/);
  });

  it("still charges a vendored skill for its description", () => {
    // The shape of somebody else's file is theirs. The listing allowance is everyone's.
    const wordsOf = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    const root = skillsRoot({
      a: { "SKILL.md": `---\nname: a\ndescription: ${wordsOf(160)}\n---\nbody\n`, "LICENSE.txt": "MIT\n" },
    });
    expect(run(root).code).toBe(1);
    expect(run(root).out).toMatch(/description_too_long/);
  });

  it("warns about a long reference with no table of contents, and not one that has it", () => {
    const bare = skillsRoot({
      a: { "SKILL.md": skill("a", "x\n"), "references/spec.md": "# Spec\n" + long(400) },
    });
    expect(run(bare).out).toMatch(/reference_needs_toc: references\/spec\.md is \d+ lines/);

    const withToc = skillsRoot({
      a: {
        "SKILL.md": skill("a", "x\n"),
        "references/spec.md": "# Spec\n\n- [One](#one)\n- [Two](#two)\n" + long(400),
      },
    });
    expect(run(withToc).out).not.toMatch(/reference_needs_toc/);
  });

  it("leaves a short reference alone whatever it looks like", () => {
    const root = skillsRoot({
      a: { "SKILL.md": skill("a", "x\n"), "references/short.md": "# Short\n" + long(120) },
    });
    expect(run(root).out).not.toMatch(/reference_needs_toc/);
  });
});
