import type { CustomArrayDict } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  Reference,
  TFile
} from 'obsidian';
import type { Mock } from 'vitest';

import { DUMMY_PATH } from 'obsidian-dev-utils/obsidian/attachment-path';
import { getFileOrNull } from 'obsidian-dev-utils/obsidian/file-system';
import { getBacklinksForFileSafe } from 'obsidian-dev-utils/obsidian/metadata-cache';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { AttachmentPathManager } from './attachment-path-manager.ts';
import type { HandedOverSettingsComponent } from './handed-over-settings-component.ts';

import { PluginApiImpl } from './plugin-api-impl.ts';
import { PLUGIN_API_CONTRACT } from './plugin-api.ts';
import { ActionContext } from './token-evaluator-context.ts';

vi.mock('obsidian-dev-utils/obsidian/file-system', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian-dev-utils/obsidian/file-system')>(),
  getFileOrNull: vi.fn()
}));

vi.mock('obsidian-dev-utils/obsidian/metadata-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('obsidian-dev-utils/obsidian/metadata-cache')>(),
  getBacklinksForFileSafe: vi.fn()
}));

const mockGetBacklinksForFileSafe = vi.mocked(getBacklinksForFileSafe);
const mockGetFileOrNull = vi.mocked(getFileOrNull);

const ATTACHMENT_FILE = createFile('Attachments/image.png');
const NOTE_PATH = 'Notes/Alpha.md';

function createBacklinks(referencesByNotePath: Record<string, Reference[]>): CustomArrayDict<Reference> {
  return strictProxy<CustomArrayDict<Reference>>({
    get: (key: string) => referencesByNotePath[key] ?? null
  });
}

function createFile(path: string): TFile {
  return strictProxy<TFile>({
    extension: path.split('.').at(-1) ?? '',
    name: path.split('/').at(-1) ?? '',
    path
  });
}

