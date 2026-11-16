// Compatibility corrections verified against the official ac.scm runtime.
// This file runs in the VM's lexical scope immediately after Environment.init.
Pair_st.buildFrom2=function(items,last){
  if(items)for(let i=items.length-1;i>=0;i--)last=new Pair().init2(items[i],last);
  return last;
};
const exactBuiltin=new Builtin().initBuiltin('exact');
exactBuiltin.invokePair=function(args){
  const value=args.car();
  return Truth_st.valueOf(value instanceof Rational&&value.isInteger());
};
const truncBuiltin=new Builtin().initBuiltin('trunc');
truncBuiltin.invokePair=function(args){
  return Rational_st.make1(Math.trunc(ArcNumber_st.cast(args.car(),this).toDouble()));
};
Rational.prototype.gcd_=function(a,b){
  if(!Number.isFinite(a)||!Number.isFinite(b))throw new Error('Non-finite rational');
  a=Math.abs(a);b=Math.abs(b);
  while(b!==0){const next=a%b;a=b;b=next;}
  return a;
};
const rationalInit=Rational.prototype.init;
Rational.prototype.init=function(numerator,denominator){
  rationalInit.call(this,numerator,denominator);
  if(this.denominator_<0){this.numerator_=-this.numerator_;this.denominator_=-this.denominator_;}
  if(this.numerator_===0)this.numerator_=0;
  return this;
};
Rational.prototype.mod=function(other){
  if(!this.isInteger()||!other.isInteger()||other.toInt()===0)throw new Error('Invalid modulo operands');
  const a=this.toInt(),b=other.toInt();
  return Rational_st.make1(a-Math.floor(a/b)*b);
};
const doubleDivide=Maths_st.doubleOps_.divide;
Maths_st.doubleOps_.divide=function(args){
  const result=doubleDivide.call(this,args),first=args.car();
  return first instanceof Rational&&first.numerator_===0&&args.cdr()!==ArcObject_st.NIL?Rational_st.ZERO:result;
};
Real.prototype.multiplyNumber=function(other){
  if(other instanceof Rational&&other.numerator_===0)return Rational_st.ZERO;
  return Real_st.make(this.value_*other.toDouble());
};
const realString=Real.prototype.toString;
Real.prototype.toString=function(){
  const value=this.value_,absolute=Math.abs(value);
  if(!Number.isFinite(value))return realString.call(this);
  if(Object.is(value,-0))return '-0.0';
  let result=absolute!==0&&(absolute<0.0001||absolute>=1e15)?value.toExponential():String(value);
  if(result.includes('e'))return result.replace(/e([+-])(\d)$/,(_,sign,digit)=>'e'+sign+'0'+digit);
  return result.includes('.')?result:result+'.0';
};

StringInputPort.prototype.init=function(text){return this.initInput(host.input(text));};
StringOutputPort.prototype.init=function(){
  this.workerOutput_=host.output();
  return this.initOutput(this.workerOutput_);
};
StringOutputPort.prototype.value=function(){return ArcString_st.make(this.workerOutput_.value());};
Output.prototype.writeChar=function(character){this.out_.writeString(String.fromCodePoint(character.value()));};
ArcCharacter.prototype.disp=function(){return String.fromCodePoint(this.value_);};
ArcCharacter.prototype.toString=function(){
  return this.value_>65535?'#\\U'+this.value_.toString(16).toUpperCase().padStart(8,'0'):'#\\'+this.disp();
};
function characters(string){
  if(string.workerCharsValue_!==string.value_){string.workerChars_=Array.from(string.value_);string.workerCharsValue_=string.value_;}
  return string.workerChars_;
}
ArcString.prototype.len=function(){return characters(this).length;};
ArcString.prototype.invoke=function(vm,args){
  const index=Rational_st.cast(args.car(),this),chars=characters(this);
  const i=index.toInt();
  if(!index.isInteger()||i<0||i>=chars.length)throw new Error('String index out of range');
  vm.pushA(ArcCharacter_st.makeFromCharCode(chars[i].codePointAt(0)));
};
ArcString.prototype.srefChar=function(index,value){
  const chars=characters(this).slice(),i=index.toInt();
  if(!index.isInteger()||i<0||i>=chars.length)throw new Error('String index out of range');
  chars[i]=String.fromCodePoint(value.value());this.value_=chars.join('');
};
ArcString.prototype.scar=function(character){this.srefChar(Rational_st.make1(0),character);return character;};
ArcString.prototype.compareTo=function(other){
  const a=characters(this),b=characters(ArcString_st.cast(other,this));
  for(let i=0;i<Math.min(a.length,b.length);i++){const diff=a[i].codePointAt(0)-b[i].codePointAt(0);if(diff)return diff;}
  return a.length-b.length;
};
ArcString.prototype.escape_=function(value){
  let result='"';
  const escapes={'"':'\\"','\\':'\\\\','\n':'\\n','\r':'\\r','\t':'\\t','\b':'\\b','\f':'\\f','\v':'\\v','\x07':'\\a','\x1b':'\\e'};
  for(const char of value){
    const code=char.codePointAt(0);
    result+=escapes[char]??(code>65535?'\\U'+code.toString(16).toUpperCase().padStart(8,'0'):
      code<32||code===127?'\\u'+code.toString(16).toUpperCase().padStart(4,'0'):char);
  }
  return result+'"';
};
Typing_st.CONS.addCoercion(Typing_st.STRING,new Typing_st.Coercion().init('string-cons',function(value){
  return Pair_st.buildFrom1(Array.from(value.value(),char=>ArcCharacter_st.makeFromCharCode(char.codePointAt(0))));
}));
Typing_st.STRING.addCoercion(Typing_st.CHAR,new Typing_st.Coercion().init('char-string',function(value){
  return ArcString_st.make(String.fromCodePoint(value.value()));
}));
Typing_st.SYM.addCoercion(Typing_st.CHAR,new Typing_st.Coercion().init('char-sym',function(value){
  return ArcSymbol_st.mkSym(String.fromCodePoint(value.value()));
}));
