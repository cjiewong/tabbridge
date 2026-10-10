import { writeFile } from 'node:fs/promises';
import { request } from './client.mjs';
import { setup, doctor, uninstall } from './setup.mjs';
import { nativeHost } from './native.mjs';
import { mcp } from './mcp.mjs';
import { METHODS, VERSION, fault } from './protocol.mjs';
import { tools } from './tools.mjs';

const HELP = `TabBridge ${VERSION} — local Chrome automation for CLI agents

  tabbridge setup [--browser chrome|chromium|testing|edge]
  tabbridge doctor
  tabbridge mcp [--session NAME]
  tabbridge tools
  tabbridge status | tabs
  tabbridge open URL [--session NAME]
  tabbridge claim|release|close|snapshot|reload|back|forward TAB
  tabbridge activate TAB [--json '{"waitForText":"Expected content","timeoutMs":8000}']
  tabbridge navigate TAB URL
  tabbridge click TAB REF
  tabbridge hover TAB REF
  tabbridge drag TAB SOURCE_REF TARGET_REF
  tabbridge read TAB [--json '{"maxChars":12000}']
  tabbridge fill TAB REF TEXT
  tabbridge upload TAB REF [ABSOLUTE_FILE ...]
  tabbridge select TAB REF VALUE
  tabbridge press TAB Enter|Control+A|Shift+Tab
  tabbridge wait TAB TEXT
  tabbridge scroll TAB [--json '{"deltaY":600}']
  tabbridge screenshot TAB --out screenshot.png [--full-page]
  tabbridge network TAB [--json '{"action":"start"}']
  tabbridge evaluate TAB EXPRESSION
  tabbridge batch TAB --json '{"steps":[...]}'
  tabbridge uninstall

All browser commands accept --session NAME and --json OBJECT.
Default CLI session: default. Use separate names for concurrent tasks.
Share and claim individual tabs, or enable All web tabs in the extension for
automatic claiming. Get fresh snapshot refs before acting. A timed-out write
has an unknown outcome and must not be replayed.
See README.md and docs/SECURITY.md before enabling developer evaluation.
`;
export async function main(argv) {
  const command = argv.shift();
  if (command === 'native-host') return nativeHost(argv[0]);
  const options = {}; const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (['--session', '--json', '--out', '--browser', '--manifest-dir'].includes(argv[i])) {
      if (argv[i + 1] === undefined) throw fault('USAGE', `Missing value for ${argv[i]}`);
      options[argv[i].slice(2)] = argv[++i];
    } else if (argv[i] === '--diff') options.diff = true;
    else if (argv[i] === '--full-page') options.fullPage = true;
    else if (argv[i].startsWith('--')) throw fault('USAGE', `Unknown option ${argv[i]}`);
    else args.push(argv[i]);
  }
  const print = result => process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!command || ['help', '--help', '-h'].includes(command)) { process.stdout.write(HELP); return; }
  if (['--version', 'version'].includes(command)) { console.log(VERSION); return; }
  if (command === 'setup') return print(await setup({ browser: options.browser, manifestDir: options['manifest-dir'] }));
  if (command === 'doctor') { const result = await doctor(); print(result); if (!result.ok) process.exitCode = 1; return; }
  if (command === 'uninstall') return print(await uninstall());
  if (command === 'tools') return print(tools);
  if (command === 'mcp') return mcp({ session: options.session });
  if (!METHODS.has(command)) throw fault('USAGE', `Unknown command ${command}. Run tabbridge help`);
  let params = options.json ? JSON.parse(options.json) : {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw fault('USAGE', '--json must be an object');
  if (command === 'open') params = { ...params, ...(args[0] ? { url: args[0] } : {}) };
  else if (!['tabs', 'status'].includes(command)) {
    if (args[0] !== undefined) params.tabId = Number(args[0]);
    if (['click', 'hover', 'upload', 'fill', 'select'].includes(command) && args[1]) params.ref = args[1];
    if (command === 'drag') { if (args[1]) params.sourceRef = args[1]; if (args[2]) params.targetRef = args[2]; }
    if (command === 'upload' && args.length > 2) params.files = args.slice(2);
    if (command === 'fill' && args[2] !== undefined) params.text = args[2];
    if (command === 'select' && args[2] !== undefined) params.value = args[2];
    if (command === 'navigate' && args[1]) params.url = args[1];
    if (command === 'press' && args[1]) params.key = args[1];
    if (command === 'wait' && args[1]) params.text = args[1];
    if (command === 'evaluate' && args[1]) params.expression = args[1];
    if (options.diff) params.diff = true;
    if (command === 'screenshot' && options.fullPage) params.fullPage = true;
  }
  if (command === 'screenshot' && !options.out) throw fault('USAGE', 'Use --out PATH to save the screenshot');
  const result = await request(command, params, { session: options.session });
  if (command === 'screenshot') {
    await writeFile(options.out, Buffer.from(result.data, 'base64'), { mode: 0o600 }); print({ saved: options.out, mimeType: result.mimeType });
  } else { print(result); if (result?.failed) process.exitCode = 1; }
}
