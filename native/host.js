export function input(text) {
  const bytes=text instanceof Uint8Array?text:new TextEncoder().encode(text),decoder=new TextDecoder();
  let position=0;
  function character(){
    if(position>=bytes.length)return null;
    const first=bytes[position],size=first<128?1:first<224?2:first<240?3:4;
    return {code:decoder.decode(bytes.subarray(position,position+size)).codePointAt(0),size};
  }
  return {
    get offset(){return decoder.decode(bytes.subarray(0,position)).length;},
    readCharCodeAsync(next){const char=character();if(char)position+=char.size;next(null,char?.code??null);return true;},
    peekCharCodeAsync(next){next(null,character()?.code??null);return true;},
    readByteAsync(next){next(null,position<bytes.length?bytes[position++]:null);return true;},
    close(){}
  };
}
export function output(){
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  let chunks=[],length=0;
  return {
    writeString(text){const bytes=encoder.encode(text);chunks.push(bytes);length+=bytes.length;},
    writeByte(byte){if(!Number.isInteger(byte)||byte<0||byte>255)throw new Error('Expected a byte');chunks.push(Uint8Array.of(byte));length++;},
    bytes(){const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}chunks=[bytes];return bytes;},
    value(){return decoder.decode(this.bytes());},
    close(){},flush(){}
  };
}
export function makeHost(sources,storage=new Map()) {
  let consoleOutput='';
  const normalize=path=>path.replace(/^\.\//,'').replace(/\/$/,'');
  const dirs=new Set(['','arc','arc/logs','arc/news','arc/news/story','arc/news/profile','arc/news/vote','static']);
  const read=path=>{const key=normalize(path);return storage.get(key)??(Object.hasOwn(sources,key)?sources[key]:undefined);};
  const write=(path,value)=>storage.set(normalize(path),value);
  const sink={writeString(s){consoleOutput+=s;},writeByte(n){consoleOutput+=String.fromCharCode(n);},close(){},flush(){}};
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
        const port=output();if(append)port.writeString(read(path)||'');
        write(path,port.value());
        return {writeString(s){port.writeString(s);write(path,port.value());},writeByte(n){port.writeByte(n);write(path,port.value());},close(){},flush(){}};
      }),
      dirAsync:operation(path=>{
        const prefix=normalize(path)+'/';
        return [...new Set([...Object.keys(sources),...storage.keys()].filter(p=>p.startsWith(prefix)).map(p=>p.slice(prefix.length).split('/')[0]))].sort();
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
    input,output,read,write,storage,directoryExists:path=>dirs.has(normalize(path)),
    takeOutput(){const result=consoleOutput;consoleOutput='';return result;}
  };
  return host;
}
