import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./native/e2e',
  timeout:120000,
  expect:{timeout:10000},
  workers:1,
  retries:0,
  reporter:[['list'],['html',{open:'never'}],['json',{outputFile:'test-results/results.json'}]],
  use:{viewport:{width:1280,height:900},trace:'retain-on-failure'},
  projects:['chromium','firefox','webkit'].map(browserName=>({name:browserName,use:{browserName,
    ...(browserName==='webkit'&&process.env.E2E_WEBKIT_EXECUTABLE?{launchOptions:{executablePath:process.env.E2E_WEBKIT_EXECUTABLE}}:{})
  }})),
});
