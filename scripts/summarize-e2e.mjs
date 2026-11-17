import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';

const report=JSON.parse(await readFile('test-results/results.json','utf8'));
if(report.stats.unexpected||report.stats.flaky||report.stats.skipped||report.errors?.length)throw new Error('Only a complete, passing browser run can be summarized.');
const tests=[];
function collect(suite){
  for(const spec of suite.specs||[])for(const test of spec.tests)tests.push({title:spec.title,...test});
  for(const child of suite.suites||[])collect(child);
}
for(const suite of report.suites)collect(suite);
if(!tests.length||tests.some(test=>test.results.length!==1||test.results[0].status!=='passed'))throw new Error('Every test must pass without retries.');
const projects={};
for(const test of tests){
  const project=projects[test.projectName]||={tests:0,htmlComparisons:0,screenshotComparisons:0,exactScreenshots:0,roundingDifferences:[]};
  project.tests++;
  for(const attachment of test.results[0].attachments){
    if(attachment.name.endsWith('-worker.html'))project.htmlComparisons++;
    if(!attachment.name.endsWith('-pixels.json'))continue;
    const bytes=attachment.path?await readFile(attachment.path):Buffer.from(attachment.body,'base64');
    const pixels=JSON.parse(bytes);project.screenshotComparisons++;
    if(!pixels.changedPixels)project.exactScreenshots++;
    else project.roundingDifferences.push({test:test.title,page:attachment.name.slice(0,-12),...pixels});
  }
}
const require=createRequire(import.meta.url);
const testRequire=createRequire(require.resolve('@playwright/test/package.json'));
const browserRequire=createRequire(testRequire.resolve('playwright/package.json'));
const browserManifest=JSON.parse(await readFile(join(dirname(browserRequire.resolve('playwright-core/package.json')),'browsers.json'),'utf8'));
const pkg=JSON.parse(await readFile('package.json','utf8'));
const checksums={};
for(const name of (await readdir('native')).filter(name=>/\.(js|arc)$/.test(name)).sort()){
  checksums['native/'+name]=createHash('sha256').update(await readFile('native/'+name)).digest('hex');
}
const summary={
  startedAt:report.stats.startTime,durationMs:report.stats.duration,
  passed:tests.length,failed:0,retries:0,
  node:process.version,playwright:pkg.devDependencies['@playwright/test'],
  browsers:Object.fromEntries(browserManifest.browsers.filter(browser=>projects[browser.name]).map(browser=>[browser.name,browser.browserVersion])),
  officialArchiveSha256:JSON.parse(await readFile('upstream/SOURCE.json','utf8')).archive_sha256,
  applicationFilesSha256:checksums,
  comparisonRules:{html:'Exact after normalizing random callback and session identifiers.',fixtures:'Equal clocks, memory and seed data; idle signup uses real clocks.',screenshots:{maxChangedPixels:2,maxChannelDelta:1,masks:false}},
  projects,
};
await mkdir('verification',{recursive:true});
await writeFile('verification/browser-results.json',JSON.stringify(summary,null,2)+'\n');
console.log('Saved verification/browser-results.json: '+tests.length+' passing browser tests.');
