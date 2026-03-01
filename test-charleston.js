// Quick test of Charleston scraper — strapping-only mode
const db = require('./db/init');
const charleston = require('./scraper/portals/charleston');
const utils = require('./scraper/utils');

(async () => {
  await db.getDb();
  utils.log('Testing Charleston strapping-only scraper...');

  try {
    const permits = await charleston.scrape({});
    utils.log(`\n=== RESULTS: ${permits.length} passed strapping inspections ===`);

    // Show first 10
    for (let i = 0; i < Math.min(10, permits.length); i++) {
      const p = permits[i];
      utils.log(`\n#${i+1}:`);
      utils.log(`  Permit: ${p.permit_number}`);
      utils.log(`  Address: ${p.address}`);
      utils.log(`  Type: ${p.inspection_type}`);
      utils.log(`  Status: ${p.inspection_status}`);
      utils.log(`  Date: ${p.inspection_date}`);
      utils.log(`  Builder: ${p.builder_name || '—'}`);
      utils.log(`  Company: ${p.builder_company || '—'}`);
      utils.log(`  Phone: ${p.builder_phone || '—'}`);
      utils.log(`  Email: ${p.builder_email || '—'}`);
      utils.log(`  Owner: ${p.owner_name || '—'}`);
      utils.log(`  Applicant: ${p.applicant_name || '—'}`);
      utils.log(`  Value: ${p.project_value ? '$' + Number(p.project_value).toLocaleString() : '—'}`);
      const raw = typeof p.raw_data === 'string' ? JSON.parse(p.raw_data) : p.raw_data;
      utils.log(`  Linked Permit: ${raw?._linkedPermit || raw?.LinkNumber || '—'}`);
    }

    // Save to DB
    let saved = 0;
    let errors = 0;
    for (const permit of permits) {
      try {
        await db.upsertPermit(permit);
        saved++;
      } catch (err) {
        errors++;
        if (errors <= 3) utils.log(`DB save error: ${err.message}`);
      }
    }
    utils.log(`\nSaved: ${saved}, Errors: ${errors}`);

    // Check DB count
    const result = await db.queryPermits({ per_page: 1 });
    utils.log(`DB total: ${result.pagination.total} permits`);

    // Count with contact data
    const withContact = permits.filter(p => p.builder_name || p.builder_company || p.builder_phone).length;
    utils.log(`With contact data: ${withContact}/${permits.length}`);

    // Count high value
    const highValue = permits.filter(p => p.project_value && p.project_value >= 300000).length;
    utils.log(`$300K+ projects: ${highValue}/${permits.length}`);

  } catch (err) {
    utils.log(`FATAL: ${err.message}`);
    console.error(err);
  }

  db.close();
  process.exit(0);
})();
