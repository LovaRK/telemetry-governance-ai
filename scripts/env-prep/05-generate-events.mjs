/**
 * 05 — Generate and ingest realistic events per index/sourcetype
 *
 * Volume model: manifest GB *proportions* scaled to TOTAL_DAILY_GB (default
 * 0.25 GB). Absolute GB will not match 1stMile production — that is fine and
 * documented: both datasensAI and Data Sensei read the same live instance, so
 * the tally is internally consistent; relative scores and ratio KPIs
 * (ROI, GainScope) are scale-independent.
 *
 * Quality issues are reproduced ORGANICALLY: sourcetypes listed in the quality
 * CSV get a proportion of malformed events (garbled timestamps → real
 * DateParserVerbose warnings; missing linebreaks → LineBreakingProcessor),
 * so _internal parsing errors arise the same way they do in production.
 *
 * Timestamps are spread across the last 24h.
 *
 * Usage: node scripts/env-prep/05-generate-events.mjs [--dry-run]
 * Env:   TOTAL_DAILY_GB (default 0.25), MAX_EVENTS_TOTAL (default 200000)
 */

import { SplunkRest, SplunkHec, loadManifest, DRY_RUN, log } from './00-lib.mjs';

const TOTAL_DAILY_GB = parseFloat(process.env.TOTAL_DAILY_GB || '0.25');
const MAX_EVENTS_TOTAL = parseInt(process.env.MAX_EVENTS_TOTAL || '200000', 10);
const BATCH_SIZE = 1000;

const USERS = ['jsmith', 'mchen', 'apatel', 'kwilson', 'dlee', 'svc_monitor'];
const HOSTS = ['app-prod-01', 'app-prod-02', 'web-dmz-01', 'db-core-01', 'fw-edge-01'];
const IPS = ['10.1.4.22', '10.1.4.87', '192.168.10.5', '172.16.8.41', '10.2.0.13'];
const URIS = ['/api/v1/orders', '/login', '/health', '/api/v1/users', '/static/app.js', '/checkout'];
const WIN_EVENTS = [[4624, 'An account was successfully logged on'], [4625, 'An account failed to log on'], [4688, 'A new process has been created'], [4672, 'Special privileges assigned to new logon']];

const pick = (arr, i) => arr[i % arr.length];
const ts = (date) => date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

