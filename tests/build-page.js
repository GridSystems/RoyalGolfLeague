// Builds a test page: index.html + an error trap in <head> + the test script before </body>.
// Usage: node build-page.js <index.html> <test.js> <data.json|""> <out.html>
const fs = require('fs');
const [app, test, data, out] = process.argv.slice(2);
let page = fs.readFileSync(app, 'utf8');
let script = fs.readFileSync(test, 'utf8');
if (data) script = 'window.__DATA=' + fs.readFileSync(data, 'utf8') + ';\n' + script;
page = page.replace('<head>', () => '<head><script>window.addEventListener("error",e=>{document.title="ERR "+e.message+" @line "+e.lineno})</script>');
const i = page.lastIndexOf('</body>');
fs.writeFileSync(out, page.slice(0, i) + '<script>' + script + '</script>' + page.slice(i), 'utf8');
