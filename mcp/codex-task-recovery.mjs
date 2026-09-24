// Only this terminal native failure is eligible. Never use substring matching:
// provider text may carry a different cause, a URL, a prompt, or a credential.
export const ROUTE_TIMEOUT='workspace routing discovery timed out'
export const MAX_ROUTE_RETRIES=5

export const isRouteTimeout=message=>message===ROUTE_TIMEOUT

export function mayRecoverRouteTimeout({terminal,activitySeen,usageAdvanced,goalStatus,activeTurnCount,attempts,aborted}) {
 return terminal?.status==='failed'
  && typeof terminal.id==='string' && terminal.id.length>0
  && isRouteTimeout(terminal.error?.message)
  && activitySeen===false && usageAdvanced===false
  && goalStatus===null && activeTurnCount===0
  && Number.isInteger(attempts) && attempts>=0 && attempts<MAX_ROUTE_RETRIES
  && aborted===false
}

export function routeTimeoutFailure(attempts) {
 if(!Number.isInteger(attempts)||attempts<0||attempts>MAX_ROUTE_RETRIES)throw Error('Invalid routing recovery count')
 return Error('Codex workspace-routing-timeout:'+attempts)
}
