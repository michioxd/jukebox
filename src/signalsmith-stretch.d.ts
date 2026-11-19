declare module "signalsmith-stretch" {
    interface StretchNode extends AudioWorkletNode {
        latency(): Promise<number>;
        start(settings: { active: boolean; output: number; semitones: number }): Promise<unknown>;
    }

    const createStretch: {
        (context: AudioContext, options: AudioWorkletNodeOptions): Promise<StretchNode>;
        moduleUrl: string;
    };
    export default createStretch;
}
