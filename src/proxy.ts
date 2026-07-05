/** @public — proxy module API. Import from here, not from proxy/ directly. */
export {
  executeProxyRequest,
  type FailoverContext,
} from "./proxy/execute-proxy-request";
export { mutateRequest } from "./proxy/mutate-request";
export { ProxyResponse } from "./proxy/proxy-response";
export { routeRequest } from "./proxy/route-request";
export { routingMemory } from "./proxy/routing-memory";
