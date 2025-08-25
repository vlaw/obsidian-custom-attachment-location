import type {
  Reference,
  ReferenceCache,
  TFile,
  TFolder
} from 'obsidian';
import type { FileChange } from 'obsidian-dev-utils/obsidian/FileChange';
import type { PathOrAbstractFile } from 'obsidian-dev-utils/obsidian/FileSystem';
import type { ProcessOptions } from 'obsidian-dev-utils/obsidian/Vault';
import type { CanvasData } from 'obsidian/canvas.d.ts';

import {
  App,
  Notice,
  setIcon,
  Vault
} from 'obsidian';
import {
  abortSignalAny,
  INFINITE_TIMEOUT
} from 'obsidian-dev-utils/AbortController';
import { throwExpression } from 'obsidian-dev-utils/Error';
import { appendCodeBlock } from 'obsidian-dev-utils/HTMLElement';
import {
  normalizeOptionalProperties,
  removeUndefinedProperties,
  toJson
} from 'obsidian-dev-utils/ObjectUtils';
import { applyFileChanges } from 'obsidian-dev-utils/obsidian/FileChange';
import {
  getPath,
  isCanvasFile,
  isNote
} from 'obsidian-dev-utils/obsidian/FileSystem';
import {
  extractLinkFile,
  updateLink
} from 'obsidian-dev-utils/obsidian/Link';
import { loop } from 'obsidian-dev-utils/obsidian/Loop';
import {
  getAllLinks,
  getBacklinksForFileSafe,
  getCacheSafe
} from 'obsidian-dev-utils/obsidian/MetadataCache';
import { confirm } from 'obsidian-dev-utils/obsidian/Modals/Confirm';
import { addToQueue } from 'obsidian-dev-utils/obsidian/Queue';
import { referenceToFileChange } from 'obsidian-dev-utils/obsidian/Reference';
import {
  copySafe,
  process,
  renameSafe
} from 'obsidian-dev-utils/obsidian/Vault';
import { deleteEmptyFolderHierarchy } from 'obsidian-dev-utils/obsidian/VaultEx';
import {
  basename,
  dirname,
  extname,
  join,
  makeFileName
} from 'obsidian-dev-utils/Path';

import type { Plugin } from './Plugin.ts';

import {
  getAttachmentFolderFullPathForPath,
  getGeneratedAttachmentFileName
} from './AttachmentPath.ts';
import { selectMode } from './CollectAttachmentUsedByMultipleNotesModal.ts';
import { CollectAttachmentUsedByMultipleNotesMode } from './PluginSettings.ts';
import {
  hasPromptToken,
  Substitutions
} from './Substitutions.ts';

interface AttachmentMoveResult {
  newAttachmentPath: string;
  oldAttachmentPath: string;
}

interface CollectAttachmentContext {
  collectAttachmentUsedByMultipleNotesMode?: CollectAttachmentUsedByMultipleNotesMode;
  isAborted?: boolean;
}

