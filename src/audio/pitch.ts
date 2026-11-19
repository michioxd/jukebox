import processorUrl from "signalsmith-stretch?url&no-inline";
import createStretch from "signalsmith-stretch";

export interface PitchProcessor {
    node: AudioWorkletNode;
    latency: number;
}

export async function createPitchProcessor(
    context: AudioContext,
    channels: number,
    speed: number,
): Promise<PitchProcessor> {
    // Use the bundled worklet asset instead of the library's blob URL fallback.
    createStretch.moduleUrl = processorUrl;
    const node = await createStretch(context, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
    });
    try {
        const latency = await node.latency();
        await node.start({ active: true, output: 0, semitones: -12 * Math.log2(speed) });
        return { node, latency };
    } catch (error) {
        node.port.close();
        throw error;
    }
}
