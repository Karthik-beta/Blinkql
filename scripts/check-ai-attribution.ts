// Fails if any commit in a pull request, or its description, credits an AI tool.
// Local hooks can be skipped with --no-verify; this runs in CI where they can't.
//
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo GITHUB_EVENT_PATH=event.json \
//     node scripts/check-ai-attribution.ts
import { readFileSync } from "node:fs";
import { findAiAttribution } from "./ai-attribution.ts";

type PullRequestEvent = { pull_request: { number: number; body: string | null } };
type Commit = { sha: string; commit: { message: string } };

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH } = process.env;
if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_EVENT_PATH) {
  console.error("Needs GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_PATH.");
  process.exit(2);
}

const { pull_request: pr } = JSON.parse(
  readFileSync(GITHUB_EVENT_PATH, "utf8"),
) as PullRequestEvent;

/** Every commit on the PR; the API returns at most 250, 100 per page. */
async function pullRequestCommits(): Promise<Commit[]> {
  const commits: Commit[] = [];
  for (let page = 1; ; page++) {
    const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${pr.number}/commits?per_page=100&page=${page}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const batch = (await response.json()) as Commit[];
    commits.push(...batch);
    if (batch.length < 100) return commits;
  }
}

const sources = [
  ...(await pullRequestCommits()).map((c) => ({ name: c.sha.slice(0, 7), text: c.commit.message })),
  { name: "PR description", text: pr.body ?? "" },
];

let failed = false;
for (const { name, text } of sources) {
  for (const line of findAiAttribution(text)) {
    console.error(`${name}: ${line}`);
    failed = true;
  }
}

if (failed) {
  console.error(
    "\nRemove the AI attribution above: reword the commits (git rebase -i, then force-push)" +
      " and edit the PR description.",
  );
  process.exit(1);
}
process.stdout.write(
  `No AI attribution in ${sources.length - 1} commit(s) or the PR description.\n`,
);
