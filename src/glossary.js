const GLOSSARY = [
  ["Department of Migrant Workers", "The Philippine government department responsible for protecting and supporting overseas Filipino workers."],
  ["Fair Work Ombudsman", "Australia’s government workplace-relations regulator."],
  ["Commonwealth Bank", "A major Australian bank, also known as CommBank."],
  ["Philippine Overseas Employment Administration", "The former Philippine government agency that regulated overseas employment, commonly called POEA. Its functions now sit with the Department of Migrant Workers."],
  ["University of Wollongong Malaysia", "The Malaysian campus of Australia’s University of Wollongong."],
  ["Sunway University Online", "The online study platform of Malaysia’s Sunway University."],
  ["University of Melbourne", "A public research university in Melbourne, Australia."],
  ["organic Google results", "Unpaid search listings ranked by Google, excluding advertisements."],
  ["organic CTR", "The share of searchers who click an unpaid Google result."],
  ["SERP", "Search engine results page: the page of listings Google shows for a query."],
  ["power law", "A distribution where a few top items get most of the attention, and the rest get far less."],
  ["Remote Jobs in Asia", "A job board focused on remote roles available across Asia."],
  ["Nationwide Visas", "An immigration and visa consultancy."],
  ["WorkAbroad.ph", "A Philippine job site focused on overseas employment."],
  ["Michael Page", "A global recruitment agency with operations across Asia-Pacific, including Australia."],
  ["Mind Care Space", "A Hong Kong career coaching and counselling service."],
  ["Youth Central", "A Victorian Government information resource for young people."],
  ["Hong Kong", "A special administrative region of China and a major Asian employment market."],
  ["JobStreet", "An online employment marketplace focused on Southeast Asia."],
  ["LinkedIn", "A professional networking platform that also lists jobs."],
  ["Australia", "A country and employment market in the Oceania region."],
  ["Australian", "Relating to Australia."],
  ["Malaysia", "A Southeast Asian country and employment market."],
  ["Langkawi", "An island and district in the Malaysian state of Kedah."],
  ["SerpApi", "A service used to capture structured Google search-result rankings."],
  ["Facebook", "A social networking platform operated by Meta."],
  ["Glassdoor", "A jobs platform known for employee-submitted company reviews and salary data."],
  ["Indeed", "A global job-search and employment platform."],
  ["POEA Jobs", "A Philippine job site focused on approved overseas employment opportunities."],
  ["Civil Safety", "An Australian training provider for civil construction and workplace safety."],
  ["Reddit", "A network of topic-based online communities and discussions."],
  ["Hays", "A global recruitment firm with a substantial Australian operation."],
  ["Jora", "A job-search engine that aggregates vacancies from many sources."],
  ["Seek", "A major online employment marketplace in Australia and New Zealand."],
  ["CUHK", "The Chinese University of Hong Kong."],
  ["ACAS", "The UK Advisory, Conciliation and Arbitration Service for workplace relations."],
  ["POEA", "Philippine Overseas Employment Administration, the former agency responsible for regulating overseas employment from the Philippines."],
  ["FIFO", "Fly-in fly-out: work where employees travel to a remote site for rostered shifts."],
  ["Asia", "The region containing markets in this game such as Hong Kong, Malaysia, the Philippines, and Singapore."],
  ["Philippines", "A Southeast Asian country; its country code here is PH."],
  ["Singapore", "A Southeast Asian city-state; its country code here is SG."],
  ["AU", "Country code for Australia."],
  ["HK", "Country code for Hong Kong."],
  ["MY", "Country code for Malaysia."],
  ["PH", "Country code for the Philippines."],
  ["SG", "Country code for Singapore."],
].sort(([left], [right]) => right.length - left.length);

const TERM_PATTERN = new RegExp(
  GLOSSARY.map(([term]) => escapeRegExp(term)).join("|"),
  "giu",
);
const DEFINITIONS = new Map(
  GLOSSARY.map(([term, definition]) => [term.toLocaleLowerCase(), definition]),
);

export function appendGlossaryText(element, text) {
  const value = String(text);
  let cursor = 0;

  for (const match of value.matchAll(TERM_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!hasTermBoundaries(value, start, end)) continue;

    element.append(document.createTextNode(value.slice(cursor, start)));

    const term = document.createElement("dfn");
    const definition = DEFINITIONS.get(match[0].toLocaleLowerCase());
    term.className = "glossary-term";
    term.tabIndex = 0;
    term.textContent = match[0];
    term.dataset.definition = definition;
    term.setAttribute("aria-label", `${match[0]}: ${definition}`);
    element.append(term);
    cursor = end;
  }

  element.append(document.createTextNode(value.slice(cursor)));
}

function hasTermBoundaries(value, start, end) {
  return !isLetterOrNumber(value[start - 1]) && !isLetterOrNumber(value[end]);
}

function isLetterOrNumber(character) {
  return character ? /[\p{L}\p{N}]/u.test(character) : false;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
