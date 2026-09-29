import type { TextFileView } from 'obsidian';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

import { installReleasedPlugin } from '../scripts/helpers/download-released-plugin.ts';
import { findPluginSettingsComponent } from '../scripts/helpers/plugin-settings-component-finder.ts';

/*
 * Issue #92's follow-up: with Excalidraw listed so that an image pasted into a drawing is renamed, Excalidraw's
 * AUTO-EXPORT got renamed too.
 *
 * On every save Excalidraw writes `<drawing>.excalidraw.svg` and `.png` beside the drawing, creating them when they
 * are missing. A note that embeds the drawing as an image links to that export, so the export passed every test the
 * handler had: another plugin's fresh write, from a listed plugin, linked from a note. It was moved into the
 * attachment folder under the generated name, the next save wrote a fresh one at the drawing's path, and that one
 * was moved as well — a pile of `renamed 1.svg`, `renamed 2.svg`, and a `{{prompt}}` on every save.
 *
 * This suite runs that shape against the REAL Excalidraw with both auto-exports on, and pins that the exports stay
 * where Excalidraw writes them through two saves while the pasted image in the same drawing is still renamed.
 *
 * Excalidraw is its pinned RELEASE, installed and removed exactly as in
 * `externally-created-attachment-drawing-owner.desktop.integration.test.ts`. Its auto-export switches are set on its
 * in-memory settings and never saved, and the plugin folder is removed at the end.
 */

const EXCALIDRAW_PLUGIN_ID = 'obsidian-excalidraw-plugin';
const EXCALIDRAW_REPO = 'zsviczian/obsidian-excalidraw-plugin';
const EXCALIDRAW_VERSION = '2.27.3';

// A 1x1 PNG: the smallest image Excalidraw accepts as a paste.
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface ExcalidrawApiLike {
  addElementsToView: (shouldRepositionToCursor: boolean, shouldSave: boolean) => Promise<boolean>;
  addImage: (topX: number, topY: number, imageFile: string) => Promise<string>;
  addRect: (topX: number, topY: number, width: number, height: number) => string;
  create: (params: ExcalidrawCreateParams) => Promise<string>;
  reset: () => void;
  setView: (view: unknown) => unknown;
}

interface ExcalidrawCreateParams {
  readonly filename: string;
  readonly foldername: string;
  readonly onNewPane: boolean;
}

interface ExcalidrawPluginLike {
  readonly settings?: ExcalidrawSettingsLike;
}

interface ExcalidrawSettingsLike {
  autoexportPNG: boolean;
  autoexportSVG: boolean;
}

// Excalidraw's view is a `TextFileView` whose `save` takes a second flag that forces the write.
interface ExcalidrawViewLike extends TextFileView {
  save: (shouldPreventReload?: boolean, shouldForceSave?: boolean) => Promise<void>;
}

interface ExcalidrawWindow extends Window {
  ExcalidrawAutomate?: ExcalidrawApiLike;
}

interface ProbeResult {
  readonly drawingPath: string;
  readonly filePaths: string[];
  readonly isExcalidrawLoaded: boolean;
  readonly noteText: string;
  readonly renamedPaths: string[];
  readonly settingsFound: boolean;
}

interface ScopedSettings {
  attachmentFolderPath: string;
  generatedAttachmentFileName: string;
  otherPluginIdsForAttachmentRename: string[];
  renameAttachmentsCreatedByOtherPluginsMode: string;
}

