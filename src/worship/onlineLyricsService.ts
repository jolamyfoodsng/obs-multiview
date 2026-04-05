import { invoke } from "@tauri-apps/api/core";

export interface OnlineLyricsSearchResult {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  artist: string;
  url: string;
  preview: string;
  lyrics: string;
  thumbnailUrl?: string | null;
}

export async function searchOnlineSongLyrics(query: string): Promise<OnlineLyricsSearchResult[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 3) {
    return [];
  }

  const results = await invoke<OnlineLyricsSearchResult[]>("search_online_song_lyrics", {
    query: trimmedQuery,
  });

  return Array.isArray(results) ? results : [];
}
