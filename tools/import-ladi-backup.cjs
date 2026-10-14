"use strict";

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const readline = require('node:readline/promises');
let pool;
let persistWebhook;
let sourceBySlug;
let crmData;

const REQUIRED = ['created_at', 'name', 'email', 'phone', 'landing_page', 'source', 'medium', 'campaign_id', 'adset_id', 'ad_id', 'ip', 'form_id', 'ref'];
const BATCH = 'LADI_BACKUP_IMPORT_V1';
const EMBEDDED_TSV_GZIP_B64 = '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';

function parseTsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('TSV file has no data rows.');
  const headers = lines.shift().split('\t').map(value => value.trim());
  for (const field of REQUIRED) if (!headers.includes(field)) throw new Error(`Missing required column: ${field}`);
  return lines.map((line, index) => {
    const values = line.split('\t');
    const row = Object.fromEntries(headers.map((header, i) => [header, String(values[i] || '').trim()]));
    row.line = index + 2;
    row.phone = row.phone.replace(/\D/g, '');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.created_at)) throw new Error(`Line ${row.line}: invalid timestamp.`);
    if (!row.name || row.name.length > 160) throw new Error(`Line ${row.line}: invalid name.`);
    if (row.phone.length < 9 || row.phone.length > 13) throw new Error(`Line ${row.line}: invalid phone.`);
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) throw new Error(`Line ${row.line}: invalid email.`);
    try { if (!['http:', 'https:'].includes(new URL(row.landing_page).protocol)) throw new Error(); }
    catch { throw new Error(`Line ${row.line}: invalid landing-page URL.`); }
    return row;
  });
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length >= 11) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1);
  return digits;
}

function eventKey(slug, row) {
  return crypto.createHash('sha256').update([BATCH, slug, normalizePhone(row.phone), row.email.toLowerCase(), row.created_at, row.campaign_id, row.ad_id].join('|')).digest('hex');
}

function metadataFor(row, website, eventId, slug) {
  const url = new URL(row.landing_page);
  const canonicalUrl = website?.sourceUrl || `${url.origin}/`;
  const utm = Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'fbclid'].filter(key => url.searchParams.has(key)).map(key => [key, url.searchParams.get(key)]));
  return {
    ladiBackfill: BATCH,
    webhookEventId: eventId,
    webhookSlug: slug,
    landingPageName: website?.name || url.hostname,
    landingPageUrl: canonicalUrl,
    landingPageDomain: url.hostname,
    sourceUrl: canonicalUrl,
    landingPageOriginalUrl: row.landing_page,
    ipAddress: row.ip,
    ladiSource: row.source,
    medium: row.medium,
    campaignId: row.campaign_id,
    adsetId: row.adset_id,
    adId: row.ad_id,
    formId: row.form_id,
    ref: row.ref,
    ...utm
  };
}

async function saveSourceDetails(customerId, eventId, row, website, slug) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SELECT id FROM crm_write_lock WHERE id=1 FOR UPDATE');
    const [rows] = await connection.execute('SELECT id,name,phone,email,source,campaign,website_id,status,sale_id,leader_id,team_id,note,custom_fields_json,created_at,updated_at FROM customers WHERE id=? FOR UPDATE', [customerId]);
    const customer = rows[0];
    if (!customer || customer.id !== `CUS-${eventId}`) throw new Error(`Refusing metadata update for unrelated customer ${customerId}.`);
    const stored = typeof customer.custom_fields_json === 'string' ? JSON.parse(customer.custom_fields_json || '{}') : (customer.custom_fields_json || {});
    const meta = { ...(stored.__crmMeta || {}), ...metadataFor(row, website, eventId, slug) };
    const custom = { ...stored, __crmMeta: meta, __crmFields: stored.__crmFields || {} };
    const source = row.source || 'Landing Page';
    const campaign = row.campaign_id || row.source || 'UNATTRIBUTED';
    const websiteId = website?.id || customer.website_id || null;
    await connection.execute('UPDATE customers SET source=?,campaign=?,website_id=?,custom_fields_json=? WHERE id=?', [source, campaign, websiteId, JSON.stringify(custom), customerId]);
    const after = { ...customer, source, campaign, website_id: websiteId, custom_fields_json: custom };
    await connection.execute('INSERT IGNORE INTO crm_changes(request_id,actor_id,changes_json) VALUES (?,?,?)', [`ladi-backfill-${eventId}`, 'LADI_IMPORT', JSON.stringify([{ key: 'customers', id: customerId, before: null, after }])]);
    await connection.commit();
    return customer.created_at;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

