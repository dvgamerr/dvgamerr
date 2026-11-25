const GRAPHQL_URL = "https://api.github.com/graphql";
const REST_API_BASE_URL = "https://api.github.com";
const REST_API_VERSION = "2022-11-28";
const USER_AGENT = "dvgamerr-github-stats";
const REPOSITORIES_PER_PAGE = 100;
const MAX_REPOSITORY_PAGES = 100;

const ACTIVITY_QUERY = `
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

function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function requireCount(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }

  return value;
}

const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_WAIT_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Returns how long to wait (ms) when the response is a rate-limit rejection
// that carries a usable hint, otherwise null (not retryable).
function getRateLimitWaitMs(response) {
  if (response.status !== 403 && response.status !== 429) {
    return null;
  }

  const retryAfter = Number(response.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }

  const remaining = response.headers?.get?.("x-ratelimit-remaining");
  const reset = Number(response.headers?.get?.("x-ratelimit-reset"));
  if (remaining === "0" && Number.isFinite(reset)) {
    return Math.max(reset * 1000 - Date.now(), 0) + 1000;
  }

  return null;
}

async function requestJson(fetchImpl, url, options, apiName) {
  let response;
  let payload;

  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetchImpl(url, options);
    } catch (error) {
      throw new Error(`${apiName} request failed`, { cause: error });
    }

    const waitMs = response ? getRateLimitWaitMs(response) : null;
    if (
      waitMs === null ||
      waitMs > MAX_RATE_LIMIT_WAIT_MS ||
      attempt >= MAX_RATE_LIMIT_RETRIES
    ) {
      break;
    }
    await sleep(waitMs);
  }

  if (!response || typeof response.json !== "function") {
    throw new TypeError(`${apiName} returned an invalid response object`);
  }

  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(
      `${apiName} returned invalid JSON (HTTP ${response.status})`,
      { cause: error },
    );
  }

  if (!response.ok) {
    const detail =
      typeof payload?.message === "string" ? `: ${payload.message}` : "";
    throw new Error(`${apiName} returned HTTP ${response.status}${detail}`);
  }

  return payload;
}

function normalizeActivity(user) {
  return {
    name: requireNonEmptyString(user.name || user.login, "user.name"),
    login: requireNonEmptyString(user.login, "user.login"),
    totalCommits: requireCount(
      user.commits?.totalCommitContributions,
      "user.commits.totalCommitContributions",
    ),
    totalPRs: requireCount(
      user.pullRequests?.totalCount,
      "user.pullRequests.totalCount",
    ),
    totalIssues:
      requireCount(user.openIssues?.totalCount, "user.openIssues.totalCount") +
      requireCount(
        user.closedIssues?.totalCount,
        "user.closedIssues.totalCount",
      ),
    contributedTo: requireCount(
      user.repositoriesContributedTo?.totalCount,
      "user.repositoriesContributedTo.totalCount",
    ),
  };
}

async function fetchActivity({ fetchImpl, token, username }) {
  const payload = await requestJson(
    fetchImpl,
    GRAPHQL_URL,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify({
        query: ACTIVITY_QUERY,
        variables: { login: username },
      }),
    },
    "GitHub GraphQL API",
  );

  if (payload.errors?.length) {
    const messages = payload.errors
      .map((error) => error?.message)
      .filter(Boolean)
      .join(", ");
    throw new Error(`GitHub GraphQL error: ${messages || "Unknown error"}`);
  }
  if (!payload.data?.user) {
    throw new Error(`GitHub user not found: ${username}`);
  }

  return normalizeActivity(payload.data.user);
}

function createRepositoriesUrl(username, page) {
  const url = new URL(
    `/users/${encodeURIComponent(username)}/repos`,
    REST_API_BASE_URL,
  );
  url.searchParams.set("type", "owner");
  url.searchParams.set("sort", "full_name");
  url.searchParams.set("per_page", String(REPOSITORIES_PER_PAGE));
  url.searchParams.set("page", String(page));
  return url;
}

function sumRepositoryStars(repositories, page) {
  if (!Array.isArray(repositories)) {
    throw new TypeError(`GitHub repositories page ${page} must be an array`);
  }

  return repositories.reduce(
    (total, repository, index) =>
      total +
      requireCount(
        repository?.stargazers_count,
        `repositories[${index}].stargazers_count`,
      ),
    0,
  );
}

async function fetchPublicStarCount({ fetchImpl, token, username }) {
  let totalStars = 0;

  for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
    // Authenticate: anonymous calls share a 60/hour limit per runner IP and
    // get rate limited on GitHub Actions. Public repo data is readable with
    // any token.
    const repositories = await requestJson(
      fetchImpl,
      createRepositoriesUrl(username, page),
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": USER_AGENT,
          "x-github-api-version": REST_API_VERSION,
        },
      },
      "GitHub REST API",
    );

    totalStars += sumRepositoryStars(repositories, page);

    if (repositories.length < REPOSITORIES_PER_PAGE) {
      return totalStars;
    }
  }

  throw new Error(
    `GitHub REST pagination exceeded ${MAX_REPOSITORY_PAGES} pages`,
  );
}

export async function fetchGitHubStats({ username, token, fetchImpl }) {
  const normalizedUsername = requireNonEmptyString(username, "username");
  const normalizedToken = requireNonEmptyString(token, "token");

  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }

  const [activity, totalStars] = await Promise.all([
    fetchActivity({
      fetchImpl,
      token: normalizedToken,
      username: normalizedUsername,
    }),
    fetchPublicStarCount({
      fetchImpl,
      token: normalizedToken,
      username: normalizedUsername,
    }),
  ]);

  return { ...activity, totalStars };
}
