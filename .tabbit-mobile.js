const out = {};
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));

// 手机视口
await page.setViewportSize({ width: 390, height: 844 });
await page.goto('https://find-moment.netlify.app/signup', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(700);

const email = `mobile-probe-${Date.now()}@example.com`;
await page.fill('#email', email);
await page.getByRole('button', { name: '发送验证码' }).click();
await page.waitForTimeout(5000);

// 是否进到验证码这一步
out.reachedCodeStep = await page.evaluate(() => Boolean(document.querySelector('#token')));

if (!out.reachedCodeStep) {
  out.step1Body = await page.evaluate(() => document.body.innerText.split('\n').filter(Boolean).slice(0, 12));
  await page.screenshot({ path: 'D:/Code/Find/.ui-shots/mobile-step1.png' });
  return out;
}

// 1. 点一下格子区域，看焦点有没有落到那个隐形输入框
const box = await page.evaluate(() => {
  const boxes = document.querySelector('.pointer-events-none.flex');
  if (!boxes) return null;
  const r = boxes.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (box) {
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(300);
}
out.afterTap = await page.evaluate(() => ({
  activeId: document.activeElement?.id ?? null,
  activeTag: document.activeElement?.tagName ?? null,
  inputVisible: (() => {
    const el = document.querySelector('#token');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), fontSize: cs.fontSize, opacity: cs.opacity };
  })(),
}));

// 2. 模拟键盘输入 6 位数字
await page.keyboard.type('123456', { delay: 80 });
await page.waitForTimeout(400);

out.afterTyping = await page.evaluate(() => {
  const input = document.querySelector('#token');
  const boxes = [...document.querySelectorAll('.pointer-events-none.flex > div')].map((d) => d.innerText.trim());
  return {
    inputValue: input?.value ?? null,
    inputLength: input?.value?.length ?? 0,
    格子里的字符: boxes,
  };
});

// 3. 有没有自动提交（会自动提交的话这里已经出现服务端返回的错误）
await page.waitForTimeout(3500);
out.afterAutoSubmit = await page.evaluate(() => {
  const notice = document.querySelector('[role="alert"]');
  return {
    hasError: Boolean(notice),
    errorText: notice?.innerText?.slice(0, 160) ?? null,
    stillOnCodeStep: Boolean(document.querySelector('#token')),
  };
});
await page.screenshot({ path: 'D:/Code/Find/.ui-shots/mobile-code.png' });

out.consoleErrors = errors;
out.testEmail = email;
return out;
