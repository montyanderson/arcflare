import {test,expect,submit} from './harness.mjs';

for(const role of [null,'bob','erin','alice'])test(`page bytes and pixels match for ${role||'anonymous'}`,async({sites})=>{
  await sites.role(role);
  for(const path of ['/','/newest','/item?id=1','/item?id=4','/user?id=bob','/lists','/formatdoc','/submit']){
    await sites.goto(path);await sites.same(path.replaceAll('/','_'));
  }
});

test('original layouts match at narrow and tablet widths',async({sites})=>{
  for(const width of [390,768]){
    await sites.each(page=>page.setViewportSize({width,height:844}));
    for(const path of ['/','/item?id=1','/login']){
      await sites.goto(path);await sites.same(width+'-'+path.replaceAll('/','_'));
    }
  }
});

test('registration validation, real cookies, logout, login and password reset',async({sites})=>{
  await sites.goto('/');
  await sites.each(page=>page.getByRole('link',{name:'login',exact:true}).click());
  await sites.same('signup');
  for(const [u,p]of [['bad name','long password'],['charlie','x'],['charlie','long browser password']]){
    await sites.each(async page=>{
      const form=page.locator('form').filter({has:page.getByRole('button',{name:'create account',exact:true})});
      await form.locator('[name=u]').fill(u);await form.locator('[name=p]').fill(p);
      await form.getByRole('button',{name:'create account',exact:true}).click();
    });
    await sites.same('registration-'+u+'-'+p.length);
  }
  await sites.each(async page=>expect(page.getByRole('link',{name:'charlie',exact:true})).toBeVisible());
  await sites.goto('/resetpw');
  await sites.each(page=>submit(page,{p:'replacement browser password'},'reset'));
  await sites.same('reset-password');
  await sites.goto('/logout');
  await sites.goto('/login');
  await sites.each(page=>submit(page,{u:'charlie',p:'wrong password'},'login'));
  await sites.same('bad-login');
  await sites.each(page=>submit(page,{u:'charlie',p:'replacement browser password'},'login'));
  await sites.same('logged-in');
  await sites.goto('/user?id=charlie');await sites.same('private-profile');
});

test('story submission, comments, nested replies and browser history',async({sites})=>{
  await sites.role('alice');await sites.goto('/submit');
  await sites.each(page=>submit(page,{t:'Browser story 🌍 #(literal)',u:'https://example.com/browser',x:''}));
  await sites.same('submitted-story');
  await sites.each(page=>page.getByRole('link',{name:'discuss',exact:true}).first().click());
  await sites.same('story-thread');
  await sites.each(page=>submit(page,{text:'Browser *comment* 🌍\n\n<script>alert(1)</script>'},'add comment'));
  await sites.same('comment');
  await sites.each(page=>page.getByRole('link',{name:'reply',exact:true}).first().click());
  await sites.each(page=>submit(page,{text:'Nested browser reply'},'reply'));
  await sites.same('nested-reply');
  await sites.each(page=>page.goBack());await sites.same('history-back');
});

test('JavaScript voting changes the DOM and persists without navigating',async({sites})=>{
  await sites.role('bob');await sites.goto('/item?id=1');
  await sites.each(async page=>{
    const before=page.url();
    const ping=page.waitForResponse(response=>new URL(response.url()).pathname==='/vote');
    await page.locator('#up_1').click();await ping;
    expect(page.url()).toBe(before);
    await expect(page.locator('#score_1')).toHaveText('2 points');
  });
  await sites.same('voted-dom');
  await sites.goto('/item?id=1');await sites.same('voted-persisted');
  await sites.goto('/saved?id=bob');await sites.same('saved-items');
});

