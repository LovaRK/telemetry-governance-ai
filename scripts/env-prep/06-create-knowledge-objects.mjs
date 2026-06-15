/**
 * 06 — Create knowledge objects in the dedicated `datasense_demo` app
 *
 * Saved searches (scheduled + alerts with security-keyword names per the
 * inventory CSV counts), dashboards (SimpleXML), macros, eventtypes, tags.
 *
 * CRITICAL CONSTRAINT: every generated SPL contains a literal `index=<name>`
 * token. The KO-attribution regex in splunk-queries-service.ts (and Data
 * Sensei's equivalent) only credits literal index references — macro-only
 * SPL would be invisible to both scorers.
 *
 * Usage: node scripts/env-prep/06-create-knowledge-objects.mjs [--dry-run]
 */

import { SplunkRest, loadManifest, DRY_RUN, log } from './00-lib.mjs';

const sanitize = (s) => s.replace(/[^\w\s:-]/g, '').slice(0, 90).trim() || 'unnamed';

function alertSpl(index, st) {
  return `index=${index} sourcetype="${st}" (failed OR denied OR error OR unauthorized) | stats count by host | where count > 5`;
}
function scheduledSpl(index, st) {
  return `index=${index} sourcetype="${st}" | timechart span=1h count`;
}
function dashboardXml(title, index, sourcetypes) {
  const panels = sourcetypes.slice(0, 3).map(st => `
    <row>
      <panel>
        <title>${sanitize(st)} volume</title>
        <chart>
          <search><query>index=${index} sourcetype="${st}" | timechart span=1h count</query>
            <earliest>-24h</earliest><latest>now</latest></search>
        </chart>
      </panel>
    </row>`).join('');
  return `<dashboard><label>${sanitize(title)}</label>${panels}</dashboard>`;
}

async function main() {
  const manifest = loadManifest();
  const rest = new SplunkRest();
  const app = manifest.app;
  const ns = `/servicesNS/admin/${app}`;

  log(`Knowledge objects in app '${app}' ${DRY_RUN ? '(DRY RUN)' : ''}`);

  if (!DRY_RUN) {
    const { status } = await rest.post('/services/apps/local', {
      name: app, label: 'datasensAI Demo Environment', visible: 'true',
    }, [409]);
    log(`  app ${app}: ${status === 409 ? 'already exists' : 'created'}`);
  }

  let created = { alerts: 0, scheduled: 0, dashboards: 0, macros: 0, eventtypes: 0, tags: 0 };

  for (const idx of manifest.indexes) {
    const ko = idx.knowledgeObjects;
    const sts = idx.sourcetypes.map(s => s.sourcetype);
    if (sts.length === 0) continue;

    // ── Alerts (security-keyword names; cron-scheduled with alert actions) ──
    for (let i = 0; i < ko.alertCount; i++) {
      const st = sts[i % sts.length];
      const sample = ko.savedSearchSamples.find(s => s.isAlert);
      const name = sanitize(sample && i === 0 ? sample.name : `1stMile - Detect suspicious activity - ${idx.name} ${i + 1}`);
      if (DRY_RUN) { created.alerts++; continue; }
      await rest.post(`${ns}/saved/searches`, {
        name,
        search: alertSpl(idx.name, st),
        is_scheduled: '1',
        cron_schedule: `${i % 60} * * * *`,
        'alert_type': 'number of events',
        'alert_comparator': 'greater than',
        'alert_threshold': '0',
        'actions': 'email',
        // instance restricts alert recipients via alert_actions.conf allowedDomainList
        'action.email.to': 'soc-demo@bitsioinc.com',
        'dispatch.earliest_time': '-1h',
        'dispatch.latest_time': 'now',
      }, [409]);
      created.alerts++;
    }

    // ── Scheduled searches ──
    for (let i = 0; i < ko.scheduledSearchCount; i++) {
      const st = sts[i % sts.length];
      const name = sanitize(`1stMile - ${idx.name} hourly rollup ${i + 1}`);
      if (DRY_RUN) { created.scheduled++; continue; }
      await rest.post(`${ns}/saved/searches`, {
        name,
        search: scheduledSpl(idx.name, st),
        is_scheduled: '1',
        cron_schedule: `${(i * 7) % 60} * * * *`,
        'dispatch.earliest_time': '-1h',
        'dispatch.latest_time': 'now',
      }, [409]);
      created.scheduled++;
    }

    // ── Dashboards ──
    const dashNames = ko.dashboardSamples.length
      ? ko.dashboardSamples
      : (ko.dashboardCount > 0 ? [`${idx.name}_overview`] : []);
    for (let i = 0; i < Math.max(ko.dashboardCount, dashNames.length) && i < 10; i++) {
      const title = dashNames[i % dashNames.length] || `${idx.name}_dash_${i}`;
      const name = sanitize(title).replace(/[\s:]+/g, '_').toLowerCase() + (i >= dashNames.length ? `_${i}` : '');
      if (DRY_RUN) { created.dashboards++; continue; }
      await rest.post(`${ns}/data/ui/views`, {
        name,
        'eai:data': dashboardXml(title, idx.name, sts),
      }, [409]);
      created.dashboards++;
    }
  }

  // ── Macros (real definitions referencing tracked indexes) ──
  for (const m of manifest.macros) {
    if (DRY_RUN) { created.macros++; continue; }
    await rest.post(`${ns}/admin/macros`, {
      name: sanitize(m.title).replace(/\s+/g, '_'),
      definition: m.definition,
    }, [409, 400]);
    created.macros++;
  }

  // ── Eventtypes + tags (from datamodel mapping CSV) ──
  for (const et of manifest.eventtypes) {
    if (DRY_RUN) { created.eventtypes++; created.tags++; continue; }
    await rest.post(`${ns}/saved/eventtypes`, {
      name: et.name, search: et.search,
    }, [409]);
    created.eventtypes++;
    await rest.post(`${ns}/configs/conf-tags`, {
      name: `eventtype=${et.name}`, [et.tag]: 'enabled',
    }, [409, 400]).catch(() => {}); // tags endpoint varies by version — non-critical
    created.tags++;
  }

  log(`\n✓ Knowledge objects ${DRY_RUN ? 'planned' : 'created'}:`);
  log(`  alerts: ${created.alerts}, scheduled: ${created.scheduled}, dashboards: ${created.dashboards}`);
  log(`  macros: ${created.macros}, eventtypes: ${created.eventtypes}, tags: ${created.tags}`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