export async function collectAttachments(
  plugin: Plugin,
  note: TFile,
  ctx: CollectAttachmentContext,
  abortSignal: AbortSignal
): Promise<void> {
  abortSignal.throwIfAborted();
  const app = plugin.app;

  if (ctx.isAborted) {
    return;
  }

  const notice = new Notice(`Collecting attachments for ${note.path}`);

  const attachmentsMap = new Map<string, string>();
  const isCanvas = isCanvasFile(app, note);

  await applyFileChanges(
    app,
    note,
    async (abortSignal2) => {
      abortSignal2.throwIfAborted();
      if (ctx.isAborted) {
        return [];
      }

      const cache = await getCacheSafe(app, note);
      abortSignal2.throwIfAborted();

      if (!cache) {
        return [];
      }

      const links = isCanvas ? await getCanvasLinks(app, note) : getAllLinks(cache);
      abortSignal2.throwIfAborted();
      const changes: FileChange[] = [];

      for (const link of links) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (ctx.isAborted) {
          return changes;
        }

        const attachmentMoveResult = await prepareAttachmentToMove(plugin, link, note.path, note.path);
        abortSignal2.throwIfAborted();
        if (!attachmentMoveResult) {
          continue;
        }

        if (plugin.settings.isExcludedFromAttachmentCollecting(attachmentMoveResult.oldAttachmentPath)) {
          console.warn(`Skipping collecting attachment ${attachmentMoveResult.oldAttachmentPath} as it is excluded from attachment collecting.`);
          continue;
        }

        const backlinks = await getBacklinksForFileSafe(app, attachmentMoveResult.oldAttachmentPath);
        abortSignal2.throwIfAborted();
        if (backlinks.keys().length > 1) {
          const backlinksSorted = backlinks.keys().sort((a, b) => a.localeCompare(b));
          const backlinksStr = backlinksSorted.map((backlink) => `- ${backlink}`).join('\n');

          async function applyCollectAttachmentUsedByMultipleNotesMode(
            collectAttachmentUsedByMultipleNotesMode: CollectAttachmentUsedByMultipleNotesMode
          ): Promise<boolean> {
            abortSignal2.throwIfAborted();
            if (!attachmentMoveResult) {
              return false;
            }

            switch (collectAttachmentUsedByMultipleNotesMode) {
              case CollectAttachmentUsedByMultipleNotesMode.Cancel:
                console.error(
                  `Cancelling collecting attachments, as attachment ${attachmentMoveResult.oldAttachmentPath} is referenced by multiple notes.\n${backlinksStr}`
                );
                new Notice('Collecting attachments cancelled. See console for details.');
                ctx.isAborted = true;
                return false;
              case CollectAttachmentUsedByMultipleNotesMode.Copy:
                // eslint-disable-next-line require-atomic-updates
                attachmentMoveResult.newAttachmentPath = await copySafe(app, attachmentMoveResult.oldAttachmentPath, attachmentMoveResult.newAttachmentPath);
                break;
              case CollectAttachmentUsedByMultipleNotesMode.Move:
                await moveAttachment();
                abortSignal2.throwIfAborted();
                break;
              case CollectAttachmentUsedByMultipleNotesMode.Prompt: {
                const { mode, shouldUseSameActionForOtherProblematicAttachments } = await selectMode(
                  app,
                  attachmentMoveResult.oldAttachmentPath,
                  backlinksSorted
                );
                if (shouldUseSameActionForOtherProblematicAttachments) {
                  ctx.collectAttachmentUsedByMultipleNotesMode = mode;
                }
                return applyCollectAttachmentUsedByMultipleNotesMode(mode);
              }
              case CollectAttachmentUsedByMultipleNotesMode.Skip:
                console.warn(
                  `Skipping collecting attachment ${attachmentMoveResult.oldAttachmentPath} as it is referenced by multiple notes.\n${backlinksStr}`
                );
                return false;
              default:
                throw new Error(`Unknown collect attachment used by multiple notes mode: ${plugin.settings.collectAttachmentUsedByMultipleNotesMode}`);
            }

            return true;
          }

          if (
            !await applyCollectAttachmentUsedByMultipleNotesMode(
              ctx.collectAttachmentUsedByMultipleNotesMode ?? plugin.settings.collectAttachmentUsedByMultipleNotesMode
            )
          ) {
            abortSignal2.throwIfAborted();
            continue;
          }
        } else {
          abortSignal2.throwIfAborted();
          await moveAttachment();
          abortSignal2.throwIfAborted();
        }

        async function moveAttachment(): Promise<void> {
          abortSignal2.throwIfAborted();
          if (!attachmentMoveResult) {
            return;
          }

          // eslint-disable-next-line require-atomic-updates
          attachmentMoveResult.newAttachmentPath = await renameSafe(app, attachmentMoveResult.oldAttachmentPath, attachmentMoveResult.newAttachmentPath);
          abortSignal2.throwIfAborted();
          await deleteEmptyFolderHierarchy(app, dirname(attachmentMoveResult.oldAttachmentPath));
        }

        attachmentsMap.set(attachmentMoveResult.oldAttachmentPath, attachmentMoveResult.newAttachmentPath);

        if (!isCanvas) {
          const newContent = updateLink({
            app,
            link,
            newSourcePathOrFile: note,
            newTargetPathOrFile: attachmentMoveResult.newAttachmentPath,
            oldTargetPathOrFile: attachmentMoveResult.oldAttachmentPath
          });

          changes.push(referenceToFileChange(link, newContent));
        }
      }

      return changes;
    },
    removeUndefinedProperties(normalizeOptionalProperties<Partial<ProcessOptions>>({
      timeoutInMilliseconds: getTimeoutInMilliseconds(plugin)
    }))
  );

  if (isCanvas) {
    await process(app, note, (abortSignal2, content) => {
      abortSignal2.throwIfAborted();
      const canvasData = JSON.parse(content) as CanvasData;
      for (const node of canvasData.nodes) {
        if (node.type !== 'file') {
          continue;
        }
        const newPath = attachmentsMap.get(node.file);
        if (!newPath) {
          continue;
        }
        node.file = newPath;
      }
      return toJson(canvasData);
    });
  }

  notice.hide();
}

