# Credence Calibration Game

A small true-or-false game for practicing probabilistic judgment. Players choose
an answer, report 50–100% confidence, and receive a Brier score plus a
confidence-bucket calibration report.

The frontend is a dependency-free static site hosted by GitHub Pages. Questions
and anonymous attempts can be stored in Google Sheets through a Google Apps
Script web app.

## How scoring works

Confidence is converted to a probability that the statement is true. Choosing
**True** at 80% means `p(true) = 0.8`; choosing **False** at 80% means
`p(true) = 0.2`.

The binary Brier score is:

```text
(forecast probability - outcome)²
```

An outcome is `1` for true and `0` for false. A score of `0` is perfect and `1`
is the worst possible score. Lower mean scores are better. Calibration compares
the player's accuracy at each confidence level with the level they reported.

## Run locally

This project needs a local web server because it loads questions with `fetch`.

```sh
npm test
npm run serve
```

Open <http://localhost:4173>. With no Apps Script URL configured, the game uses
the bundled questions in `data/questions.json` and does not send responses.

## Refresh the SEO questions

Copy `.env.example` to `.env`, add a SerpApi key, then run:

```sh
npm run generate:seo
```

The generator searches Google in the country relevant to each query and writes
10 true-or-false ranking comparisons to `data/questions.json`. It also saves the
source positions and result URLs in `data/serp-snapshot.json`. Rankings are a
dated snapshot and can change. The `.env` file is ignored by Git and must never
be exposed in frontend code.

## Connect Google Sheets

### 1. Create the spreadsheet

1. Create a blank Google Sheet.
2. Open **Extensions → Apps Script**.
3. Replace the editor's `Code.gs` with `apps-script/Code.gs` from this
   repository.
4. In Apps Script **Project Settings**, enable the `appsscript.json` manifest in
   the editor. Replace it with `apps-script/appsscript.json`.
5. Select `setupSheets` in the function menu and click **Run**.
6. Approve the spreadsheet permission prompt.

`setupSheets` creates:

- `Questions`: `id`, `prompt`, `answer`, `explanation`, `active`
- `Responses`: timestamp, anonymous session ID, optional nickname, answer,
  confidence, correctness, probability, and Brier score

It also inserts five starter questions when `Questions` is empty. Every question
ID must be unique. Use `TRUE` or `FALSE` for `answer` and `active`. Templates are
available in `data/questions-template.csv` and `data/responses-template.csv`.

### 2. Deploy the web app

1. In Apps Script, choose **Deploy → New deployment**.
2. Select **Web app**.
3. Set **Execute as** to **Me**.
4. Set **Who has access** to **Anyone**.
5. Deploy and copy the URL ending in `/exec`.

The endpoint must be public so a public GitHub Pages site can read questions and
write responses. It does not expose the spreadsheet itself.

Whenever `Code.gs` changes, use **Deploy → Manage deployments → Edit**, select a
new version, and redeploy.

### 3. Configure the frontend

Paste the `/exec` URL into the single configuration value in `src/config.js`:

```js
export const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
```

Commit and push that change. The URL is an endpoint, not a secret. The browser
loads questions with JSONP and sends attempts as a simple cross-origin POST.
If the remote question service is unavailable, the frontend falls back to its
bundled demo questions and does not send those demo attempts to Sheets.

## Deploy to GitHub Pages

This repository is designed to publish directly from the root of the `main`
branch:

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select `main` and `/ (root)`, then save.

The site will be available at:

```text
https://jackgolding.com/credence-calibration-game/
```

GitHub may take a few minutes to perform the first deployment.

## Privacy and data behavior

- A random browser session ID is generated for each game.
- A nickname is optional and limited to 40 characters.
- No login, email address, IP address, or browser fingerprint is deliberately
  collected by the application.
- Apps Script validates confidence values, looks up the correct answer on the
  server, neutralizes spreadsheet-formula prefixes, locks concurrent writes,
  and ignores duplicate session/question attempts.
- The current run is saved in `localStorage` so refreshing does not lose it.

Google and GitHub may retain their own standard service logs. If the game is
used with participants, describe that hosting and retention policy to them.

## Project structure

```text
.
├── index.html
├── styles.css
├── src/
│   ├── app.js
│   ├── config.js
│   └── scoring.js
├── data/
│   ├── questions.json
│   ├── questions-template.csv
│   └── responses-template.csv
├── apps-script/
│   ├── Code.gs
│   └── appsscript.json
└── tests/
    └── scoring.test.js
```
