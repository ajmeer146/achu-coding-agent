const fs = require('fs');
let code = fs.readFileSync('test-browser.ts', 'utf8');
const search = '    // H. screenshot succeeds';
const replace = `    // G2. console errors are captured
    if (session.page !== null) {
      await session.page.setContent("<html><script>console.error('Test console error');setTimeout(() => { throw new Error('Test runtime error'); }, 10);</script></html>");
      await new Promise(r => setTimeout(r, 100));
      const errInspect = await session.inspectPage();
      if (errInspect.success && errInspect.info.consoleErrors.includes('Test console error') && errInspect.info.pageErrors.some(e => e.includes('Test runtime error'))) {
        console.log('PASS: G2. console and runtime errors are captured');
        recordPass();
      } else {
        throw new Error('Errors not captured.');
      }
    }

    // G3. block external navigation
    const extSafety = checkActionSafety('navigate', { url: 'https://example.com' });
    if (extSafety.allowed) {
      throw new Error('Safety checker did not block external navigation');
    }
    console.log('PASS: G3. safety checker blocks external navigation');
    recordPass();

    // H. screenshot succeeds`;
code = code.replace(search, replace);
fs.writeFileSync('test-browser.ts', code);
