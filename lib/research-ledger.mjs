// Versioned approved decisions + original baseline direction; extended bars never enter.
import {policyContext} from './approved-policy.mjs';
export function decisionRows(feed,session,observedAt=Date.now()){return policyContext(feed,session,observedAt).rows;}
