// DemoReady GitHub Action: records a demo of a PR's preview deployment and comments on the PR.
// No dependencies: Node 20's fetch talks to DemoReady (/api/ci/demos) and the GitHub REST API.
import { appendFileSync, readFileSync } from "node:fs";

const input = (name, fallback = "") => (process.env[`INPUT_${name.toUpperCase()}`] ?? fallback).trim();
const setOutput = (k, v) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v ?? ""}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = input("server", "https://demoready.ai").replace(/\/+$/, "");
const apiKey = input("api-key");
const ghToken = input("github-token");
const repo = process.env.GITHUB_REPOSITORY;
const event = (() => {
  try {
    return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    return {};
  }
})();
const sha = event.pull_request?.head?.sha ?? event.deployment?.sha ?? process.env.GITHUB_SHA ?? "";

async function demoready(path, body) {
  const res = await fetch(`${server}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": "demoready-action" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `DemoReady answered ${res.status}`);
  return data;
}

async function github(path, method = "GET", body) {
  const res = await fetch(`${process.env.GITHUB_API_URL || "https://api.github.com"}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "User-Agent": "demoready-action", "X-GitHub-Api-Version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

/** The pull request: from the event, or (deployment events) the open PR for the deployed commit. */
async function findPr() {
  if (event.pull_request?.number) return event.pull_request.number;
  if (event.issue?.pull_request) return event.issue.number;
  if (!sha || !ghToken) return null;
  const prs = await github(`/repos/${repo}/commits/${sha}/pulls`).catch(() => []);
  return prs.find((p) => p.state === "open")?.number ?? null;
}

const marker = `<!-- demoready:${input("from-demo") || "story"} -->`;
let commentId = null;
async function comment(pr, body) {
  if (!pr || input("comment", "true") !== "true" || !ghToken) return;
  const text = `${marker}\n${body}`;
  try {
    if (!commentId) {
      const existing = await github(`/repos/${repo}/issues/${pr}/comments?per_page=100`);
      commentId = existing.find((c) => c.body?.startsWith(marker))?.id ?? null;
    }
    if (commentId) await github(`/repos/${repo}/issues/comments/${commentId}`, "PATCH", { body: text });
    else commentId = (await github(`/repos/${repo}/issues/${pr}/comments`, "POST", { body: text })).id;
  } catch (err) {
    console.log(`::warning::Couldn't comment on the pull request (give the workflow "pull-requests: write"): ${err.message}`);
  }
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const host = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

async function main() {
  const url = input("url");
  if (!apiKey) throw new Error("api-key is required (store your DemoReady API key as a repository secret)");
  if (!url) throw new Error("url is required: the preview deployment to record");
  if (!input("from-demo") && !input("story")) throw new Error("Set from-demo (replay an existing demo) or story (what to show)");

  const pr = await findPr();
  const look = { theme: input("style") || undefined, voice: input("voice") || undefined, music: input("music") || undefined };
  const demo = await demoready("/api/ci/demos", {
    url,
    ...(input("from-demo") ? { from_demo: input("from-demo") } : { story: input("story") }),
    ...look,
    repo,
    pr,
    sha,
  });
  console.log(`Recording ${url}: ${demo.app_url}`);
  setOutput("demo-id", demo.id);
  await comment(pr, `### 🎬 Recording a demo of this PR…\nDemoReady is recording \`${host(url)}\` (${sha.slice(0, 7)}). This comment updates when the video is ready. [Follow along](${demo.app_url})`);

  const deadline = Date.now() + Number(input("timeout-minutes", "20")) * 60_000;
  let d = demo;
  while (!["done", "failed"].includes(d.status)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for the recording (${d.status}). It may still finish: ${d.app_url}`);
    await sleep(10_000);
    d = await demoready(`/api/ci/demos/${demo.id}`);
    console.log(`… ${d.status}`);
  }
  setOutput("status", d.status);

  if (d.status === "failed") {
    await comment(pr, `### ⚠️ DemoReady couldn't record this PR\n${d.error ?? "The recording failed."}\n\n[Details](${d.app_url}) · No demo was used from your plan.`);
    throw new Error(d.error ?? "The recording failed");
  }

  setOutput("share-url", d.share_url);
  setOutput("video-url", d.video_url);
  const watch = d.share_url ?? d.app_url;
  const scenes = d.scenes?.length ? `\n<details><summary>Scenes</summary>\n\n${d.scenes.map((s) => `- ${s.status === "done" ? "✅" : s.status === "partial" ? "🟡" : "⏭️"} ${s.title}`).join("\n")}\n</details>` : "";
  await comment(
    pr,
    `### 🎬 ${d.title ?? "Demo of this PR"}\n` +
      (d.poster_url ? `[![${(d.title ?? "Demo").replace(/[\[\]]/g, "")}](${d.poster_url})](${watch})\n\n` : "") +
      `**[▶ Watch the demo](${watch})** · ${d.duration_sec ? clock(d.duration_sec) : ""} · recorded from \`${host(url)}\` at ${sha.slice(0, 7)}${d.video_url ? ` · [MP4](${d.video_url})` : ""}${scenes}\n\n<sub>Made with [DemoReady](${server})</sub>`,
  );
  console.log(`Done: ${watch}`);
}

main().catch((err) => {
  console.log(`::${input("fail-on-error", "false") === "true" ? "error" : "warning"}::${err.message}`);
  setOutput("status", "failed");
  process.exit(input("fail-on-error", "false") === "true" ? 1 : 0);
});
