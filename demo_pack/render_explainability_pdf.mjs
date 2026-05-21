import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const htmlPath = '/Users/ramakrishna/Desktop/Teja/Dashboards/demo_pack/Agentic_Dashboard_End_to_End_Explainability_Report.html';
const pdfPath = '/Users/ramakrishna/Desktop/Teja/Dashboards/demo_pack/Agentic Dashboard End-to-End Explainability Report.pdf';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '16mm', bottom: '16mm', left: '12mm', right: '12mm' }
});
await browser.close();
console.log(pdfPath);
