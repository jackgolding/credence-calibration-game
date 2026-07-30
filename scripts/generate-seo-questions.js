import { readFile, writeFile } from "node:fs/promises";

const searches = [
  { query: "poea jobs", country: "ph" },
  { query: "hong kong career advice", country: "hk" },
  { query: "nursing jobs in langkawi", country: "my" },
  { query: "commonwealth bank employee reviews", country: "au" },
  { query: "remote jobs in asia", country: "sg" },
  { query: "resignation letter", country: "au" },
  { query: "how much does a fifo worker make", country: "au" },
  { query: "which city in australia has the most job growth", country: "au" },
  { query: "how to write a cover letter", country: "au" },
  { query: "top earning jobs in malaysia", country: "my" },
];

const careerSites = [
  { name: "Seek", domains: ["seek.com.au", "seek.com"] },
  { name: "JobsDB", domains: ["jobsdb.com"] },
  { name: "JobStreet", domains: ["jobstreet.com"] },
  { name: "Indeed", domains: ["indeed.com"] },
  { name: "LinkedIn", domains: ["linkedin.com"] },
  { name: "Glassdoor", domains: ["glassdoor.com"] },
  { name: "Jora", domains: ["jora.com"] },
  { name: "Foundit", domains: ["foundit.com"] },
  { name: "Hays", domains: ["hays.com", "hays.com.au", "hays.com.hk"] },
  { name: "Randstad", domains: ["randstad.com"] },
  {
    name: "Michael Page",
    domains: ["michaelpage.com", "michaelpage.com.au", "michaelpage.com.hk", "michaelpage.com.my"],
  },
  { name: "Robert Half", domains: ["roberthalf.com"] },
  { name: "WorkAbroad.ph", domains: ["workabroad.ph"] },
  { name: "PhilJobNet", domains: ["philjobnet.gov.ph"] },
  { name: "Bossjob", domains: ["bossjob.com", "bossjob.ph"] },
  { name: "Kalibrr", domains: ["kalibrr.com"] },
  { name: "OnlineJobs.ph", domains: ["onlinejobs.ph"] },
  { name: "GrabJobs", domains: ["grabjobs.co"] },
];

const siteAliases = new Map([
  ["fairwork.gov.au", "Fair Work Ombudsman"],
  ["nationwidevisas.com", "Nationwide Visas"],
  ["poeajobs.ph", "POEA Jobs"],
  ["remotejobsinasia.com", "Remote Jobs in Asia"],
  ["remotejobsasia.com", "Remote Jobs Asia"],
  ["youthcentral.vic.gov.au", "Youth Central"],
]);

function parseEnv(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function identifySite(link) {
  let hostname;
  try {
    hostname = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }

  const knownSite = careerSites.find((site) =>
    site.domains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    ),
  );
  if (knownSite) return { ...knownSite, key: knownSite.name, known: true };

  const label = hostname.split(".")[0];
  return {
    name: siteAliases.get(hostname) ||
      (label.length <= 4
        ? label.toUpperCase()
        : `${label.charAt(0).toUpperCase()}${label.slice(1)}`),
    domains: [hostname],
    key: hostname,
    known: false,
  };
}

async function fetchResults(search, apiKey) {
  const url = new URL("https://serpapi.com/search.json");
  url.search = new URLSearchParams({
    engine: "google",
    q: search.query,
    api_key: apiKey,
    gl: search.country,
    hl: "en",
    num: "20",
    no_cache: "true",
  });

  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `SerpApi returned HTTP ${response.status}`);
  }

  const rankedSites = [];
  const seen = new Set();
  for (const result of payload.organic_results || []) {
    const site = identifySite(result.link);
    if (!site || seen.has(site.key)) continue;
    seen.add(site.key);
    rankedSites.push({
      name: site.name,
      known: site.known,
      position: Number(result.position),
      title: result.title,
      link: result.link,
    });
  }

  if (rankedSites.length < 2) {
    throw new Error(
      `Only found ${rankedSites.length} recognized career sites for "${search.query}".`,
    );
  }

  return {
    query: search.query,
    country: search.country,
    searchUrl: payload.search_metadata?.google_url || null,
    comparisonSites: chooseComparisonSites(rankedSites),
    sites: rankedSites,
  };
}

function chooseComparisonSites(rankedSites) {
  const knownSites = rankedSites.filter((site) => site.known);
  let comparisonSites;
  if (knownSites.length >= 2) {
    comparisonSites = knownSites.slice(0, 2);
  } else if (knownSites.length === 1) {
    comparisonSites = [
      knownSites[0],
      rankedSites.find((site) => site.name !== knownSites[0].name),
    ].sort((a, b) => a.position - b.position);
  } else {
    comparisonSites = rankedSites.slice(0, 2);
  }
  return comparisonSites;
}

function makeQuestion(result, index, capturedAt) {
  const [higher, lower] = result.comparisonSites;
  const reverseStatement = index % 2 === 1;
  const first = reverseStatement ? lower : higher;
  const second = reverseStatement ? higher : lower;
  const answer = first.position < second.position;
  const date = capturedAt.slice(0, 10);

  return {
    id: `seo-${String(index + 1).padStart(2, "0")}`,
    prompt: `For the Google search “${result.query}”, ${first.name} ranks higher than ${second.name}.`,
    answer,
    explanation:
      `${higher.name} ranked #${higher.position}, ahead of ${lower.name} at #${lower.position}, ` +
      `in ${result.country.toUpperCase()} organic Google results captured via SerpApi on ${date}. ` +
      "Search rankings can change over time.",
  };
}

async function main() {
  let capturedAt = new Date().toISOString();
  let results;

  if (process.argv.includes("--from-snapshot")) {
    const snapshot = JSON.parse(
      await readFile(new URL("../data/serp-snapshot.json", import.meta.url), "utf8"),
    );
    capturedAt = snapshot.capturedAt;
    results = snapshot.results.map((result) => {
      const sites = result.sites.map((site) => {
        const identity = identifySite(site.link);
        return {
          ...site,
          name: identity.name,
          known: identity.known,
        };
      });
      return { ...result, sites, comparisonSites: chooseComparisonSites(sites) };
    });
  } else {
    const env = parseEnv(await readFile(new URL("../.env", import.meta.url), "utf8"));
    if (!env.SERPAPI_KEY) throw new Error("SERPAPI_KEY is missing from .env.");

    results = [];
    for (const search of searches) {
      results.push(await fetchResults(search, env.SERPAPI_KEY));
    }
  }

  const questions = results.map((result, index) =>
    makeQuestion(result, index, capturedAt),
  );

  await writeFile(
    new URL("../data/questions.json", import.meta.url),
    `${JSON.stringify({ questions }, null, 2)}\n`,
  );
  await writeFile(
    new URL("../data/serp-snapshot.json", import.meta.url),
    `${JSON.stringify({ capturedAt, results }, null, 2)}\n`,
  );
}

await main();
