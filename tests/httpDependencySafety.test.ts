import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

test('malformed compressed JSON cannot terminate the HTTP server', () => {
  // Run out of process: the vulnerable parser throws after the response and kills Node.
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import express from 'express';
    import {gzipSync} from 'node:zlib';
    import assert from 'node:assert/strict';
    const app=express();
    app.use(express.json());
    app.post('/', (req,res)=>res.json(req.body));
    app.get('/health', (_req,res)=>res.send('ok'));
    const server=app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    const url='http://127.0.0.1:'+server.address().port;
    try {
      const valid=await fetch(url,{method:'POST',headers:{'content-type':'application/json','content-encoding':'gzip'},body:gzipSync('{"test":true}')});
      assert.deepEqual(await valid.json(),{test:true});
      const malformed=Buffer.concat([gzipSync('{"test":true}'),Buffer.from('invalid trailing bytes')]);
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','content-encoding':'gzip'},body:malformed});
      await response.text();
      await new Promise(resolve=>setTimeout(resolve,30));
      assert.equal(await (await fetch(url+'/health')).text(),'ok');
    } finally {server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}
  `], { encoding:'utf8', timeout:10000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

test('Vercel configuration schemas remain compatible with the patched Zod dependency', () => {
  const require = createRequire(import.meta.url);
  const {globalConfigSchema, authConfigSchema} = require('@vercel/cli-config');
  const config={currentTeam:'fixture',telemetry:{enabled:false},futureSetting:'preserved'};
  assert.deepEqual(globalConfigSchema.parse(config),config);
  assert.equal(globalConfigSchema.safeParse({telemetry:{enabled:'false'}}).success,false);
  assert.deepEqual(authConfigSchema.parse({skipWrite:true}),{skipWrite:true});
  assert.equal(typeof require('@vercel/functions').waitUntil,'function');
});
