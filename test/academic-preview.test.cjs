'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {academicPreview}=require('../src/speech-plan.cjs');
test('editor samples use the actual Markdown plan with the current academic settings',()=>{
  const a=academicPreview({}),b=academicPreview({academicFunctionStyle:'compact',academicIntervalStyle:'range',academicTableRepeatHeaders:false});
  assert.equal(a.length,3);b.forEach(([label,text],i)=>{assert.equal(label,a[i][0]);assert.notEqual(text,a[i][1]);});
  assert.match(a[0][1],/f of x/);assert.doesNotMatch(b[0][1],/ of /);
});
