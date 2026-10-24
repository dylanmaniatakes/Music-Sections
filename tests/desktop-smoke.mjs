import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const profile = await mkdtemp(path.join(os.tmpdir(), 'music-sections-desktop-'));
let app;
try {
  app = await electron.launch({ args: ['tests/desktop-entry.cjs'], env: { ...process.env, MUSIC_SECTIONS_TEST_PROFILE: profile } });
  const page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('heading', { name: 'Add your first song' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.musicSections?.desktop))).toBe(true);
  await page.evaluate(() => { localStorage.setItem('music-sections-online-default', '1'); localStorage.setItem('music-sections-online', 'false'); });
  await page.reload();
  await page.getByRole('button', { name: 'Try the practice track' }).click();
  await expect(page.getByRole('heading', { name: 'Practice arrangement', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Find sections', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Find sections', exact: true }).click();
  await expect(page.getByText(/suggested sections ready to review/)).toBeVisible();
  await page.getByRole('tab', { name: 'Perform' }).click();
  await page.getByRole('button', { name: /^04 Verse 2/ }).click();
  await expect(page.getByTestId('position')).toHaveText('0:40');
  await page.getByRole('button', { name: 'Loop section', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Loop section', exact: true })).toHaveAttribute('aria-pressed', 'true');
  if (await page.getByRole('alert').count()) throw new Error(await page.getByRole('alert').innerText());
  await page.getByRole('button', { name: 'Stop playback' }).click();
  await page.getByLabel('Extra section repeats').selectOption('3');
  await page.getByRole('button', { name: 'Repeat 3 times', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Repeat 3 times', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mode-badge')).toHaveText('3 extra repeats armed');
  await page.getByRole('button', { name: 'Repeat 3 times', exact: true }).click();
  await expect(page.getByLabel('Extra section repeats')).toBeEnabled();
  await page.getByRole('button', { name: 'Stop playback' }).click();
  await page.keyboard.press('4'); await expect(page.getByTestId('position')).toHaveText('0:40');
  await page.keyboard.press('Space'); await expect(page.getByRole('button', { name: 'Play song', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByTestId('position')).toHaveText('0:00');
  await page.screenshot({ path: 'docs/desktop-screenshot.png', animations: 'disabled' });
  const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  if (!preferences.contextIsolation || !preferences.sandbox || preferences.nodeIntegration) throw new Error('Desktop isolation settings are incorrect.');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Desktop smoke passed: custom protocol, preload bridge, worker analysis, section playback, counted repeats, keyboard control, isolated renderer.');
  await app.evaluate(() => {
    globalThis.musicSectionsTestFetch = globalThis.fetch;
    globalThis.fetch = async url => {
      if (String(url).startsWith('https://amp.shazam.com/')) return Response.json({ matches: [{}], track: { key: 'desktop-test', title: 'Desktop identified song', subtitle: 'Test artist' } });
      if (String(url).startsWith('https://lrclib.net/')) return Response.json({ id: 1, duration: 96, trackName: 'Desktop identified song', artistName: 'Test artist', instrumental: true });
      return globalThis.musicSectionsTestFetch(url);
    };
  });
  await page.getByRole('tab', { name: 'Prepare' }).click();
  await page.getByRole('button', { name: 'Identify & improve sections', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Identify & improve', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Desktop identified song', exact: true })).toBeVisible();
  await expect(page.getByText(/Song identity agreed across two audio samples/)).toBeVisible();
  await app.evaluate(() => { globalThis.fetch = globalThis.musicSectionsTestFetch; delete globalThis.musicSectionsTestFetch; });
  console.log('Desktop recognition bridge passed: real local WASM fingerprints, mocked external responses, identity update, and fallback analysis.');
  if (!process.env.MUSIC_SECTIONS_SKIP_LOOKUP) try {
    const matches = await page.evaluate(async () => {
      const result = await window.musicSections.lookupTitle('Amazing Grace'); return result.recordings?.length ?? 0;
    });
    console.log(`Live title lookup: ${matches} results.`);
  } catch (error) { console.log(`Live title lookup unavailable: ${error.message}`); }
} finally { await app?.close(); await rm(profile, { recursive: true, force: true }); }
