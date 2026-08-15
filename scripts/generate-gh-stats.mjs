import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchGitHubStats } from "./github-stats/github-client.mjs";
import { renderStatsCard } from "./github-stats/render-card.mjs";

const DEFAULT_USERNAME = "dvgamerr";
const OUTPUT_FILENAME = "gh-stats.svg";

export function getRuntimeConfig(environment = process.env) {
  const token = environment.GITHUB_TOKEN?.trim();

  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }

  return {
    username: environment.GITHUB_REPOSITORY_OWNER?.trim() || DEFAULT_USERNAME,
    token,
    outputPath: join(
      environment.GITHUB_WORKSPACE?.trim() || process.cwd(),
      OUTPUT_FILENAME,
    ),
  };
}

export async function generateStatsCard({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  writeFileImpl = writeFile,
} = {}) {
  const config = getRuntimeConfig(environment);
  const stats = await fetchGitHubStats({
    username: config.username,
    token: config.token,
    fetchImpl,
  });

  await writeFileImpl(config.outputPath, renderStatsCard(stats), "utf8");

  return { outputPath: config.outputPath, stats };
}

async function main() {
  const { outputPath, stats } = await generateStatsCard();
  console.log(
    `Updated ${outputPath}: ${stats.totalCommits} commits, ${stats.totalStars} stars`,
  );
}

const entrypointPath = process.argv[1] && resolve(process.argv[1]);

if (entrypointPath === fileURLToPath(import.meta.url)) {
  await main();
}
