export function input(text) {
  let offset=0;
  return {
    get offset(){return offset;},
    readCharCodeAsync(next){next(null,offset<text.length?text.charCodeAt(offset++):null);return true;},
    peekCharCodeAsync(next){next(null,offset<text.length?text.charCodeAt(offset):null);return true;},
    readByteAsync(next){next(null,offset<text.length?text.charCodeAt(offset++):null);return true;},
    close(){}
  };
}
export function makeHost(sources,storage=new Map()) {
  let output='';
  const normalize=path=>path.replace(/^\.\//,'').replace(/\/$/,'');
  const dirs=new Set(['','arc','arc/logs','arc/news','arc/news/story','arc/news/profile','arc/news/vote','static']);
  const read=path=>storage.get(normalize(path))??sources[normalize(path)];
  const write=(path,value)=>storage.set(normalize(path),value);
  const sink={writeString(s){output+=s;},writeByte(n){output+=String.fromCharCode(n);},close(){},flush(){}};
  const operation=fn=>(...args)=>{const callback=args.findLast(x=>typeof x==='function');try{callback(null,fn(...args));}catch(e){callback(e);}return true;};
  const host={
    System_in:input(''),System_out:sink,System_err:sink,
    System_fs:{
      fileExistsAsync:operation(path=>read(path)!==undefined),
      dirExistsAsync:operation(path=>dirs.has(normalize(path))),
      inFileAsync:operation(path=>{
        if(path==='/dev/urandom') return {readByteAsync(next){next(null,crypto.getRandomValues(new Uint8Array(1))[0]);return true;},close(){}};
        const value=read(path);if(value===undefined)throw new Error('Missing file: '+path);return input(value);
      }),
      outFileAsync:operation((path,append)=>{
        let data=append?(read(path)||''):'';
        write(path,data);
        return {writeString(s){data+=s;write(path,data);},writeByte(n){data+=String.fromCharCode(n);write(path,data);},close(){},flush(){}};
      }),
      dirAsync:operation(path=>{
        const prefix=normalize(path)+'/';
        return [...new Set([...Object.keys(sources),...storage.keys()].filter(p=>p.startsWith(prefix)).map(p=>p.slice(prefix.length).split('/')[0]))];
      }),
      makeDirectoryAsync:operation(path=>{dirs.add(normalize(path));return true;}),
      makeDirectoriesAsync:operation(path=>{dirs.add(normalize(path));return true;}),
      mvFileAsync:operation((from,to)=>{const data=read(from);if(data===undefined)throw new Error('Missing file: '+from);write(to,data);storage.delete(normalize(from));}),
      rmFileAsync:operation(path=>storage.delete(normalize(path)))
    },
    system(command) {
      if(command.startsWith('mkdir -p ')){dirs.add(normalize(command.slice(9)));return true;}
      if(command==='rm arc/news/story/*.tmp'){for(const key of storage.keys())if(key.startsWith('arc/news/story/')&&key.endsWith('.tmp'))storage.delete(key);return true;}
      throw new Error('Unsupported process operation: '+command);
    },
    mkdir(path){dirs.add(normalize(path));return true;},
    input,read,write,storage,directoryExists:path=>dirs.has(normalize(path)),
    takeOutput(){const result=output;output='';return result;}
  };
  return host;
}
