import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SqlFiles} from '../storage.js';

function storage(){
  const db=new DatabaseSync(':memory:');
  return {db,sql:{exec(sql,...params){const rows=db.prepare(sql).all(...params);return {toArray:()=>rows};}},transactionSync(fn){
    db.exec('BEGIN');try {fn();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }};
}

test('SQLite files preserve empty files and unicode at chunk boundaries across reopening',()=>{
  const backing=storage();try{
    let files=new SqlFiles(backing);const content='x'.repeat(65535)+'🌍'+'é'.repeat(131072);
    files.set('arc/unicode',content);files.set('arc/empty','');files.commit();
    files=new SqlFiles(backing);
    assert.equal(files.get('arc/unicode'),content);assert.equal(files.get('arc/empty'),'');assert.equal(files.get('arc/missing'),undefined);
    assert.ok(backing.sql.exec('SELECT * FROM arc_file_parts WHERE path=?','arc/unicode').toArray().length>1);
    files.set('arc/unicode','short');files.commit();assert.equal(files.get('arc/unicode'),'short');
    assert.equal(backing.sql.exec('SELECT * FROM arc_file_parts WHERE path=?','arc/unicode').toArray().length,1);
  }finally{backing.db.close();}
});
test('staged file mutations commit together and rollback restores previous data',()=>{
  const backing=storage();try{
    const files=new SqlFiles(backing);files.set('arc/a','a');files.set('arc/b','b');files.commit();
    files.delete('arc/a');files.set('arc/b','updated');assert.equal(files.get('arc/a'),undefined);
    files.rollback();assert.equal(files.get('arc/a'),'a');assert.equal(files.get('arc/b'),'b');
    files.delete('arc/a');files.commit();assert.deepEqual([...files.keys()],['arc/b']);
    assert.throws(()=>files.set('news.arc','bad'),/forbidden/);
  }finally{backing.db.close();}
});