describe('Excalidraw\'s auto-export, with Excalidraw listed (issue #92)', () => {
  it('stays where Excalidraw writes it through repeated saves, while the pasted image is still renamed', async () => {
    const vaultPath = getTemporaryVault().path;
    // Almost 5 MB of `main.js`, so it is written from Node rather than handed to the closure.
    /*
     * Release notes off: Excalidraw opens its Welcome dialog on every load that finds no recorded release, and the
     * second Excalidraw suite in one Obsidian instance then times out waiting for its drawing to open.
     */
    await installReleasedPlugin({ data: { showReleaseNotes: false }, pluginId: EXCALIDRAW_PLUGIN_ID, repo: EXCALIDRAW_REPO, vaultPath, version: EXCALIDRAW_VERSION });

    const result = await evalInObsidian({
      async callback({ app, excalidrawPluginId, findPluginSettingsComponent: findSettingsComponent, pngDataUrl }): Promise<ProbeResult> {
        // Module-scope constants are not captured by the serialized closure, so they live here.
        const WAIT_TIMEOUT_IN_MILLISECONDS = 15_000;
        const POLL_INTERVAL_IN_MILLISECONDS = 200;
        // Longer than the handler's 5-second wait for a note to link the file, so a move would have happened.
        const SETTLE_DELAY_IN_MILLISECONDS = 7000;

        function isScopedSettings(value: unknown): value is ScopedSettings {
          return typeof value === 'object' && value !== null
            && typeof (value as Record<string, unknown>)['renameAttachmentsCreatedByOtherPluginsMode'] === 'string'
            && typeof (value as Record<string, unknown>)['generatedAttachmentFileName'] === 'string'
            && typeof (value as Record<string, unknown>)['attachmentFolderPath'] === 'string'
            && Array.isArray((value as Record<string, unknown>)['otherPluginIdsForAttachmentRename']);
        }

        const emptyResult = { drawingPath: '', filePaths: [], isExcalidrawLoaded: false, noteText: '', renamedPaths: [] };
        const settingsComponent = findSettingsComponent(app.plugins.getPlugin('obsidian-custom-attachment-location'), isScopedSettings);
        if (!settingsComponent) {
          return { ...emptyResult, settingsFound: false };
        }

        const originalSettings = {
          attachmentFolderPath: settingsComponent.settings.attachmentFolderPath,
          generatedAttachmentFileName: settingsComponent.settings.generatedAttachmentFileName,
          otherPluginIdsForAttachmentRename: [...settingsComponent.settings.otherPluginIdsForAttachmentRename],
          renameAttachmentsCreatedByOtherPluginsMode: settingsComponent.settings.renameAttachmentsCreatedByOtherPluginsMode
        };

        const stamp = `${Date.now().toString()}-${Math.floor(performance.now()).toString()}`;
        const folderPath = `auto-export-${stamp}`;
        const pathsBeforeSuite = new Set(app.vault.getAllLoadedFiles().map((file) => file.path));
        const renamedPaths: string[] = [];
        const renameEventRef = app.vault.on('rename', (file, oldPath) => {
          if (oldPath.startsWith(`${folderPath}/`)) {
            renamedPaths.push(`${oldPath} -> ${file.path}`);
          }
        });

        async function waitFor(description: string, isDone: () => boolean): Promise<void> {
          const deadline = Date.now() + WAIT_TIMEOUT_IN_MILLISECONDS;
          while (!isDone()) {
            if (Date.now() >= deadline) {
              throw new Error(`timed out waiting for ${description}`);
            }
            await sleep(POLL_INTERVAL_IN_MILLISECONDS);
          }
        }

        async function saveAfter(ea: ExcalidrawApiLike, view: ExcalidrawViewLike, addElement: () => unknown): Promise<void> {
          ea.reset();
          ea.setView(view);
          await addElement();
          await ea.addElementsToView(false, true);
          // Excalidraw writes a pasted image, and runs its auto-export, on a FORCED save.
          await view.save(false, true);
          await sleep(SETTLE_DELAY_IN_MILLISECONDS);
        }

        try {
          await app.plugins.loadManifests();
          await app.plugins.enablePlugin(excalidrawPluginId);
          // Excalidraw's automation API exists before its settings do, and `create` reads them.
          await waitFor('Excalidraw to finish loading', () =>
            (window as ExcalidrawWindow).ExcalidrawAutomate !== undefined
            && (app.plugins.getPlugin(excalidrawPluginId) as ExcalidrawPluginLike | null)?.settings !== undefined);
          const ea = (window as ExcalidrawWindow).ExcalidrawAutomate;
          const excalidrawSettings = (app.plugins.getPlugin(excalidrawPluginId) as ExcalidrawPluginLike | null)?.settings;
          if (!ea || !excalidrawSettings) {
            return { ...emptyResult, settingsFound: true };
          }

          excalidrawSettings.autoexportSVG = true;
          excalidrawSettings.autoexportPNG = true;

          await settingsComponent.editAndSave((settings) => {
            settings.attachmentFolderPath = './assets/{{noteFileName}}';
            settings.generatedAttachmentFileName = `renamed-${stamp}`;
            // The enum's values ARE the display strings; this code runs inside Obsidian and cannot import them.
            settings.renameAttachmentsCreatedByOtherPluginsMode = 'Only listed plugins';
            settings.otherPluginIdsForAttachmentRename = ['advanced-rename-and-delete-handler', excalidrawPluginId];
          });

          await app.vault.createFolder(folderPath);
          const drawingName = `drawing-${stamp}`;
          // The note embeds the drawing's exports, which is what Excalidraw's embed type `SVG` / `PNG` inserts.
          await app.vault.create(`${folderPath}/note.md`, `![[${drawingName}.excalidraw.svg]]\n![[${drawingName}.excalidraw.png]]\n`);

          ea.reset();
          const drawingPath = await ea.create({ filename: drawingName, foldername: folderPath, onNewPane: false });
          await waitFor('the drawing to open in Excalidraw', () => app.workspace.getLeavesOfType('excalidraw').some((leaf) => (leaf.view as ExcalidrawViewLike).file?.path === drawingPath));
          const leaf = app.workspace.getLeavesOfType('excalidraw').find((candidate) => (candidate.view as ExcalidrawViewLike).file?.path === drawingPath);
          const view = leaf?.view as ExcalidrawViewLike;

          // First save: the paste and both exports are written.
          await saveAfter(ea, view, () => ea.addImage(0, 0, pngDataUrl));
          // Second save: the exports are written again.
          await saveAfter(ea, view, () => ea.addRect(0, 0, 10, 10));

          const noteFile = app.vault.getFileByPath(`${folderPath}/note.md`);
          const noteText = noteFile ? await app.vault.read(noteFile) : '';
          leaf?.detach();
          return {
            drawingPath,
            filePaths: app.vault.getFiles().filter((file) => file.path.startsWith(`${folderPath}/`)).map((file) => file.path).sort(),
            isExcalidrawLoaded: true,
            noteText,
            renamedPaths,
            settingsFound: true
          };
        } finally {
          app.vault.offref(renameEventRef);
          await settingsComponent.editAndSave((settings) => {
            settings.attachmentFolderPath = originalSettings.attachmentFolderPath;
            settings.generatedAttachmentFileName = originalSettings.generatedAttachmentFileName;
            settings.otherPluginIdsForAttachmentRename = originalSettings.otherPluginIdsForAttachmentRename;
            settings.renameAttachmentsCreatedByOtherPluginsMode = originalSettings.renameAttachmentsCreatedByOtherPluginsMode;
          });

          for (const leaf of app.workspace.getLeavesOfType('excalidraw')) {
            leaf.detach();
          }
          await app.plugins.disablePlugin(excalidrawPluginId);

          // Everything this suite or Excalidraw added to the vault, deepest first so a folder is empty when its turn comes.
          const addedPaths = app.vault.getAllLoadedFiles().map((file) => file.path).filter((path) => !pathsBeforeSuite.has(path));
          for (const path of addedPaths.sort((a, b) => b.length - a.length)) {
            const file = app.vault.getAbstractFileByPath(path);
            if (file) {
              await app.fileManager.trashFile(file);
            }
          }

          const pluginFolderPath = `${app.vault.configDir}/plugins/${excalidrawPluginId}`;
          if (await app.vault.adapter.exists(pluginFolderPath)) {
            await app.vault.adapter.rmdir(pluginFolderPath, true);
          }
          // So the removed plugin stops appearing in `app.plugins.manifests` for every later suite.
          await app.plugins.loadManifests();
        }
      },
      input: { excalidrawPluginId: EXCALIDRAW_PLUGIN_ID, findPluginSettingsComponent, pngDataUrl: PNG_DATA_URL },
      vaultPath
    });

    expect(result.settingsFound).toBe(true);
    expect(result.isExcalidrawLoaded).toBe(true);

    const drawingBasePath = result.drawingPath.slice(0, -'.md'.length);
    const drawingFolder = result.drawingPath.slice(0, result.drawingPath.lastIndexOf('/'));
    const drawingFileName = drawingBasePath.slice(drawingFolder.length + 1);
    const assetsFolder = `${drawingFolder}/assets/${drawingFileName}`;

    // Both exports are exactly where Excalidraw writes them, once each, and the note still embeds them there.
    expect(result.filePaths).toContain(`${drawingBasePath}.svg`);
    expect(result.filePaths).toContain(`${drawingBasePath}.png`);
    expect(result.filePaths.filter((path) => path.endsWith('.svg'))).toHaveLength(1);
    expect(result.noteText).toContain(`![[${drawingFileName}.svg]]`);
    expect(result.noteText).toContain(`![[${drawingFileName}.png]]`);

    // The pasted image is the only file renamed, into the drawing's folder, and nothing else was moved.
    expect(result.renamedPaths).toHaveLength(1);
    expect(result.renamedPaths[0]).toMatch(/\/Pasted Image [^/]+\.png -> /);
    expect(result.renamedPaths[0]).toContain(` -> ${assetsFolder}/renamed-`);
  }, 180_000);
});
