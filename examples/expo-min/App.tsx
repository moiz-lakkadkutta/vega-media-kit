import React, { useRef, useState } from 'react'
import { View } from 'react-native'
import { KitPlayer, CueOverlay } from '@moizp/vega-media-kit'
import type { Cue, KitPlayerRef } from '@moizp/vega-media-kit'

// Apple's HLS example with multiple audio and subtitle tracks.
const SRC = 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8'

export default function App() {
  const ref = useRef<KitPlayerRef>(null)
  const [cues, setCues] = useState<Cue[]>([])
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <KitPlayer ref={ref} source={{ uri: SRC, type: 'hls' }} autoplay preferredText={{ languages: ['en', 'fr'] }} onCue={setCues} onTracks={(t) => console.log('tracks', t)} />
      <CueOverlay active={cues} primaryTrackId={cues[0]?.trackId} scale={0.5} />
    </View>
  )
}
