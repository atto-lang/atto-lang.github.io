import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PUBLICATION_ASSETS} from './package-playground.mjs';
const read = name => readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const html=read('comparisons/index.html'), css=read('comparisons/comparisons.css');
const profile=JSON.parse(read('play/example-backend-profile.json'));
test('canonical comparator is discoverable and static',()=>{
  assert.match(read('index.html'),/href="\.\/comparisons\/">Compare languages/);
  assert.match(html,/rel="canonical" href="https:\/\/atto-lang\.github\.io\/comparisons\/"/);
  assert.match(html,/default-src 'none'/);
  assert.doesNotMatch(html,/<script\b|<iframe\b|<object\b|<embed\b|<[^>]+\bon[a-z]+\s*=|javascript\s*:/i);
  assert.doesNotMatch(css,/@import\b|url\s*\(/i);
  for(const name of ['comparisons/index.html','comparisons/comparisons.css'])assert.ok(PUBLICATION_ASSETS.includes(name));
});
test('preserves legacy language and architecture coverage with accessible grids',()=>{
  for(const name of ["Elixir","Erlang","Gleam","Rust","Java","C++","Go","Node.js","C#","OCaml"])assert.ok(html.includes(name),name);
  for(const id of ["type-system","hot-reload","build-system","borrow-checking","memory-safety","garbage-collection","compressed-addressing","soft-real-time","hard-real-time","aot-jit","native-single-binaries","target-architectures","lambdas","mobile-phones","desktop-apps","actor-system","functional-programming","adts","data-oriented","data-oriented-design","gpus","distributed","carrier-grade-linux","embedded-systems","fpga-asic","websockets","rtc-signaling","top-five","stack-traces","high-load-performance","concurrency-model","nonblocking-io","ffi-abi","packages-modules"])assert.ok(html.includes('id="'+id+'"'),id);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const m of html.matchAll(/href="#([^"]+)"/g))assert.ok(ids.includes(m[1]),m[1]);
  assert.equal((html.match(/<table class="compare-table/g)||[]).length,2);
  assert.equal((html.match(/tabindex="0" role="region"/g)||[]).length,2);
  assert.match(html,/<th scope="row">/);
  assert.match(html,/<th scope="col">/);
});
test('each browser-evidence row links to an admitted fixture and no other row implies execution',()=>{
  const matrix=html.slice(html.indexOf('<table class="compare-table detail-grid"'),html.indexOf('</table>',html.indexOf('<table class="compare-table detail-grid"')));
  const rows=[...matrix.matchAll(/<tr id="([^"]+)">([\s\S]*?)<\/tr>/g)];
  assert.equal(rows.length,40);
  for(const [,id,row] of rows){
    const statuses=[...row.matchAll(/data-status="(browser|design|research)"/g)];
    assert.equal(statuses.length,1,id);
    const links=[...row.matchAll(/href="\.\.\/play\/\?example=preview\/([^"&]+)&amp;run=1"/g)];
    if(statuses[0][1]==='browser'){
      assert.equal(links.length,1,id);
      assert.ok(profile.preview.some(p=>p.name===links[0][1]&&p.expect==='exec'),id);
    }else assert.equal(links.length,0,id);
  }
  assert.match(html,/not a fresh execution/);
  assert.match(html,/No speedup, zero-runtime-exception/);
});
