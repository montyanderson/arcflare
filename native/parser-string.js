// Injected into ArcParser_st by the build. Arc 3.2 uses Scheme string literals;
// Rainbow's #(expr) interpolation is not part of that grammar.
function finishInterpolatedString(parts, then) {
  function read() {
    let done=false,error=null,value=null;
    readChar((e,c)=>{done=true;error=e;value=c;});
    if(!done)throw new Error('Asynchronous reader is unavailable');
    if(error)throw error;
    return value;
  }
  function peek() {
    let value=null;
    peekChar((e,c)=>{if(e)throw e;value=c;});
    return value;
  }
  try {
    let value='';
    while(true){
      const c=read();
      if(c===null)throw new ParseException().init();
      if(c==='"'){then(null,[ArcString_st.make(value)]);return true;}
      if(c!=='\\'){value+=c;continue;}
      const escaped=read();
      const simple={n:'\n',r:'\r',t:'\t',a:'\x07',b:'\b',v:'\v',f:'\f',e:'\x1b','"':'"','\\':'\\'};
      if(Object.hasOwn(simple,escaped)){value+=simple[escaped];continue;}
      if(escaped==='\n')continue;
      if(escaped==='u'||escaped==='U'){
        let hex='';const limit=escaped==='u'?4:8;
        while(hex.length<limit&&peek()!==null&&/^[0-9a-f]$/i.test(peek()))hex+=read();
        if(!hex.length)throw new ParseException().init();
        value+=String.fromCodePoint(parseInt(hex,16));continue;
      }
      if(escaped!==null&&/^[0-7]$/.test(escaped)){
        let oct=escaped;
        while(oct.length<3&&peek()!==null&&/^[0-7]$/.test(peek()))oct+=read();
        value+=String.fromCodePoint(parseInt(oct,8));continue;
      }
      throw new ParseException().init();
    }
  }catch(error){then(error);return true;}
}
