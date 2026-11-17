import test from 'node:test';
import assert from 'node:assert/strict';
import {validRequestOrigin} from '../app/request-origin.mjs';
const request=(origin,authorization)=>new Request('http://127.0.0.1:3100/api/campaigns',{headers:{...(origin?{origin}:{}),...(authorization?{authorization}:{})}});
test('lamp-post writes accept canonical and www production origins behind the TLS proxy',()=>{
 for(const origin of ['https://spotlight.co.tz','https://www.spotlight.co.tz','http://127.0.0.1:3100',undefined])assert.equal(validRequestOrigin(request(origin)),true);
});
test('native origins require an explicit bearer session; unrelated or spoofed origins remain rejected',()=>{
 for(const origin of ['http://localhost','https://localhost','capacitor://localhost']){assert.equal(validRequestOrigin(request(origin,'Bearer token')),true);assert.equal(validRequestOrigin(request(origin)),false);}
 for(const origin of ['null','https://spotlight.co.tz.evil.test','https://evil.test','https://www.spotlight.co.tz:444'])assert.equal(validRequestOrigin(request(origin,'Bearer token')),false);
 const forged=new Request('http://internal/api/campaigns',{headers:{origin:'https://evil.test','x-forwarded-host':'evil.test'}});assert.equal(validRequestOrigin(forged),false);
});
