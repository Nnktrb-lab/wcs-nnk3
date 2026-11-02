const { chromium } = require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:process.env.HOME+'/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome'});
const p=await b.newPage({viewport:{width:390,height:844}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file:///home/user/workspace/sla/site/sudoku-learning-academy.html');await p.waitForTimeout(2500);
await p.click('.nav button[data-view="chat"]');await p.waitForTimeout(500);
console.log(await p.textContent('#dmGate'), await p.isVisible('#dmFind'), errs);await p.screenshot({path:'/home/user/workspace/qa/dm-offline-m.png'});await b.close();})();
