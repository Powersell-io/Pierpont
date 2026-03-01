// Diagnostic 2: Capture the exact API request the Angular app makes when searching
const puppeteer = require('puppeteer');
const config = require('./config');

(async () => {
  const browser = await puppeteer.launch(config.scraper.puppeteer);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  page.setDefaultTimeout(30000);

  // Intercept outgoing requests
  const capturedRequests = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('search/search') || url.includes('Search')) {
      capturedRequests.push({
        url: url,
        method: req.method(),
        postData: req.postData(),
        headers: req.headers(),
      });
    }
    req.continue();
  });

  // Also capture the criteria API response
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('search/criteria') || url.includes('search/search')) {
      try {
        const text = await resp.text();
        console.log('\n=== RESPONSE FROM:', url.substring(0, 150), '===');
        console.log('Status:', resp.status());
        console.log('Body (first 2000):', text.substring(0, 2000));
        console.log('===\n');
      } catch(e) {}
    }
  });

  // Navigate
  console.log('Loading portal...');
  await page.goto('https://egcss.charleston-sc.gov/energov_prod/selfservice#/search', {
    waitUntil: 'networkidle2', timeout: 45000
  });
  await new Promise(r => setTimeout(r, 3000));

  // Use Angular's scope to change the search module to Inspection (4)
  console.log('Setting search module to Inspection via Angular...');
  const moduleSet = await page.evaluate(() => {
    try {
      // Find the select element and set its value via Angular
      const select = document.querySelector('#SearchModule');
      if (!select) return { error: 'No SearchModule select found' };

      // Set the Angular model value
      const scope = angular.element(select).scope();
      if (scope && scope.vm) {
        scope.vm.searchModule = 4;
        scope.$apply();
        return { success: true, searchModule: scope.vm.searchModule };
      }

      // Try via controller
      const ctrl = angular.element(select).controller('ngModel');
      if (ctrl) {
        ctrl.$setViewValue('number:4');
        ctrl.$render();
        return { success: true, via: 'controller' };
      }

      return { error: 'Could not set Angular model' };
    } catch(e) {
      return { error: e.message };
    }
  });
  console.log('Module set result:', JSON.stringify(moduleSet));
  await new Promise(r => setTimeout(r, 1000));

  // Uncheck exact match
  console.log('Unchecking exact match...');
  await page.evaluate(() => {
    const cb = document.querySelector('#ExactMatch');
    if (cb && cb.checked) cb.click();
  });
  await new Promise(r => setTimeout(r, 500));

  // Type search term
  console.log('Typing "Framing" into search...');
  const searchInput = await page.$('#SearchKeyword');
  if (searchInput) {
    await searchInput.click({ clickCount: 3 });
    await searchInput.press('Backspace');
    await searchInput.type('Framing', { delay: 50 });
    console.log('Typed into #SearchKeyword');
  } else {
    console.log('ERROR: #SearchKeyword not found');
  }
  await new Promise(r => setTimeout(r, 500));

  // Click search button
  console.log('Clicking search button...');
  const searchBtn = await page.$('#button-Search');
  if (searchBtn) {
    await searchBtn.click();
    console.log('Clicked #button-Search');
  } else {
    console.log('ERROR: #button-Search not found');
  }

  // Wait for the API call
  await new Promise(r => setTimeout(r, 8000));

  // Show captured requests
  console.log('\n=== CAPTURED API REQUESTS (' + capturedRequests.length + ') ===');
  for (const req of capturedRequests) {
    console.log('URL:', req.url);
    console.log('Method:', req.method);
    console.log('Post Data:');
    if (req.postData) {
      try {
        const parsed = JSON.parse(req.postData);
        console.log(JSON.stringify(parsed, null, 2));
      } catch(e) {
        console.log(req.postData);
      }
    } else {
      console.log('(none)');
    }
    console.log('---');
  }

  // Show the results count from the page
  const resultsText = await page.evaluate(() => {
    const body = document.body.innerText;
    const match = body.match(/Found\s+([\d,]+)\s+results?/i);
    return match ? match[0] : 'No results text found';
  });
  console.log('\nResults text:', resultsText);

  await page.screenshot({ path: 'screenshots/diag2-results.png', fullPage: true });

  await browser.close();
  console.log('Done.');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