/** Render one event line for a sourcetype family. `i` drives determinism. */
function renderEvent(sourcetype, date, i) {
  const st = sourcetype.toLowerCase();
  const user = pick(USERS, i), host = pick(HOSTS, i), ip = pick(IPS, i + 1), uri = pick(URIS, i);
  const status = [200, 200, 200, 304, 404, 500][i % 6];

  if (/fgt|fortigate|netfw|firewall/.test(st)) {
    const action = i % 7 === 0 ? 'deny' : 'accept';
    return `date=${date.toISOString().slice(0, 10)} time=${date.toISOString().slice(11, 19)} devname="fw-edge-01" devid="FGT60E0000000001" logid="0000000013" type="traffic" subtype="forward" srcip=${ip} srcport=${4000 + (i % 2000)} dstip=${pick(IPS, i + 2)} dstport=${[443, 80, 53, 22][i % 4]} action="${action}" policyid=${1 + (i % 40)} sentbyte=${500 + (i % 9000)} rcvdbyte=${300 + (i % 4000)}`;
  }
  if (/iis/.test(st)) {
    return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} 10.0.1.10 GET ${uri} - 443 ${user} ${ip} Mozilla/5.0 ${status} 0 0 ${10 + (i % 400)}`;
  }
  if (/wineventlog|oswin|msad/.test(st)) {
    const [code, msg] = pick(WIN_EVENTS, i);
    return `${ts(date)} LogName=Security EventCode=${code} EventType=0 ComputerName=${host}.corp.local SourceName=Microsoft Windows security auditing. TaskCategory=Logon Message=${msg} Subject: Account Name: ${user} Account Domain: CORP Logon ID: 0x${(0x3e7 + i).toString(16)}`;
  }
  if (/wazuh/.test(st)) {
    return JSON.stringify({ timestamp: date.toISOString(), rule: { level: 3 + (i % 10), description: pick(['Login session opened', 'PAM: User login failed', 'Integrity checksum changed', 'New dpkg (Debian Package) installed'], i), id: String(5000 + (i % 700)) }, agent: { name: host, id: String(1 + (i % 12)).padStart(3, '0') }, location: '/var/log/auth.log' });
  }
  if (/apache|tomcat|access|nginx/.test(st)) {
    return `${ip} - ${user} [${date.toISOString().slice(0, 10)}T${date.toISOString().slice(11, 19)}Z] "GET ${uri} HTTP/1.1" ${status} ${200 + (i % 12000)} "-" "Mozilla/5.0"`;
  }
  if (/syslog|osnix|linux|secure/.test(st)) {
    return `${date.toString().slice(4, 19)} ${host} ${pick(['sshd', 'sudo', 'systemd', 'cron'], i)}[${1000 + (i % 8000)}]: ${pick([`Accepted publickey for ${user} from ${ip} port 52144 ssh2`, `pam_unix(sudo:session): session opened for user root by ${user}(uid=1000)`, `Started Session ${i % 900} of user ${user}.`, `(root) CMD (/usr/lib64/sa/sa1 1 1)`], i)}`;
  }
  if (/1stmile|webservice|engine|appgate|tango/.test(st)) {
    return `${ts(date)} [${pick(['INFO', 'INFO', 'INFO', 'WARN', 'ERROR'], i)}] [pool-2-thread-${1 + (i % 8)}] com.firstmile.ws.Handler - request=${uri} user=${user} latency_ms=${5 + (i % 900)} status=${status}`;
  }
  // generic kv line
  return `${ts(date)} host=${host} user=${user} src=${ip} action=${pick(['read', 'write', 'update', 'login'], i)} object=${uri} result=${status < 400 ? 'success' : 'failure'} bytes=${100 + (i % 5000)}`;
}

/** Malformed variants that organically trigger _internal parsing warnings. */
function renderMalformed(sourcetype, date, i, kind) {
  if (kind === 'dateparser') {
    // Garbled / ambiguous timestamp → DateParserVerbose warnings
    return `${pick(['13/32/2025 25:71:99', '0000-00-00 99:99:99', 'Febtober 32 2025', '31-02-2025T26:61'], i)} ${renderEvent(sourcetype, date, i).replace(/^[^ ]+ [^ ]+ /, '')}`;
  }
  // Linebreak issues: one enormous unbroken line → LineBreakingProcessor warnings
  return renderEvent(sourcetype, date, i) + ' ' + 'payload_fragment '.repeat(800);
}

async function main() {
  const manifest = loadManifest();
  const scale = TOTAL_DAILY_GB; // proportions × this
  const totalBytesBudget = TOTAL_DAILY_GB * 1024 ** 3;

  // Plan: per index::sourcetype byte budgets
  const plan = [];
  for (const idx of manifest.indexes) {
    const idxBytes = totalBytesBudget * idx.gbProportion;
    for (const st of idx.sourcetypes) {
      plan.push({
        index: idx.name,
        sourcetype: st.sourcetype,
        source: st.source,
        bytesBudget: idxBytes * st.gbProportion,
        quality: st.quality,
      });
    }
  }

  // Estimate counts and clamp to MAX_EVENTS_TOTAL
  const AVG = 280; // bytes/event rough average across templates
  let estTotal = plan.reduce((n, p) => n + Math.ceil(p.bytesBudget / AVG), 0);
  const clamp = estTotal > MAX_EVENTS_TOTAL ? MAX_EVENTS_TOTAL / estTotal : 1;

  log(`Event generation plan ${DRY_RUN ? '(DRY RUN)' : ''}`);
  log(`  target volume:  ${TOTAL_DAILY_GB} GB across ${plan.length} index::sourcetype pairs`);
  log(`  est. events:    ${Math.round(estTotal * clamp)} (clamp ×${clamp.toFixed(3)})`);
  log(`  transport:      ${manifest.ingest?.transport || 'rest (04-hec-setup not run)'}`);

  if (DRY_RUN) {
    for (const p of plan.slice(0, 10)) {
      log(`  ${p.index}/${p.sourcetype}: ~${Math.round((p.bytesBudget * clamp) / 1024)} KB${p.quality ? ' (+quality issues)' : ''}`);
    }
    if (plan.length > 10) log(`  … and ${plan.length - 10} more`);
    return;
  }

  const rest = new SplunkRest();
  const hec = manifest.ingest?.transport === 'hec' && manifest.ingest.hecToken
    ? new SplunkHec(manifest.ingest.hecUrl, manifest.ingest.hecToken)
    : null;

  const now = Date.now();
  const DAY = 86400_000;
  let sentTotal = 0;

  for (const p of plan) {
    const budget = p.bytesBudget * clamp;
    if (budget < AVG) continue;

    // How many malformed events to weave in (organic quality issues)
    const qualityTotal = p.quality ? Math.min(p.quality.dateParserHits + p.quality.otherHits, Math.floor(budget / AVG / 10)) : 0;
    const dateParserShare = p.quality && qualityTotal > 0
      ? p.quality.dateParserHits / (p.quality.dateParserHits + p.quality.otherHits)
      : 0;

    let bytes = 0, i = 0, batch = [];
    const flush = async () => {
      if (batch.length === 0) return;
      if (hec) {
        await hec.send(batch.map(b => ({ event: b.line, time: b.epoch, index: p.index, sourcetype: p.sourcetype, source: p.source, host: 'datasense-demo' })));
      } else {
        await rest.receiveSimple(p.index, p.sourcetype, p.source, batch.map(b => b.line).join('\n'));
      }
      sentTotal += batch.length;
      batch = [];
    };

    while (bytes < budget) {
      const when = new Date(now - Math.floor((i * 9973) % DAY)); // deterministic 24h spread
      let line;
      if (qualityTotal > 0 && i % Math.max(2, Math.floor(budget / AVG / qualityTotal)) === 1 && i / 2 < qualityTotal) {
        line = renderMalformed(p.sourcetype, when, i, (i % 100) / 100 < dateParserShare ? 'dateparser' : 'linebreak');
      } else {
        line = renderEvent(p.sourcetype, when, i);
      }
      batch.push({ line, epoch: Math.floor(when.getTime() / 1000) });
      bytes += Buffer.byteLength(line) + 1;
      i++;
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();
    log(`  ${p.index}/${p.sourcetype}: ${i} events (${(bytes / 1024).toFixed(0)} KB)${qualityTotal ? ` incl. ~${qualityTotal} malformed` : ''}`);
  }

  log(`\n✓ Ingested ~${sentTotal} events. Allow 1–2 minutes for indexing, then run 08-validate.mjs.`);
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
