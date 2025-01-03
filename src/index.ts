import { execSync } from 'child_process';
import fs from 'fs';
import fsp, { writeFile } from 'fs/promises';

import env from './utils/env.js';
import getAuth from './utils/get-auth.js';
import getEventServiceData from './utils/get-event-service-data.js';
import getTournamentCmsData from './utils/get-tournament-frontend-cms-data.js';
import killToken from './utils/kill-token.js';
import getTournamentLeaderboardsCmsData from './utils/get-tournament-leaderboards-cms-data.js';
import getTournamentScoringRulesCmsData from './utils/get-tournament-scoring-rules-cms-data.js';
import { SimplifiedEvent } from './types/event-service.js';

const outputFolder = 'output';
const eventsFile = `${outputFolder}/events.json`;
const devEventsFile = `${outputFolder}/events-dev.json`;
const cmsFrontendFile = `${outputFolder}/cms.json`;
const cmsLeaderboardsFile = `${outputFolder}/cms-leaderboards.json`;
const cmsScoringRulesFile = `${outputFolder}/cms-scoring-rules.json`;

const writeEventsFiles = async (type: string, res: Awaited<ReturnType<typeof getEventServiceData>>) => {
  if (!res.success) {
    return;
  }

  await writeFile(`${outputFolder}/${type}.json`, JSON.stringify(res.data, null, 3));

  const eventsDir = `${outputFolder}/${type}/events`;

  // so deleted events are actually deleted in git too
  if (fs.existsSync(eventsDir)) {
    await fsp.rmdir(eventsDir, { recursive: true });
  }

  await fsp.mkdir(eventsDir, { recursive: true });

  const events = <SimplifiedEvent[]>res.data.events;

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];

    await writeFile(`${eventsDir}/${event.eventId}.json`, JSON.stringify(event, null, 3));
  }
}

const main = async () => {
  if (!fs.existsSync(outputFolder)) {
    await fsp.mkdir(outputFolder, { recursive: true });
  }

  const frontendCms = await getTournamentCmsData('en-US');
  const leaderboardsCms = await getTournamentLeaderboardsCmsData('en-US');
  const scoringRulesCms = await getTournamentScoringRulesCmsData('en-US');

  if (frontendCms.success) {
    await writeFile(cmsFrontendFile, JSON.stringify(frontendCms.data, null, 3));
  }

  if (leaderboardsCms.success) {
    await writeFile(cmsLeaderboardsFile, JSON.stringify(leaderboardsCms.data, null, 3));
  }

  if (scoringRulesCms.success) {
    await writeFile(cmsScoringRulesFile, JSON.stringify(scoringRulesCms.data, null, 3));
  }

  const auth = await getAuth();
  const eventsData = await getEventServiceData(auth, 'live');
  const devEventsData = await getEventServiceData(auth, 'prod');

  await writeEventsFiles('events', eventsData);
  await writeEventsFiles('events-dev', devEventsData);

  await killToken(auth);

  const gitStatus = execSync('git status')?.toString('utf-8') || '';
  const changes: string[] = [];

  let triggerWebhook = false;

  if (gitStatus.includes(cmsFrontendFile)) {
    changes.push('Frontend CMS');

    triggerWebhook = true;
  }

  if (gitStatus.includes(cmsLeaderboardsFile)) {
    changes.push('Leaderboards CMS');
  }

  if (gitStatus.includes(cmsScoringRulesFile)) {
    changes.push('Scoring Rules CMS');
  }

  if (gitStatus.includes(eventsFile)) {
    changes.push('Events');

    triggerWebhook = true;
  }

  if (gitStatus.includes(devEventsFile)) {
    changes.push('Events (Dev)');
  }

  if (!changes.length) {
    return;
  }

  // we dont have the webhook in local dev, so only run when defined
  if (triggerWebhook && env.WEBHOOK_URL && env.WEBHOOK_AUTH) {
    const res = await fetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `token ${env.WEBHOOK_AUTH}`,
      },
      body: JSON.stringify({
        event_type: 'tournaments-data-updated',
      }),
    });

    if (!res.ok) {
      console.error(`failed to send webhook - ${res.status} ${res.statusText}: ${await res.text()}`);
    }
  }

  const commitMessage = `Modified ${changes.join(', ')}`

  console.log(commitMessage);

  if (env.GIT_DO_NOT_COMMIT?.toLowerCase() === 'true') {
    return;
  }

  execSync('git add output');
  execSync('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
  execSync('git config user.name "github-actions[bot]"');
  execSync('git config commit.gpgsign false');
  execSync(`git commit -m "${commitMessage}"`);

  if (env.GIT_DO_NOT_PUSH?.toLowerCase() === 'true') {
    return;
  }

  execSync('git push');
};

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
