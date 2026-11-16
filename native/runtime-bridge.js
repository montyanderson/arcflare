// This bridge is wrapped in the same lexical scope as the vendored VM.
Environment_st.init();
ArcSymbol_st.mkSym('call*').setValue(new Hash().init());
ArcSymbol_st.mkSym('sig').setValue(new Hash().init());
ArcSymbol_st.mkSym('*env*').setValue(new Hash().init());
const symbol=name=>ArcSymbol_st.mkSym(name);
const nil=ArcObject_st.NIL;
function toArc(value) {
  if(value===null || value===undefined || value===false) return nil;
  if(value===true) return ArcObject_st.T;
  if(typeof value==='string') return ArcString_st.make(value);
  if(typeof value==='number') return Number.isInteger(value)?Rational_st.make1(value):new Real().init(value);
  if(Array.isArray(value)) return Pair_st.buildFrom1(value.map(toArc));
  return value;
}
function fromArc(value) {
  if(value===nil) return null;
  if(value===ArcObject_st.T) return true;
  if(value instanceof ArcString) return value.value();
  if(value instanceof ArcNumber) return value.toDouble();
  if(value instanceof ArcSymbol) return value.name();
  if(value instanceof Pair) {const result=[];for(let p=value;p!==nil;p=p.cdr()) result.push(fromArc(p.car()));return result;}
  return value;
}
function bind(name,fn) {
  const f=new Builtin().initBuiltin(name);
  f.invokePair=function(args) {
    const values=[];
    for(let p=args;p!==nil;p=p.cdr()) values.push(fromArc(p.car()));
    return toArc(fn(...values));
  };
}
function bindAsync(name,fn) {
  const f=new Builtin().initBuiltin(name);
  f.invoke=function(vm,args){
    const values=[];
    for(let p=args;p!==nil;p=p.cdr())values.push(fromArc(p.car()));
    const step=new Instruction().initInstruction();
    step.belongsTo(f);step.implementsAsync=true;
    step.operateAsync=function(vm,next){
      Promise.resolve().then(()=>fn(...values)).then(value=>{vm.pushA(toArc(value));next(null);},next);
      return false;
    };
    vm.pushFrame(step);
  };
}
// Workers has no heap-usage API. Zero is an unsupported sentinel, not a measurement.
bind('memory',()=>0);
for (const name of ['current-gc-milliseconds','current-process-milliseconds']) {
  bind(name,()=>{throw new Error(name+' is unavailable in Workers');});
}
bind('timedate',(seconds=Date.now()/1000)=>{
  const d=new Date(seconds*1000);
  return [d.getUTCSeconds(),d.getUTCMinutes(),d.getUTCHours(),d.getUTCDate(),d.getUTCMonth()+1,d.getUTCFullYear()];
});
bind('system',command=>host.system(command));
bind('file-exists',path=>host.read(path)!==undefined?path:null);
bind('dir-exists',path=>host.directoryExists(path)?path:null);
bind('worker-mkdir',path=>host.mkdir(path));
// Arc 3.2 implements @ interpolation in ac.scm. Rainbow delegates it to
// at-string; build the same (string ...) expression without JavaScript eval.
const atString=new Builtin().initBuiltin('at-string');
atString.invokePair=function(args){
  const text=args.car().value();
  const parts=[symbol('string')];
  let literal='';
  const flush=()=>{if(literal){parts.push(Pair_st.buildFrom1([symbol('quote'),toArc(literal)]));literal='';}};
  for(let i=0;i<text.length;){
    if(text[i]!=='@'){literal+=text[i++];continue;}
    if(text[i+1]==='@'){literal+='@';i+=2;continue;}
    flush();
    const stream=host.input(text.slice(i+1));
    let expression;
    ArcParser_st.readObjectAsync(stream,(error,value)=>{if(error)throw error;expression=value;},true);
    if(expression===null || !stream.offset)throw new Error('Missing expression after @');
    parts.push(expression);i+=1+stream.offset;
  }
  flush();
  return Pair_st.buildFrom1(parts);
};
function evaluate(source) {
  return new Promise((resolve,reject)=>{
    try {
      const expression=ArcParser_st.readFirstObjectFromString(source);
      Console_st.compileAndEvalAsync_(new VM().init(),expression,(error,result)=>error?reject(error):resolve(fromArc(result)));
    } catch(error) {reject(error);}
  });
}
function load(source) {
  return new Promise((resolve,reject)=>{
    try {Console_st.loadAsync(new VM().init(),new StringInputPort().init(source).unwrap(),error=>error?reject(error):resolve());}
    catch(error) {reject(error);}
  });
}
return {evaluate,load,bind,bindAsync,set:(name,value)=>symbol(name).setValue(toArc(value)),get:name=>fromArc(symbol(name).value())};
