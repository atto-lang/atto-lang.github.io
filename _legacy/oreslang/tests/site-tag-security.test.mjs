import test from "node:test";
import assert from "node:assert/strict";
import { htmlAttribute, siteTags, validatedSiteUrl } from "./site-url-policy.mjs";

const base="https://ores-truffle-oreslang.github.io/examples/";

test("quoted lookalike attributes never shadow real unsafe href/src values",()=>{
  const cases=[
    ['<a data-note=" href=/safe/" href="javascript:alert(1)">',"href","javascript:alert(1)"],
    ["<a title=' href=/safe/ ' href='&#106;avascript:alert(1)'>","href","&#106;avascript:alert(1)"],
    ['<a data-note="src=/safe/" href="data:text/html,evil">',"href","data:text/html,evil"],
    ['<img data-note=" src=/safe/" src="javascript:alert(1)">',"src","javascript:alert(1)"],
    ["<script data-note=' src=/safe/ ' src='data:text/javascript,evil'>","src","data:text/javascript,evil"],
    ['<link data-test=" href=/safe/" href="javascript:alert(1)">',"href","javascript:alert(1)"],
    ['<source data-test=" src=/safe/" src="javascript:alert(1)">',"src","javascript:alert(1)"]
  ];
  for(const [tag,attribute,expected] of cases) {
    assert.equal(htmlAttribute(tag,attribute),expected,tag);
    assert.throws(()=>validatedSiteUrl(htmlAttribute(tag,attribute),base,attribute),
      /Unsafe|unsupported/u,tag);
  }
});

test("full tag scan cannot be truncated by > inside unrelated quoted attributes",()=>{
  const html=[
    '<a title="first > second" href="javascript:alert(1)">Unsafe link</a>',
    "<img alt='image > label' src='javascript:alert(1)'>",
    '<a title="<a href=/fake/>" href="/real/">safe</a>',
    '<source data-info=">)" src="/brand/attolang-icon-180.png">',
    '<script data-note="> inside quoted" src="data:text/javascript,alert(1)"></script>'
  ].join("\n");
  const tags=[...siteTags(html)];
  assert.equal(tags.length,5,"quoted '<a' must not manufacture a sixth tag");
  assert.equal(htmlAttribute(tags[0],"href"),"javascript:alert(1)");
  assert.equal(htmlAttribute(tags[1],"src"),"javascript:alert(1)");
  assert.equal(htmlAttribute(tags[2],"href"),"/real/");
  assert.equal(htmlAttribute(tags[3],"src"),"/brand/attolang-icon-180.png");
  assert.equal(htmlAttribute(tags[4],"src"),"data:text/javascript,alert(1)");
  const rejected=tags.filter(tag=>{
    for(const field of ["href","src"]){
      const value=htmlAttribute(tag,field);
      if(!value)continue;
      try{validatedSiteUrl(value,base,field);}catch{return true;}
    }
    return false;
  });
  assert.equal(rejected.length,3);
});

test("reader keeps first duplicate value as browser HTML parser does",()=>{
  const cases=[
    ['<a href="/first/" href="javascript:alert(1)">',"/first/"],
    ['<a HREF="javascript:alert(1)" href="/safe/">',"javascript:alert(1)"],
    ["<a href='/one/' HREF=/two/>","/one/"],
    ["<a href = /hello/ data-href=/other/>","/hello/"],
    ['<a href="/&amp;?q=1" title=" href=javascript:evil ">',"/&amp;?q=1"],
    ['<a data-x="" href="">',""]
  ];
  for(const [tag,expected] of cases)assert.equal(htmlAttribute(tag,"href"),expected,tag);
});

test("quoted whitespace and angle brackets do not create fictitious attributes",()=>{
  for(const tag of [
    '<a title=" href=javascript:alert(1) ">',
    "<img alt='src=javascript:alert(1) >'>",
    '<link data-info="><a href=javascript:alert(1)>">',
    '<source data-info="src=javascript:alert(1)">'
  ]) {
    assert.equal(htmlAttribute(tag,"href"),null,tag);
    assert.equal(htmlAttribute(tag,"src"),null,tag);
  }
});

test("malformed quoted tags fail closed before link policy can be bypassed",()=>{
  for(const html of [
    '<a title="unfinished href=javascript:alert(1)>',
    "<img alt='unfinished src=javascript:alert(1)>",
    '<script data-note="unfinished src=data:text/javascript,evil>'
  ]) {
    assert.throws(()=>[...siteTags(html)],/Unterminated/u,html);
  }
  assert.throws(()=>[...siteTags('<a title="ok" <img src="/safe/">')],/Malformed/u);
  assert.throws(()=>htmlAttribute('<a href="unfinished',"href"),/Unterminated/u);
});

test("case folding, unquoted values and entity-encoded schemes stay enforced",()=>{
  const tags=[
    '<A DATA-COMMENT=" href=/safe/" HrEf=&#106;avascript:alert(1)>',
    '<IMG DATA-COMMENT="src=/safe/" SrC=javascript:alert(1)>',
    "<a data-note=' href=/ok/' HREF='javascript&colon;alert(1)'>"
  ];
  for(const [index,tag] of tags.entries()) {
    const value=htmlAttribute(tag,index===1?"src":"href");
    assert.ok(value,"unsafe actual URL must be found");
    assert.throws(()=>validatedSiteUrl(value,base,index===1?"src":"href"),/Unsafe/u);
  }
});
