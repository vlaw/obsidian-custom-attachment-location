import type { App } from 'obsidian';

import { DUMMY_PATH } from 'obsidian-dev-utils/obsidian/attachment-path';
import { getFileOrNull } from 'obsidian-dev-utils/obsidian/file-system';
import { getBacklinksForFileSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';

import type { AttachmentPathManager } from './attachment-path-manager.ts';
import type { HandedOverSettingsComponent } from './handed-over-settings-component.ts';
import type {
  CustomAttachmentLocationApi,
  GetAttachmentFolderPathParams,
  GetProperAttachmentPathParams
} from './plugin-api.ts';

import { ActionContext } from './token-evaluator-context.ts';

interface PluginApiImplConstructorParams {
  readonly app: App;
  readonly attachmentPathManager: AttachmentPathManager;
  readonly handedOverSettingsComponent: HandedOverSettingsComponent;
}

/*
 * The published names, re-spelled under the names the params-interface convention wants. They are aliases
 * rather than separate declarations, so `api.d.ts` stays the single place either shape is described.
 */
type PluginApiImplGetAttachmentFolderPathParams = GetAttachmentFolderPathParams;

type PluginApiImplGetProperAttachmentPathParams = GetProperAttachmentPathParams;

/**
 * The published API, implemented over the same {@link AttachmentPathManager} the plugin's own commands drive.
 *
 * Built in `onloadImpl` and handed to the base through `getPluginApis`, so the registry record lives exactly
 * as long as the feature surface does: while the declared dependency is missing this plugin registers nothing
 * and the handle is revoked, rather than answering from torn-down components.
 */
export class PluginApiImpl implements CustomAttachmentLocationApi {
  private readonly app: App;
  private readonly attachmentPathManager: AttachmentPathManager;
  private readonly handedOverSettingsComponent: HandedOverSettingsComponent;

  public constructor(params: PluginApiImplConstructorParams) {
    this.app = params.app;
    this.attachmentPathManager = params.attachmentPathManager;
    this.handedOverSettingsComponent = params.handedOverSettingsComponent;
  }

  /**
   * The folder this plugin would put a new attachment of the note's in.
   *
   * @param params - The note, and optionally the attachment whose name the template may read.
   * @returns The folder path, or `null` when this plugin leaves the note alone.
   */
  public async getAttachmentFolderPath(params: PluginApiImplGetAttachmentFolderPathParams): Promise<null | string> {
    if (this.handedOverSettingsComponent.isPathIgnored(params.notePath)) {
      return null;
    }

    /*
     * `DUMMY_PATH` for a caller that named no attachment, matching what the plugin itself passes when it has
     * none in hand — the folder template may read the attachment's name, and Obsidian's own placeholder is
     * what every other probe in this plugin resolves that with.
     */
    return await this.attachmentPathManager.getAttachmentFolderFullPathForPath({
      actionContext: ActionContext.ReadApi,
      attachmentFileName: params.attachmentFileName ?? DUMMY_PATH,
      notePath: params.notePath
    });
  }

  /**
   * Where an attachment a note already references belongs.
   *
   * @param params - The note, and the attachment it references.
   * @returns The path it belongs at, or `null` when there is nothing to do.
   */
  public async getProperAttachmentPath(params: PluginApiImplGetProperAttachmentPathParams): Promise<null | string> {
    if (this.handedOverSettingsComponent.isPathIgnored(params.notePath)) {
      return null;
    }

    const attachmentFile = getFileOrNull({ app: this.app, pathOrFile: params.attachmentPathOrFile });

    if (!attachmentFile || this.handedOverSettingsComponent.isPathIgnored(attachmentFile.path)) {
      return null;
    }

    /*
     * The reference is read from the attachment's backlinks rather than from the note's own link list, so a
     * frontmatter link and a canvas node count exactly as a body link does — the same source the
     * `Move attachment to proper folder` command reads, and the reason a consumer supplies two paths instead
     * of a `Reference` it would have to construct.
     */
    const backlinks = await getBacklinksForFileSafe({
      app: this.app,
      pathOrFile: attachmentFile
    });
    const reference = backlinks.get(params.notePath)?.[0];

    if (!reference) {
      return null;
    }

    const sequenceNumberByAttachmentPath = await this.attachmentPathManager.getSequenceNumberMap(params.notePath);

    return await this.attachmentPathManager.getProperAttachmentPath({
      actionContext: ActionContext.ReadApi,
      attachmentFile,
      noteFilePath: params.notePath,
      reference,
      sequenceNumber: sequenceNumberByAttachmentPath.get(attachmentFile.path) ?? 0
    });
  }
}