async function shortenExistingSourceUrl(customerId, row, website, slug) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SELECT id FROM crm_write_lock WHERE id=1 FOR UPDATE');
    const [rows] = await connection.execute('SELECT id,name,phone,email,source,campaign,website_id,status,sale_id,leader_id,team_id,note,custom_fields_json,created_at,updated_at FROM customers WHERE id=? FOR UPDATE', [customerId]);
    const customer = rows[0];
    if (!customer || normalizePhone(customer.phone) !== normalizePhone(row.phone) || (row.email && String(customer.email || '').trim().toLowerCase() !== row.email.toLowerCase())) {
      throw new Error(`Refusing source update for non-matching CRM customer ${customerId}.`);
    }
    const stored = typeof customer.custom_fields_json === 'string' ? JSON.parse(customer.custom_fields_json || '{}') : (customer.custom_fields_json || {});
    const url = new URL(row.landing_page);
    const canonicalUrl = website?.sourceUrl || `${url.origin}/`;
    const oldMeta = stored.__crmMeta || {};
    const meta = {
      ...oldMeta,
      landingPageName: oldMeta.landingPageName || website?.name || url.hostname,
      landingPageUrl: canonicalUrl,
      landingPageDomain: url.hostname,
      sourceUrl: canonicalUrl,
      landingPageOriginalUrl: oldMeta.landingPageOriginalUrl || oldMeta.landingPageUrl || row.landing_page
    };
    if (oldMeta.landingPageUrl === canonicalUrl && oldMeta.sourceUrl === canonicalUrl) {
      await connection.commit();
      return false;
    }
    const custom = { ...stored, __crmMeta: meta, __crmFields: stored.__crmFields || {} };
    await connection.execute('UPDATE customers SET custom_fields_json=? WHERE id=?', [JSON.stringify(custom), customerId]);
    const before = { ...customer, custom_fields_json: stored };
    const after = { ...customer, custom_fields_json: custom };
    const requestId = `ladi-source-url-${eventKey(slug, row).slice(0, 40)}`;
    await connection.execute('INSERT IGNORE INTO crm_changes(request_id,actor_id,changes_json) VALUES (?,?,?)', [requestId, 'LADI_IMPORT', JSON.stringify([{ key: 'customers', id: customerId, before, after }])]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

function getArgs(argv) {
  const slugAt = argv.indexOf('--slug');
  const slug = slugAt >= 0 ? argv[slugAt + 1] : '';
  const embedded = argv.includes('--embedded');
  const valueIndexes = new Set(slugAt >= 0 ? [slugAt + 1] : []);
  const file = argv.find((value, index) => !value.startsWith('--') && !valueIndexes.has(index));
  const validateOnly = argv.includes('--validate-only');
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  if (!file && !embedded) throw new Error('Pass a TSV file or use --embedded.');
  if (!validateOnly && (!slug || !/^ds-\d{13}-[A-Z0-9]{11}$/.test(slug))) throw new Error('Pass a valid --slug ds-...');
  if (argv.includes('--apply') && argv.includes('--dry-run')) throw new Error('Choose only one of --apply or --dry-run.');
  return { file, embedded, slug: slug.toUpperCase(), apply: argv.includes('--apply'), validateOnly };
}

async function main() {
  let options;
  try { options = getArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; return; }
  if (options.help) {
    console.log('Usage: node tools/import-ladi-backup.cjs --embedded --slug <webhook-slug> [--apply]');
    console.log('Or pass a TSV file instead of --embedded.');
    console.log('Use --validate-only to check the file without connecting to MySQL.');
    console.log('Default is a live-CRM dry-run. --apply writes records and preserves created_at.');
    return;
  }
  const file = options.embedded ? '' : path.resolve(options.file);
  const input = options.embedded
    ? zlib.gunzipSync(Buffer.from(EMBEDDED_TSV_GZIP_B64, 'base64')).toString('utf8')
    : await fs.readFile(file, 'utf8');
  const rows = parseTsv(input);
  const unique = [];
  const seenPhones = new Set();
  const seenEmails = new Set();
  let repeatedInFile = 0;
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    const email = row.email.toLowerCase();
    if (seenPhones.has(phone) || (email && seenEmails.has(email))) { repeatedInFile++; continue; }
    seenPhones.add(phone);
    if (email) seenEmails.add(email);
    unique.push(row);
  }
  if (options.validateOnly) {
    console.log(`File: ${options.embedded ? 'embedded backup' : path.basename(file)} | valid rows: ${rows.length} | in-file duplicates: ${repeatedInFile}`);
    console.log(`Timestamp range: ${rows[0].created_at} to ${rows.at(-1).created_at}`);
    return;
  }
  ({ pool } = require('../db.js'));
  ({ persistWebhook, sourceBySlug } = require('../webhook-store.cjs'));
  crmData = require('../crm-data.cjs');
  if (typeof crmData.distributeAutomaticForCustomers !== 'function') {
    throw new Error('CRM server code is outdated. Update crm-data.cjs before importing so only this batch is assigned.');
  }
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) throw new Error('Missing DB_HOST/DB_USER/DB_NAME in .env.');
  const connection = await pool.getConnection();
  let website;
  let existing;
  try {
    website = await sourceBySlug(connection, options.slug);
    if (!website) throw new Error(`Webhook source ${options.slug} is not configured in this CRM.`);
    const [customers] = await connection.query('SELECT id,phone,email FROM customers');
    existing = customers;
  } finally { connection.release(); }
  const customerFor = row => {
    const phone = normalizePhone(row.phone);
    const email = row.email.toLowerCase();
    const phoneMatches = existing.filter(customer => phone && normalizePhone(customer.phone) === phone);
    const emailMatches = existing.filter(customer => email && String(customer.email || '').trim().toLowerCase() === email);
    const matches = phoneMatches.length && emailMatches.length
      ? phoneMatches.filter(customer => emailMatches.some(match => match.id === customer.id))
      : phoneMatches.length ? phoneMatches : emailMatches;
    if (matches.length > 1) throw new Error(`Ambiguous CRM match for ${row.name} (${row.phone}); no records were changed.`);
    if (phoneMatches.length && emailMatches.length && !matches.length) throw new Error(`Phone/email point to different CRM customers for ${row.name} (${row.phone}); no records were changed.`);
    return matches[0] || null;
  };
  const plan = unique.map(row => {
    const customer = customerFor(row);
    return { row, customer, duplicate: Boolean(customer) };
  });
  const skipped = plan.filter(item => item.duplicate).length;
  const ready = plan.filter(item => !item.duplicate);
  const targetedCustomerIds = [...new Set(plan.filter(item => item.customer).map(item => String(item.customer.id)))];
  console.log(`File: ${path.basename(file)} | valid rows: ${rows.length} | in-file duplicates: ${repeatedInFile}`);
  console.log(`CRM source: ${website.name || website.domain || website.id} (${options.slug})`);
  console.log(`Already in CRM: ${skipped} | would import: ${ready.length} | matched for targeted auto-assignment: ${targetedCustomerIds.length}`);
  if (!options.apply) {
    console.log('Dry-run only; nothing was written. Add --apply to import.');
    await pool.end();
    return;
  }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  const confirmation = await terminal.question('Type NHAP to confirm the import: ');
  terminal.close();
  if (confirmation.trim().toUpperCase() !== 'NHAP') {
    console.log('Cancelled; no records were imported.');
    await pool.end();
    return;
  }
  let imported = 0;
  let racedDuplicates = 0;
  let shortenedSources = 0;
  const customerIdsToAssign = [...targetedCustomerIds];
  for (const { row, customer } of plan) {
    if (!customer) continue;
    if (await shortenExistingSourceUrl(customer.id, row, website, options.slug)) shortenedSources++;
  }
  for (const { row } of ready) {
    const key = eventKey(options.slug, row);
    const eventId = `WHE-LADI-${key.slice(0, 32)}`;
    const payload = {
      name: row.name, phone: row.phone, email: row.email, ip: row.ip,
      landing_page: row.landing_page, source: row.source, medium: row.medium,
      campaign_id: row.campaign_id, adset_id: row.adset_id, ad_id: row.ad_id,
      form_id: row.form_id, ref: row.ref, __ladiImportBatch: BATCH
    };
    const record = {
      id: eventId, slug: options.slug, receivedAt: row.created_at, contentType: 'application/x-www-form-urlencoded',
      status: 'NEW', problems: [], matchedKeys: {},
      customer: { name: row.name, phone: row.phone, email: row.email, ipAddress: row.ip },
      raw: payload, dedupeKey: key, retryCount: 0, consumedAt: ''
    };
    const result = await persistWebhook(record, { skipAutomatic: true });
    if (result.duplicate || result.replay) {
      racedDuplicates++;
      if (result.customerId) customerIdsToAssign.push(String(result.customerId));
      continue;
    }
    const customerId = result.customerId || `CUS-${eventId}`;
    await saveSourceDetails(customerId, eventId, row, website, options.slug);
    customerIdsToAssign.push(String(customerId));
    imported++;
    console.log(`Imported ${row.created_at} | ${row.name} | ${row.phone}`);
  }
  let autoDistributed = 0;
  const uniqueCustomerIdsToAssign = [...new Set(customerIdsToAssign)];
  if (uniqueCustomerIdsToAssign.length) {
    const assignmentConnection = await pool.getConnection();
    try {
      await assignmentConnection.beginTransaction();
      await assignmentConnection.query('SELECT id FROM crm_write_lock WHERE id=1 FOR UPDATE');
      autoDistributed = await crmData.distributeAutomaticForCustomers(assignmentConnection, uniqueCustomerIdsToAssign);
      await assignmentConnection.commit();
    } catch (error) {
      await assignmentConnection.rollback().catch(() => {});
      throw error;
    } finally { assignmentConnection.release(); }
  }
  if (imported) {
    const importId = `IMP-LADI-${crypto.createHash('sha256').update(input).digest('hex').slice(0, 24)}`;
    const importRecord = { id: importId, source: 'LadiPage backup', filename: options.embedded ? 'backup-ladi-crm.tsv (embedded)' : path.basename(file), records: imported, skipped: skipped + racedDuplicates, importedAt: new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 19), actor: 'LADI_IMPORT', status: 'SUCCESS' };
    await pool.execute('INSERT INTO crm_documents(collection,id,body,deleted) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE body=VALUES(body),deleted=0', ['imports', importId, JSON.stringify(importRecord)]);
  }
  if (imported || autoDistributed || shortenedSources) crmData.invalidateSnapshotCache();
  console.log(`Done: imported ${imported}; skipped CRM duplicates ${skipped}; concurrent duplicates ${racedDuplicates}.`);
  console.log(`Shortened landing-page source URLs for ${shortenedSources} matched existing customers; full original URLs were retained.`);
  console.log(`Automatic assignment engine processed ${autoDistributed} matched backup customers; customers outside this backup were not included.`);
  if (!autoDistributed && targetedCustomerIds.length) console.log('CRM automatic distribution is not enabled/configured for these records; eligible customers remain in the unassigned queue.');
  console.log('Original created_at values and the CRM automatic distribution settings were preserved.');
  await pool.end();
}

main().catch(async error => {
  console.error('Ladi backup import failed:', error.code || error.message || error);
  try { await pool.end(); } catch {}
  process.exitCode = 1;
});
