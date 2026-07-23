const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, bypassCSP: true });
  const page = await context.newPage();
  await page.goto('http://localhost:3001/volatility', { waitUntil: 'load', timeout: 20000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const box = await page.locator('input[placeholder="e.g. RELIANCE"]').boundingBox();
  console.log('box', box);
  await page.screenshot({ path: '/tmp/vol-after2.png', clip: { x: box.x - 20, y: box.y - 40, width: box.width + 60, height: box.height + 60 } });
  await browser.close();
})();
