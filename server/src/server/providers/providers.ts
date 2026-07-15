/** @public — providers module API. Import from here, not from providers/ directly. */
export { discoverAndCacheModels } from "./model-discovery";
export { loadModelCacheSync } from "./model-discovery/load-model-cache-sync";
export {
  allProviders as providers,
  buildChatEndpoint,
  getModelId,
  type Provider,
} from "./registry";
