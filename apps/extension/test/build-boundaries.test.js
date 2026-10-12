import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Exercise the real produced manifest/config and rejected distribution destinations.
test('LAN distribution requires an explicit private single origin; standard builds keep their HTTPS boundary',()=>{
 const output=mkdtempSync(resolve('../../.tmp/extension-build-'));
 const build=(api,dashboard,lan)=>spawnSync(process.execPath,['build.js'],{encoding:'utf8',env:{...process.env,WIKIMF_API_ORIGIN:api,WIKIMF_DASHBOARD_ORIGIN:dashboard,WIKIMF_LAN_TEST_MODE:lan,WIKIMF_EXTENSION_OUTPUT:pathToFileURL(output+'/').href}});
 for(const [api,dashboard,lan] of [
  ['http://192.168.11.10:8080','http://192.168.11.10:8080',''],
  ['http://8.8.8.8:8080','http://8.8.8.8:8080','1'],
  ['http://192.168.11.10:8080','http://192.168.11.11:8080','1'],
  ['http://reader.invalid:8080','http://reader.invalid:8080','1'],
  ['http://user:secret@192.168.11.10:8080','http://192.168.11.10:8080','1']
 ])assert.notEqual(build(api,dashboard,lan).status,0,'Unsafe distribution build must be rejected');
 assert.equal(build('http://192.168.11.10:8080','http://192.168.11.10:8080','1').status,0);
 const manifest=JSON.parse(readFileSync(output+'/manifest.json','utf8'));
 assert.equal(manifest.name,'wikimf LAN 検証');assert.equal(manifest.version,'0.1.2');
 assert.deepEqual(manifest.host_permissions,['https://ja.wikipedia.org/*','https://en.wikipedia.org/*','http://192.168.11.10:8080/*']);
 assert.ok(!manifest.permissions.includes('cookies'));
 const config=readFileSync(output+'/config.js','utf8');assert.ok(config.includes("CLIENT_VERSION='0.1.2-lan'"));
 assert.equal(build('https://reader.invalid','https://reader.invalid','').status,0);
 assert.ok(!JSON.parse(readFileSync(output+'/manifest.json','utf8')).host_permissions.some(p=>p.startsWith('http:')));
});
