const FONT_FAMILY = "'Segoe UI', Ubuntu, Sans-Serif";
const MONOSPACE_FONT_FAMILY =
  "'SF Mono', 'Cascadia Code', 'Consolas', monospace";

const THEME = Object.freeze({
  background: "000000",
  border: "b7f74a",
  icon: "ffffff",
  text: "ffffff",
  title: "b7f74a",
});

const CARD = Object.freeze({
  width: 440,
  height: 188,
  impactX: 24,
  activityX: 209,
  firstMetricY: 92,
});

const METRIC = Object.freeze({
  characterWidth: 8.4,
  iconSize: 14,
  labelGap: 6,
  rowHeight: 24,
  valueOffsetX: 18,
  valueOffsetY: 12,
});

const ICONS = Object.freeze({
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  commits:
    '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
  contributions:
    '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  issues:
    '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  pullRequests:
    '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
});

const XML_ENTITIES = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});

export function formatCompactNumber(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("value must be a non-negative finite number");
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }

  return String(value);
}

export function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) => XML_ENTITIES[character],
  );
}

function renderMetricRow({ icon, value, label }, x, y) {
  const formattedValue = formatCompactNumber(value);
  const valueX = x + METRIC.valueOffsetX;
  const labelX =
    valueX +
    Math.ceil(formattedValue.length * METRIC.characterWidth) +
    METRIC.labelGap;

  return `<svg x="${x}" y="${y}" width="${METRIC.iconSize}" height="${METRIC.iconSize}" viewBox="0 0 24 24" fill="none" stroke="#${THEME.icon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55">${icon}</svg>
<text x="${valueX}" y="${y + METRIC.valueOffsetY}" font-size="14" font-weight="700" font-family="${MONOSPACE_FONT_FAMILY}" fill="#${THEME.text}">${formattedValue}</text>
<text x="${labelX}" y="${y + METRIC.valueOffsetY}" font-size="12" font-family="${FONT_FAMILY}" fill="#${THEME.text}" opacity="0.5">${escapeXml(label)}</text>`;
}

function renderMetricRows(metrics, x) {
  return metrics
    .map((metric, index) =>
      renderMetricRow(
        metric,
        x,
        CARD.firstMetricY + index * METRIC.rowHeight,
      ),
    )
    .join("\n");
}

function createMetricGroups(stats) {
  return {
    impact: [
      { icon: ICONS.star, value: stats.totalStars, label: "stars" },
      {
        icon: ICONS.contributions,
        value: stats.contributedTo,
        label: "contributions",
      },
    ],
    activity: [
      { icon: ICONS.commits, value: stats.totalCommits, label: "commits" },
      {
        icon: ICONS.pullRequests,
        value: stats.totalPRs,
        label: "pull requests",
      },
      { icon: ICONS.issues, value: stats.totalIssues, label: "issues" },
    ],
  };
}

export function renderStatsCard(stats) {
  const metrics = createMetricGroups(stats);
  const title = `GitHub stats for @${stats.login}`;
  const impactRows = renderMetricRows(metrics.impact, CARD.impactX);
  const activityRows = renderMetricRows(metrics.activity, CARD.activityX);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}" role="img" aria-labelledby="stats-title">
  <title id="stats-title">${escapeXml(title)}</title>
  <rect x="0.5" y="0.5" width="${CARD.width - 1}" height="99%" rx="4.5" fill="#${THEME.background}" stroke="#${THEME.border}"/>
  <text x="24" y="40" font-size="16" font-weight="600" font-family="${FONT_FAMILY}" fill="#${THEME.title}">${escapeXml(stats.name)}</text>
  <text x="24" y="56" font-size="11" font-family="${FONT_FAMILY}" fill="#${THEME.text}" opacity="0.4">@${escapeXml(stats.login)}</text>
  <line x1="24" y1="64" x2="416" y2="64" stroke="#${THEME.text}" stroke-width="0.5" opacity="0.1"/>
  <text x="${CARD.impactX}" y="80" font-size="9" font-weight="700" font-family="${FONT_FAMILY}" fill="#${THEME.text}" opacity="0.3" letter-spacing="1.5">IMPACT</text>
  <text x="${CARD.activityX}" y="80" font-size="9" font-weight="700" font-family="${FONT_FAMILY}" fill="#${THEME.text}" opacity="0.3" letter-spacing="1.5">ACTIVITY</text>
  ${impactRows}
  ${activityRows}
</svg>\n`;
}
