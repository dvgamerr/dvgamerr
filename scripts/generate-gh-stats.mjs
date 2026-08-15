import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const username = process.env.GITHUB_REPOSITORY_OWNER || "dvgamerr";
const token = process.env.GITHUB_TOKEN;

if (!token) {
  throw new Error("GITHUB_TOKEN is required");
}

const query = `
  query userInfo($login: String!) {
    user(login: $login) {
      name
      login
      commits: contributionsCollection {
        totalCommitContributions
      }
      repositoriesContributedTo(
        first: 1
        contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]
      ) {
        totalCount
      }
      pullRequests(first: 1) {
        totalCount
      }
      openIssues: issues(states: OPEN) {
        totalCount
      }
      closedIssues: issues(states: CLOSED) {
        totalCount
      }
    }
  }
`;

async function fetchActivity() {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "dvgamerr-github-stats",
    },
    body: JSON.stringify({ query, variables: { login: username } }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`GitHub GraphQL returned HTTP ${response.status}`);
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors.map(({ message }) => message).join(", "));
  }
  if (!payload.data?.user) {
    throw new Error(`GitHub user not found: ${username}`);
  }

  return payload.data.user;
}

async function fetchPublicStars() {
  let page = 1;
  let stars = 0;

  while (true) {
    // Deliberately unauthenticated: a repository-scoped GITHUB_TOKEN cannot
    // read stargazers from the user's other repositories.
    const url = new URL(`https://api.github.com/users/${encodeURIComponent(username)}/repos`);
    url.searchParams.set("type", "owner");
    url.searchParams.set("sort", "full_name");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "dvgamerr-github-stats",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub REST API returned HTTP ${response.status}`);
    }

    const repositories = await response.json();
    stars += repositories.reduce(
      (total, repository) => total + repository.stargazers_count,
      0,
    );

    if (repositories.length < 100) {
      return stars;
    }
    page += 1;
  }
}

function formatNumber(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

const icons = {
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  commits:
    '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
  prs: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  issues:
    '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  contributions:
    '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
};

const font = "'Segoe UI', Ubuntu, Sans-Serif";
const mono = "'SF Mono', 'Cascadia Code', 'Consolas', monospace";
const theme = {
  title: "b7f74a",
  text: "ffffff",
  icon: "ffffff",
  background: "000000",
  border: "b7f74a",
};

function metricRow({ icon, value, label }, x, y) {
  const formatted = formatNumber(value);
  const labelX = x + 18 + Math.ceil(formatted.length * 8.4) + 6;

  return `<svg x="${x}" y="${y}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#${theme.icon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">${icon}</svg>
<text x="${x + 18}" y="${y + 12}" font-size="14" font-weight="700" font-family="${mono}" fill="#${theme.text}">${formatted}</text>
<text x="${labelX}" y="${y + 12}" font-size="12" font-family="${font}" fill="#${theme.text}" opacity="0.5">${label}</text>`;
}

function renderCard(stats) {
  const impact = [
    { icon: icons.star, value: stats.totalStars, label: "stars" },
    {
      icon: icons.contributions,
      value: stats.contributedTo,
      label: "contributions",
    },
  ];
  const activity = [
    { icon: icons.commits, value: stats.totalCommits, label: "commits" },
    { icon: icons.prs, value: stats.totalPRs, label: "pull requests" },
    { icon: icons.issues, value: stats.totalIssues, label: "issues" },
  ];
  const impactRows = impact
    .map((metric, index) => metricRow(metric, 24, 92 + index * 24))
    .join("\n");
  const activityRows = activity
    .map((metric, index) => metricRow(metric, 209, 92 + index * 24))
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="188" viewBox="0 0 440 188" role="img">
  <rect x="0.5" y="0.5" width="439" height="99%" rx="4.5" fill="#${theme.background}" stroke="#${theme.border}"/>
  <text x="24" y="40" font-size="16" font-weight="600" font-family="${font}" fill="#${theme.title}">${escapeHtml(stats.name)}</text>
  <text x="24" y="56" font-size="11" font-family="${font}" fill="#${theme.text}" opacity="0.4">@${escapeHtml(stats.login)}</text>
  <line x1="24" y1="64" x2="416" y2="64" stroke="#${theme.text}" stroke-width="0.5" opacity="0.1"/>
  <text x="24" y="80" font-size="9" font-weight="700" font-family="${font}" fill="#${theme.text}" opacity="0.3" letter-spacing="1.5">IMPACT</text>
  <text x="209" y="80" font-size="9" font-weight="700" font-family="${font}" fill="#${theme.text}" opacity="0.3" letter-spacing="1.5">ACTIVITY</text>
  ${impactRows}
  ${activityRows}
</svg>\n`;
}

const [user, totalStars] = await Promise.all([
  fetchActivity(),
  fetchPublicStars(),
]);
const stats = {
  name: user.name || user.login,
  login: user.login,
  totalCommits: user.commits.totalCommitContributions,
  totalPRs: user.pullRequests.totalCount,
  totalIssues: user.openIssues.totalCount + user.closedIssues.totalCount,
  totalStars,
  contributedTo: user.repositoriesContributedTo.totalCount,
};
const outputPath = join(process.env.GITHUB_WORKSPACE || process.cwd(), "gh-stats.svg");

await writeFile(outputPath, renderCard(stats), "utf8");
console.log(
  `Updated ${outputPath}: ${stats.totalCommits} commits, ${stats.totalStars} stars`,
);
