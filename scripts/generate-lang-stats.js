#!/usr/bin/env node
/**
 * Generates a "Most Used Languages" SVG card by aggregating language byte
 * counts across all of a GitHub user's public, non-fork repositories.
 *
 * Runs entirely on GitHub's own API — no third-party stats service involved.
 * Output is committed to assets/top-langs.svg by the accompanying workflow.
 */

const USERNAME = process.env.GH_USERNAME || "Hridu06";
const TOKEN = process.env.GH_TOKEN || "";
const OUTPUT_PATH = "assets/top-langs.svg";
const TOP_N = 7;

const API = "https://api.github.com";
const headers = {
  "Accept": "application/vnd.github+json",
  "User-Agent": `${USERNAME}-readme-stats`,
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

// A small, commonly-used subset of GitHub's language colors.
const LANGUAGE_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  HTML: "#e34c26",
  CSS: "#563d7c",
  PHP: "#4F5D95",
  Python: "#3572A5",
  Java: "#b07219",
  "C#": "#178600",
  C: "#555555",
  "C++": "#f34b7d",
  Blade: "#f7523f",
  SCSS: "#c6538c",
  Vue: "#41b883",
  Dockerfile: "#384d54",
  Shell: "#89e051",
  "Jupyter Notebook": "#DA5B0B",
};
const DEFAULT_COLOR = "#858585";

async function fetchJSON(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}: ${await res.text()}`);
  }
  return res.json();
}

async function getAllRepos() {
  const repos = [];
  let page = 1;
  for (;;) {
    const batch = await fetchJSON(
      `${API}/users/${USERNAME}/repos?per_page=100&page=${page}&type=owner`
    );
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return repos.filter((r) => !r.fork && !r.archived);
}

async function getLanguageTotals(repos) {
  const totals = {};
  for (const repo of repos) {
    let langs;
    try {
      langs = await fetchJSON(`${API}/repos/${USERNAME}/${repo.name}/languages`);
    } catch (err) {
      console.warn(`Skipping ${repo.name}: ${err.message}`);
      continue;
    }
    for (const [lang, bytes] of Object.entries(langs)) {
      totals[lang] = (totals[lang] || 0) + bytes;
    }
  }
  return totals;
}

// Excluded because they inflate byte counts without reflecting hand-written
// code (notebooks embed execution output; these formats are markup, not
// programming languages).
const EXCLUDED_LANGUAGES = new Set(["Jupyter Notebook", "Markdown", "TeX"]);

function topLanguages(totals, n) {
  const filtered = Object.fromEntries(
    Object.entries(totals).filter(([name]) => !EXCLUDED_LANGUAGES.has(name))
  );
  const total = Object.values(filtered).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(filtered)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, bytes]) => ({
      name,
      percent: (bytes / total) * 100,
      color: LANGUAGE_COLORS[name] || DEFAULT_COLOR,
    }));
}

function renderSVG(languages) {
  const columns = 2;
  const colWidth = 240;
  const rowHeight = 40;
  const padding = 25;
  const gap = 20;
  const rows = Math.ceil(languages.length / columns);
  const width = padding * 2 + colWidth * columns + gap * (columns - 1);
  const height = padding * 2 + rows * rowHeight;
  const barWidth = colWidth;

  const items = languages
    .map((lang, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = padding + col * (colWidth + gap);
      const y = padding + row * rowHeight;
      const filled = Math.max((lang.percent / 100) * barWidth, 2);
      return `
    <g transform="translate(${x}, ${y})">
      <text x="0" y="0" class="lang-name">${lang.name}</text>
      <text x="${barWidth}" y="0" text-anchor="end" class="lang-percent">${lang.percent.toFixed(1)}%</text>
      <rect x="0" y="8" width="${barWidth}" height="6" rx="3" fill="#2d2d2d" />
      <rect x="0" y="8" width="${filled}" height="6" rx="3" fill="${lang.color}" />
    </g>`;
    })
    .join("");
  const rowsSvg = items;

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .lang-name { font: 600 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: #e6e6e6; }
    .lang-percent { font: 600 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: #9e9e9e; }
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="8" fill="#151515" stroke="#2d2d2d" />
  ${rowsSvg}
</svg>`;
}

async function main() {
  console.log(`Fetching repositories for ${USERNAME}...`);
  const repos = await getAllRepos();
  console.log(`Found ${repos.length} owned, non-archived repos. Fetching languages...`);
  const totals = await getLanguageTotals(repos);
  const languages = topLanguages(totals, TOP_N);
  if (languages.length === 0) {
    throw new Error("No language data found — aborting to avoid writing an empty card.");
  }
  const svg = renderSVG(languages);

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, svg, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
  languages.forEach((l) => console.log(`  ${l.name}: ${l.percent.toFixed(1)}%`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
