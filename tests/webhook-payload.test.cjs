"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const net = require('node:net');
const source = fs.readFileSync(require.resolve('../webhook-server.cjs'), 'utf8');
function parser() {
  const context = {net, Buffer};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const KEY_ALIASES ='), source.indexOf('function readBody(')), context);
  vm.runInContext(source.slice(source.indexOf('function decodeBody('), source.indexOf('/* --------------------------------------------------------------- helpers */')), context);
  return context;
}
test('Multipart webhook keeps a case-sensitive boundary and reads Vietnamese customer fields', () => {
  const p = parser();
  const boundary = '----WebKitFormBoundaryAbC123';
  const body = [['H\u1ecd v\u00e0 t\u00ean', 'Kh\u00e1ch m\u1edbi'], ['S\u1ed1 \u0111i\u1ec7n tho\u1ea1i', '0912345678']]
    .map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
    .join('') + `--${boundary}--\r\n`;
  const type = p.contentTypeOf({headers:{'content-type':`Multipart/Form-Data; boundary="${boundary}"; charset=UTF-8`}});
  const result = p.adaptLadiPagePayload(p.decodeBody(Buffer.from(body), type));
  assert.equal(result.ok, true);
  assert.equal(result.record.name, 'Kh\u00e1ch m\u1edbi');
  assert.equal(result.record.phone, '0912345678');
});
test('JSON and URL encoded webhook fields are still decoded with a case-insensitive media type', () => {
  const p = parser();
  for (const [contentType, body] of [
    ['Application/JSON; Charset=UTF-8', JSON.stringify({name:'Test',phone:'0912345678'})],
    ['Application/X-WWW-Form-Urlencoded', 'name=Test&phone=0912345678']
  ]) {
    const result = p.adaptLadiPagePayload(p.decodeBody(Buffer.from(body), p.contentTypeOf({headers:{'content-type':contentType}})));
    assert.equal(result.ok, true);
    assert.equal(result.record.phone, '0912345678');
  }
});
