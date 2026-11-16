// Map-shaped virtual filesystem backed by a Durable Object's synchronous SQL.
// A request stages writes, then commits all modified Arc files in one transaction.
export class SqlFiles {
  constructor(storage){
    this.storage=storage;this.sql=storage.sql;this.pending=new Map();
    this.sql.exec('CREATE TABLE IF NOT EXISTS arc_file_parts(path TEXT NOT NULL, part INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(path, part))');
  }
  get(path){
    if(this.pending.has(path))return this.pending.get(path)??undefined;
    const rows=this.sql.exec('SELECT content FROM arc_file_parts WHERE path=? ORDER BY part',path).toArray();
    return rows.length?rows.map(row=>row.content).join(''):undefined;
  }
  set(path,value){
    if(!path.startsWith('arc/'))throw new Error('Writing outside the Arc data directory is forbidden');
    this.pending.set(path,value);return this;
  }
  delete(path){this.pending.set(path,null);return true;}
  keys(){
    const keys=new Set(this.sql.exec('SELECT DISTINCT path FROM arc_file_parts').toArray().map(r=>r.path));
    for(const [key,value] of this.pending)value===null?keys.delete(key):keys.add(key);
    return keys.keys();
  }
  commit(){
    this.storage.transactionSync(()=>{
      for(const [path,value]of this.pending){
        this.sql.exec('DELETE FROM arc_file_parts WHERE path=?',path);
        // Chunk files below SQLite's row limit without splitting surrogate pairs.
        if(value!==null){
          let offset=0,part=0;
          do {
            let end=Math.min(offset+65536,value.length);
            if(end<value.length&&value.charCodeAt(end-1)>=0xd800&&value.charCodeAt(end-1)<=0xdbff)end--;
            this.sql.exec('INSERT INTO arc_file_parts(path,part,content) VALUES (?,?,?)',path,part++,value.slice(offset,end));
            offset=end;
          } while(offset<value.length);
        }
      }
    });
    this.pending.clear();
  }
  rollback(){this.pending.clear();}
}