export function collectAttachmentsCurrentFolder(plugin: Plugin, checking: boolean): boolean {
  const note = plugin.app.workspace.getActiveFile();
  if (!isNoteEx(plugin, note)) {
    return false;
  }

  if (!checking) {
    addToQueue(
      plugin.app,
      (abortSignal) => collectAttachmentsInFolder(plugin, note?.parent ?? throwExpression(new Error('Parent folder not found')), abortSignal),
      plugin.abortSignal,
      getTimeoutInMilliseconds(plugin)
    );
  }

  return true;
}

export function collectAttachmentsCurrentNote(plugin: Plugin, checking: boolean): boolean {
  const note = plugin.app.workspace.getActiveFile();
  if (!note || !isNoteEx(plugin, note)) {
    return false;
  }

  if (!checking) {
    if (plugin.settings.isPathIgnored(note.path)) {
      new Notice('Note path is ignored');
      console.warn(`Cannot collect attachments in the note as note path is ignored: ${note.path}.`);
      return true;
    }

    addToQueue(plugin.app, (abortSignal) => collectAttachments(plugin, note, {}, abortSignal), plugin.abortSignal, getTimeoutInMilliseconds(plugin));
  }

  return true;
}

export function collectAttachmentsEntireVault(plugin: Plugin): void {
  addToQueue(
    plugin.app,
    (abortSignal) => collectAttachmentsInFolder(plugin, plugin.app.vault.getRoot(), abortSignal),
    plugin.abortSignal,
    getTimeoutInMilliseconds(plugin)
  );
}

export async function collectAttachmentsInFolder(plugin: Plugin, folder: TFolder, abortSignal: AbortSignal): Promise<void> {
  abortSignal.throwIfAborted();
  if (
    !await confirm({
      app: plugin.app,
      message: createFragment((f) => {
        f.appendText('Do you want to collect attachments for all notes in folder: ');
        appendCodeBlock(f, folder.path);
        f.appendText(' and all its subfolders?');
        f.createEl('br');
        f.appendText('This operation cannot be undone.');
      }),
      title: createFragment((f) => {
        setIcon(f.createSpan(), 'lucide-alert-triangle');
        f.appendText(' Collect attachments in folder');
      })
    })
  ) {
    abortSignal.throwIfAborted();
    return;
  }
  plugin.consoleDebug(`Collect attachments in folder: ${folder.path}`);
  const noteFiles: TFile[] = [];
  Vault.recurseChildren(folder, (child) => {
    if (isNoteEx(plugin, child)) {
      noteFiles.push(child as TFile);
    }
  });

  noteFiles.sort((a, b) => a.path.localeCompare(b.path));

  const ctx: CollectAttachmentContext = {};
  const abortController = new AbortController();

  const combinedAbortSignal = abortSignalAny([abortController.signal, plugin.abortSignal]);

  await loop({
    abortSignal: combinedAbortSignal,
    buildNoticeMessage: (noteFile, iterationStr) => `Collecting attachments ${iterationStr} - ${noteFile.path}`,
    items: noteFiles,
    processItem: async (noteFile) => {
      combinedAbortSignal.throwIfAborted();
      if (plugin.settings.isPathIgnored(noteFile.path)) {
        console.warn(`Cannot collect attachments in the note as note path is ignored: ${noteFile.path}.`);
        return;
      }
      await collectAttachments(plugin, noteFile, ctx, combinedAbortSignal);
      combinedAbortSignal.throwIfAborted();
      if (ctx.isAborted) {
        abortController.abort();
      }
    },
    progressBarTitle: 'Custom Attachment Location: Collecting attachments...',
    shouldContinueOnError: true,
    shouldShowProgressBar: true
  });
}

