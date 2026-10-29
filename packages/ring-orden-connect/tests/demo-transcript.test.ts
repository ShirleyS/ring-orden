import test from 'node:test';
import assert from 'node:assert/strict';
import { appendDemoTranscript, providerTranscript } from '../src/demo-transcript.ts';

test('live captions distinguish speaker roles and update repeated provider events', () => {
 const user=providerTranscript({source:'user',message:'Un latte, por favor',event_id:4})!;
 const agent=providerTranscript({source:'ai',message:'¿Con qué leche?',event_id:4,response_id:'answer-1'})!;
 let lines=appendDemoTranscript([],user);
 lines=appendDemoTranscript(lines,agent);
 lines=appendDemoTranscript(lines,providerTranscript({source:'ai',message:'¿Con qué tipo de leche?',event_id:5,response_id:'answer-1'})!);
 assert.deepEqual(lines.map(l=>[l.speaker,l.text]),[['user','Un latte, por favor'],['agent','¿Con qué tipo de leche?']]);
});
test('empty or unsupported provider messages do not appear as captions', () => {
 assert.equal(providerTranscript({source:'ai',message:'  ',event_id:1}),null);
 assert.equal(providerTranscript({source:'tool',message:'private tool payload',event_id:2}),null);
});
test('demo captions retain only the latest 100 turns', () => {
 let lines=[] as import('../src/demo-transcript.ts').DemoTranscriptLine[];
 for(let i=0;i<110;i++) lines=appendDemoTranscript(lines,{id:String(i),speaker:'user',text:String(i)});
 assert.equal(lines.length,100);
 assert.equal(lines[0].text,'10');
 assert.equal(lines[99].text,'109');
});
