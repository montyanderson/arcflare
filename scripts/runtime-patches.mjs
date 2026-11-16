// Checked transformations for code nested inside the vendored parser.
// The checked-in Rainbow file remains byte-identical to its upstream version.
export function patchRuntime(source,stringReader){
  function replace(before,after,count=1){
    if(source.split(before).length-1!==count)throw new Error('Rainbow parser patch no longer matches: '+before);
    source=source.replaceAll(before,after);
  }
  replace('String.fromCharCode( charCode )','String.fromCodePoint( charCode )',2);
  replace('soFar.length === 1','Array.from( soFar ).length === 1');
  replace('soFar.charCodeAt( 0 )','soFar.codePointAt( 0 )');
  // The port accidentally tests the error argument instead of the character.
  replace('/[^a-zA-Z]/.test( e )','/[^a-zA-Z]/.test( c )');
  replace('e.charCodeAt( 0 )','c.codePointAt( 0 )');
  const start=source.indexOf('    function finishInterpolatedString( parts, then ) {');
  const end=source.indexOf('    function finishNamedCharacter( soFar, then ) {',start);
  if(start<0||end<0)throw new Error('Rainbow string reader no longer matches');
  return source.slice(0,start)+stringReader+'\n'+source.slice(end);
}
