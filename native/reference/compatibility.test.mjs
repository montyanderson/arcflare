import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createNews} from '../engine.js';
import {createReference} from './client.mjs';

let original,port;
import {setup} from './fixture.mjs';

before(async()=>{
  try {
    original=await createReference();port=await createNews(new Map());
    const evaluate=port.runtime.evaluate;
    port.runtime.evaluate=async source=>{try{return await evaluate(source);}catch(error){throw new Error(String(error.message||error).slice(0,1000));}};
    await original.evaluate(setup);await port.runtime.evaluate(setup);
  }catch(error){throw new Error(String(error.message||error).slice(0,2000));}
});
after(async()=>{if(original)await original.close();});

const normalize=s=>s.replace(/fnid=[A-Za-z0-9]+/g,'fnid=CALLBACK')
  .replace(/%66%6e%69%64%3d(?:%[0-9a-f]{2}){10}/gi,'%66%6e%69%64%3dCALLBACK')
  .replace(/name="fnid" value="[A-Za-z0-9]+"/g,'name="fnid" value="CALLBACK"');
function same(actual,expected,label){
  if(actual===expected)return;
  let offset=0;while(offset<actual.length&&actual[offset]===expected[offset])offset++;
  assert.fail(`${label}: first difference at ${offset}\noriginal: ${JSON.stringify(expected.slice(Math.max(0,offset-60),offset+180))}\nworker:   ${JSON.stringify(actual.slice(Math.max(0,offset-60),offset+180))}`);
}

test('primitive and library results match official ac.scm',async t=>{
  for(const expression of [
    '(exact nil)','(exact "abc")','(exact \'abc)','(exact 1)','(exact 1.0)','(exact 1/2)',
    '(trunc -1.9)','(trunc 1.9)','(/ -1 2)','(/ 1 -2)','(mod -5 3)','(mod 5 -3)',
    '(round -1.5)','(round 2.5)','(coerce 2.5 \'int)',
    '(urldecode "%41")','(urldecode "%C3%A9")','(urldecode "%F0%9F%8C%8D")',
    '(tostring (writeb 65))','(readb (instring "A"))',
    '(parseargs "x=a=b&empty=&%78=yes&dup=one&dup=two")',
    '(safe-item "abc")','(safe-item "363/blank.php")','(safe-item "-1")',
    '(timedate 0)','(plural 2 "point")','(markdown "hello *world* https://example.org")',
    '(frontpage-rank (item 1))','(sitename "https://www.example.co.uk/a")',
    '(let s "hi" (= (s 0) #\\b) s)',
    '(let s "hi" (is s (coerce s \'string)))',
    '(len "a🌍é")','(string ("a🌍" 1))','(coerce "é🌍" \'cons)',
    '(coerce (coerce "a🌍" \'cons) \'string)',
    '(read "\\"#(literal)\\"")','(read "\\"\\\\U0001F30D\\"")',
    '(len (coerce (newstring 70000 #\\x) \'cons))',
    '(errsafe ("x" -1))','(errsafe ("x" 1))',
    '(sort < \'("Z" "a" "é" "A"))',
    '(shash "reference password")',
    '1.0','-0.0','1e-8','1e15','1e10','0.0001','1.234e15',
    '(/ 0 2.0)','(* 0 2.0)','(* 0 +inf.0)','(/ 0 0.0)'
  ])await t.test(expression,async()=>{
    const wrapped=`(tostring (write ${expression}))`;
    same(await port.runtime.evaluate(wrapped),await original.evaluate(wrapped),expression);
  });
});

test('all named page handlers match official Scheme output for each role',async t=>{
  const routes=await port.runtime.evaluate('(sort < (map string (keys srvops*)))');
  assert.equal(routes.length,54,'Every official registered handler must be covered');
  for(const role of [null,'bob','erin','alice']){
    for(const path of [...routes.filter(path=>path!=='logout'),'logout']){
      await t.test(`${role||'anonymous'} /${path}`,async()=>{
        const id=['item','edit','reply'].includes(path)?'1':'alice';
        const args=[['id',id],['whence','news']];
        const cookies=role?[['user',role+'cookie']]:[];
        const expr=`(tostring (respond (stdout) '${path||'||'} '${JSON.stringify(args).replaceAll('[','(').replaceAll(']',')').replaceAll(',',' ')} '${JSON.stringify(cookies).replaceAll('[','(').replaceAll(']',')').replaceAll(',',' ')} "127.0.0.1"))`;
        await original.evaluate('(do (++ requests*) (++ (requests/ip* "127.0.0.1" 0)))');
        const expected=await original.evaluate(expr);
        const actual=await port.handle({path,args,cookies});
        same(normalize(actual),normalize(expected),`${role||'anonymous'} /${path}`);
      });
    }
  }
});