test('profile preferences, private fields, edit, delete and restore',async({sites})=>{
  await sites.role('alice');await sites.goto('/user?id=alice');
  await sites.each(page=>submit(page,{about:'Browser profile *text*',email:'private@example.test'},'update'));
  await sites.same('updated-profile');
  await sites.role(null);await sites.goto('/user?id=alice');await sites.same('public-profile');
  await sites.each(async page=>expect(await page.content()).not.toContain('private@example.test'));
  await sites.role('alice');await sites.goto('/edit?id=1');
  await sites.each(page=>submit(page,{title:'Edited browser title'},'update'));
  await sites.same('edited');
  await sites.goto('/item?id=1');
  await sites.each(page=>page.getByRole('link',{name:'delete',exact:true}).first().click());
  await sites.each(page=>page.getByRole('button',{name:'Yes',exact:true}).click());
  await sites.same('deleted');
  await sites.goto('/item?id=1');
  await sites.each(page=>page.getByRole('link',{name:'undelete',exact:true}).first().click());
  await sites.each(page=>page.getByRole('button',{name:'No',exact:true}).click());
  await sites.same('restored');
});

test('poll creation and multiple option votes',async({sites})=>{
  await sites.role('alice');await sites.goto('/newpoll');
  await sites.each(page=>submit(page,{t:'Browser poll',x:'Pick options.',o:'First\n\nSecond'}));
  await sites.same('created-poll');
  await sites.each(page=>page.getByRole('link',{name:'Browser poll',exact:true}).click());
  await sites.same('poll');
  const paths=sites.pages.map(page=>new URL(page.url()).pathname+new URL(page.url()).search);
  expect(paths[1]).toBe(paths[0]);
  await sites.role('bob');await sites.goto(paths[0]);
  await sites.each(async page=>{
    const arrows=page.locator('a[id^=up_]');
    for(let index=1;index<await arrows.count();index++){
      const ping=page.waitForResponse(response=>new URL(response.url()).pathname==='/vote');
      await arrows.nth(index).click();await ping;
    }
  });
  await sites.goto(paths[0]);await sites.same('poll-multiple-votes');
});

test('pagination and delayed comment visibility match the original',async({sites})=>{
  await sites.control('(do (repeat 32 (submit-item "alice" (create-story (string "https://example.test/" maxid*) (string "Page story " maxid*) nil "alice" "127.0.0.1"))) (gen-topstories) nil)');
  await sites.goto('/newest');
  await sites.each(page=>page.getByRole('link',{name:'More',exact:true}).click());
  await sites.same('pagination');
  await sites.role('bob');
  await sites.control('(= (uvar "bob" delay) 2)');
  await sites.goto('/item?id=1');
  await sites.each(page=>submit(page,{text:'Delayed browser comment'},'add comment'));
  await sites.same('delayed-own-comment');
  await sites.role(null);await sites.goto('/item?id=1');
  await sites.each(async page=>expect(await page.content()).not.toContain('Delayed browser comment'));
  await sites.same('delayed-hidden-comment');
  await sites.control('(do (assign seconds (fn () 1700000121)) nil)');
  await sites.goto('/item?id=1');await sites.same('delayed-visible-comment');
  await sites.each(async page=>expect(await page.content()).toContain('Delayed browser comment'));
});

test('flagging, unflagging, and private saved items enforce original permissions',async({sites})=>{
  await sites.control('(= (uvar "bob" karma) 100)');
  await sites.role('bob');await sites.goto('/item?id=1');
  await sites.each(page=>page.getByRole('link',{name:'flag',exact:true}).first().click());
  await sites.same('flagged');
  await sites.goto('/item?id=1');
  await sites.each(page=>page.getByRole('link',{name:'unflag',exact:true}).first().click());
  await sites.same('unflagged');
  await sites.role('erin');await sites.goto('/saved?id=bob');await sites.same('private-saved-denied');
});