export function isNoteEx(plugin: Plugin, pathOrFile: null | PathOrAbstractFile): boolean {
  if (!pathOrFile || !isNote(plugin.app, pathOrFile)) {
    return false;
  }

  const path = getPath(plugin.app, pathOrFile);
  return plugin.settings.treatAsAttachmentExtensions.every((extension) => !path.endsWith(extension));
}

async function getCanvasLinks(app: App, canvasFile: TFile): Promise<ReferenceCache[]> {
  const canvasData = await app.vault.readJson(canvasFile.path) as CanvasData;
  const paths = canvasData.nodes.filter((node) => node.type === 'file').map((node) => node.file);
  return paths.map((path) => ({
    link: path,
    original: path,
    position: {
      end: { col: 0, line: 0, loc: 0, offset: 0 },
      start: { col: 0, line: 0, loc: 0, offset: 0 }
    }
  }));
}

function getTimeoutInMilliseconds(plugin: Plugin): number | undefined {
  return plugin.settings.collectAttachmentUsedByMultipleNotesMode === CollectAttachmentUsedByMultipleNotesMode.Prompt
      || hasPromptToken(plugin.settings.attachmentFolderPath)
      || hasPromptToken(plugin.settings.generatedAttachmentFileName)
    ? INFINITE_TIMEOUT
    : undefined;
}

async function prepareAttachmentToMove(
  plugin: Plugin,
  link: Reference,
  newNotePath: string,
  oldNotePath: string
): Promise<AttachmentMoveResult | null> {
  const app = plugin.app;

  const oldAttachmentFile = extractLinkFile(app, link, oldNotePath);
  if (!oldAttachmentFile) {
    console.warn(`Skipping collecting attachment ${link.link} as it could not be resolved.`);
    return null;
  }

  if (isNoteEx(plugin, oldAttachmentFile)) {
    console.warn(`Skipping collecting attachment ${oldAttachmentFile.path} as it is a note.`);
    return null;
  }

  const oldAttachmentPath = oldAttachmentFile.path;
  const oldAttachmentName = oldAttachmentFile.name;

  const oldNoteBaseName = basename(oldNotePath, extname(oldNotePath));
  const newNoteBaseName = basename(newNotePath, extname(newNotePath));

  let newAttachmentName: string;

  if (plugin.settings.shouldRenameCollectedAttachments) {
    newAttachmentName = makeFileName(
      await getGeneratedAttachmentFileName(
        plugin,
        new Substitutions({
          app: plugin.app,
          attachmentFileContent: await plugin.app.vault.readBinary(oldAttachmentFile),
          noteFilePath: newNotePath,
          originalAttachmentFileName: oldAttachmentFile.name
        })
      ),
      oldAttachmentFile.extension
    );
  } else if (plugin.settings.shouldRenameAttachmentFiles) {
    newAttachmentName = oldAttachmentName.replaceAll(oldNoteBaseName, newNoteBaseName);
  } else {
    newAttachmentName = oldAttachmentName;
  }

  const newAttachmentFolderPath = await getAttachmentFolderFullPathForPath(plugin, newNotePath, newAttachmentName);
  const newAttachmentPath = join(newAttachmentFolderPath, newAttachmentName);

  if (oldAttachmentPath === newAttachmentPath) {
    console.warn(`Skipping collecting attachment ${oldAttachmentFile.path} as it is already in the destination folder.`);
    return null;
  }

  return {
    newAttachmentPath,
    oldAttachmentPath
  };
}
