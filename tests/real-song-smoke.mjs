import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => { localStorage.setItem('music-sections-online-default', '1'); localStorage.setItem('music-sections-online', 'false'); });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/');
  for (const ext of ['ogg', 'mp3']) {
    await page.locator('input[type=file]').nth(0).setInputFiles(`tests/local-fixtures/voice-song.${ext}`);
    await expect(page.getByText(/suggested sections ready to review/)).toBeVisible();
    const count = await page.locator('.section-row').count();
    const labels = await page.locator('.section-row strong').allTextContents();
    console.log(`${ext}: decoded actual vocal music; ${count} suggestions: ${labels.join(', ')}`);
    await page.getByRole('tab', { name: 'Perform' }).click();
    await page.locator('.section-card').nth(1).click();
    await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Loop section', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Loop section', exact: true })).toHaveAttribute('aria-pressed', 'true');
    if (await page.getByRole('alert').count()) throw new Error(await page.getByRole('alert').innerText());
    await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
    await page.getByRole('tab', { name: 'Prepare' }).click();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Real vocal music smoke passed. This checks decoding and operation, not section correctness or physical audio output.');
} finally { await browser.close(); }
