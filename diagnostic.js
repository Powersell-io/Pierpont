// Deep diagnostic of EnerGov portal to understand search flow
const puppeteer = require('puppeteer');
const config = require('./config');

(async () => {
  const browser = await puppeteer.launch(config.scraper.puppeteer);
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
  page.setDefaultTimeout(30000);

  // Intercept API responses
  const apiResponses = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if (ct.includes('json')) {
      try {
        const text = await resp.text();
        if (text.length > 2 && text.length < 500000) {
          apiResponses.push({ url: url.substring(0, 200), size: text.length, preview: text.substring(0, 500) });
        }
      } catch(e) {}
    }
  });

  // 1. Go to the search page
  console.log('=== NAVIGATING TO SEARCH PAGE ===');
  await page.goto('https://egcss.charleston-sc.gov/energov_prod/selfservice#/search', { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 3000));

  // 2. Inspect the page structure
  const pageInfo = await page.evaluate(() => {
    const info = {};

    // Get all select elements and their options
    info.selects = [];
    document.querySelectorAll('select').forEach(sel => {
      const opts = Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim(), selected: o.selected }));
      info.selects.push({
        id: sel.id, name: sel.name, classes: sel.className,
        options: opts
      });
    });

    // Get all visible input fields
    info.inputs = [];
    document.querySelectorAll('input').forEach(inp => {
      const r = inp.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        info.inputs.push({
          type: inp.type, id: inp.id, name: inp.name, placeholder: inp.placeholder,
          classes: inp.className, value: inp.value,
          ngModel: inp.getAttribute('ng-model') || '',
        });
      }
    });

    // Get all visible buttons
    info.buttons = [];
    document.querySelectorAll('button, input[type=submit]').forEach(btn => {
      const r = btn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        info.buttons.push({
          tag: btn.tagName, type: btn.type, text: (btn.textContent || btn.value || '').trim().substring(0, 50),
          classes: btn.className, id: btn.id,
        });
      }
    });

    // Get all checkboxes
    info.checkboxes = [];
    document.querySelectorAll('input[type=checkbox]').forEach(cb => {
      info.checkboxes.push({
        id: cb.id, checked: cb.checked,
        label: cb.parentElement ? cb.parentElement.textContent.trim().substring(0, 80) : '',
        ngModel: cb.getAttribute('ng-model') || '',
      });
    });

    // Current URL and title
    info.url = window.location.href;
    info.title = document.title;

    return info;
  });

  console.log('\nURL:', pageInfo.url);
  console.log('Title:', pageInfo.title);

  console.log('\n=== SELECT DROPDOWNS ===');
  for (const s of pageInfo.selects) {
    console.log('Select:', JSON.stringify({ id: s.id, name: s.name }));
    for (const o of s.options) {
      console.log('  Option:', JSON.stringify(o));
    }
  }

  console.log('\n=== INPUTS ===');
  for (const i of pageInfo.inputs) {
    console.log('Input:', JSON.stringify(i));
  }

  console.log('\n=== CHECKBOXES ===');
  for (const c of pageInfo.checkboxes) {
    console.log('Checkbox:', JSON.stringify(c));
  }

  console.log('\n=== BUTTONS ===');
  for (const b of pageInfo.buttons) {
    console.log('Button:', JSON.stringify(b));
  }

  // 3. Change dropdown to 'Inspection'
  console.log('\n=== SELECTING INSPECTION FROM DROPDOWN ===');
  const selectResult = await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      const opts = Array.from(sel.options);
      const inspOpt = opts.find(o => o.textContent.trim().toLowerCase().includes('inspection'));
      if (inspOpt) {
        sel.value = inspOpt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        return { found: true, value: inspOpt.value, text: inspOpt.textContent.trim() };
      }
    }
    return { found: false };
  });
  console.log('Select result:', JSON.stringify(selectResult));
  await new Promise(r => setTimeout(r, 1000));

  // 4. Uncheck exact phrase if checked
  const uncheckResult = await page.evaluate(() => {
    const cbs = document.querySelectorAll('input[type=checkbox]');
    for (const cb of cbs) {
      const label = (cb.parentElement && cb.parentElement.textContent || '').toLowerCase();
      if (label.includes('exact') && cb.checked) {
        cb.click();
        return { unchecked: true };
      }
    }
    return { unchecked: false };
  });
  console.log('Uncheck exact phrase:', JSON.stringify(uncheckResult));
  await new Promise(r => setTimeout(r, 1000));

  // 5. Type 'Framing' and search
  console.log('\n=== SEARCHING FOR FRAMING ===');

  // Find the right search input
  const typed = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[type=text], input[type=search]');
    for (const inp of inputs) {
      const r = inp.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const ph = (inp.placeholder || '').toLowerCase();
        if (ph.includes('search') || ph.includes('keyword') || ph.includes('address')) {
          return { found: true, placeholder: inp.placeholder, id: inp.id };
        }
      }
    }
    // Fallback to first visible text input
    for (const inp of inputs) {
      const r = inp.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { found: true, placeholder: inp.placeholder, id: inp.id, fallback: true };
      }
    }
    return { found: false };
  });
  console.log('Search input:', JSON.stringify(typed));

  if (typed.found) {
    const selector = typed.id ? '#' + typed.id : 'input[placeholder="' + typed.placeholder + '"]';
    const input = await page.$(selector) || await page.$('input[type=text]');
    if (input) {
      await input.click({ clickCount: 3 });
      await input.press('Backspace');
      await input.type('Framing', { delay: 50 });
      console.log('Typed "Framing"');
    }
  }

  await page.screenshot({ path: 'screenshots/diag-before-search.png', fullPage: true });

  // Click search
  const clicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const text = btn.textContent.trim().toLowerCase();
      const r = btn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (text.includes('search') || btn.type === 'submit')) {
        btn.click();
        return { clicked: true, text: btn.textContent.trim() };
      }
    }
    return { clicked: false };
  });
  console.log('Clicked search:', JSON.stringify(clicked));

  // Wait for results
  console.log('Waiting for results...');
  await new Promise(r => setTimeout(r, 8000));

  await page.screenshot({ path: 'screenshots/diag-after-search.png', fullPage: true });

  // 6. Check API responses
  console.log('\n=== API RESPONSES (' + apiResponses.length + ' total) ===');
  for (const resp of apiResponses) {
    console.log('URL:', resp.url);
    console.log('Size:', resp.size);
    console.log('Preview:', resp.preview.substring(0, 400));
    console.log('---');
  }

  // 7. Parse page results
  const pageResults = await page.evaluate(() => {
    return {
      bodyTextSample: document.body.innerText.substring(0, 3000),
      tables: document.querySelectorAll('table').length,
      tableRows: document.querySelectorAll('table tr').length,
      ngRepeats: document.querySelectorAll('[ng-repeat]').length,
      currentUrl: window.location.href,
    };
  });

  console.log('\n=== PAGE AFTER SEARCH ===');
  console.log('URL:', pageResults.currentUrl);
  console.log('Tables:', pageResults.tables, 'Rows:', pageResults.tableRows, 'ng-repeats:', pageResults.ngRepeats);
  console.log('\nBody text:');
  console.log(pageResults.bodyTextSample);

  await browser.close();
  console.log('\nDone.');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
