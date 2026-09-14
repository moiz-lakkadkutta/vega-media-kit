declare module 'shaka-player' {
  // Minimal surface used by the Vega adapter. Consumers get full types from shaka-player itself.
  export class Player {
    constructor(media?: HTMLMediaElement)
    attach(media: HTMLMediaElement): Promise<void>
    load(uri: string, startTime?: number): Promise<void>
    destroy(): Promise<void>
    configure(config: Record<string, unknown>): boolean
    addEventListener(type: string, listener: (e: Event & Record<string, unknown>) => void): void
    getVariantTracks(): unknown[]
    getTextTracks(): unknown[]
    selectVariantTrack(track: unknown, clearBuffer?: boolean, safeMargin?: number): void
    selectTextTrack(track: unknown): void
    setTextTrackVisibility(visible: boolean): Promise<void>
  }
}
