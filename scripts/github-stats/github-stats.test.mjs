import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  generateStatsCard,
  getRuntimeConfig,
} from "../generate-gh-stats.mjs";
import { fetchGitHubStats } from "./github-client.mjs";
import {
  escapeXml,
  formatCompactNumber,
  renderStatsCard,
} from "./render-card.mjs";

const ACTIVITY_RESPONSE = {
  data: {
    user: {
      name: "Kananek Thongkam",
      login: "dvgamerr",
      commits: { totalCommitContributions: 864 },
      repositoriesContributedTo: { totalCount: 24 },
      pullRequests: { totalCount: 50 },
      openIssues: { totalCount: 5 },
      closedIssues: { totalCount: 32 },
    },
  },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createSuccessfulFetch(requests = []) {
  return async (input, options = {}) => {
    const url = String(input);
    requests.push({ options, url });

    if (url.endsWith("/graphql")) {
      return jsonResponse(ACTIVITY_RESPONSE);
    }

    const page = Number(new URL(url).searchParams.get("page"));
    const repositories =
      page === 1
        ? Array.from({ length: 100 }, () => ({ stargazers_count: 1 }))
        : [{ stargazers_count: 4 }, { stargazers_count: 6 }];
    return jsonResponse(repositories);
  };
}

test("fetchGitHubStats combines validated activity and paginated public stars", async () => {
  const requests = [];
  const stats = await fetchGitHubStats({
    username: " dvgamerr ",
    token: " test-token ",
    fetchImpl: createSuccessfulFetch(requests),
  });

  assert.deepEqual(stats, {
    name: "Kananek Thongkam",
    login: "dvgamerr",
    totalCommits: 864,
    totalPRs: 50,
    totalIssues: 37,
    contributedTo: 24,
    totalStars: 110,
  });
  assert.equal(requests.length, 3);

  const graphqlRequest = requests.find(({ url }) => url.endsWith("/graphql"));
  const restRequests = requests.filter(({ url }) => !url.endsWith("/graphql"));
  assert.equal(graphqlRequest.options.headers.authorization, "Bearer test-token");
  assert.equal(restRequests[0].options.headers.authorization, undefined);
});

test("fetchGitHubStats reports GraphQL errors with context", async () => {
  const fetchImpl = async (input) =>
    String(input).endsWith("/graphql")
      ? jsonResponse({ errors: [{ message: "Access denied" }] })
      : jsonResponse([]);

  await assert.rejects(
    fetchGitHubStats({ username: "dvgamerr", token: "token", fetchImpl }),
    /GitHub GraphQL error: Access denied/,
  );
});

test("fetchGitHubStats reports HTTP failures with API details", async () => {
  const fetchImpl = async (input) =>
    String(input).endsWith("/graphql")
      ? jsonResponse({ message: "rate limit exceeded" }, 403)
      : jsonResponse([]);

  await assert.rejects(
    fetchGitHubStats({ username: "dvgamerr", token: "token", fetchImpl }),
    /GitHub GraphQL API returned HTTP 403: rate limit exceeded/,
  );
});

test("fetchGitHubStats wraps network failures with API context", async () => {
  const fetchImpl = async (input) => {
    if (String(input).endsWith("/graphql")) {
      throw new Error("connection reset");
    }
    return jsonResponse([]);
  };

  await assert.rejects(
    fetchGitHubStats({ username: "dvgamerr", token: "token", fetchImpl }),
    /GitHub GraphQL API request failed/,
  );
});

test("fetchGitHubStats validates API response counts", async () => {
  const invalidActivity = structuredClone(ACTIVITY_RESPONSE);
  invalidActivity.data.user.commits.totalCommitContributions = -1;
  const fetchImpl = async (input) =>
    String(input).endsWith("/graphql")
      ? jsonResponse(invalidActivity)
      : jsonResponse([]);

  await assert.rejects(
    fetchGitHubStats({ username: "dvgamerr", token: "token", fetchImpl }),
    /totalCommitContributions must be a non-negative integer/,
  );
});

test("getRuntimeConfig normalizes environment values", () => {
  const config = getRuntimeConfig({
    GITHUB_TOKEN: " token ",
    GITHUB_REPOSITORY_OWNER: " dvgamerr ",
    GITHUB_WORKSPACE: "workspace",
  });

  assert.deepEqual(config, {
    username: "dvgamerr",
    token: "token",
    outputPath: join("workspace", "gh-stats.svg"),
  });
  assert.throws(() => getRuntimeConfig({}), /GITHUB_TOKEN is required/);
});

test("generateStatsCard writes the rendered SVG", async () => {
  const writes = [];
  const result = await generateStatsCard({
    environment: {
      GITHUB_TOKEN: "token",
      GITHUB_REPOSITORY_OWNER: "dvgamerr",
      GITHUB_WORKSPACE: "workspace",
    },
    fetchImpl: createSuccessfulFetch(),
    writeFileImpl: async (...arguments_) => writes.push(arguments_),
  });

  assert.equal(result.stats.totalStars, 110);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], join("workspace", "gh-stats.svg"));
  assert.match(writes[0][1], /<svg /);
  assert.equal(writes[0][2], "utf8");
});

test("formatCompactNumber formats each supported magnitude", () => {
  assert.equal(formatCompactNumber(999), "999");
  assert.equal(formatCompactNumber(1_000), "1.0k");
  assert.equal(formatCompactNumber(1_500_000), "1.5M");
  assert.throws(() => formatCompactNumber(-1), /non-negative finite number/);
});

test("escapeXml encodes XML-sensitive characters", () => {
  assert.equal(
    escapeXml(`A&B <tag> "quoted" 'value'`),
    "A&amp;B &lt;tag&gt; &quot;quoted&quot; &#39;value&#39;",
  );
});

test("renderStatsCard keeps the existing visual metrics and adds a title", () => {
  const svg = renderStatsCard({
    name: "Kananek & Team",
    login: "dvgamerr",
    totalCommits: 864,
    totalPRs: 50,
    totalIssues: 37,
    contributedTo: 24,
    totalStars: 11,
  });

  assert.match(svg, /aria-labelledby="stats-title"/);
  assert.match(svg, /<title id="stats-title">GitHub stats for @dvgamerr<\/title>/);
  assert.match(svg, /Kananek &amp; Team/);
  assert.match(svg, />11<\/text>/);
  assert.match(svg, />864<\/text>/);
  assert.match(svg, />50<\/text>/);
  assert.match(svg, />37<\/text>/);
});
