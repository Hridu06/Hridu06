#!/usr/bin/env node
/**
 * Generates a "Contribution Graph" SVG card — a line/area chart of daily
 * contributions over the last DAYS days.
 *
 * Uses GitHub's GraphQL API when a token is available; otherwise falls back
 * to parsing the public contributions calendar. No third-party stats service
 * involved. Output is committed to assets/activity-graph.svg by the
 * accompanying workflow.
 */

const USERNAME = process.env.GH_USERNAME || "Hridu06";
const TOKEN = process.env.GH_TOKEN || "";
const OUTPUT_PATH = "assets/activity-graph.svg";
const DAYS = 31;

const COLORS = {
  bg: "#151515",
  border: "#2d2d2d",
  title: "#e6e6e6",
  label: "#9e9e9e",
  grid: "#2d2d2d",
  line: "#14A97D",
  point: "#ffffff",
};

async function fetchFromGraphQL() {
  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": `${USERNAME}-readme-stats`,
    },
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });
  if (!res.ok) {
    throw new Error(`GitHub GraphQL ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GitHub GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ date: d.date, count: d.contributionCount }));
}

// The public calendar renders each day as a <td data-date=... id=...> with a
// matching <tool-tip for=id>"N contributions on ..."</tool-tip>.
async function fetchFromPublicPage() {
  const res = await fetch(`https://github.com/users/${USERNAME}/contributions`, {
    headers: { "User-Agent": `${USERNAME}-readme-stats` },
  });
  if (!res.ok) {
    throw new Error(`Contributions page ${res.status}`);
  }
  const html = await res.text();

  const dateById = {};
  for (const [td] of html.matchAll(/<td[^>]*data-date="[^"]*"[^>]*>/g)) {
    const date = td.match(/data-date="([^"]+)"/)[1];
    const id = td.match(/id="([^"]+)"/)?.[1];
    if (id) dateById[id] = date;
  }

  const days = [];
  for (const [, id, text] of html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    if (!dateById[id]) continue;
    const count = text.match(/^(\d+) contribution/);
    days.push({ date: dateById[id], count: count ? Number(count[1]) : 0 });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function niceMax(value) {
  if (value <= 4) return 4;
  const step = Math.ceil(value / 4);
  return step * 4;
}

function renderSVG(days) {
  const width = 495;
  const height = 195;
  const pad = { top: 45, right: 20, bottom: 30, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const max = niceMax(Math.max(...days.map((d) => d.count)));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const x = (i) => pad.left + (i / (days.length - 1)) * plotW;
  const y = (v) => pad.top + plotH - (v / max) * plotH;

  const grid = [0, 1, 2, 3, 4]
    .map((i) => {
      const value = (max / 4) * i;
      const gy = y(value).toFixed(1);
      return `
  <line x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}" stroke="${COLORS.grid}" stroke-dasharray="${i === 0 ? "" : "3 3"}" />
  <text x="${pad.left - 8}" y="${gy}" text-anchor="end" dominant-baseline="middle" class="label">${value}</text>`;
    })
    .join("");

  // Label every 5th day plus the last, so labels don't collide.
  const xLabels = days
    .map((d, i) => {
      if (i % 5 !== 0 && i !== days.length - 1) return "";
      return `
  <text x="${x(i).toFixed(1)}" y="${height - pad.bottom + 16}" text-anchor="middle" class="label">${Number(d.date.slice(8, 10))}</text>`;
    })
    .join("");

  const points = days.map((d, i) => `${x(i).toFixed(1)},${y(d.count).toFixed(1)}`);
  const linePath = `M${points.join(" L")}`;
  const areaPath = `${linePath} L${x(days.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  const dots = days
    .map((d, i) => `
  <circle cx="${x(i).toFixed(1)}" cy="${y(d.count).toFixed(1)}" r="2.5" fill="${COLORS.point}" stroke="${COLORS.line}" stroke-width="1.5"><title>${d.date}: ${d.count}</title></circle>`)
    .join("");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .title { font: 600 15px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${COLORS.title}; }
    .subtitle { font: 400 11px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${COLORS.label}; }
    .label { font: 400 10px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${COLORS.label}; }
  </style>
  <defs>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${COLORS.line}" stop-opacity="0.45" />
      <stop offset="100%" stop-color="${COLORS.line}" stop-opacity="0" />
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="5" fill="${COLORS.bg}" stroke="${COLORS.border}" />
  <text x="${pad.left}" y="24" class="title">Contribution Graph</text>
  <text x="${width - pad.right}" y="24" text-anchor="end" class="subtitle">${total} contributions · last ${days.length} days</text>
  ${grid}
  ${xLabels}
  <path d="${areaPath}" fill="url(#area)" />
  <path d="${linePath}" fill="none" stroke="${COLORS.line}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
  ${dots}
</svg>`;
}

async function main() {
  console.log(`Fetching contributions for ${USERNAME} via ${TOKEN ? "GraphQL" : "public page"}...`);
  const all = TOKEN ? await fetchFromGraphQL() : await fetchFromPublicPage();

  // The calendar can include future days of the current week; drop those.
  const today = new Date().toISOString().slice(0, 10);
  const days = all.filter((d) => d.date <= today).slice(-DAYS);
  if (days.length < 2) {
    throw new Error("Not enough contribution data — aborting to avoid writing an empty card.");
  }
  const svg = renderSVG(days);

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, svg, "utf8");
  console.log(`Wrote ${OUTPUT_PATH} (${days[0].date} → ${days[days.length - 1].date})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
