const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../webhook-server.cjs'), 'utf8');

test('Webhook stamps use Vietnam time even when the host timezone is UTC', () => {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) { super(args.length ? args[0] : '2026-10-16T17:05:00.000Z'); }
    static now() { return new RealDate('2026-10-16T17:05:00.000Z').getTime(); }
  }
  const context = { Date: FixedDate, Intl };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function stamp()'), source.indexOf('async function notificationWebsiteForSlug')), context);
  assert.equal(context.stamp(), '2026-10-17 00:05');
});
