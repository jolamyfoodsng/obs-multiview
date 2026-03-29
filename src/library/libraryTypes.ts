/**
 * libraryTypes.ts — Type definitions for the Library module (media only).
 *
 * Songs reuse the existing `Song` type from `../worship/types`.
 */

export interface MediaItem {
  id: string;
  /** Display name, e.g. "Welcome_Loop.mp4" */
  name: string;
  /** "image" | "video" */
  type: "image" | "video";
  /**
   * Overlay-server URL for preview/playback in the UI, e.g.
   * "http://127.0.0.1:45678/uploads/Welcome_Loop.mp4"
   * Legacy items may still hold a data-URL here.
   */
  url: string;
  /**
   * Absolute local file path on disk, e.g.
   * "~/Documents/OBSChurchStudio/uploads/Welcome_Loop.mp4"
   * Used by OBS native sources (ffmpeg_source / image_source).
   */
  filePath?: string;
  /**
   * Just the filename stored on disk inside the uploads folder.
   * Used to build overlay URLs on any origin.
   */
  diskFileName?: string;
  /** Optional thumbnail data-URL (for videos a poster frame) */
  thumbnailUrl?: string;
  /** Duration in seconds (videos only) */
  durationSec?: number;
  /** File size in bytes */
  fileSize?: number;
  /** MIME type, e.g. "video/mp4" */
  mimeType?: string;
  /** ISO date string */
  createdAt: string;
}