describe('PluginApiImpl', () => {
  let getAttachmentFolderFullPathForPath: Mock<AttachmentPathManager['getAttachmentFolderFullPathForPath']>;
  let getProperAttachmentPath: Mock<AttachmentPathManager['getProperAttachmentPath']>;
  let getSequenceNumberMap: Mock<AttachmentPathManager['getSequenceNumberMap']>;
  let ignoredPaths: Set<string>;
  let pluginApi: PluginApiImpl;

  beforeEach(() => {
    vi.clearAllMocks();

    ignoredPaths = new Set<string>();
    getAttachmentFolderFullPathForPath = vi.fn().mockResolvedValue('Attachments/Alpha');
    getProperAttachmentPath = vi.fn().mockResolvedValue('Attachments/Alpha/image.png');
    getSequenceNumberMap = vi.fn().mockResolvedValue(new Map([[ATTACHMENT_FILE.path, 3]]));

    pluginApi = new PluginApiImpl({
      app: strictProxy<App>({}),
      attachmentPathManager: strictProxy<AttachmentPathManager>({
        getAttachmentFolderFullPathForPath,
        getProperAttachmentPath,
        getSequenceNumberMap
      }),
      handedOverSettingsComponent: strictProxy<HandedOverSettingsComponent>({
        isPathIgnored: (path: string) => ignoredPaths.has(path)
      })
    });

    mockGetFileOrNull.mockReturnValue(ATTACHMENT_FILE);
    mockGetBacklinksForFileSafe.mockResolvedValue(createBacklinks({ [NOTE_PATH]: [strictProxy<Reference>({})] }));
  });

  it('should declare every method the contract names', () => {
    for (const methodName of Object.keys(PLUGIN_API_CONTRACT)) {
      expect(pluginApi).toHaveProperty(methodName, expect.any(Function));
    }
  });

  describe('getAttachmentFolderPath', () => {
    it('should answer for the note it was asked about', async () => {
      await expect(pluginApi.getAttachmentFolderPath({ notePath: NOTE_PATH })).resolves.toBe('Attachments/Alpha');

      expect(getAttachmentFolderFullPathForPath).toHaveBeenCalledWith(expect.objectContaining({ notePath: NOTE_PATH }));
    });

    it('should read in a context that never asks the user anything', async () => {
      await pluginApi.getAttachmentFolderPath({ notePath: NOTE_PATH });

      expect(getAttachmentFolderFullPathForPath).toHaveBeenCalledWith(expect.objectContaining({ actionContext: ActionContext.ReadApi }));
    });

    it('should stand the placeholder name in when the caller named no attachment', async () => {
      await pluginApi.getAttachmentFolderPath({ notePath: NOTE_PATH });

      expect(getAttachmentFolderFullPathForPath).toHaveBeenCalledWith(expect.objectContaining({ attachmentFileName: DUMMY_PATH }));
    });

    it('should pass the attachment name on when the caller supplied one', async () => {
      await pluginApi.getAttachmentFolderPath({ attachmentFileName: 'image.png', notePath: NOTE_PATH });

      expect(getAttachmentFolderFullPathForPath).toHaveBeenCalledWith(expect.objectContaining({ attachmentFileName: 'image.png' }));
    });

    it('should answer with null for a note the plugin leaves alone', async () => {
      ignoredPaths.add(NOTE_PATH);

      await expect(pluginApi.getAttachmentFolderPath({ notePath: NOTE_PATH })).resolves.toBeNull();
      expect(getAttachmentFolderFullPathForPath).not.toHaveBeenCalled();
    });
  });

  describe('getProperAttachmentPath', () => {
    it('should answer with the path the attachment belongs at', async () => {
      await expect(pluginApi.getProperAttachmentPath({ attachmentPathOrFile: ATTACHMENT_FILE.path, notePath: NOTE_PATH }))
        .resolves.toBe('Attachments/Alpha/image.png');
    });

    it('should resolve the sequence number from the note own numbering', async () => {
      await pluginApi.getProperAttachmentPath({ attachmentPathOrFile: ATTACHMENT_FILE.path, notePath: NOTE_PATH });

      expect(getSequenceNumberMap).toHaveBeenCalledWith(NOTE_PATH);
      expect(getProperAttachmentPath).toHaveBeenCalledWith(expect.objectContaining({
        actionContext: ActionContext.ReadApi,
        sequenceNumber: 3
      }));
    });

    it('should answer with null for a path no file answers to', async () => {
      mockGetFileOrNull.mockReturnValue(null);

      await expect(pluginApi.getProperAttachmentPath({ attachmentPathOrFile: 'Never/Written.png', notePath: NOTE_PATH })).resolves.toBeNull();
      expect(getProperAttachmentPath).not.toHaveBeenCalled();
    });

    it('should answer with null when the note does not reference the attachment', async () => {
      mockGetBacklinksForFileSafe.mockResolvedValue(createBacklinks({ 'Notes/Beta.md': [strictProxy<Reference>({})] }));

      await expect(pluginApi.getProperAttachmentPath({ attachmentPathOrFile: ATTACHMENT_FILE.path, notePath: NOTE_PATH })).resolves.toBeNull();
      expect(getProperAttachmentPath).not.toHaveBeenCalled();
    });

    it('should answer with null for an attachment the plugin leaves alone', async () => {
      ignoredPaths.add(ATTACHMENT_FILE.path);

      await expect(pluginApi.getProperAttachmentPath({ attachmentPathOrFile: ATTACHMENT_FILE.path, notePath: NOTE_PATH })).resolves.toBeNull();
      expect(getProperAttachmentPath).not.toHaveBeenCalled();
    });

    it('should answer with null for a note the plugin leaves alone', async () => {
      ignoredPaths.add(NOTE_PATH);

      await expect(pluginApi.getProperAttachmentPath({ attachmentPathOrFile: ATTACHMENT_FILE.path, notePath: NOTE_PATH })).resolves.toBeNull();
      expect(getProperAttachmentPath).not.toHaveBeenCalled();
    });
  });
});
