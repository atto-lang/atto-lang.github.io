// Generated-page URL policy unit tests, not browser E2E certification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeUrlAttribute,validatedSiteUrl,htmlAttribute} from './site-url-policy.mjs';

const base='https://ores-truffle-oreslang.github.io/examples/';

test('local links and HTTPS assets survive entity decoding without authority change',()=>{
  assert.equal(validatedSiteUrl('../docs/?a=1&amp;b=2',base,'href').search,'?a=1&b=2');
  for(const attr of ['href','src','poster','action']){
    const url=validatedSiteUrl('/brand/attolang-icon-180.png',base,attr);
    assert.equal(url.origin,'https://ores-truffle-oreslang.github.io');
  }
  assert.equal(decodeUrlAttribute('page&#x2f;index.html'),'page/index.html');
});

test('encoded executable schemes remain denied in all navigational and resource slots',()=>{
  for(const attr of ['href','src','poster','action']){
    for(const raw of [
      '&#x6a;avascript&#x3a;alert(1)',
      'java&Tab;script:alert(1)',
      'data:text/html,<h1>unsafe</h1>'
    ]) assert.throws(()=>validatedSiteUrl(raw,base,attr),/Unsafe|unsupported/,attr+':'+raw);
  }
});

test('attribute reader does not promote non-URL attributes to URL authority',()=>{
  assert.equal(htmlAttribute("<a title='javascript:alert(1)' href='/safe'>",'href'),'/safe');
  assert.equal(htmlAttribute("<a title='javascript:alert(1)'>",'href'),null);
});
