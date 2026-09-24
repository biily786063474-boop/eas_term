import test from 'node:test'
import assert from 'node:assert/strict'
import {ROUTE_TIMEOUT,MAX_ROUTE_RETRIES,isRouteTimeout,mayRecoverRouteTimeout,routeTimeoutFailure} from '../../mcp/codex-task-recovery.mjs'

const eligible={terminal:{id:'turn-a',status:'failed',error:{message:'workspace routing discovery timed out'}},activitySeen:false,usageAdvanced:false,goalStatus:null,activeTurnCount:0,attempts:0,aborted:false}

test('only the exact terminal routing timeout qualifies',()=>{
 assert.equal(isRouteTimeout(ROUTE_TIMEOUT),true)
 for(const message of [ROUTE_TIMEOUT+' at https://private.example', '401 '+ROUTE_TIMEOUT,ROUTE_TIMEOUT.toUpperCase(),undefined])assert.equal(isRouteTimeout(message),false)
 assert.equal(mayRecoverRouteTimeout(eligible),true)
 for(const terminal of [{...eligible.terminal,status:'completed'}, {...eligible.terminal,id:''},{...eligible.terminal,error:{message:'other'}},undefined])assert.equal(mayRecoverRouteTimeout({...eligible,terminal}),false)
})

test('side effects, uncertain state, goals, cancellation and retry cap fail closed',()=>{
 assert.equal(MAX_ROUTE_RETRIES,2)
 for(const variation of [{activitySeen:true},{usageAdvanced:true},{goalStatus:'active'},{goalStatus:undefined},{activeTurnCount:1},{attempts:2},{aborted:true}])assert.equal(mayRecoverRouteTimeout({...eligible,...variation}),false)
})

test('failure category encodes only a bounded retry count',()=>{
 for(const attempts of [0,1,2])assert.equal(routeTimeoutFailure(attempts).message,'Codex workspace-routing-timeout:'+attempts)
 for(const attempts of [-1,3,1.2,'1'])assert.throws(()=>routeTimeoutFailure(attempts))
})