test('persistent data and browser cookies survive worker restart',async({sites})=>{
  await sites.role('alice');await sites.goto('/submit');
  await sites.each(page=>submit(page,{t:'Persistent browser post',u:'https://example.test/persistent',x:''}));
  await sites.same('before-restart');
  await sites.restartWorker();
  await sites.goto('/newest');await sites.same('after-restart');
  await sites.each(async page=>expect(page.getByRole('link',{name:'Persistent browser post',exact:true})).toBeVisible());
});

test('invalid IDs, encoded fields and unknown routes match over HTTP',async({sites})=>{
  for(const path of ['/item?id=missing','/item?id=-1','/reply?id=missing','/user?%69d=bob','/user?id=bob=ignored','/unknown-route','/x?fnid=expired']){
    await sites.goto(path);await sites.same(path.replaceAll('/','_'));
  }
});

for(const role of ['bob','erin','alice'])test(`permissions match for ${role}`,async({sites})=>{
  await sites.role(role);
  for(const path of ['/newsadmin','/edit?id=2','/prompt','/repl']){
    await sites.goto(path);await sites.same(role+path.replaceAll('/','_'));
  }
});

test('administrator kill and restore actions match',async({sites})=>{
  await sites.role('alice');await sites.goto('/item?id=1');
  await sites.each(page=>page.getByRole('link',{name:'kill',exact:true}).first().click());
  await sites.same('killed');
  await sites.goto('/item?id=1');
  await sites.each(page=>page.getByRole('link',{name:'unkill',exact:true}).first().click());
  await sites.same('unkilled');
});

test.describe('real clock lifecycle',()=>{
test.use({clockFrozen:false});
test('idle login and signup callbacks survive real typing time',async({sites})=>{
  await sites.goto('/');
  await new Promise(resolve=>setTimeout(resolve,16000));
  await sites.each(page=>page.getByRole('link',{name:'login',exact:true}).click());
  await sites.same('idle-login');
  await sites.each(async page=>{
    const form=page.locator('form').filter({has:page.getByRole('button',{name:'create account',exact:true})});
    await form.locator('[name=u]').fill('patient');await form.locator('[name=p]').fill('patient browser password');
  });
  await new Promise(resolve=>setTimeout(resolve,46000));
  await sites.each(page=>page.getByRole('button',{name:'create account',exact:true}).click());
  await sites.each(async page=>expect(page.getByRole('link',{name:'patient',exact:true})).toBeVisible());
  await sites.each(async page=>expect(await page.content()).not.toContain('Unknown or expired link'));
});
});

test('administrator REPL and saved programs work through original forms',async({sites})=>{
  await sites.role('alice');await sites.goto('/repl');
  await sites.each(page=>submit(page,{expr:'(+ 20 22)'},'submit'));
  await sites.same('repl-result');
  await sites.goto('/prompt');
  await sites.each(page=>submit(page,{app:'browser-program'},'create app'));
  await sites.same('program-editor');
  await sites.each(page=>submit(page,{exprs:'(pr "Browser Arc program 🌍")'},'save'));
  await sites.same('saved-program');
  await sites.goto('/prompt');
  await sites.each(page=>page.getByRole('link',{name:'run',exact:true}).first().click());
  await sites.same('program-output');
});

test('concurrent browser tabs preserve responses and shared account state',async({sites})=>{
  await sites.role('bob');
  const paths=['/','/newest','/item?id=1','/item?id=4','/user?id=bob','/threads?id=bob','/saved?id=bob','/lists'];
  const results=[];
  for(let side=0;side<2;side++)results[side]=await Promise.all(paths.map(async path=>{
    const tab=await sites.pages[side].context().newPage();
    try{const response=await tab.goto(sites.urls[side]+path);return {status:response.status(),html:await response.text()};}
    finally{await tab.close();}
  }));
  const {normalize}=await import('./harness.mjs');
  for(let i=0;i<paths.length;i++){
    expect(results[1][i].status,paths[i]).toBe(results[0][i].status);
    expect(normalize(results[1][i].html),paths[i]).toBe(normalize(results[0][i].html));
  }
});
