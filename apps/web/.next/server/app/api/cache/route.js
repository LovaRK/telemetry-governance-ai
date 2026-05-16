"use strict";(()=>{var e={};e.id=783,e.ids=[783],e.modules={517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},9771:(e,t,a)=>{a.r(t),a.d(t,{headerHooks:()=>X,originalPathname:()=>V,patchFetch:()=>z,requestAsyncStorage:()=>q,routeModule:()=>M,serverHooks:()=>G,staticGenerationAsyncStorage:()=>H,staticGenerationBailout:()=>W});var n={};a.r(n),a.d(n,{GET:()=>U,POST:()=>P});var i=a(2390),r=a(1498),o=a(9308),s=a(7024),c=a(3106);async function l(e){let t=await (0,c.IO)("SELECT * FROM cache_metadata WHERE cache_key = $1",[e]);if(0===t.rows.length)return{cacheKey:e,status:"stale",lastRefreshAt:null,nextRefreshAt:null,recordCount:0,sourceType:"splunk",isStale:!0};let a=t.rows[0],n=a.last_refresh_at?new Date(a.last_refresh_at):null,i=!n||Date.now()-n.getTime()>216e5;return{cacheKey:a.cache_key,status:a.status,lastRefreshAt:n,nextRefreshAt:a.next_refresh_at?new Date(a.next_refresh_at):null,recordCount:a.record_count,sourceType:a.source_type,isStale:i||"stale"===a.status}}async function u(e){let t=(await (0,c.IO)("SELECT status, updated_at FROM cache_metadata WHERE cache_key = $1",[e])).rows[0];if(!t||"refreshing"!==t.status)return!1;let a=t.updated_at?new Date(t.updated_at):null;return!(!a||Date.now()-a.getTime()>6e5)||(await (0,c.IO)("UPDATE cache_metadata SET status = 'stale', updated_at = NOW() WHERE cache_key = $1",[e]),!1)}async function d(e){await (0,c.IO)(`
    INSERT INTO cache_metadata (cache_key, status, updated_at)
    VALUES ($1, 'refreshing', NOW())
    ON CONFLICT (cache_key)
    DO UPDATE SET status = 'refreshing', updated_at = NOW()
    `,[e])}async function p(e,t){await (0,c.IO)(`
    INSERT INTO cache_metadata (cache_key, status, error_message, updated_at)
    VALUES ($1, 'error', $2, NOW())
    ON CONFLICT (cache_key)
    DO UPDATE SET status = 'error', error_message = $2, updated_at = NOW()
    `,[e,t])}async function h(){return(await (0,c.IO)("SELECT * FROM cache_metadata ORDER BY updated_at DESC")).rows.map(e=>{let t=e.last_refresh_at?new Date(e.last_refresh_at):null;return{cacheKey:e.cache_key,status:e.status,lastRefreshAt:t,nextRefreshAt:e.next_refresh_at?new Date(e.next_refresh_at):null,recordCount:e.record_count,sourceType:e.source_type,isStale:!t||Date.now()-t.getTime()>216e5}})}let g=process.env.OLLAMA_BASE_URL||"http://localhost:11434";class y{constructor(e=g){this.baseUrl=e}async generate(e,t){let a={model:"gemma:2b",prompt:e,stream:!1,...t?.json?{format:"json"}:{},options:{temperature:t?.temperature??.1,top_p:.9,num_predict:t?.maxTokens??4096,num_ctx:8192}},n=new AbortController,i=setTimeout(()=>n.abort(),18e4);try{let e=await fetch(`${this.baseUrl}/api/generate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(a),signal:n.signal});if(!e.ok){let t=await e.text().catch(()=>"");throw Error(`Ollama HTTP ${e.status}: ${t.slice(0,200)}`)}let t=await e.json();return t.response?.trim()||""}finally{clearTimeout(i)}}async isHealthy(){try{return(await fetch(`${this.baseUrl}/api/tags`,{signal:AbortSignal.timeout(5e3)})).ok}catch{return!1}}}let m=process.env.ANTHROPIC_API_KEY;class E{constructor(e=m||""){if(!e)throw Error("ANTHROPIC_API_KEY environment variable is required for fallback");this.apiKey=e}async generate(e,t){let a=t?.maxTokens??4096,n=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":this.apiKey,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:"claude-3-5-sonnet-20241022",max_tokens:a,messages:[{role:"user",content:e}],temperature:t?.temperature??.1})});if(!n.ok){let e=await n.text();throw Error(`Anthropic API ${n.status}: ${e.slice(0,200)}`)}let i=await n.json();return(i.content?.[0]?.text||"").trim()}async isHealthy(){try{if(!this.apiKey)return!1;return(await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":this.apiKey,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:"claude-3-5-sonnet-20241022",max_tokens:10,messages:[{role:"user",content:"ping"}]}),signal:AbortSignal.timeout(5e3)})).ok}catch{return!1}}}class _{constructor(){this.ollama=new y;try{this.anthropic=new E}catch{this.anthropic=null}}async generate(e,t){if(await this.ollama.isHealthy())try{return{response:await this.ollama.generate(e,t),provider:"ollama"}}catch(e){console.warn(`[LLMRouter] Ollama generation failed, attempting Anthropic fallback: ${e instanceof Error?e.message:String(e)}`)}else console.warn("[LLMRouter] Ollama is not healthy, attempting Anthropic fallback");if(!this.anthropic)throw Error("No LLM available: Ollama is down and ANTHROPIC_API_KEY is not configured. Dashboard unavailable.");try{return{response:await this.anthropic.generate(e,t),provider:"anthropic"}}catch(e){throw Error(`All LLM providers failed: ${e instanceof Error?e.message:String(e)}`)}}async isHealthy(){return!!await this.ollama.isHealthy()||!!this.anthropic&&await this.anthropic.isHealthy()}}let f=`You are a Splunk FinOps and Security intelligence agent.
You analyze telemetry data from Splunk indexes and sourcetypes to make cost optimization and security decisions.

Your decisions are final and will be displayed on an executive dashboard. Be analytical, specific, and commercially aware.

For each index/sourcetype you must evaluate:
1. BUSINESS VALUE: Is this data being searched/used? When was it last accessed? What is its event volume?
2. COST: How much does it cost annually? Is that cost justified by usage?
3. SECURITY COVERAGE: Does this sourcetype contribute to threat detection?
4. RETENTION: Is the retention policy appropriate for the data type and usage?
5. OPTIMIZATION OPPORTUNITY: Can cost be reduced without losing value?

Tier definitions:
- Critical: Active, high-value, frequently searched, security/compliance critical
- Important: Regularly used, moderate value, supports operational processes
- Nice-to-Have: Occasionally useful, low-to-moderate cost, can be trimmed
- Low-Value: Rarely or never searched, high cost relative to value, prime for elimination

Action definitions:
- KEEP: Data is valuable, retention and ingestion rate are appropriate
- OPTIMIZE: Reduce retention or field indexing to cut cost while keeping data
- ARCHIVE: Move to cold/cheap storage (S3), reduce hot retention to 7-14 days
- ELIMINATE: Stop ingesting, high cost zero value
- S3_CANDIDATE: Route to Federated Search / S3, keep queryable but remove from hot tier`,S=new Set(["Critical","Important","Nice-to-Have","Low-Value"]),v=new Set(["KEEP","OPTIMIZE","ARCHIVE","ELIMINATE","S3_CANDIDATE"]);async function w(e,t=.5){if(0===e.length)throw Error("No telemetry inputs provided to LLM decision agent");let a=new _;if(!await a.isHealthy())throw Error("No LLM available: Ollama is not running AND ANTHROPIC_API_KEY is not configured. Dashboard unavailable. Start Ollama or set ANTHROPIC_API_KEY.");console.log(`[LLMDecisionAgent] Starting reasoning for ${e.length} inputs in batches of 5 (parallel)`);let n=[];for(let t=0;t<e.length;t+=5)n.push(e.slice(t,t+5));let i=async(e,n)=>{let i=function(e,t){let a=JSON.stringify(e.map(e=>({index:e.index,sourcetype:e.sourcetype||null,daily_gb:e.dailyAvgGb,total_events:e.totalEvents,retention_days:e.retentionDays,first_event:e.firstEvent,last_event:e.lastEvent,annual_cost_usd:Math.round(365*e.dailyAvgGb*t*100)/100})),null,2);return`${f}

COST MODEL: $${t}/GB/day license cost

SPLUNK TELEMETRY DATA:
${a}

Analyze every index above and return ONLY a valid JSON object in this exact schema:

{
  "decisions": [
    {
      "index": "string",
      "sourcetype": "string or null",
      "tier": "Critical|Important|Nice-to-Have|Low-Value",
      "action": "KEEP|OPTIMIZE|ARCHIVE|ELIMINATE|S3_CANDIDATE",
      "compositeScore": 0-100,
      "utilizationScore": 0-100,
      "detectionScore": 0-100,
      "qualityScore": 0-100,
      "riskScore": 0-100,
      "annualLicenseCost": number,
      "estimatedSavings": number,
      "confidence": "HIGH|MEDIUM|LOW",
      "confidenceScore": 0.0-1.0,
      "recommendation": "one clear action sentence",
      "reasoning": "2-3 sentences explaining why this decision was made",
      "evidence": ["signal 1", "signal 2"],
      "isQuickWin": true|false,
      "isS3Candidate": true|false,
      "detectionGap": true|false
    }
  ],
  "roiScore": 0-100,
  "gainScopeScore": 0-100,
  "totalLicenseSpend": number,
  "licenseSpendLowValue": number,
  "storageSavingsPotential": number,
  "avgUtilization": 0-100,
  "avgDetection": 0-100,
  "avgQuality": 0-100,
  "securityGaps": number,
  "operationalGaps": number,
  "quickWins": [
    {
      "index": "string",
      "action": "string",
      "impact": "e.g. Save $12,000/year",
      "details": "specific optimization step"
    }
  ],
  "savingsStaircase": [
    { "stage": "Current Spend", "amount": number },
    { "stage": "After Ingest Actions", "amount": number },
    { "stage": "After Retention Tuning", "amount": number },
    { "stage": "After Archive", "amount": number },
    { "stage": "After S3 Migration", "amount": number },
    { "stage": "Optimized Target", "amount": number }
  ],
  "agentReasoning": "executive summary of the overall telemetry estate, key findings, and top recommendations in 3-4 sentences"
}

Return ONLY the JSON. No explanation text before or after.`}(e,t),r="";for(let o=1;o<=2;o++){let s,c,l;try{let{response:e,provider:t}=await a.generate(i,{json:!0,temperature:.1});s=e,c=t}catch(e){throw Error(`LLM call failed (batch ${n+1}, attempt ${o}): ${e instanceof Error?e.message:String(e)}`)}try{l=JSON.parse(function(e){let t=e.match(/\{[\s\S]*\}/);if(!t)throw Error("No JSON object found in LLM response");return t[0]}(s))}catch{r=`Invalid JSON (attempt ${o}). Raw: ${s.slice(0,200)}`;continue}if(!Array.isArray(l.decisions)){r=`Missing "decisions" array (attempt ${o})`;continue}let u=[];for(let e of l.decisions){let t="string"!=typeof e.index||""===e.index.trim()?"missing index":S.has(e.tier)?v.has(e.action)?"number"!=typeof e.compositeScore||e.compositeScore<0||e.compositeScore>100?"invalid compositeScore":"number"!=typeof e.utilizationScore?"missing utilizationScore":"number"!=typeof e.detectionScore?"missing detectionScore":"number"!=typeof e.qualityScore?"missing qualityScore":null:`invalid action: ${e.action}`:`invalid tier: ${e.tier}`;t?console.warn(`[LLMDecisionAgent] Batch ${n+1} skipping invalid decision (${t}):`,JSON.stringify(e).slice(0,120)):u.push(e)}if(0===u.length&&o<2){r=`All decisions failed validation (attempt ${o})`;continue}return console.log(`[LLMDecisionAgent] Batch ${n+1} OK via ${c} — ${u.length}/${l.decisions.length} decisions valid`),{decisions:function(e,t,a){return e.map((e,n)=>{let i=t.find(t=>t.index===e.index)||t[n],r=i?Math.round(365*i.dailyAvgGb*a*100)/100:0;return{index:e.index||(i?.index??`unknown_${n}`),sourcetype:e.sourcetype||i?.sourcetype,tier:e.tier||"Nice-to-Have",action:e.action||"KEEP",compositeScore:"number"==typeof e.compositeScore?e.compositeScore:50,utilizationScore:"number"==typeof e.utilizationScore?e.utilizationScore:0,detectionScore:"number"==typeof e.detectionScore?e.detectionScore:0,qualityScore:"number"==typeof e.qualityScore?e.qualityScore:50,riskScore:"number"==typeof e.riskScore?e.riskScore:50,annualLicenseCost:"number"==typeof e.annualLicenseCost?e.annualLicenseCost:r,estimatedSavings:"number"==typeof e.estimatedSavings?e.estimatedSavings:0,confidence:e.confidence||"LOW",confidenceScore:"number"==typeof e.confidenceScore?e.confidenceScore:.3,recommendation:e.recommendation||`Review ${e.index} based on current usage patterns`,reasoning:e.reasoning||"Insufficient data for detailed analysis",evidence:Array.isArray(e.evidence)?e.evidence:[],isQuickWin:!!e.isQuickWin,isS3Candidate:!!e.isS3Candidate,detectionGap:!!e.detectionGap}})}(u.length>0?u:l.decisions,e,t),parsed:l}}throw Error(`Batch ${n+1} failed after 2 attempts: ${r}`)},r=await Promise.all(n.map((e,t)=>i(e,t))),o=r.flatMap(e=>e.decisions),s=r[0]?.parsed,c="number"==typeof s?.totalLicenseSpend?s.totalLicenseSpend:o.reduce((e,t)=>e+t.annualLicenseCost,0),l=o.filter(e=>"Low-Value"===e.tier||"ELIMINATE"===e.action||"ARCHIVE"===e.action).reduce((e,t)=>e+t.annualLicenseCost,0),u=o.reduce((e,t)=>("Critical"===t.tier?e.critical++:"Important"===t.tier?e.important++:"Nice-to-Have"===t.tier?e.niceToHave++:e.lowValue++,e),{critical:0,important:0,niceToHave:0,lowValue:0}),d=o.length,p=o.reduce((e,t)=>e+t.utilizationScore,0)/d,h=o.reduce((e,t)=>e+t.detectionScore,0)/d,g=o.reduce((e,t)=>e+t.qualityScore,0)/d,y=o.reduce((e,t)=>e+t.confidenceScore,0)/d;return console.log(`[LLMDecisionAgent] Complete — ${o.length} valid decisions, $${c.toFixed(2)} total spend`),{decisions:o,roiScore:"number"==typeof s?.roiScore?s.roiScore:Math.min(100,Math.round(l/Math.max(c,1)*100)),gainScopeScore:"number"==typeof s?.gainScopeScore?s.gainScopeScore:Math.round(.4*p+.3*h+.3*g),totalLicenseSpend:c,licenseSpendLowValue:"number"==typeof s?.licenseSpendLowValue?s.licenseSpendLowValue:l,storageSavingsPotential:"number"==typeof s?.storageSavingsPotential?s.storageSavingsPotential:.6*l,totalDailyGb:e.reduce((e,t)=>e+t.dailyAvgGb,0),totalSourcetypes:e.length,tierCounts:u,securityGaps:"number"==typeof s?.securityGaps?s.securityGaps:o.filter(e=>e.detectionGap).length,operationalGaps:"number"==typeof s?.operationalGaps?s.operationalGaps:o.filter(e=>"OPTIMIZE"===e.action).length,avgUtilization:Math.round(p),avgDetection:Math.round(h),avgQuality:Math.round(g),avgConfidence:Math.round(100*y),quickWins:Array.isArray(s?.quickWins)?s.quickWins.slice(0,3):o.filter(e=>e.isQuickWin).slice(0,3).map(e=>({index:e.index,action:e.action,impact:`Save $${Math.round(e.estimatedSavings).toLocaleString()}/year`,details:e.recommendation})),savingsStaircase:Array.isArray(s?.savingsStaircase)?s.savingsStaircase:[{stage:"Current Spend",amount:c},{stage:"After Ingest Actions",amount:Math.round(.85*c)},{stage:"After Retention Tuning",amount:Math.round(.72*c)},{stage:"After Archive",amount:Math.round(.58*c)},{stage:"After S3 Migration",amount:Math.round(.45*c)},{stage:"Optimized Target",amount:Math.round(.38*c)}],agentReasoning:s?.agentReasoning||`Analyzed ${e.length} Splunk indexes. ${u.lowValue} low-value candidates identified. Total spend: $${c.toLocaleString()}.`}}var D=a(9306);let $=new Uint8Array(16),T=[];for(let e=0;e<256;++e)T.push((e+256).toString(16).slice(1));let L={lookbackDays:30,costPerGbPerDay:.5};async function A(e,t=L){var a,n;let i=Date.now(),r=n||a||!crypto.randomUUID?function(e,t,a){let n=(e=e||{}).random??e.rng?.()??crypto.getRandomValues($);if(n.length<16)throw Error("Random bytes length must be >= 16");if(n[6]=15&n[6]|64,n[8]=63&n[8]|128,t){if((a=a||0)<0||a+16>t.length)throw RangeError(`UUID byte range ${a}:${a+15} is out of buffer bounds`);for(let e=0;e<16;++e)t[a+e]=n[e];return t}return function(e,t=0){return(T[e[t+0]]+T[e[t+1]]+T[e[t+2]]+T[e[t+3]]+"-"+T[e[t+4]]+T[e[t+5]]+"-"+T[e[t+6]]+T[e[t+7]]+"-"+T[e[t+8]]+T[e[t+9]]+"-"+T[e[t+10]]+T[e[t+11]]+T[e[t+12]]+T[e[t+13]]+T[e[t+14]]+T[e[t+15]]).toLowerCase()}(n)}(a,n,void 0):crypto.randomUUID(),o=await (0,D.m3)(),s=t.costPerGbPerDay??o.costPerGbPerDay;console.log(`[Aggregation] Using cost model: $${s}/GB/day from user config`);let l=await e.getIndexMetrics();if(0===l.length)throw Error("Splunk returned 0 indexes. Check index permissions.");let u=l.filter(e=>e.dailyAvgGb>=.1).sort((e,t)=>t.dailyAvgGb-e.dailyAvgGb).slice(0,20).map(e=>e.index),d=u.length>0?await e.getBatchSourcetypeMetrics(u).catch(e=>(console.warn("[Aggregation] Sourcetype batch failed (index data still used):",e.message),[])):[],p=[...l.map(e=>({index:e.index,sourcetype:void 0,dailyAvgGb:e.dailyAvgGb,totalEvents:e.totalEvents,retentionDays:e.retentionDays,firstEvent:e.firstEvent,lastEvent:e.lastEvent,licenseGbPerDay:s})),...d.map(e=>({index:e.index,sourcetype:e.sourcetype,dailyAvgGb:e.dailyAvgGb,totalEvents:e.totalEvents,retentionDays:e.retentionDays,firstEvent:e.firstEvent,lastEvent:e.lastEvent}))];console.log(`[Aggregation] Sending ${p.length} metrics to LLM decision agent...`);let h=await w(p,s);console.log(`[Aggregation] LLM agent completed. ${h.decisions.length} decisions received.`);let g=new Date().toISOString().split("T")[0],y=0,m=0,E=h.decisions;return await (0,c.PS)(async t=>{await t.query("DELETE FROM telemetry_snapshots WHERE snapshot_date = $1",[g]),await t.query("DELETE FROM agent_decisions WHERE snapshot_date = $1",[g]);for(let e=0;e<E.length;e+=50){let a=E.slice(e,e+50),n=`sp_batch_${Math.floor(e/50)}`;try{for(let e of(await t.query(`SAVEPOINT ${n}`),a)){let a=p.find(t=>t.index===e.index&&(t.sourcetype||null)===(e.sourcetype||null));await C(t,e,a,r,g),await k(t,e,r,g),y++}await t.query(`RELEASE SAVEPOINT ${n}`)}catch(e){await t.query(`ROLLBACK TO SAVEPOINT ${n}`),m+=a.length,console.error(`[Aggregation] Batch ${n} failed:`,e instanceof Error?e.message:e)}}await O(t,h,r,g),await I(t,"index_metrics",y);try{let a=await e.getSavedSearches();if(a.length>0){for(let e of(await t.query("DELETE FROM search_audit WHERE snapshot_date = $1",[g]),E.filter(e=>"ARCHIVE"===e.action||"ELIMINATE"===e.action).map(e=>e.index),a)){let a=e.isScheduled&&!e.lastRun,n=!e.isScheduled&&!e.isAlert&&!e.lastRun,i=a?30:n?40:e.isAlert?80:60,r=a?"Scheduled search with no recorded execution":n?"Not scheduled, not an alert, never run":e.isAlert?"Active alert":"Saved search",o=a?"HIGH":n?"HIGH":e.isAlert?"LOW":"MEDIUM",s=a?"orphan":n?"unused":"active";await t.query(`INSERT INTO search_audit (snapshot_date, search_name, search_type, app, schedule, is_scheduled, is_alert, last_run, confidence_score, reason, status, risk_level, is_unused)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[g,e.name,e.isAlert?"alert":"scheduled",e.app,e.schedule,e.isScheduled,e.isAlert,e.lastRun,i,r,s,o,n])}console.log(`[Aggregation] Search audit: ${a.length} searches audited.`)}}catch(e){console.warn("[Aggregation] Search audit skipped (non-fatal):",e instanceof Error?e.message:e)}}),{snapshotId:r,inserted:y,errors:m,durationMs:Date.now()-i,agentReasoning:h.agentReasoning}}async function C(e,t,a,n,i){let r=t.sourcetype?"sourcetype":"index",o=t.sourcetype?t.index:null;await e.query(`
    INSERT INTO telemetry_snapshots (
      snapshot_id, snapshot_date, granularity, parent_index, index_name, sourcetype,
      total_events, daily_avg_gb, retention_days,
      utilization_pct, cost_per_year, risk_score,
      classification, confidence, recommendation, evidence,
      raw_metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    ON CONFLICT ON CONSTRAINT uq_snapshot_identity DO UPDATE SET
      snapshot_id     = EXCLUDED.snapshot_id,
      total_events    = EXCLUDED.total_events,
      daily_avg_gb    = EXCLUDED.daily_avg_gb,
      retention_days  = EXCLUDED.retention_days,
      cost_per_year   = EXCLUDED.cost_per_year,
      risk_score      = EXCLUDED.risk_score,
      classification  = EXCLUDED.classification,
      confidence      = EXCLUDED.confidence,
      recommendation  = EXCLUDED.recommendation,
      evidence        = EXCLUDED.evidence,
      raw_metadata    = EXCLUDED.raw_metadata,
      updated_at      = NOW()
    `,[n,i,r,o,t.index,t.sourcetype||null,a?.totalEvents??0,a?.dailyAvgGb??0,a?.retentionDays??90,t.utilizationScore,t.annualLicenseCost,t.riskScore,{KEEP:"KEEP",OPTIMIZE:"OPTIMIZE",ARCHIVE:"ARCHIVE",ELIMINATE:"ELIMINATE",S3_CANDIDATE:"ARCHIVE"}[t.action]||"KEEP",t.confidenceScore,t.recommendation,JSON.stringify({...t.evidence.map(e=>({text:e})),reasoning:t.reasoning,tier:t.tier,action:t.action,confidence:t.confidence,isQuickWin:t.isQuickWin,isS3Candidate:t.isS3Candidate,detectionGap:t.detectionGap,estimatedSavings:t.estimatedSavings,compositeScore:t.compositeScore,utilizationScore:t.utilizationScore,detectionScore:t.detectionScore,qualityScore:t.qualityScore}),JSON.stringify({firstEvent:a?.firstEvent,lastEvent:a?.lastEvent,reasoning:t.reasoning,agentDecision:!0})])}async function O(e,t,a,n){await e.query(`
    INSERT INTO executive_kpis (
      snapshot_id, snapshot_date,
      roi_score, gainscope_score,
      total_license_spend, license_spend_low_value, storage_savings_potential,
      total_daily_gb, total_sourcetypes,
      tier_critical, tier_important, tier_nice_to_have, tier_low_value,
      security_gaps, operational_gaps,
      avg_utilization, avg_detection, avg_quality, avg_confidence,
      quick_wins, savings_staircase, agent_reasoning
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
    ON CONFLICT (snapshot_date) DO UPDATE SET
      snapshot_id             = EXCLUDED.snapshot_id,
      roi_score               = EXCLUDED.roi_score,
      gainscope_score         = EXCLUDED.gainscope_score,
      total_license_spend     = EXCLUDED.total_license_spend,
      license_spend_low_value = EXCLUDED.license_spend_low_value,
      storage_savings_potential = EXCLUDED.storage_savings_potential,
      total_daily_gb          = EXCLUDED.total_daily_gb,
      total_sourcetypes       = EXCLUDED.total_sourcetypes,
      tier_critical           = EXCLUDED.tier_critical,
      tier_important          = EXCLUDED.tier_important,
      tier_nice_to_have       = EXCLUDED.tier_nice_to_have,
      tier_low_value          = EXCLUDED.tier_low_value,
      security_gaps           = EXCLUDED.security_gaps,
      operational_gaps        = EXCLUDED.operational_gaps,
      avg_utilization         = EXCLUDED.avg_utilization,
      avg_detection           = EXCLUDED.avg_detection,
      avg_quality             = EXCLUDED.avg_quality,
      avg_confidence          = EXCLUDED.avg_confidence,
      quick_wins              = EXCLUDED.quick_wins,
      savings_staircase       = EXCLUDED.savings_staircase,
      agent_reasoning         = EXCLUDED.agent_reasoning,
      updated_at              = NOW()
    `,[a,n,t.roiScore,t.gainScopeScore,t.totalLicenseSpend,t.licenseSpendLowValue,t.storageSavingsPotential,t.totalDailyGb,t.totalSourcetypes,t.tierCounts.critical,t.tierCounts.important,t.tierCounts.niceToHave,t.tierCounts.lowValue,t.securityGaps,t.operationalGaps,t.avgUtilization,t.avgDetection,t.avgQuality,t.avgConfidence,JSON.stringify(t.quickWins),JSON.stringify(t.savingsStaircase),t.agentReasoning])}async function k(e,t,a,n){await e.query(`
    INSERT INTO agent_decisions (
      snapshot_id, snapshot_date,
      index_name, sourcetype,
      tier, action,
      composite_score, utilization_score, detection_score, quality_score, risk_score,
      annual_license_cost, estimated_savings,
      confidence, confidence_score,
      recommendation, reasoning, evidence,
      is_quick_win, is_s3_candidate, detection_gap
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
    ON CONFLICT (snapshot_id, index_name, sourcetype) DO UPDATE SET
      tier = EXCLUDED.tier,
      action = EXCLUDED.action,
      composite_score = EXCLUDED.composite_score,
      utilization_score = EXCLUDED.utilization_score,
      detection_score = EXCLUDED.detection_score,
      quality_score = EXCLUDED.quality_score,
      risk_score = EXCLUDED.risk_score,
      annual_license_cost = EXCLUDED.annual_license_cost,
      estimated_savings = EXCLUDED.estimated_savings,
      confidence = EXCLUDED.confidence,
      confidence_score = EXCLUDED.confidence_score,
      recommendation = EXCLUDED.recommendation,
      reasoning = EXCLUDED.reasoning,
      evidence = EXCLUDED.evidence,
      is_quick_win = EXCLUDED.is_quick_win,
      is_s3_candidate = EXCLUDED.is_s3_candidate,
      detection_gap = EXCLUDED.detection_gap,
      updated_at = NOW()
`,[a,n,t.index,t.sourcetype||null,t.tier,t.action,t.compositeScore,t.utilizationScore,t.detectionScore,t.qualityScore,t.riskScore,t.annualLicenseCost,t.estimatedSavings,t.confidence,t.confidenceScore,t.recommendation,t.reasoning,JSON.stringify(t.evidence),t.isQuickWin,t.isS3Candidate,t.detectionGap])}async function I(e,t,a){await e.query(`
    INSERT INTO cache_metadata (cache_key, last_refresh_at, next_refresh_at, status, record_count)
    VALUES ($1, NOW(), NOW() + INTERVAL '24 hours', 'fresh', $2)
    ON CONFLICT (cache_key) DO UPDATE SET
      last_refresh_at = EXCLUDED.last_refresh_at,
      next_refresh_at = EXCLUDED.next_refresh_at,
      status          = 'fresh',
      record_count    = EXCLUDED.record_count,
      updated_at      = NOW()
    `,[t,a])}let b=require("http"),x=require("https"),R=[1e3,3e3];class N{constructor(e){if(!e.mcpUrl)throw Error("Splunk MCP URL is required");this.config=e}get timeoutMs(){return this.config.timeoutMs??2e4}getTokenValue(){return this.config.token.trim().replace(/^Authorization:\s*/i,"").replace(/^(Bearer|Splunk)\s+/i,"").trim()}getBearerHeader(){return`Bearer ${this.getTokenValue()}`}getSplunkHeader(){return`Splunk ${this.getTokenValue()}`}getRestBaseUrl(){let e=new URL(this.config.mcpUrl);return`${e.protocol}//${e.host}`}requestText(e,t,a,n){return new Promise((i,r)=>{let o=new URL(e),s="https:"===o.protocol?x:b,c=n||"",l=s.request({protocol:o.protocol,hostname:o.hostname,port:o.port,path:`${o.pathname}${o.search}`,method:t,headers:{...a,...c?{"Content-Length":Buffer.byteLength(c).toString()}:{}},timeout:this.timeoutMs,rejectUnauthorized:"https:"===o.protocol?!this.config.allowInsecureTls:void 0},e=>{let t="";e.setEncoding("utf8"),e.on("data",e=>{t+=e}),e.on("end",()=>{let a=e.statusCode||0;i({status:a,ok:a>=200&&a<300,text:t})})});l.on("timeout",()=>l.destroy(Error(`Request timed out after ${Math.round(this.timeoutMs/1e3)}s`))),l.on("error",r),c&&l.write(c),l.end()})}async withRetry(e,t){let a=Error("Unknown error");for(let t=0;t<=R.length;t++)try{return await e()}catch(e){if(!((a=e instanceof Error?e:Error(String(e))).message.includes("timed out")||a.message.includes("ECONNRESET")||a.message.includes("ETIMEDOUT")||a.message.includes("socket hang up"))||t>=R.length)break;await new Promise(e=>setTimeout(e,R[t]))}throw a}async healthCheckFast(){let e=Date.now();try{let t=await this.requestText(`${this.getRestBaseUrl()}/services/server/info?output_mode=json`,"GET",{Authorization:this.getBearerHeader()});if(!t.ok){let a=401===t.status?"Invalid or expired token":403===t.status?"Token lacks permission":`HTTP ${t.status}`;return{success:!1,latencyMs:Date.now()-e,error:a}}return{success:!0,latencyMs:Date.now()-e}}catch(i){let t=i instanceof Error?i.message:"Unknown error",a=new URL(this.config.mcpUrl),n=a.port||"8089";if(t.includes("ECONNREFUSED")||t.includes("ECONNRESET")||t.includes("timed out")||t.includes("ETIMEDOUT"))return{success:!1,latencyMs:Date.now()-e,error:`Cannot reach ${a.hostname}:${n}. Port ${n} appears blocked by a firewall. Open TCP ${n} inbound in your server firewall.`};return{success:!1,latencyMs:Date.now()-e,error:t}}}async getIndexMetrics(){return this.withRetry(async()=>{let e=await this.requestText(`${this.getRestBaseUrl()}/services/data/indexes?output_mode=json&count=500&summarize=false`,"GET",{Authorization:this.getBearerHeader()});if(!e.ok){if(401===e.status)throw Error("Splunk authentication failed (401). Token is invalid or expired.");if(403===e.status)throw Error("Splunk access denied (403). Token lacks permission to list indexes.");throw Error(`Splunk index list failed: HTTP ${e.status}`)}return(JSON.parse(e.text).entry||[]).filter(e=>e.name&&!e.name.startsWith("_")).map(e=>{let t=e.content||{},a=parseFloat(t.currentDBSizeMB||t.maxTotalDataSizeMB||"0"),n=Math.max(1,Math.round(parseInt(t.frozenTimePeriodInSecs||"7776000",10)/86400)),i=a>0?parseFloat((a/1024/n).toFixed(4)):0;return{index:e.name,totalEvents:parseInt(t.totalEventCount||"0",10),dailyAvgGb:i,retentionDays:n,firstEvent:t.minTime||new Date(Date.now()-864e5*n).toISOString(),lastEvent:t.maxTime||new Date().toISOString()}}).filter(e=>e.totalEvents>0||e.dailyAvgGb>0)},"getIndexMetrics")}async getSourcetypeMetrics(e){let t=`| tstats count AS totalEvents WHERE index="${e}" earliest=-24h latest=now() BY sourcetype | sort - totalEvents | head 30`;return this.withRetry(async()=>(await this.runSearchJob(t)).map(t=>({index:e,sourcetype:t.sourcetype||"unknown",totalEvents:parseInt(t.totalEvents||t.count||"0",10),dailyAvgGb:0,retentionDays:90,firstEvent:new Date(Date.now()-864e5).toISOString(),lastEvent:new Date().toISOString()})),`getSourcetypeMetrics(${e})`)}async getBatchSourcetypeMetrics(e){if(0===e.length)return[];let t=e.map(e=>`index="${e}"`).join(" OR "),a=`| tstats count AS totalEvents WHERE (${t}) earliest=-24h latest=now() BY index sourcetype | sort - totalEvents | head 200`;return this.withRetry(async()=>(await this.runSearchJob(a)).map(e=>({index:e.index||"unknown",sourcetype:e.sourcetype||"unknown",totalEvents:parseInt(e.totalEvents||e.count||"0",10),dailyAvgGb:0,retentionDays:90,firstEvent:new Date(Date.now()-864e5).toISOString(),lastEvent:new Date().toISOString()})),"getBatchSourcetypeMetrics")}async getSavedSearches(){return this.withRetry(async()=>{let e=await this.requestText(`${this.getRestBaseUrl()}/servicesNS/-/-/saved/searches?output_mode=json&count=500&search=disabled%3D0`,"GET",{Authorization:this.getBearerHeader()});if(!e.ok){if(401===e.status)throw Error("Splunk auth failed (401)");if(403===e.status)throw Error("Splunk access denied (403)");throw Error(`Saved searches failed: HTTP ${e.status}`)}return(JSON.parse(e.text).entry||[]).map(e=>{let t=e.content||{};return{name:e.name||"",app:e.acl?.app||"unknown",isScheduled:"1"===t.is_scheduled||!0===t.is_scheduled,isAlert:!!(t.alert_type&&"always"!==t.alert_type),schedule:t.cron_schedule||"",lastRun:t.next_scheduled_time||null,disabled:"1"===t.disabled||!0===t.disabled}})},"getSavedSearches")}async runSearchJob(e){let t=new URLSearchParams({search:e.trim(),output_mode:"json",exec_mode:"oneshot"}),a=await this.requestText(`${this.getRestBaseUrl()}/services/search/jobs/export`,"POST",{Authorization:this.getSplunkHeader(),"Content-Type":"application/x-www-form-urlencoded"},t.toString());if(!a.ok){if(401===a.status)throw Error("Splunk authentication failed (401). Verify the token is valid.");if(403===a.status)throw Error("Splunk access denied (403). Token lacks search permission.");throw Error(`Splunk search failed: HTTP ${a.status} — ${a.text.slice(0,200)}`)}return a.text.split(/\r?\n/).filter(Boolean).flatMap(e=>{try{return[JSON.parse(e)]}catch{return[]}}).map(e=>e.result||e).filter(e=>e&&"object"==typeof e&&Object.keys(e).length>0)}}async function U(e){try{let{searchParams:t}=new URL(e.url),a=t.get("key");if(a){let e=await l(a);return s.Z.json(e)}let n=await h();return s.Z.json({caches:n})}catch(e){return s.Z.json({error:e instanceof Error?e.message:"Failed to fetch cache status"},{status:500})}}async function P(e){let t=Date.now();try{var a;let n=await e.json();if(!n?.mcpUrl||!n?.token)return s.Z.json({error:"mcpUrl and token are required"},{status:400});let{mcpUrl:i,token:r,disableSslVerify:o=!1,costPerGbPerDay:l=.5}=n,h="index_metrics";if(await u(h))return s.Z.json({error:"Refresh already in progress",hint:"Wait for current job to complete"},{status:409});await d(h);let g=new N({mcpUrl:i,token:r,allowInsecureTls:!!o}),y=await g.healthCheckFast();if(!y.success){await p(h,`Splunk unreachable: ${y.error}`);let e=y.error?.includes("firewall")||y.error?.includes("blocked")||y.error?.includes("Cannot reach");return s.Z.json({error:"Cannot connect to Splunk",reason:y.error||"Connection failed",hint:e?"Open TCP 8089 inbound in your server firewall.":"Verify Splunk is running and the token is valid."},{status:500})}let m=await (a=A(g,{lookbackDays:30,costPerGbPerDay:l}),new Promise((e,t)=>{let n=setTimeout(()=>{t(Error(`Refresh timed out after ${Math.round(300)}s. The LLM agent is processing data — try again.`))},3e5);a.then(e).catch(t).finally(()=>clearTimeout(n))}));m.errors>0&&await p(h,`Partial failure: ${m.errors} records failed`);let E=await (0,c.IO)("SELECT COUNT(*) as count FROM telemetry_snapshots"),_=parseInt(E.rows[0]?.count||"0",10);if(0===_)return await p(h,"No data stored after refresh"),s.Z.json({error:"No data returned from Splunk",hint:"Check index permissions and time range"},{status:500});return s.Z.json({success:!0,snapshotId:m.snapshotId,inserted:m.inserted,errors:m.errors,durationMs:Date.now()-t,agentReasoning:m.agentReasoning})}catch(a){let e=a instanceof Error?a.message:"Refresh failed";await p("index_metrics",e).catch(()=>{});let t="Check MCP URL, token, and network connectivity";return e.includes("Ollama")?t='Start Ollama: run "ollama serve" in a terminal':e.includes("ECONNREFUSED")||e.includes("ECONNRESET")?t="Port 8089 refused — ensure Splunk management API is running":e.includes("timed out")?t="Refresh timed out — the LLM agent may need more time. Try again.":e.includes("401")&&(t="Token rejected. Verify your Splunk token is valid."),s.Z.json({error:"Refresh failed",reason:e,hint:t},{status:500})}}let M=new i.AppRouteRouteModule({definition:{kind:r.x.APP_ROUTE,page:"/api/cache/route",pathname:"/api/cache",filename:"route",bundlePath:"app/api/cache/route"},resolvedPagePath:"/Users/ramakrishna/Desktop/Teja/Dashboards/apps/web/app/api/cache/route.ts",nextConfigOutput:"",userland:n}),{requestAsyncStorage:q,staticGenerationAsyncStorage:H,serverHooks:G,headerHooks:X,staticGenerationBailout:W}=M,V="/api/cache/route";function z(){return(0,o.patchFetch)({serverHooks:G,staticGenerationAsyncStorage:H})}},9306:(e,t,a)=>{a.d(t,{Oh:()=>o,m3:()=>r});var n=a(3106);let i={configKey:"default",costPerGbPerDay:.5,maxRetentionDays:730,maxParallel:2,decisionWeights:{},retentionPolicy:{CRITICAL:730,IMPORTANT:365,NICE_TO_HAVE:90,LOW_VALUE:30}};async function r(){let e=await (0,n.IO)(`SELECT id, config_key as "configKey", cost_per_gb_per_day as "costPerGbPerDay",
            max_retention_days as "maxRetentionDays", max_parallel as "maxParallel",
            decision_weights as "decisionWeights", retention_policy as "retentionPolicy",
            created_at as "createdAt", updated_at as "updatedAt"
     FROM user_config WHERE config_key = 'default'`);return 0===e.rows.length?(await (0,n.IO)(`INSERT INTO user_config (config_key, cost_per_gb_per_day, max_retention_days, max_parallel)
       VALUES ('default', $1, $2, $3)`,[i.costPerGbPerDay,i.maxRetentionDays,i.maxParallel]),{...i,id:0,createdAt:new Date,updatedAt:new Date}):e.rows[0]}async function o(e){let t=await r(),a=e.costPerGbPerDay??t.costPerGbPerDay,i=e.maxRetentionDays??t.maxRetentionDays,o=e.maxParallel??t.maxParallel,s=e.decisionWeights??t.decisionWeights,c=e.retentionPolicy??t.retentionPolicy;return await (0,n.IO)(`UPDATE user_config 
     SET cost_per_gb_per_day = $1, max_retention_days = $2, max_parallel = $3,
         decision_weights = $4, retention_policy = $5, updated_at = NOW()
     WHERE config_key = 'default'`,[a,i,o,JSON.stringify(s),JSON.stringify(c)]),r()}},3106:(e,t,a)=>{a.d(t,{IO:()=>o,PS:()=>s});let n=require("pg"),i=process.env.DATABASE_URL||"postgresql://telemetry:telemetry@localhost:5433/telemetry_os",r=new n.Pool({connectionString:i,max:20,idleTimeoutMillis:3e4,connectionTimeoutMillis:5e3});async function o(e,t){Date.now();let a=await r.query(e,t);return Date.now(),a}async function s(e){let t=await r.connect();try{await t.query("BEGIN");let a=await e(t);return await t.query("COMMIT"),a}catch(e){throw await t.query("ROLLBACK"),e}finally{t.release()}}r.on("error",e=>{console.error("Unexpected PostgreSQL pool error",e),process.exit(-1)})}};var t=require("../../../webpack-runtime.js");t.C(e);var a=e=>t(t.s=e),n=t.X(0,[369,587],()=>a(9771));module.exports=n})();