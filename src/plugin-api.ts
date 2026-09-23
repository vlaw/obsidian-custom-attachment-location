/**
 * @file
 *
 * The runtime half of this plugin's published contract: the registry contract and its version.
 *
 * The TYPES are not declared here. They live in the repo-root `api.d.ts`, which is the file a consumer
 * reads, and are re-exported from it so there is exactly one declaration of each and nothing to drift.
 */

import type { PluginApiContract } from 'obsidian-dev-utils/obsidian/plugin/plugin-api';

export type {
  CustomAttachmentLocationApi,
  GetAttachmentFolderPathParams,
  GetProperAttachmentPathParams
} from '../api.d.ts';

/**
 * The contract this plugin publishes. It declares the method names; a consumer that wants schema validation
 * at the boundary supplies its own contract to `watchPluginApi`, and the consumer's wins.
 */
export const PLUGIN_API_CONTRACT: PluginApiContract = {
  getAttachmentFolderPath: {},
  getProperAttachmentPath: {}
};

/**
 * The version of the contract above — independent of the plugin's own version, so a consumer asks for `'^1'`
 * and keeps working across releases that change nothing it depends on.
 *
 * `1.0.0` is the pair of per-note reads. The surface is deliberately one API rather than one per question:
 * the collect-settings migration and the attachment-collecting call this plugin already offers by hand are
 * to become members here, which is an additive minor each time and nothing a consumer of `'^1'` notices.
 */
export const PLUGIN_API_VERSION = '1.0.0';
